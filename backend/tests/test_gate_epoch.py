"""LLM-I03: the gate epoch contract, with MockTransport and no GPU.

Every test here answers the same question from a different angle: does a caller
learn the truth about *why* the model was not asked? The gate rejects a data
request that cannot name the epoch it was built for, so a Studio call has to read
`/model-snapshot` immediately before the chat call and forward `X-Model-Epoch`.

Nothing here is evidence about model output. The reply in these tests is a fixed
string; meaning preservation is UCP04/UCP09's evaluation, not this file's.
"""

import json

import httpx
import pytest
from app.services.gate_epoch import (
    EPOCH_MISMATCH,
    SnapshotError,
    read_snapshot,
    rejection_detail,
    snapshot_url,
)
from app.services.prompt_compose import ComposeProviderClient
from app.services.prompt_proposals import DictionaryEntryRef, ProposalRequest
from app.services.proposal_provider import ProposalProviderClient
from conftest import SNAPSHOT_EPOCH, snapshot

ADMISSION = "http://127.0.0.1:8081/control"
GATE_KEY = "gate-control-key-for-tests-1234"
LLM_KEY = "llama-key-for-tests-1234567890"
MODEL = "qwen-test"

# A reply that satisfies the proposal validator, so a failure can only come from the
# gate path being tested rather than from a rejected body.
REPLY = {
    "proposal_id": "prop-0123456789",
    "request_id": "req-0123456789",
    "status": "ready",
    "kind": "selection_hint",
    "provider": {"model": MODEL, "version": "2026-05", "latency_ms": 5,
                 "finish_reason": "stop"},
    "revisions": {"scene": "sha256:" + "a" * 64, "selection": "sha256:" + "b" * 64,
                  "text": "sha256:" + "c" * 64},
    "suggestions": [{"id": "appearance.short_hair", "matched_phrase": "짧은 머리",
                     "basis": "quote", "polarity": "affirmed", "actor": None,
                     "confidence": 0.9, "reason_ko": "머리 길이"}],
    "unresolved_spans": [], "ambiguities": [], "rejected": [], "truncated": False,
}
DICTIONARY = {"appearance.short_hair": DictionaryEntryRef("appearance")}


def settings(model=MODEL):
    class Settings:
        admission_url = ADMISSION
        admission_key = GATE_KEY
        llm_api_key = LLM_KEY
        engine = "sdcpp"
        llm_model = model

    return Settings()


def chat():
    return httpx.Response(200, json={"choices": [{
        "message": {"content": json.dumps(REPLY)},
        "finish_reason": "stop"}], "model": MODEL})


def proposal_request():
    return ProposalRequest.model_validate({
        "kind": "selection_hint", "request_id": "req-0123456789",
        "target_family": "sd15", "dictionary_version": "1.2.0",
        "free_text_ko": "짧은 머리의 사람",
        "revisions": {"scene": "sha256:" + "a" * 64,
                      "selection": "sha256:" + "b" * 64,
                      "text": "sha256:" + "c" * 64},
    })


def proposal_client(transport, model=MODEL):
    return ProposalProviderClient(settings(model),
                                  transport=httpx.MockTransport(transport))


async def run_proposal(transport, *, model=MODEL):
    client = proposal_client(transport, model=model)
    return await client.propose(proposal_request(), session="s1", mode="auto",
                                blocked=False, leased=False, model=model,
                                dictionary=DICTIONARY, dictionary_version="1.2.0")


# 1. A healthy snapshot → the epoch goes out on the chat call.
@pytest.mark.asyncio
async def test_the_snapshot_epoch_is_forwarded_on_the_chat_call():
    seen = []

    def transport(request):
        seen.append(request)
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            return snapshot(MODEL)
        return chat()

    outcome = await run_proposal(transport)
    assert outcome.ok is True
    posts = [request for request in seen
             if request.url.path.endswith("/v1/chat/completions")]
    assert len(posts) == 1
    assert posts[0].headers["x-model-epoch"] == SNAPSHOT_EPOCH
    # The existing credential contract is untouched: still the llama key, never the
    # gate control key (C02-1).
    assert posts[0].headers["authorization"] == f"Bearer {LLM_KEY}"
    assert GATE_KEY not in posts[0].headers.get("authorization", "")


# 2. Snapshot paused → the chat call is never made.
@pytest.mark.asyncio
@pytest.mark.parametrize("snapshot_response", [
    lambda _request: snapshot(MODEL, ready=False),
    # The gate also answers 409 when it is paused; both must stop the call.
    lambda _request: httpx.Response(409, json={"detail": "model_epoch_mismatch"}),
])
async def test_a_paused_snapshot_blocks_the_inference_call(snapshot_response):
    posts = []

    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            return snapshot_response(request)
        posts.append(request)
        return chat()

    outcome = await run_proposal(transport)
    assert outcome.failure == "admission_paused"
    assert outcome.detail == "snapshot_not_ready"
    assert posts == [], "a paused snapshot must not be followed by an inference call"


