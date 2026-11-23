"""UCP03: the integrated compose endpoint and provider.

No real model is called. The provider is given an ``httpx.MockTransport`` so the gate
and the chat call are exercised through the real route and the real provider without
touching a GPU. **Nothing here is evidence of LLM quality** — it only shows that the
contract holds when the model says something specific. Meaning preservation is UCP04's
evaluation, and real-model behaviour is UCP09's.
"""

import asyncio
import json

import httpx
import pytest
from app.main import create_app
from app.models.schemas import ComposeRequest
from app.services.llm import FakeLLM
from app.services.prompt_compose import (
    MAX_REQUEST_BYTES,
    ComposeProviderClient,
    compose_revisions,
)
from app.services.prompt_dictionary import load_dictionary
from app.services.prompt_profiles import PROFILE_VERSION, PROFILES, profile_for, profile_versions
from conftest import HEADERS
from fastapi.testclient import TestClient

REQUEST_ID = "cmp-0123456789ab"
ADMISSION = "http://127.0.0.1:8081/control"
GATE_KEY = "gate-control-key-for-tests-1234"
LLM_KEY = "llama-key-for-tests-1234567890"
MODEL = "qwen3-35b-a3b"
MODEL_ID = "pornmaster-klein-9b"
FAMILY = "flux2"
BRIEF = "붉은 원피스를 입은 여성이 비 오는 거리에 서 있다"


def configured(settings):
    """Settings that can actually serve a compose call (non-fake, gated)."""
    settings.engine = "sdcpp"
    settings.admission_url = ADMISSION
    settings.admission_key = GATE_KEY
    settings.llm_api_key = LLM_KEY
    settings.llm_model = MODEL
    return settings


def dictionary():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2]
    return load_dictionary(root / "config/prompt_dictionary.json")


def revisions(brief=BRIEF, selections=None, choices=(), *, model_id=MODEL_ID,
              family=FAMILY, profile_version=PROFILE_VERSION):
    """The fingerprint the browser would send, computed the same way on both sides."""
    payload = [{"id": item["id"], "source": item.get("source", "auto"),
                "pinned": item.get("pinned"), "entity_id": item.get("entity_id")}
               for item in (selections or [])]
    parsed = [ComposeRequest.model_validate({
        "schema_version": 1, "request_id": REQUEST_ID,
        "input_revision": "sha256:" + "0" * 64,
        "dictionary_version": dictionary().version, "target_model_id": model_id,
        "target_family": family, "profile_version": profile_version,
        "selections": payload})
    ][0]
    return compose_revisions(brief_ko=brief, selections=parsed.selections,
                             choices=list(choices), target_model_id=model_id,
                             target_family=family, profile_version=profile_version,
                             dictionary_version=dictionary().version)


def body(**changes):
    """A valid request. `input_revision` is computed, never hardcoded."""
    selections = changes.pop("selections", [
        {"id": "clothing.dress", "source": "manual", "pinned": True},
        {"id": "style.illustration", "source": "excluded"},
    ])
    brief = changes.pop("brief_ko", BRIEF)
    # UCP04: the fingerprint covers the target, so a test that switches family must have
    # its revision computed for that family — otherwise the request would fail the
    # revision check before reaching the rule under test.
    model_id = changes.get("target_model_id", MODEL_ID)
    family = changes.get("target_family", FAMILY)
    profile_version = changes.get("profile_version", PROFILE_VERSION)
    rev = revisions(brief=brief, selections=selections,
                    choices=changes.get("clarification_choices", ()),
                    model_id=model_id, family=family,
                    profile_version=profile_version)
    payload = {
        "schema_version": 1, "request_id": REQUEST_ID, "input_revision": rev["input"],
        "dictionary_version": dictionary().version,
        "target_model_id": model_id, "target_family": family,
        "profile_version": profile_version, "candidate_count": 3, "brief_ko": brief,
        "selections": selections, "clarification_choices": [],
    }
    payload.update(changes)
    return payload


def raw_body(**changes):
    """A request the client could send but the schema should refuse.

    `input_revision` is still the honest fingerprint of these contents, so a 422 must come
    from the schema's own cross-field rules rather than from the revision check.
    """
    selections = changes.pop("selections", [])
    brief = changes.pop("brief_ko", "")
    rev = compose_revisions(brief_ko=brief, selections=_shaped(selections), choices=[],
                            target_model_id=MODEL_ID, target_family=FAMILY,
                            profile_version=PROFILE_VERSION,
                            dictionary_version=dictionary().version)
    payload = {
        "schema_version": 1, "request_id": REQUEST_ID, "input_revision": rev["input"],
        "dictionary_version": dictionary().version,
        "target_model_id": MODEL_ID, "target_family": FAMILY,
        "profile_version": PROFILE_VERSION, "candidate_count": 3, "brief_ko": brief,
        "selections": selections, "clarification_choices": [],
    }
    payload.update(changes)
    return payload


def _shaped(selections):
    """Lightweight selection objects for fingerprinting only."""
    from app.models.schemas import ComposeSelection
    return [ComposeSelection.model_construct(
        id=item["id"], source=item.get("source", "auto"),
        pinned=item.get("pinned"), entity_id=item.get("entity_id"))
        for item in selections]


def reply(**changes):
    """A well-formed model reply. Every field the server validates is present."""
    payload = {
        "result_id": "res-model-ignored", "request_id": REQUEST_ID,
        "status": "ready",
        "summary_ko": "비 오는 거리에 선 붉은 원피스의 여성",
        "scene": {
            "entities": [{"entity_id": "e1", "kind": "person", "count": 1,
                          "attributes_ko": ["붉은 원피스"],
                          "evidence_ko": "붉은 원피스"}],
            "relations": [{"subject_entity_id": "e1", "predicate_ko": "서 있다",
                           "object_entity_id": None, "evidence_ko": "서 있다"}],
            "environment": {"location_ko": "비 오는 거리"},
            "unmapped_details": [], "ambiguities": [],
        },
        "dictionary_bindings": [
            {"id": "clothing.dress", "source": "auto", "entity_id": "e1"},
            {"id": "subject.person", "source": "auto", "entity_id": "e1"},
        ],
        "candidates": [{
            "candidate_id": "candidate-1", "title_ko": "원문 충실",
            "difference_ko": "원문에 가장 가까운 표현",
            "positive_prompt": "a woman in a red dress standing on a rainy street",
            "negative_prompt": "blurry, extra limbs",
            "preserved_ko": ["붉은 원피스"],
        }],
        "clarifications": [],
    }
    payload.update(changes)
    return payload


def chat(content=None, *, status=200, finish_reason="stop", model=MODEL, usage=None):
    """A provider envelope. The envelope's stop reason and model are authoritative."""
    envelope = {
        "choices": [{"message": {"content": json.dumps(
            content if content is not None else reply(), ensure_ascii=False)},
            "finish_reason": finish_reason}],
        "model": model,
    }
    if usage is not None:
        envelope["usage"] = usage
    return httpx.Response(status, json=envelope)


