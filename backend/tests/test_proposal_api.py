"""LLM-I03: the authenticated proposal endpoint (C02-1 path, C02-4 contract).

No real model is called. The provider is given an ``httpx.MockTransport`` so the
gate and the chat call are exercised through the real route and the real provider
without touching a GPU. Nothing here is evidence of LLM quality.
"""

import json
import re
from pathlib import Path

import httpx
import pytest
from app.main import create_app
from app.services.llm import FakeLLM
from app.services.prompt_dictionary import load_dictionary
from app.services.proposal_provider import ProposalProviderClient
from conftest import HEADERS
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
REQUEST_ID = "req-0123456789"
ADMISSION = "http://127.0.0.1:8081/control"
GATE_KEY = "gate-control-key-for-tests-1234"
LLM_KEY = "llama-key-for-tests-1234567890"
MODEL = "qwen-test"


def body(**changes):
    payload = {
        "kind": "selection_hint",
        "request_id": REQUEST_ID,
        "target_family": "sd15",
        "dictionary_version": "1.2.0",
        "free_text_ko": "안경 없이 짧은 머리의 사람",
        "revisions": {
            "scene": "sha256:" + "a" * 64,
            "selection": "sha256:" + "b" * 64,
            "text": "sha256:" + "c" * 64,
        },
    }
    payload.update(changes)
    return payload


def reply(**changes):
    payload = {
        "proposal_id": "prop-0123456789",
        "request_id": REQUEST_ID,
        "status": "ready",
        "kind": "selection_hint",
        "provider": {"model": MODEL, "version": "2026-05", "latency_ms": 5,
                     "finish_reason": "stop"},
        "revisions": {
            "scene": "sha256:" + "a" * 64,
            "selection": "sha256:" + "b" * 64,
            "text": "sha256:" + "c" * 64,
        },
        "suggestions": [{"id": "appearance.short_hair", "matched_phrase": "짧은 머리",
                         "basis": "quote", "polarity": "affirmed", "actor": None,
                         "confidence": 0.9, "reason_ko": "머리 길이"}],
        "unresolved_spans": [], "ambiguities": [], "rejected": [], "truncated": False,
    }
    payload.update(changes)
    return payload


def chat(content=None, *, status=200, finish_reason="stop", model=None):
    """A provider envelope. LLM-R05: the envelope's stop reason/model are authoritative."""
    body = {"choices": [
        {"message": {"content": json.dumps(content if content is not None else reply())},
         "finish_reason": finish_reason}]}
    if model is not None:
        body["model"] = model
    return httpx.Response(status, json=body)


def configured(settings):
    """A settings object that can actually serve a proposal (non-fake, gated)."""
    settings.engine = "sdcpp"
    settings.admission_url = ADMISSION
    settings.admission_key = GATE_KEY
    settings.llm_api_key = LLM_KEY
    settings.llm_model = MODEL
    return settings


def install(app, handler):
    """Route the control GET and the chat POST through one recorded transport."""
    calls = []

    def transport(request):
        calls.append(request)
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        return handler(request)

    app.state.proposal_client = ProposalProviderClient(
        app.state.settings, transport=httpx.MockTransport(transport)
    )
    return calls


@pytest.fixture
def gated(settings):
    with TestClient(create_app(configured(settings), llm=FakeLLM()),
                    headers=HEADERS) as client:
        yield client


def test_capability_is_advertised_with_the_contract_shape(gated):
    value = gated.get("/api/v1/system/capabilities").json()["prompt_proposals"]
    assert value == {
        "schema_versions": [1],
        "max_response_bytes": 16384,
        "timeout_ms": 20000,
        "dictionary_version": "1.2.0",
    }


def test_capability_is_omitted_on_a_fake_engine_or_without_a_gate(settings):
    # C02-4: an unsupported server must look unsupported, not broken.
    for change in ({"engine": "fake"},
                   {"engine": "sdcpp", "admission_url": ""},
                   {"engine": "sdcpp", "admission_url": ADMISSION, "llm_model": ""}):
        configured(settings)
        for key, value in change.items():
            setattr(settings, key, value)
        with TestClient(create_app(settings, llm=FakeLLM()), headers=HEADERS) as client:
            assert "prompt_proposals" not in client.get("/api/v1/system/capabilities").json()
    settings.engine = "sdcpp"  # never leave a real-engine settings object behind