# 3. A missing or malformed epoch is a clear failure, not a silent pass-through.
@pytest.mark.asyncio
@pytest.mark.parametrize("epoch, expected", [
    (None, "snapshot_invalid_epoch"),
    ("", "snapshot_invalid_epoch"),
    ("dc75b481", "snapshot_invalid_epoch"),      # the truncated value seen in a log
    ("Z" * 32, "snapshot_invalid_epoch"),        # right length, not hex
    ("0" * 33, "snapshot_invalid_epoch"),        # one character too long
])
async def test_a_missing_or_malformed_epoch_fails_clearly(epoch, expected):
    body = {"ready": True, "models": {"data": [{"id": MODEL}]}}
    if epoch is not None:
        body["epoch"] = epoch
    posts = []

    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            return httpx.Response(200, json=body)
        posts.append(request)
        return chat()

    outcome = await run_proposal(transport)
    assert outcome.failure == "gate_unreachable"
    assert outcome.detail == expected
    assert posts == []


# 4. The snapshot names a different model than the one configured → refuse.
@pytest.mark.asyncio
async def test_a_snapshot_naming_another_model_blocks_the_call():
    posts = []

    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            # The live host serves the full weights path; a short alias here stands in
            # for "something other than the configured value".
            return snapshot("/opt/models/some-other-model.gguf")
        posts.append(request)
        return chat()

    outcome = await run_proposal(transport)
    assert outcome.failure == "not_configured"
    # The detail names the model the gate *is* serving: that is the value the
    # operator needs for STUDIO_LLM_MODEL, and it cannot be guessed (llama exposes
    # the weights path when no --alias is set).
    assert outcome.detail == (
        "configured_model_unavailable: served=/opt/models/some-other-model.gguf")
    assert posts == [], "a model the gate is not serving must not receive the call"


# 5. A 409 on the chat call is passed through, never retried.
@pytest.mark.asyncio
async def test_a_chat_409_is_reported_without_a_retry():
    posts = []

    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            return snapshot(MODEL)
        posts.append(request)
        return httpx.Response(409, json={"detail": EPOCH_MISMATCH},
                              headers={"X-BC250-Admission": "rejected"})

    outcome = await run_proposal(transport)
    assert outcome.failure == "upstream_status"
    # The gate's own reason survives, so the caller can tell "the GPU owner moved"
    # from a generic upstream error.
    assert outcome.detail == EPOCH_MISMATCH
    assert len(posts) == 1, "a 409 must not be retried"


# 5b. The epoch changing between snapshot and call is exactly that case.
@pytest.mark.asyncio
async def test_an_epoch_change_between_snapshot_and_call_is_a_409():
    """The snapshot is read, then a hold lands, so the gate rejects the header."""
    gate = {"epoch": SNAPSHOT_EPOCH}
    posts = []

    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            # This read captures the epoch as it is *now*; the store is bumped below,
            # which is what a studio- or switch- hold does between the two calls.
            captured = gate["epoch"]
            gate["epoch"] = "f" * 32
            return snapshot(MODEL, epoch=captured)
        posts.append(request)
        # The gate compares what the caller sent with its current epoch.
        if request.headers.get("x-model-epoch") != gate["epoch"]:
            return httpx.Response(409, json={"detail": EPOCH_MISMATCH},
                                  headers={"X-BC250-Admission": "rejected"})
        return chat()

    outcome = await run_proposal(transport)
    assert outcome.failure == "upstream_status"
    assert outcome.detail == EPOCH_MISMATCH
    assert len(posts) == 1, "the stale header is reported, not retried"


# 6. A snapshot that times out or cannot connect is a safe, named failure.
@pytest.mark.asyncio
@pytest.mark.parametrize("error", [
    httpx.ConnectError("refused"),
    httpx.ReadTimeout("slow"),
    httpx.ConnectTimeout("slow"),
])
async def test_a_snapshot_transport_failure_is_reported_and_blocks(error):
    posts = []

    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            raise error
        posts.append(request)
        return chat()

    outcome = await run_proposal(transport)
    assert outcome.failure == "gate_unreachable"
    assert outcome.detail == f"snapshot_{type(error).__name__}"
    assert posts == []


@pytest.mark.asyncio
async def test_a_snapshot_with_a_broken_body_is_reported_and_blocks():
    posts = []

    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            return httpx.Response(200, text="<html>not json</html>")
        posts.append(request)
        return chat()

    outcome = await run_proposal(transport)
    assert outcome.failure == "gate_unreachable"
    assert outcome.detail == "snapshot_not_json"
    assert posts == []