def install(app, handler, *, timeout=None):
    """Route the control GET and the chat POST through one recorded transport."""
    calls = []

    def transport(request):
        calls.append(request)
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        return handler(request)

    app.state.compose_client = ComposeProviderClient(
        app.state.settings, transport=httpx.MockTransport(transport),
        **({} if timeout is None else {"timeout": timeout}),
    )
    return calls


@pytest.fixture
def gated(settings):
    with TestClient(create_app(configured(settings), llm=FakeLLM()),
                    headers=HEADERS) as client:
        yield client


def test_capability_is_advertised_separately_from_prompt_proposals(gated):
    value = gated.get("/api/v1/system/capabilities").json()
    # §5: a separate key. A client that only sees `prompt_proposals` must not infer
    # that the integrated path works.
    assert value["prompt_compose"] == {
        "schema_versions": [1],
        "dictionary_version": "1.2.0",
        # UCP04: advertised versions come from the profiles, so this is the same number
        # a request must send. `fake` is test-only and never advertised.
        "output_profile_versions": profile_versions(),
        "max_request_bytes": 24576,
        "max_response_bytes": 49152,
        "timeout_ms": 60000,
        "max_candidates": 3,
        "max_brief_chars": 4000,
        "max_selections": 100,
    }
    assert value["prompt_proposals"]["schema_versions"] == [1]


def test_capability_is_omitted_when_a_request_could_not_be_served(settings):
    # An unsupported server must look unsupported, not broken (§5).
    for change in ({"engine": "fake"},
                   {"engine": "sdcpp", "admission_url": ""},
                   {"engine": "sdcpp", "admission_url": ADMISSION, "llm_model": ""}):
        configured(settings)
        for key, value in change.items():
            setattr(settings, key, value)
        with TestClient(create_app(settings, llm=FakeLLM()), headers=HEADERS) as client:
            assert "prompt_compose" not in client.get(
                "/api/v1/system/capabilities").json()
    settings.engine = "sdcpp"  # never leave a real-engine settings object behind


def test_a_target_the_registry_does_not_know_is_refused_before_the_call(gated):
    # "잘못된 대상 참조" from UCP03's criteria: a model_id the registry does not have is a 422
    # with no provider call, because there is no profile to build a payload from.
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/compose",
                          json=body(target_model_id="no-such-model"))
    assert response.status_code == 422
    assert response.json()["detail"].startswith("model_family_mismatch")
    assert calls == []


def test_a_family_that_disagrees_with_the_registry_is_refused(gated):
    # A family mismatch is a client bug, not a stale view: 422, not 409, and no call.
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/compose",
                          json=body(target_family="sd15"))
    assert response.status_code == 422
    assert response.json()["detail"].startswith("model_family_mismatch")
    assert calls == []


def test_a_stale_dictionary_is_a_409_naming_both_versions(gated):
    # A stale mirror makes every ID look unknown, so it is checked first and reported as
    # a conflict with both versions rather than as a pile of bad IDs.
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/compose",
                          json=body(dictionary_version="0.0.1"))
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail.startswith("stale_dictionary")
    assert "0.0.1" in detail
    assert calls == []


def test_request_requires_a_bearer_credential(settings):
    with TestClient(create_app(configured(settings), llm=FakeLLM())) as client:
        response = client.post("/api/v1/prompt/compose", json=body())
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"


def test_unsupported_server_answers_503_instead_of_calling_the_provider(settings):
    configured(settings)
    settings.engine = "fake"
    try:
        with TestClient(create_app(settings, llm=FakeLLM()), headers=HEADERS) as client:
            # A transport that fails loudly: if the endpoint reached the provider at all,
            # this would surface as a 5xx/`upstream_*` rather than the 503 under test.
            calls = install(client.app, lambda request: httpx.Response(
                599, text="the provider must not be called"))
            response = client.post("/api/v1/prompt/compose", json=body())
            assert response.status_code == 503
            value = response.json()
            assert value["why"] == "not_configured"
            assert value["message"]
            # The claim in this test's name, asserted: nothing was sent upstream.
            assert calls == []
    finally:
        settings.engine = "sdcpp"


def test_a_reply_for_another_request_is_refused(gated):
    # A valid reply whose `request_id` belongs to a different request must not be adopted,
    # even though every other field is well-formed. Two requests are in flight in a real
    # browser; adopting the wrong one would attach someone else's scene to the user's brief.
    install(gated.app, lambda request: chat(reply(request_id="cmp-ffffffffffff")))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["detail"] == "request_id_mismatch"
    assert value["candidates"] == []
    # The request's own chips still come back, so the client can match reply to revision.
    assert {item["id"] for item in value["selections"]} >= {
        "clothing.dress", "style.illustration"}


def test_an_unavailable_body_keeps_the_users_sources_but_not_a_dangling_entity(gated):
    # Reference integrity and source preservation are two separate promises:
    #   * every `entity_id` in the body must exist in the scene the body carries;
    #   * the user's `source`/`pinned` must survive even when the entity link cannot.
    # A request carries no scene (entities are derived from the reply), so any attribution
    # the client sends has nothing to point at once the reply is discarded. The link is
    # dropped; the decision is not.
    selections = [
        {"id": "clothing.dress", "source": "manual", "pinned": True, "entity_id": "e1"},
        {"id": "style.illustration", "source": "excluded"},
    ]
    install(gated.app, lambda request: httpx.Response(500, text="boom"))
    value = gated.post("/api/v1/prompt/compose",
                       json=body(selections=selections)).json()
    assert value["status"] == "unavailable"

    scene_entities = {entity["entity_id"] for entity in value["scene"]["entities"]} \
        if value["scene"] else set()
    for item in value["selections"]:
        if item["entity_id"] is not None:
            assert item["entity_id"] in scene_entities, (
                f"{item['id']} points at {item['entity_id']}, absent from the body's scene")

    by_id = {item["id"]: item for item in value["selections"]}
    # The user's decisions, verbatim: manual stays manual and pinned stays pinned.
    assert by_id["clothing.dress"]["source"] == "manual"
    assert by_id["clothing.dress"]["pinned"] is True
    # The attribution that had nowhere to point was dropped, not invented. This is the
    # assertion that makes the test non-vacuous: the request *did* send `entity_id`.
    assert by_id["clothing.dress"]["entity_id"] is None
    # The veto is preserved and carries nothing else — that is the whole record of "deleted".
    assert by_id["style.illustration"]["source"] == "excluded"
    assert by_id["style.illustration"]["entity_id"] is None
    assert by_id["style.illustration"]["pinned"] is None