def test_request_requires_a_bearer_credential(settings):
    with TestClient(create_app(configured(settings), llm=FakeLLM())) as client:
        response = client.post("/api/v1/prompt/proposals", json=body())
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"


def test_unsupported_server_answers_not_configured_instead_of_failing(settings):
    """C02-4: an unconfigured server degrades to the rule-based suggestions."""
    configured(settings)
    settings.engine = "fake"  # no gate, no llama
    try:
        with TestClient(create_app(settings, llm=FakeLLM()), headers=HEADERS) as client:
            response = client.post("/api/v1/prompt/proposals", json=body())
            assert response.status_code == 200
            value = response.json()
            assert value["status"] == "unavailable"
            assert value["why"] == "not_configured"
            assert value["suggestions"] == []
            assert value["message"]
    finally:
        settings.engine = "sdcpp"


def test_unsupported_kind_is_a_200_not_a_schema_error(gated):
    # C01-4: translation/attribute_split are "not supported", not malformed.
    for kind in ("translation", "attribute_split", "warning_explain"):
        response = gated.post("/api/v1/prompt/proposals", json=body(kind=kind))
        assert response.status_code == 200
        assert response.json()["status"] == "unsupported_v1"


def test_ready_reply_is_returned_with_the_contract_fields(gated):
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/proposals", json=body())
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["status"] == "ready"
    assert value["proposal_id"] == "prop-0123456789"
    assert value["request_id"] == REQUEST_ID
    assert value["revisions"] == body()["revisions"]
    assert value["provider"]["model"] == MODEL
    assert [item["id"] for item in value["suggestions"]] == ["appearance.short_hair"]
    # Exactly one chat call and one control read: no retry, no extra probe.
    assert [call.method for call in calls] == ["GET", "POST"]


def test_the_reply_does_not_leak_credentials(gated):
    calls = install(gated.app, lambda request: chat())
    gated.post("/api/v1/prompt/proposals", json=body())
    chat_call = [call for call in calls if call.method == "POST"][0]
    # C02-1: only the llama key crosses the data path, never the gate control key.
    assert chat_call.headers["authorization"] == f"Bearer {LLM_KEY}"
    text = chat_call.content.decode()
    assert GATE_KEY not in text and LLM_KEY not in text


def test_stale_dictionary_version_is_refused_before_any_http(gated):
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/proposals", json=body(dictionary_version="1.1.0"))
    assert response.status_code == 200
    value = response.json()
    assert value["status"] == "unavailable"
    assert value["why"] == "stale_dictionary"
    assert value["message"]
    assert calls == []