# 7. The compose path gets the same treatment — it is a separate client class, and
#    a fix applied to one provider only would leave the other broken in production.
@pytest.mark.asyncio
async def test_compose_sends_the_snapshot_epoch_and_reports_a_409():
    import pathlib

    from app.models.schemas import ComposeRequest
    from app.services.prompt_compose import compose_revisions, validate_request
    from app.services.prompt_dictionary import load_dictionary
    from app.services.prompt_profiles import profile_for

    seen = []

    def transport(request):
        seen.append(request)
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        if request.url.path.endswith("/model-snapshot"):
            return snapshot(MODEL)
        return httpx.Response(409, json={"detail": EPOCH_MISMATCH},
                              headers={"X-BC250-Admission": "rejected"})

    class Registry:
        """The one lookup `validate_request` performs; nothing else is consulted."""

        def get(self, model_id):
            return {"family": "sd15", "validation_status": "verified",
                    "generation_options": {}, "presets": {}}

    root = pathlib.Path(__file__).resolve().parents[2]
    dictionary = load_dictionary(root / "config/prompt_dictionary.json")
    profile_version = profile_for("sd15").version
    # The browser computes these; the server recomputes and compares them, so the
    # request is built with the server's own function rather than a copied constant.
    revisions = compose_revisions(
        brief_ko="여성이 서 있다", selections=[], choices=[],
        target_model_id="sd15-model", target_family="sd15",
        profile_version=profile_version, dictionary_version=dictionary.version)
    request = ComposeRequest.model_validate({
        "schema_version": 1,
        "request_id": "cmp-0123456789ab", "brief_ko": "여성이 서 있다",
        "selections": [], "clarification_choices": [], "candidate_count": 1,
        "target_model_id": "sd15-model", "target_family": "sd15",
        "profile_version": profile_version,
        "dictionary_version": dictionary.version,
        "input_revision": revisions["input"],
    })
    validated = validate_request(request, registry=Registry(), dictionary=dictionary)

    client = ComposeProviderClient(settings(), transport=httpx.MockTransport(transport))
    outcome = await client.compose(validated, session="s1", mode="auto",
                                   blocked=False, leased=False,
                                   dictionary=dictionary.entries)
    assert outcome.failure == "upstream_status"
    assert outcome.detail == EPOCH_MISMATCH
    posts = [call for call in seen if call.url.path.endswith("/v1/chat/completions")]
    assert len(posts) == 1, "a 409 must not be retried"
    assert posts[0].headers["x-model-epoch"] == SNAPSHOT_EPOCH
    assert posts[0].headers["authorization"] == f"Bearer {LLM_KEY}"


# 8. The snapshot helpers themselves, without a provider in the way.
@pytest.mark.asyncio
async def test_snapshot_url_is_derived_from_the_control_url():
    assert snapshot_url(ADMISSION) == "http://127.0.0.1:8081/model-snapshot"
    assert snapshot_url("http://127.0.0.1:8081/control/") == (
        "http://127.0.0.1:8081/model-snapshot")


@pytest.mark.asyncio
async def test_read_snapshot_returns_every_served_model_id():
    async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={
                "ready": True, "epoch": SNAPSHOT_EPOCH,
                "models": {"data": [{"id": "a"}, {"id": "b"}]}}))) as client:
        epoch, ids = await read_snapshot(client, ADMISSION)
    assert (epoch, ids) == (SNAPSHOT_EPOCH, ["a", "b"])


@pytest.mark.asyncio
@pytest.mark.parametrize("body, detail", [
    ({"ready": True, "epoch": SNAPSHOT_EPOCH, "models": {"data": []}},
     "snapshot_no_model"),
    ({"ready": True, "epoch": SNAPSHOT_EPOCH}, "snapshot_invalid_models"),
    ({"ready": True, "epoch": SNAPSHOT_EPOCH, "models": {"data": [{"name": "x"}]}},
     "snapshot_no_model"),
    ({"epoch": SNAPSHOT_EPOCH, "models": {"data": [{"id": MODEL}]}}, "snapshot_invalid"),
])
async def test_an_unusable_snapshot_raises_with_a_named_reason(body, detail):
    async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json=body))) as client:
        with pytest.raises(SnapshotError) as caught:
            await read_snapshot(client, ADMISSION)
    assert caught.value.detail == detail


@pytest.mark.asyncio
async def test_a_non_200_snapshot_status_names_the_status():
    async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda _request: httpx.Response(500, text="boom"))) as client:
        with pytest.raises(SnapshotError) as caught:
            await read_snapshot(client, ADMISSION)
    assert caught.value.detail == "snapshot_http_500"
    assert caught.value.failure == "gate_unreachable"


def test_rejection_detail_only_claims_a_409_it_recognises():
    rejected = httpx.Response(409, json={"detail": EPOCH_MISMATCH},
                              headers={"X-BC250-Admission": "rejected"})
    assert rejection_detail(rejected) == EPOCH_MISMATCH

    # The header alone is enough: the gate's mark is the primary signal.
    header_only = httpx.Response(409, text="", headers={"X-BC250-Admission": "rejected"})
    assert rejection_detail(header_only) == EPOCH_MISMATCH

    # The reason alone is accepted too, so a gate revision that omits the header
    # still reports a real epoch rejection instead of an anonymous http_409.
    reason_only = httpx.Response(409, json={"detail": EPOCH_MISMATCH})
    assert rejection_detail(reason_only) == EPOCH_MISMATCH

    # Some other 409 must stay a plain status: it is not an admission decision.
    other = httpx.Response(409, json={"detail": "context_length_exceeded"})
    assert rejection_detail(other) is None
    assert rejection_detail(httpx.Response(200)) is None