def test_an_unavailable_body_keeps_an_attribution_the_scene_can_back(gated):
    # The mirror case: when the reply *does* carry a scene but fails later (no usable
    # candidates), an entity that exists in that scene is still reported.
    payload = reply(candidates=[])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    scene_entities = {entity["entity_id"] for entity in value["scene"]["entities"]}
    assert "e1" in scene_entities
    by_id = {item["id"]: item for item in value["selections"]}
    assert by_id["clothing.dress"]["entity_id"] == "e1"


def test_ready_reply_returns_the_full_contract_shape(gated):
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/compose", json=body())
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["status"] == "ready"
    assert value["schema_version"] == 1
    assert value["request_id"] == REQUEST_ID
    # The server issues `result_id`; the model's own value is never used (§5).
    assert value["result_id"].startswith("res-")
    assert value["result_id"] != "res-model-ignored"
    assert value["input_revision"] == body()["input_revision"]
    assert (value["target_model_id"], value["target_family"]) == (MODEL_ID, FAMILY)
    assert value["summary_ko"]
    assert value["scene"]["entities"][0]["entity_id"] == "e1"
    assert [item["candidate_id"] for item in value["candidates"]] == ["candidate-1"]
    assert value["provider"]["model"] == MODEL
    assert value["provider"]["finish_reason"] == "stop"
    assert value["cut_short"] is False
    # Exactly one control read and one chat call: no retry, no second verification call.
    assert [call.method for call in calls] == ["GET", "POST"]


def test_a_manual_chip_survives_even_when_the_reply_calls_it_automatic(gated):
    # §4: the model cannot demote a chip the user picked. `clothing.dress` is manual and
    # pinned in the request but `auto` in the reply.
    install(gated.app, lambda request: chat())
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    by_id = {item["id"]: item for item in value["selections"]}
    assert by_id["clothing.dress"]["source"] == "manual"
    assert by_id["clothing.dress"]["pinned"] is True