def test_oversized_body_is_413_at_the_route(gated):
    # C02-2: 8 KiB is the proposal cap, far below BodyLimit's 64 KiB.
    install(gated.app, lambda request: chat())
    payload = body(free_text_ko="가" * 4000)
    raw = json.dumps(payload, ensure_ascii=False).encode()
    assert len(raw) > 8192
    response = gated.post("/api/v1/prompt/proposals",
                          content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_malformed_requests_are_422_not_200(gated):
    # A body that is not the agreed schema is a client bug, so it must be loud.
    install(gated.app, lambda request: chat())
    assert gated.post("/api/v1/prompt/proposals", content=b"{oops",
                      headers={"Content-Type": "application/json"}).status_code == 422
    assert gated.post("/api/v1/prompt/proposals",
                      json=body(request_id="short")).status_code == 422
    assert gated.post("/api/v1/prompt/proposals",
                      json=body(free_text_ko="")).status_code == 422
    # An unknown field must be rejected, mirroring extra="forbid" elsewhere.
    assert gated.post("/api/v1/prompt/proposals",
                      json=body(unexpected=True)).status_code == 422


def test_gpu_states_are_refused_with_distinct_messages(gated):
    gated.app.state.gpu.blocked = True
    blocked = gated.post("/api/v1/prompt/proposals", json=body()).json()
    gated.app.state.gpu.blocked = False
    gated.app.state.gpu.leased = True
    leased = gated.post("/api/v1/prompt/proposals", json=body()).json()
    gated.app.state.gpu.leased = False
    assert (blocked["why"], blocked["detail"]) == ("gpu_unavailable", "recovery_required")
    assert (leased["why"], leased["detail"]) == ("gpu_unavailable", "image_running")
    assert blocked["message"] != leased["message"]


def test_manual_policy_is_refused_rather_than_borrowing_the_gpu(gated):
    gated.app.state.db.state("policy", {"mode": "manual"})
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert (value["why"], value["detail"]) == ("gpu_unavailable", "manual_approval")


def test_upstream_status_and_invalid_reply_are_200_unavailable(gated):
    install(gated.app, lambda request: httpx.Response(503, json={"error": "down"}))
    assert gated.post("/api/v1/prompt/proposals", json=body()).json()["why"] == "upstream_status"

    install(gated.app, lambda request: httpx.Response(
        200, json={"choices": [{"message": {"content": "not an object"}}]}))
    broken = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert broken["status"] == "unavailable"
    assert broken["why"] == "invalid_reply"
    assert broken["suggestions"] == []


def test_gate_failure_is_its_own_code(gated):
    def transport(request):
        raise httpx.ConnectError("refused", request=request)

    gated.app.state.proposal_client = ProposalProviderClient(
        gated.app.state.settings, transport=httpx.MockTransport(transport)
    )
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["why"] == "gate_unreachable"


def test_paused_gate_is_reported_as_unavailable(gated):
    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": True, "waiting_requests": 0,
                                             "active_requests": 0})
        raise AssertionError("a paused gate must not receive the chat call")

    gated.app.state.proposal_client = ProposalProviderClient(
        gated.app.state.settings, transport=httpx.MockTransport(transport)
    )
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["why"] == "admission_paused"
    assert value["suggestions"] == []


def test_timeout_is_reported_and_nothing_is_adopted(gated):
    import asyncio

    async def handler(request):
        await asyncio.sleep(1)
        return chat()

    gated.app.state.proposal_client = ProposalProviderClient(
        gated.app.state.settings, transport=httpx.MockTransport(handler), timeout=0.05
    )
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["why"] == "timeout"
    assert value["detail"] == "50_ms"
    assert value["suggestions"] == [] and value["unresolved_spans"] == []


def test_validator_rejection_keeps_the_diagnostic_spans(gated):
    """A reply the validator refuses must still explain what was not understood.

    LLM-R05: the refusal is driven by the *envelope* stop reason, not by the model's own
    claim, so the fixture sets `finish_reason` on the transport response.
    """
    refused = reply(unresolved_spans=[{"text": "비 오는 밤", "why": "no_dictionary_entry",
                                       "polarity": "affirmed"}])
    install(gated.app, lambda request: chat(refused, finish_reason="length"))
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["why"] == "invalid_reply"
    assert value["detail"] == "incomplete_reply"
    assert value["suggestions"] == []
    assert [span["text"] for span in value["unresolved_spans"]] == ["비 오는 밤"]


def test_provider_facts_come_from_the_envelope_not_the_model(gated):
    """LLM-R05: a model cannot launder a truncated reply by writing `stop` itself.

    The envelope reports `length` and the alias the provider actually ran; the model
    claims a clean `stop` under a different model name. The response must carry the
    envelope's values, and the partial object must not be adopted.
    """
    liar = reply(provider={"model": "qwen-vl-official", "version": "9.9",
                           "latency_ms": 1, "finish_reason": "stop"},
                 suggestions=[{"id": "lighting.neon", "matched_phrase": "네온",
                               "basis": "quote", "polarity": "affirmed", "actor": None,
                               "confidence": 0.9, "reason_ko": ""}])
    install(gated.app, lambda request: chat(liar, finish_reason="length",
                                            model="qwen2.5-vl-7b@alias"))
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "invalid_reply"
    assert value["detail"] == "incomplete_reply"
    assert value["provider"]["finish_reason"] == "length"
    assert value["provider"]["model"] == "qwen2.5-vl-7b@alias"
    assert value["suggestions"] == []