def test_an_excluded_chip_is_never_re_added(gated):
    # The reply proposes `style.illustration`, which the user excluded. The veto is the
    # only record of "I deleted this", so it must survive.
    payload = reply(dictionary_bindings=[
        {"id": "clothing.dress", "source": "manual", "entity_id": "e1"},
        {"id": "style.illustration", "source": "auto"},
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    by_id = {item["id"]: item for item in value["selections"]}
    assert by_id["style.illustration"]["source"] == "excluded"
    assert by_id["style.illustration"]["pinned"] is None


def test_a_candidate_that_re_introduces_an_excluded_id_is_refused(gated):
    # A veto inside the sentence is invisible to the structure, so it is caught in the
    # text. `style.illustration` is excluded in the request.
    payload = reply(candidates=[{
        "candidate_id": "candidate-1", "title_ko": "무시", "difference_ko": "무시",
        "positive_prompt": "a woman, style.illustration, red dress",
    }])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    # No valid candidate is left, so this is `unavailable`, never an empty `ready`.
    assert value["status"] == "unavailable"
    assert value["why"] == "invalid_reply"


def test_needs_clarification_withholds_candidates(gated):
    payload = reply(
        candidates=[],
        clarifications=[{"question_id": "q1", "question_ko": "누가 서 있나요?",
                         "why": "actor_unknown",
                         "options": [{"option_id": "o1", "label_ko": "여성"},
                                     {"option_id": "o2", "label_ko": "남성"}]}])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "needs_clarification"
    # Both together would leave the client no defined action (§5).
    assert value["candidates"] == []
    assert value["clarifications"][0]["question_id"] == "q1"
    assert [option["option_id"] for option in value["clarifications"][0]["options"]] == [
        "o1", "o2"]


def test_a_scene_only_request_is_valid_but_an_empty_one_is_422(gated):
    install(gated.app, lambda request: chat())
    # UCP01 fix A: dictionary selections alone can compose.
    only_selection = gated.post("/api/v1/prompt/compose", json=body(
        brief_ko="", selections=[{"id": "clothing.dress", "source": "manual",
                                  "pinned": True}]))
    assert only_selection.status_code == 200, only_selection.text
    # Neither text nor a chosen selection is nothing to compose.
    nothing = gated.post("/api/v1/prompt/compose", json=raw_body(
        brief_ko="", selections=[{"id": "style.illustration", "source": "excluded"}]))
    assert nothing.status_code == 422


def test_a_cut_body_is_never_stitched_back_together(gated):
    # The single most tempting repair: append `}` and treat the partial candidate as
    # real. The object here is complete except for its final brace.
    truncated = json.dumps(reply(), ensure_ascii=False)[:-1]
    install(gated.app, lambda request: chat(truncated, finish_reason="length"))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "invalid_reply"
    # No candidate was fabricated from the fragment.
    assert value["candidates"] == []
    assert value["cut_short"] is True
    assert value["provider"]["finish_reason"] == "length"


def test_a_complete_body_with_finish_reason_length_still_yields_candidates(gated):
    # The other half of the rule: truncation is not inferred from `finish_reason` alone.
    install(gated.app, lambda request: chat(finish_reason="length"))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "ready"
    assert len(value["candidates"]) == 1
    # ...but the reply is still marked incomplete, so the client can retry if it wants.
    assert value["cut_short"] is True


def test_one_invalid_candidate_is_dropped_and_the_rest_are_kept(gated):
    # Partial success: two candidates, one of which breaks a field limit. The valid one is
    # returned whole and `cut_short`/`candidates_reduced` say the list is short.
    payload = reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "정상", "difference_ko": "정상",
         "positive_prompt": "a woman in a red dress on a rainy street"},
        {"candidate_id": "candidate-2", "title_ko": "x" * 41, "difference_ko": "정상",
         "positive_prompt": "another woman in a red dress"},
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "ready"
    assert [item["candidate_id"] for item in value["candidates"]] == ["candidate-1"]
    assert value["cut_short"] is True
    assert "candidates_reduced" in value["warnings"]


def test_an_oversized_sentence_is_refused_rather_than_truncated(gated):
    payload = reply(candidates=[{
        "candidate_id": "candidate-1", "title_ko": "정상", "difference_ko": "정상",
        "positive_prompt": "a" * 2001}])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    # Silently cutting the prompt would change the image the user asked for.
    assert value["status"] == "unavailable"
    assert value["candidates"] == []


def test_negative_prompt_is_removed_when_the_model_cannot_use_it(gated):
    # `pornmaster-klein-9b` supports negative only at CFG 2.0; its `balanced` preset is
    # 1.0. Changing CFG to fit the prompt is forbidden, so the field is dropped and the
    # candidate survives with a warning.
    install(gated.app, lambda request: chat())
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "ready"
    # The candidate is kept and only the unsupported field is cleared (§5) — the sentence
    # itself is untouched, which is what distinguishes this from a refusal.
    assert value["candidates"][0]["negative_prompt"] is None
    assert value["candidates"][0]["positive_prompt"] == (
        "a woman in a red dress standing on a rainy street")
    assert "negative_requires_cfg" in value["warnings"]


def test_the_payload_does_not_carry_a_negative_prompt_for_that_model(gated):
    captured = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return chat()

    install(gated.app, handler)
    gated.post("/api/v1/prompt/compose", json=body())
    # The user turn is a JSON document inside the message, so it is parsed rather than
    # string-matched: a substring search cannot tell a field from prose about it.
    user = json.loads(captured["messages"][1]["content"])
    assert user["negative_prompt_supported"] is False
    # The whole brief is sent verbatim, not shortened into tags (§4).
    assert user["brief_ko"] == BRIEF
    assert captured["max_tokens"] == 8192
    assert captured["chat_template_kwargs"] == {"enable_thinking": False}
    # CFG is never adjusted to make negative legal (§5).
    assert "cfg_scale" not in json.dumps(captured)


def test_a_failure_without_a_provider_block_keeps_its_diagnosis(gated):
    # No `provider` block is available, so the cause must still reach a human: the detail
    # names what actually happened rather than a generic "failed".
    install(gated.app, lambda request: httpx.Response(500, text="boom"))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["provider"] is None
    # The diagnosis lives in the error fields, which is why they are not replaced by the
    # contract body: `why` names the stage, `detail` names the specific fact.
    assert value["why"] == "upstream_status"
    assert value["detail"] == "http_500"
    # Latency is still reported even without a model name, because the attempt was timed.
    assert isinstance(value["message"], str) and value["message"]


def test_a_half_emitted_candidate_list_yields_no_partial_candidate(gated):
    # Two candidates are promised by the array prefix; the second is cut mid-object. The
    # whole body is unparseable, so neither candidate survives — the first is not salvaged.
    body_text = json.dumps(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "첫째", "difference_ko": "차이",
         "positive_prompt": "a woman in a red dress"},
        {"candidate_id": "candidate-2", "title_ko": "둘째", "difference_ko": "차이",
         "positive_prompt": "a woman in a blue dress"},
    ]), ensure_ascii=False)
    cut = body_text[:len(body_text) // 2]
    install(gated.app, lambda request: chat(cut, finish_reason="length"))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    # Not even the candidate that was fully written survives: the object as a whole failed.
    assert value["candidates"] == []
    assert value["cut_short"] is True


def test_the_returned_count_is_the_requested_count_when_the_model_overproduces(gated):
    # Four candidates for a `candidate_count` of 3: the extra is dropped and reported, and
    # the client gets exactly what it budgeted for.
    payload = reply(candidates=[
        {"candidate_id": f"candidate-{index}", "title_ko": f"후보 {index}",
         "difference_ko": "차이", "positive_prompt": f"a woman in outfit {index}"}
        for index in (1, 2, 3, 4)
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert len(value["candidates"]) == 3
    assert "candidates_reduced" in value["warnings"]
    assert value["cut_short"] is True


def test_the_returned_count_is_below_the_request_when_the_model_underproduces(gated):
    # One candidate for a request of 3 — fewer is allowed (§5) and is *not* `cut_short`,
    # because nothing was lost: the model said the scene supports only one.
    install(gated.app, lambda request: chat())
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert len(value["candidates"]) == 1
    assert value["cut_short"] is False
    # No `candidates_reduced`: nothing was dropped. The only warning is the negative-prompt
    # one from this target's CFG, which is a different fact about a different field.
    assert "candidates_reduced" not in value["warnings"]


def test_complete_json_with_zero_usable_candidates_is_never_ready(gated):
    # An empty array is structurally valid but offers the client nothing to apply.
    install(gated.app, lambda request: chat(reply(candidates=[])))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "invalid_reply"
    assert value["detail"] == "no_valid_candidates"


def test_an_unknown_id_from_the_model_is_dropped_and_reported(gated):
    # The model invented `clothing.cape`, which is not in the shipped dictionary. It is the
    # model's invention, not a user decision, so it is dropped — but the reply must not be
    # silently smaller, which is what `unknown_ids_dropped` is for.
    payload = reply(dictionary_bindings=[
        {"id": "clothing.dress", "source": "auto", "entity_id": "e1"},
        {"id": "clothing.cape", "source": "auto", "entity_id": "e1"},
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "ready"
    assert "unknown_ids_dropped" in value["warnings"]
    ids = {item["id"] for item in value["selections"]}
    assert "clothing.cape" not in ids
    # The user's own chips are untouched by the model's invention.
    assert {"clothing.dress", "style.illustration"} <= ids


def test_a_binding_naming_an_unknown_entity_is_refused(gated):
    # §4: an attribution to an entity that is not in the scene is refused outright, never
    # quietly reinterpreted as "whole scene" — that would silently move the chip.
    payload = reply(dictionary_bindings=[
        {"id": "clothing.dress", "source": "auto", "entity_id": "entity-9"},
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "invalid_reply"
    assert "entity-9" in value["detail"]
    # The user's chips still come back so the client can keep them.
    assert {item["id"] for item in value["selections"]} >= {
        "clothing.dress", "style.illustration"}


async def test_a_second_concurrent_call_is_busy_rather_than_queued(gated):
    # SESSION_LIMIT is 1, so a second call on the same credential is refused, not queued
    # behind the first (a queued call would outlive the 60 s budget). Both requests go
    # through the real ASGI app and the real provider; only the transport is faked, and the
    # overlap is held open with an Event so the interleaving is deterministic.
    release = asyncio.Event()

    async def handler(request):
        if request.url.path.endswith("/control"):
            return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                             "active_requests": 0})
        await release.wait()
        return chat()

    gated.app.state.compose_client = ComposeProviderClient(
        gated.app.state.settings, transport=httpx.MockTransport(handler), timeout=5.0)
    transport = httpx.ASGITransport(app=gated.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test",
                                 headers=HEADERS) as client:
        first = asyncio.create_task(client.post("/api/v1/prompt/compose", json=body()))
        await asyncio.sleep(0.05)  # let the first call take the session lease
        second = (await client.post("/api/v1/prompt/compose", json=body())).json()
        release.set()
        first_body = (await first).json()

    # The overlapping request is refused with `busy` and pays for no model call.
    assert second["status"] == "unavailable"
    assert second["why"] == "busy"
    assert second["detail"] == "concurrent_request"
    assert second["provider"] is None
    # The first one still completes normally — a refusal must not poison the in-flight call.
    assert first_body["status"] == "ready"


def test_the_provider_client_and_its_lease_are_released_after_every_outcome(gated):
    # UCP03 checklist: "provider resources are released on error paths". The client and both
    # semaphores are `async with` blocks, so the observable evidence is that the client is
    # still usable and its leases free after each kind of failure. A leaked semaphore would
    # make every later request `busy`; a leaked client would exhaust connections.
    failures = {
        "upstream_status": lambda request: httpx.Response(500, text="boom"),
        "invalid_reply": lambda request: chat("<html>not json</html>"),
        "no_valid_candidates": lambda request: chat(reply(candidates=[])),
    }
    for name, handler in failures.items():
        install(gated.app, handler)
        failed = gated.post("/api/v1/prompt/compose", json=body()).json()
        assert failed["status"] == "unavailable", name
        # The client is created on first request, so it is read from app state here.
        client = gated.app.state.compose_client
        # The global lease is free again immediately after the failure. A leaked *global*
        # lease is the one that matters for the two-call limit; the per-credential lease is
        # freed by the same `async with`, and a leaked one would show as `busy` next time.
        assert not client._global.locked(), f"{name}: global lease leaked"
        # And a fresh request on the same client succeeds, which is the real proof.
        install(gated.app, lambda request: chat())
        ok = gated.post("/api/v1/prompt/compose", json=body()).json()
        assert ok["status"] == "ready", f"{name}: client unusable afterwards"


def test_a_timeout_releases_the_lease_it_was_holding(gated):
    # The timeout path cancels the task *inside* the semaphores. If the cancellation skipped
    # the release, every later request would be `busy` for the life of the process — so the
    # assertion is that the lease is free and the next call succeeds.
    class Slow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            if request.url.path.endswith("/control"):
                return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                                 "active_requests": 0})
            await asyncio.sleep(0.3)
            return chat()

    gated.app.state.compose_client = ComposeProviderClient(
        gated.app.state.settings, transport=Slow(), timeout=0.05)
    timed_out = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert timed_out["why"] == "timeout"
    assert not gated.app.state.compose_client._global.locked(), (
        "global lease leaked by timeout")
    # A successful call afterwards proves the release, not just the counter.
    install(gated.app, lambda request: chat())
    assert gated.post("/api/v1/prompt/compose", json=body()).json()["status"] == "ready"


def test_a_failure_still_returns_the_contract_body(gated):
    # §5: the browser keeps its text and chips on every path, so a provider failure must
    # not come back as a body without `input_revision` to match against.
    install(gated.app, lambda request: httpx.Response(500, text="boom"))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "upstream_status"
    assert value["detail"] == "http_500"
    assert value["input_revision"] == body()["input_revision"]
    assert value["request_id"] == REQUEST_ID
    assert value["result_id"].startswith("res-")
    # The user's own decisions come back unchanged.
    by_id = {item["id"]: item for item in value["selections"]}
    assert by_id["clothing.dress"]["source"] == "manual"
    assert by_id["clothing.dress"]["pinned"] is True
    assert by_id["style.illustration"]["source"] == "excluded"
    assert value["candidates"] == []
    # No call record was fabricated for a reply that never named a model.
    assert value["provider"] is None
    assert value["cut_short"] is False


def test_a_cut_body_without_a_model_name_is_not_called_cut_short(gated):
    # `cut_short` needs a provider block to be meaningful. A provider that stops early but
    # never names its model must not push the body into a state the schema refuses, which
    # would turn a handled failure into a 500.
    payload = json.dumps(reply(), ensure_ascii=False)[:-1]
    install(gated.app, lambda request: chat(payload, finish_reason="length", model=None))
    response = gated.post("/api/v1/prompt/compose", json=body())
    assert response.status_code == 200
    value = response.json()
    assert value["why"] == "invalid_reply"
    assert value["provider"] is None
    assert value["cut_short"] is False


def test_a_complete_reply_without_a_model_name_keeps_provider_null(gated):
    install(gated.app, lambda request: chat(model=None))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    # A `ready` reply is still usable; only the call record is missing.
    assert value["status"] == "ready"
    assert value["provider"] is None
    assert value["cut_short"] is False


def test_a_timeout_discards_the_late_reply(gated):
    # The provider is slower than the budget; its answer arrives after the client gave up
    # and must not be adopted. An async transport makes the delay real rather than a
    # blocking handler that would stall the loop and race the timeout.
    class Slow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            if request.url.path.endswith("/control"):
                return httpx.Response(200, json={"paused": False, "waiting_requests": 0,
                                                 "active_requests": 0})
            await asyncio.sleep(0.3)
            return chat()

    gated.app.state.compose_client = ComposeProviderClient(
        gated.app.state.settings, transport=Slow(), timeout=0.05)
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "timeout"
    assert value["candidates"] == []
    # The request state is still echoed, so the client can retry with the same revision.
    assert value["input_revision"] == body()["input_revision"]


def test_an_unreachable_gate_is_not_reported_as_a_model_problem(gated):
    def transport(request):
        raise httpx.ConnectError("refused")

    gated.app.state.compose_client = ComposeProviderClient(
        gated.app.state.settings, transport=httpx.MockTransport(transport))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["why"] == "gate_unreachable"
    # A gate failure is emphatically not `invalid_reply`: the model was never asked.
    assert value["why"] != "invalid_reply"


def test_a_paused_gate_refuses_before_paying_for_the_call(gated):
    calls = []

    def transport(request):
        calls.append(request)
        return httpx.Response(200, json={"paused": True, "waiting_requests": 0,
                                         "active_requests": 0})

    gated.app.state.compose_client = ComposeProviderClient(
        gated.app.state.settings, transport=httpx.MockTransport(transport))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["why"] == "admission_paused"
    # Only the control read: a paused gate must not be followed by a chat call.
    assert len(calls) == 1


def test_an_oversized_response_is_reduced_by_dropping_candidates(gated):
    # Three candidates each near the prompt limit. The full reply is over the response
    # budget, so the list shortens — a candidate is never cut mid-sentence.
    big = "a woman in a red dress standing on a rainy street at night, cinematic light, "
    payload = reply(candidates=[
        {"candidate_id": f"candidate-{index}", "title_ko": f"후보 {index}",
         "difference_ko": "차이", "positive_prompt": big * 12}
        for index in (1, 2, 3)
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "ready"
    assert len(value["candidates"]) < 3
    assert value["cut_short"] is True
    assert "candidates_reduced" in value["warnings"]
    # Every surviving candidate is intact, not a fragment the server clipped.
    for candidate in value["candidates"]:
        assert candidate["positive_prompt"] == big * 12


def test_the_excluded_check_is_a_raw_substring_test_on_the_sentence(gated):
    """What the check actually is, stated as a test rather than claimed as semantics.

    `_one_candidate` does `entry_id in positive_prompt` — a case-sensitive, unanchored
    substring test of the *dictionary ID* against the English sentence. It catches a model
    that pasted an ID into its output. It does not understand English, so it cannot catch
    the same concept written as a word. These cases pin that boundary so nobody later
    mistakes it for a semantic guard.
    """
    base = {"candidate_id": "candidate-1", "title_ko": "정상", "difference_ko": "정상"}

    # Caught: the literal ID appears (the model echoed the chip instead of English).
    install(gated.app, lambda request: chat(reply(candidates=[
        {**base, "positive_prompt": "a woman, style.illustration, red dress"}])))
    caught = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert caught["status"] == "unavailable"

    # Not caught: the same exclusion written as an English word. "an illustration of ..."
    # contains no ID, so it passes. This is the documented limit of a deterministic check.
    install(gated.app, lambda request: chat(reply(candidates=[
        {**base, "positive_prompt": "an illustration of a woman in a red dress"}])))
    missed = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert missed["status"] == "ready"

    # Caught again, and case-sensitively: the ID match is literal, so an upper-cased echo
    # slips through. Recording it as a test keeps the limitation visible instead of
    # letting a future reader assume the check is case-insensitive.
    install(gated.app, lambda request: chat(reply(candidates=[
        {**base, "positive_prompt": "a woman, STYLE.ILLUSTRATION, red dress"}])))
    casing = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert casing["status"] == "ready"


def test_an_excluded_id_in_the_negative_prompt_is_not_checked(gated):
    # The check reads `positive_prompt` only. A negative prompt is the *absence* of a
    # thing, so refusing `style.illustration` there would be wrong — and the code does not.
    install(gated.app, lambda request: chat(reply(candidates=[{
        "candidate_id": "candidate-1", "title_ko": "정상", "difference_ko": "정상",
        "positive_prompt": "a woman in a red dress",
        "negative_prompt": "style.illustration, cartoon, low quality"}])))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    # The model cannot use a negative prompt at this CFG, so the field is dropped — but
    # the candidate is not refused for mentioning the excluded ID in it.
    assert value["status"] == "ready"
    assert value["candidates"][0]["negative_prompt"] is None


def test_an_excluded_id_in_a_two_entity_scene_is_refused_regardless_of_entity(gated):
    # Multi-entity scene: the excluded ID belongs to the *second* entity. The check does
    # not consult the entity graph at all, so one occurrence in the sentence refuses the
    # candidate even when attribution says the chip was vetoed for someone else.
    two = reply(
        scene={
            "entities": [
                {"entity_id": "e1", "kind": "person", "count": 1,
                 "attributes_ko": ["붉은 원피스"], "evidence_ko": "붉은 원피스"},
                {"entity_id": "e2", "kind": "person", "count": 1,
                 "attributes_ko": ["모자"], "evidence_ko": "모자"},
            ],
            "relations": [], "environment": {"location_ko": "비 오는 거리"},
            "unmapped_details": [], "ambiguities": [],
        },
        dictionary_bindings=[
            {"id": "clothing.dress", "source": "manual", "entity_id": "e1"},
            {"id": "clothing.hat", "source": "excluded", "entity_id": "e2"},
        ],
        candidates=[{"candidate_id": "candidate-1", "title_ko": "정상",
                     "difference_ko": "정상",
                     "positive_prompt": "two women, one in a red dress, "
                                        "clothing.hat on the second"}])
    install(gated.app, lambda request: chat(two))
    value = gated.post("/api/v1/prompt/compose", json=body(
        selections=[{"id": "clothing.dress", "source": "manual", "pinned": True},
                    {"id": "clothing.hat", "source": "excluded"}])).json()
    assert value["status"] == "unavailable"
    assert value["why"] == "invalid_reply"


def test_a_request_over_the_byte_limit_is_413(gated):
    huge = "가" * (MAX_REQUEST_BYTES // 3 + 100)
    response = gated.post("/api/v1/prompt/compose", json=raw_body(brief_ko=huge))
    # A transport fact: retrying the same body cannot help, so it is not a 200 failure.
    assert response.status_code == 413


def test_an_unadvertised_capability_is_503(settings):
    # The endpoint exists but cannot run here: the client must not read this as a model
    # problem it can retry (§5).
    configured(settings)
    settings.engine = "fake"
    with TestClient(create_app(settings, llm=FakeLLM()), headers=HEADERS) as client:
        response = client.post("/api/v1/prompt/compose", json=body())
    assert response.status_code == 503
    assert response.json()["why"] == "not_configured"


# --------------------------------------------------------------------------------------
# UCP04: per-family output profiles and candidate validation.
# --------------------------------------------------------------------------------------


def test_the_advertised_versions_are_the_profiles_the_server_requires(gated):
    # The advertised number and the number `resolve_target` compares against come from one
    # source. If they could drift, a client would be told a version the server rejects.
    value = gated.get("/api/v1/system/capabilities").json()
    assert value["prompt_compose"]["output_profile_versions"] == profile_versions()
    assert value["prompt_compose"]["output_profile_versions"] == {
        "sd15": PROFILE_VERSION, "z-image": PROFILE_VERSION,
        "flux2": PROFILE_VERSION, "moss-image": PROFILE_VERSION,
    }
    # `fake` is test-only and compose is gated on a non-fake engine, so it is never
    # advertised: promising it would advertise a family no deployment serves.
    assert "fake" not in value["prompt_compose"]["output_profile_versions"]


def test_a_stale_profile_version_is_a_409_naming_both_versions(gated):
    # UCP03 accepted any integer >= 1, so `stale_profile` was in the failure vocabulary but
    # unreachable. It is a 409 like a stale dictionary: the body is well formed, the client
    # is simply describing output rules this build no longer applies.
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/compose",
                          json=body(profile_version=PROFILE_VERSION - 1))
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail.startswith("stale_profile")
    assert str(PROFILE_VERSION) in detail
    assert calls == []


def test_a_future_profile_version_is_also_stale(gated):
    # Not `>= server`: a newer number is just as unusable as an older one, and silently
    # accepting it would let a client run under rules this server does not implement.
    response = gated.post("/api/v1/prompt/compose",
                          json=body(profile_version=PROFILE_VERSION + 1))
    assert response.status_code == 409
    assert response.json()["detail"].startswith("stale_profile")


def test_the_profile_guidance_reaches_the_system_prompt(gated):
    captured = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return chat()

    install(gated.app, handler)
    gated.post("/api/v1/prompt/compose", json=body())
    system = captured["messages"][0]["content"]
    # `flux2` reads relationship sentences joined with `; ` — the compiler's own convention
    # for the natural-language families. The prompt must ask for that, not for a generic
    # English prompt and not for an sd15 tag list.
    assert "one or two English sentences" in system
    assert "Do not turn the scene into a tag list" in system
    assert "short English tag phrases" not in system
    assert "(word:1.2)" in system
    # The discriminator: no token hint for a family whose encoder window is unknown.
    guidance = system.split("How this model family reads a prompt:")[1]
    assert "tokens" not in guidance.split("Reply with the JSON object only")[0]


def test_the_sd15_guidance_asks_for_tags_and_a_character_budget(gated):
    # The other half: `sd15` is the one family here that reads a tag list and is the only
    # one with a known window, so its guidance must say both.
    captured = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return chat()

    install(gated.app, handler)
    gated.post("/api/v1/prompt/compose",
               json=body(target_model_id="realistic-vision-v6", target_family="sd15"))
    system = captured["messages"][0]["content"]
    assert "short English tag phrases" in system
    assert "roughly 77 tokens" in system
    # The window is stated as an aim, not a measurement: no tokenizer exists in this
    # repository, so the prompt must not present a measured number.
    assert "only partly read" in system


def test_the_payload_states_the_profile_the_server_will_enforce(gated):
    captured = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return chat()

    install(gated.app, handler)
    gated.post("/api/v1/prompt/compose", json=body())
    user = json.loads(captured["messages"][1]["content"])
    profile = profile_for(FAMILY)
    assert user["output_profile"] == {
        "family": FAMILY, "version": profile.version,
        "prompt_style": profile.prompt_style, "joiner": profile.joiner,
        "token_window": profile.token_window,
        "max_positive_chars": profile.max_positive_chars,
    }
    # The schema the model is shown carries the same character limits, so "asked for" and
    # "rejected for" cannot disagree.
    assert f"<= {profile.max_positive_chars} chars" in captured["messages"][0]["content"]


def test_identical_candidates_collapse_and_say_why(gated):
    # Two identical prompts are one prompt. §5 allows returning fewer; what it does not
    # allow is pretending the list is complete, so the collapse is named separately from a
    # rejection: `duplicate_candidates` says the model repeated itself.
    same = "a woman in a red dress on a rainy street"
    payload = reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "첫째", "difference_ko": "첫째",
         "positive_prompt": same},
        {"candidate_id": "candidate-2", "title_ko": "둘째", "difference_ko": "둘째",
         "positive_prompt": f"  {same.upper()}  "},
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "ready"
    # Case and surrounding whitespace do not make a second candidate.
    assert [item["candidate_id"] for item in value["candidates"]] == ["candidate-1"]
    assert "duplicate_candidates" in value["warnings"]
    assert "candidates_reduced" in value["warnings"]


def test_two_genuinely_different_candidates_are_not_called_duplicates(gated):
    # The counter-case: a warning that fired on every reply would be noise.
    payload = reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "첫째", "difference_ko": "첫째",
         "positive_prompt": "a woman in a red dress on a rainy street"},
        {"candidate_id": "candidate-2", "title_ko": "둘째", "difference_ko": "둘째",
         "positive_prompt": "a woman in a crimson dress on a wet street at night"},
    ])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert len(value["candidates"]) == 2
    assert "duplicate_candidates" not in value["warnings"]
    assert "candidates_reduced" not in value["warnings"]


def test_weighting_syntax_is_reported_but_never_dropped(gated):
    # A parenthesised weight is a formatting habit, not an unusable prompt. Dropping the
    # candidate would delete a whole usable sentence; the engine's own LoRA tag is added at
    # generation time regardless, so the client is told instead of corrected.
    weighted = "a woman in a (red dress:1.2) on a rainy street"
    install(gated.app, lambda request: chat(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "가중", "difference_ko": "가중",
         "positive_prompt": weighted}])))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["status"] == "ready"
    assert value["candidates"][0]["positive_prompt"] == weighted
    assert "profile_weighting_syntax" in value["warnings"]
    # The text was neither rewritten nor cut, so nothing was "reduced".
    assert "candidates_reduced" not in value["warnings"]


def test_a_candidate_with_an_inline_lora_tag_is_reported(gated):
    # The other spelling of the same problem, and the one `SdCpp.effective_prompt` would
    # actually collide with: it appends `<lora:name:strength>` itself when it finds none.
    tagged = "a woman, <lora:my-style:0.8>, rainy street"
    install(gated.app, lambda request: chat(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "로라", "difference_ko": "로라",
         "positive_prompt": tagged}])))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert value["candidates"][0]["positive_prompt"] == tagged
    assert "profile_weighting_syntax" in value["warnings"]


def test_a_parenthesised_phrase_that_is_not_a_weight_is_not_flagged(gated):
    # `(smiling)` and a clock time have no numeric weight, so they are ordinary prompt
    # text. A regex that flagged every parenthesis would warn on correct output.
    plain = "a woman (smiling) at 5:30 in the afternoon"
    install(gated.app, lambda request: chat(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "괄호", "difference_ko": "괄호",
         "positive_prompt": plain}])))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    assert "profile_weighting_syntax" not in value["warnings"]




def test_a_long_prompt_is_not_flagged_without_an_established_window(gated):
    # `flux2` reads a Qwen3-class encoder whose context length is a property of checkpoint
    # files this build cannot read. Its profile window is `None`, so no warning is raised:
    # a blanket 77-token warning across families would be a fabricated limit (§5).
    long_prompt = ", ".join(["red dress"] * 40)
    install(gated.app, lambda request: chat(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "김", "difference_ko": "김",
         "positive_prompt": long_prompt}])))
    value = gated.post("/api/v1/prompt/compose", json=body()).json()
    # The candidate is returned whole: the check never refuses and never cuts.
    assert value["candidates"][0]["positive_prompt"] == long_prompt
    assert "profile_token_window" not in value["warnings"]