def test_dictionary_mirror_matches_the_frontend_source():
    """The mirror is generated from dictionary.ts; drift must fail loudly.

    Python validates proposals against this mirror, while the browser accepts IDs
    from its own copy. If they diverge, the server can offer (or reject) an ID the
    browser does not have. LLM-R07: the comparison runs the real generator with
    `--stdout` and diffs it against the committed file, so the test cannot
    re-implement the format and quietly agree with itself.
    """
    import subprocess

    generated = subprocess.run(
        ["node", "--experimental-strip-types",
         str(ROOT / "scripts/gen-prompt-dictionary.mjs"), "--stdout"],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    assert generated.returncode == 0, generated.stderr
    mirror = json.loads((ROOT / "config/prompt_dictionary.json").read_text(encoding="utf-8"))
    assert json.loads(generated.stdout) == mirror, (
        "config/prompt_dictionary.json is stale: run "
        "`node --experimental-strip-types scripts/gen-prompt-dictionary.mjs`")

    # The version still comes from the TypeScript source, not from the mirror itself.
    source = (ROOT / "frontend/src/prompt/dictionary.ts").read_text(encoding="utf-8")
    version = re.search(r'DICTIONARY_VERSION = "([^"]+)"', source).group(1)
    assert mirror["dictionary_version"] == version

    # And the loader agrees with the file the endpoint will read (LLM-R02 fields too).
    loaded = load_dictionary(ROOT / "config/prompt_dictionary.json")
    assert loaded is not None
    assert loaded.version == version
    assert set(loaded.entries) == {item["id"] for item in mirror["entries"]}
    for item in mirror["entries"]:
        ref = loaded.entries[item["id"]]
        assert ref.category == item["category"], item["id"]
        assert ref.label_ko == item["label_ko"], item["id"]
        assert list(ref.aliases) == item["aliases"], item["id"]


def test_every_dictionary_entry_is_active_so_inactive_entry_is_unreachable():
    """LLM-R07: record the current `active` reality instead of implying a feature.

    `dictionary.ts` hardcodes ``active: true`` for every authored entry, so the
    ``inactive_entry`` branch in the validator and the ``inactive`` card block cannot be
    reached today. That is acceptable, but it must be stated rather than look like a
    working feature. If an entry ever becomes inactive, this test fails and asks for a
    real inactive-path test instead of letting the contract change silently.
    """
    loaded = load_dictionary(ROOT / "config/prompt_dictionary.json")
    assert loaded is not None
    assert len(loaded.entries) == 100
    inactive = [entry_id for entry_id, ref in loaded.entries.items() if not ref.active]
    assert inactive == [], (
        "an inactive entry now exists; add an inactive-path test for the validator "
        "and the card block instead of deleting this assertion")


def test_dictionary_loader_refuses_missing_or_malformed_files(tmp_path):
    from app.services.prompt_dictionary import load_dictionary as load

    assert load(tmp_path / "absent.json") is None
    broken = tmp_path / "broken.json"
    for content in ("{", "[]", '{"entries": []}',
                    '{"dictionary_version": "1", "entries": [{"id": "a"}]}',
                    '{"dictionary_version": "1", "entries": [{"id": "a", "category": "b"},'
                    ' {"id": "a", "category": "b"}]}'):
        broken.write_text(content, encoding="utf-8")
        # A broken mirror must not look like an empty, valid dictionary: the route
        # would then reject every suggestion as not_in_dictionary.
        assert load(broken) is None


def test_the_route_uses_the_same_dictionary_version_it_advertises(gated):
    advertised_version = gated.get("/api/v1/system/capabilities").json()[
        "prompt_proposals"]["dictionary_version"]
    install(gated.app, lambda request: chat())
    ok = gated.post("/api/v1/prompt/proposals",
                    json=body(dictionary_version=advertised_version)).json()
    stale = gated.post("/api/v1/prompt/proposals",
                       json=body(dictionary_version=f"{advertised_version}-old")).json()
    assert ok["status"] == "ready"
    assert stale["why"] == "stale_dictionary"


def test_unknown_ids_are_rejected_while_negated_ids_are_held(gated):
    mixed = reply(suggestions=[
        {"id": "lighting.glow", "matched_phrase": "조명", "basis": "quote",
         "polarity": "affirmed", "actor": None, "confidence": 0.5, "reason_ko": ""},
        {"id": "appearance.glasses", "matched_phrase": "안경", "basis": "quote",
         "polarity": "affirmed", "actor": None, "confidence": 0.7, "reason_ko": ""},
    ])
    install(gated.app, lambda request: chat(mixed))
    value = gated.post("/api/v1/prompt/proposals",
                       json=body(free_text_ko="안경 없이 짧은 머리의 사람")).json()
    assert [item["id"] for item in value["suggestions"]] == []
    assert {"raw_id": "lighting.glow", "why": "not_in_dictionary"} in value["rejected"]
    # "안경" is negated in the source text, so it is held instead of selected.
    assert value["unresolved_spans"][0]["why"] in {"negated", "polarity_conflict"}


def test_a_reply_for_another_revision_is_not_adopted(gated):
    # C01-2: a reply computed from other state must never be applied.
    stale = reply(revisions={"scene": "sha256:" + "d" * 64,
                             "selection": "sha256:" + "b" * 64,
                             "text": "sha256:" + "c" * 64})
    install(gated.app, lambda request: chat(stale))
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "invalid_reply"
    assert value["suggestions"] == []


def test_the_server_measures_latency_not_the_model(gated):
    install(gated.app, lambda request: chat(reply(provider={
        "model": MODEL, "version": "2026-05", "latency_ms": 999999, "finish_reason": "stop"})))
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    # A model cannot time its own round trip; the endpoint overwrites the claim.
    assert value["provider"]["latency_ms"] < 999999


def test_the_session_limit_is_per_credential_not_per_route():
    """C02-2 counts per credential; two clients must not share one bucket."""
    from app.api.proposals import credentials

    assert credentials("client-key-a") == credentials("client-key-a")
    assert credentials("client-key-a") != credentials("client-key-b")
    # The bucket key must not be the secret itself.
    assert "client-key-a" not in credentials("client-key-a")
    assert credentials(None).strip()


def test_cancelled_client_disconnect_is_reported_as_cancelled(gated, monkeypatch):
    """A browser abort must not become a timeout (C02-2 row '취소')."""
    from app.api.proposals import FAILURE_MESSAGES
    from app.services.proposal_provider import ProposalOutcome

    async def cancelled(*_args, **_kwargs):
        return ProposalOutcome(failure="cancelled", detail="client_disconnected")

    monkeypatch.setattr(ProposalProviderClient, "propose", cancelled)
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "cancelled"
    assert value["message"] == FAILURE_MESSAGES["cancelled"]


VARIANTS = [
    {
        "variant_id": "v1", "label_ko": "공원에서 걷기",
        "prompt_ko": "같은 인물과 의상으로 공원을 걷는다",
        "changed_ids": ["setting.park", "action.walking"],
        "removed_ids": ["location.street", "action.standing"],
        "unresolved_ko": [], "actor": None,
    },
]


def variant_body(**changes):
    payload = body(
        kind="situation_variants",
        free_text_ko="같은 인물과 의상으로 장소와 행동만 바꿔줘",
        selections=[
            {"id": "subject.person", "category": "subject"},
            {"id": "clothing.white_shirt", "category": "clothing"},
            {"id": "location.street", "category": "location"},
            {"id": "action.standing", "category": "action"},
        ],
        locked_ids=["subject.person", "clothing.white_shirt"],
    )
    payload.update(changes)
    return payload


def variant_reply(**changes):
    return reply(kind="situation_variants", suggestions=[],
                 **{"variants": VARIANTS, **changes})


def test_situation_variants_reply_carries_the_candidates_and_no_suggestions(gated):
    install(gated.app, lambda request: chat(variant_reply()))
    value = gated.post("/api/v1/prompt/proposals", json=variant_body()).json()
    assert value["status"] == "ready"
    assert value["kind"] == "situation_variants"
    # VAR01: candidates never become selection suggestions.
    assert value["suggestions"] == []
    assert [item["variant_id"] for item in value["variants"]] == ["v1"]
    assert value["variants"][0]["changed_ids"] == ["setting.park", "action.walking"]
    # The locale fallback in ``message_for`` must not leak into a ready reply.
    assert "message" not in value


def test_the_older_kinds_do_not_gain_a_variants_key(gated):
    """C01/I06 replies stay byte-identical: no new key, no new behaviour."""
    install(gated.app, lambda request: chat())
    value = gated.post("/api/v1/prompt/proposals", json=body()).json()
    assert value["kind"] == "selection_hint"
    assert "variants" not in value


def test_a_variant_request_that_fails_keeps_an_empty_candidates_key(gated):
    def transport(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        raise AssertionError("no chat call for a refused request")

    gated.app.state.proposal_client = ProposalProviderClient(
        gated.app.state.settings, transport=httpx.MockTransport(transport)
    )
    value = gated.post("/api/v1/prompt/proposals",
                       json=variant_body(dictionary_version="1.1.0")).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "stale_dictionary"
    assert value["kind"] == "situation_variants"
    # The card area can clear itself without guessing whether the key exists.
    assert value["variants"] == []


def test_a_variant_that_breaks_the_lock_is_rejected_by_the_server(gated):
    broken = [dict(VARIANTS[0], removed_ids=["clothing.white_shirt", "action.standing"])]
    install(gated.app, lambda request: chat(
        variant_reply(variants=broken)))
    value = gated.post("/api/v1/prompt/proposals", json=variant_body()).json()
    assert value["variants"] == []
    assert {"raw_id": "v1", "why": "locked", "id": "clothing.white_shirt"} in value["rejected"]


def test_groups_in_use_are_derived_from_the_dictionary_not_hardcoded():
    """LLM-R06: the allowed `target_groups` vocabulary comes from the dictionary.

    The stored categories are `action`/`location`/`composition`, but the browser and
    `target_groups` speak `pose`/`setting`/`camera`. Deriving the set keeps the two
    vocabularies from silently diverging when a category is added.
    """
    from app.services.prompt_proposals import DictionaryEntryRef as Ref
    from app.services.prompt_proposals import display_group, groups_in_use

    assert display_group("action") == "pose"
    assert display_group("location") == "setting"
    assert display_group("composition") == "camera"
    # A category with no rename passes through unchanged.
    assert display_group("lighting") == "lighting"

    entries = {
        "action.standing": Ref("action"),
        "location.street": Ref("location"),
        "lighting.neon": Ref("lighting"),
        "style.retired": Ref("style", active=False),
    }
    assert groups_in_use(entries) == {"pose", "setting", "lighting"}


def test_a_target_group_the_dictionary_lacks_is_a_contract_error(gated):
    """LLM-R06: an unknown group used to be answered as an empty success.

    `{"target_groups": ["props"]}` names no display group the dictionary has, so every
    entry was rejected as `out_of_scope` and the reply read "the model found no items".
    It is the request that is wrong, so the answer is a 422 before any model call.
    """
    called = install(gated.app, lambda request: chat())

    def chats():
        return [item for item in called if item.url.path.endswith("/chat/completions")]

    request = body(kind="partial_change", target_groups=["pose"], locked_ids=[])
    assert gated.post("/api/v1/prompt/proposals", json=request).status_code == 200
    assert len(chats()) == 1

    unknown = body(kind="partial_change", target_groups=["pose", "props"], locked_ids=[])
    response = gated.post("/api/v1/prompt/proposals", json=unknown)
    assert response.status_code == 422
    assert "props" in response.text
    # No second model call: the request never reached the provider.
    assert len(chats()) == 1