def test_the_same_long_prompt_does_warn_for_sd15(gated):
    # The mirror image, on the one family whose window is a known constant. The same prompt
    # is used so the difference is the profile, not the text.
    long_prompt = ", ".join(["red dress"] * 40)
    install(gated.app, lambda request: chat(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "김", "difference_ko": "김",
         "positive_prompt": long_prompt}])))
    value = gated.post("/api/v1/prompt/compose", json=body(
        target_model_id="realistic-vision-v6", target_family="sd15")).json()
    assert value["status"] == "ready"
    assert value["candidates"][0]["positive_prompt"] == long_prompt
    assert "profile_token_window" in value["warnings"]


def test_a_short_sd15_prompt_does_not_warn(gated):
    # The warning must track the window, not the family: a 34-character tag list is well
    # inside 77 tokens and warning about it would teach the user to ignore the warning.
    short = "a woman, red dress, rainy street"
    install(gated.app, lambda request: chat(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "짧음", "difference_ko": "짧음",
         "positive_prompt": short}])))
    value = gated.post("/api/v1/prompt/compose", json=body(
        target_model_id="realistic-vision-v6", target_family="sd15")).json()
    assert "profile_token_window" not in value["warnings"]


def test_a_family_without_a_profile_is_refused_before_the_call(gated):
    # A registry family this build has no profile for is a 422 about the target: there is
    # nothing to tell the model about how that family reads a prompt, and a generic prompt
    # would apply the wrong convention silently.
    gated.app.state.registry.models["unprofiled-model"] = {
        **gated.app.state.registry.models[MODEL_ID],
        "model_id": "unprofiled-model", "family": "unprofiled",
    }
    calls = install(gated.app, lambda request: chat())
    response = gated.post("/api/v1/prompt/compose", json=body(
        target_model_id="unprofiled-model", target_family="unprofiled"))
    assert response.status_code == 422
    assert "no output profile" in response.json()["detail"]
    assert calls == []


def test_the_warning_cap_keeps_the_load_bearing_codes(gated):
    # Four is the contract's cap. `candidates_reduced` and `profile_token_window` must
    # survive it, otherwise a shortened list would look complete and an over-budget prompt
    # would look fine. This reply asks for both plus two advisories at once.
    long_prompt = ", ".join(["(red dress:1.2)"] * 30)  # weighted *and* over the window
    install(gated.app, lambda request: chat(reply(candidates=[
        {"candidate_id": "candidate-1", "title_ko": "가중", "difference_ko": "가중",
         "positive_prompt": long_prompt, "negative_prompt": "blurry"},
        {"candidate_id": "candidate-2", "title_ko": "중복", "difference_ko": "중복",
         "positive_prompt": f"{long_prompt} "},
    ])))
    value = gated.post("/api/v1/prompt/compose", json=body(
        target_model_id="realistic-vision-v6", target_family="sd15")).json()
    assert len(value["warnings"]) <= 4
    assert "candidates_reduced" in value["warnings"]
    assert "profile_token_window" in value["warnings"]


def test_the_profile_joiner_matches_the_compiler_convention():
    # The profile restates the compiler's separator instead of importing it, so a silent
    # divergence is possible. `frontend/src/prompt/compiler.ts` joins with `, ` for `sd15`
    # and `; ` for the natural-language families; this pins the backend half to that rule.
    assert {family: profile.joiner for family, profile in PROFILES.items()} == {
        "sd15": ", ", "flux2": "; ", "z-image": "; ", "moss-image": "; ", "fake": "; ",
    }
    assert profile_for("sd15").prompt_style == "tags"
    for family in ("flux2", "z-image", "moss-image"):
        assert profile_for(family).prompt_style == "sentence"


# ── negative prompt, CFG, and the MOSS/LoRA duplication (§5, UCP04 checklist) ─────────


def moss_app(gated):
    """Register the real MOSS model over the fake-test fixture's registry.

    The compose route reads the live registry, and MOSS is the one family where the
    engine also rewrites the prompt (`SdCppEngine.effective_prompt`). Using the shipped
    `config/models.yaml` facts keeps the test aligned with the operator config instead of
    a hand-copied `negative_prompt: unsupported`.
    """
    from app.services.registry import Registry

    registry = Registry("config/models.yaml", "sdcpp")
    gated.app.state.registry = registry
    return registry


def test_moss_negative_prompt_is_dropped_once_not_twice(gated):
    """MOSS declares `negative_prompt: unsupported`, and the engine has no second rule.

    §5's checklist item asks whether the compose layer and the MOSS engine path both act
    on a negative prompt. They do not: `SdCppEngine.command` emits `-n` only when the spec
    carries one, and `Registry.resolve` refuses a negative for an `unsupported` model
    before a spec exists. So compose clearing the field is the *only* removal — one
    warning, not two, and no silent second edit of the user's prompt.
    """
    moss_app(gated)
    payload = reply(candidates=[{
        "candidate_id": "candidate-1", "title_ko": "부정", "difference_ko": "부정",
        "positive_prompt": "a woman in a rainy street",
        "negative_prompt": "blurry, deformed hands"}])
    install(gated.app, lambda request: chat(payload))
    value = gated.post("/api/v1/prompt/compose", json=body(
        target_model_id="moss-image-nsfw", target_family="moss-image")).json()
    assert value["status"] == "ready"
    assert value["candidates"][0]["negative_prompt"] is None
    # Exactly one negative warning: the duplication the checklist asks about would show
    # as the same code twice, or as an extra engine-side mutation the client cannot see.
    assert value["warnings"].count("negative_unsupported") == 1
    assert "negative_requires_cfg" not in value["warnings"]


def test_the_moss_engine_adds_its_own_lora_tag_and_trigger_once(gated):
    """The engine's rewrite is the source the compose warning describes, not a duplicate.

    `SdCppEngine.effective_prompt` prepends the LoRA trigger and appends
    `<lora:name:strength>`. That is why the profile tells the model not to emit its own
    tag: a model-supplied tag for a *different* LoRA would leave two, and the engine's
    dedup only matches the configured name. This pins the engine half so the compose
    warning's reason stays true.
    """
    from app.engines.sdcpp import SdCppEngine

    registry = moss_app(gated)
    model = registry.get("moss-image-nsfw")
    lora = model["lora"]
    assert lora["enabled"] and lora["trigger"]

    plain = "a woman in a rainy street"
    effective = SdCppEngine.effective_prompt(plain, model)
    # Trigger first, tag last, and the user's sentence untouched in between.
    name = lora["path"].rsplit("/", 1)[-1].removesuffix(".gguf")
    assert effective == f"{lora['trigger']} {plain} <lora:{name}:{lora['strength']:g}>"
    # Applying it twice changes nothing: the trigger and tag are each recognised.
    assert SdCppEngine.effective_prompt(effective, model) == effective


def test_a_model_supplied_lora_tag_survives_alongside_the_engines(gated):
    """The documented collision, made explicit rather than fixed silently.

    A candidate carrying `<lora:some-other:0.8>` is not deduplicated by the engine — it
    matches only the configured LoRA's name — so the final prompt has two tags. Compose
    therefore warns (`profile_weighting_syntax`) instead of dropping the candidate: the
    user can see and edit the text, which a silent rewrite would prevent.
    """
    from app.engines.sdcpp import SdCppEngine

    registry = moss_app(gated)
    model = registry.get("moss-image-nsfw")
    supplied = "a woman, <lora:my-style:0.8>, rainy street"
    effective = SdCppEngine.effective_prompt(supplied, model)
    assert effective.count("<lora:") == 2
    assert "<lora:my-style:0.8>" in effective

    install(gated.app, lambda request: chat(reply(candidates=[{
        "candidate_id": "candidate-1", "title_ko": "로라", "difference_ko": "로라",
        "positive_prompt": supplied}])))
    value = gated.post("/api/v1/prompt/compose", json=body(
        target_model_id="moss-image-nsfw", target_family="moss-image")).json()
    assert "profile_weighting_syntax" in value["warnings"]
    # Not shortened, not rewritten: the warning is the whole intervention.
    assert value["candidates"][0]["positive_prompt"] == supplied
    assert "candidates_reduced" not in value["warnings"]

