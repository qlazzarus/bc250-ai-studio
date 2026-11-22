"""UCP02 backend contract: the v3 snapshot, the scene, and the compose request/response.

Model-level checks: no HTTP, no provider. They pin the rules that make the stored record
trustworthy — referential integrity, `applied` presence-not-null, and a request that
accepts selection-only input while still refusing nothing-at-all.
"""

import copy
import json

import pytest
from app.models.schemas import (
    ComposeRequest,
    ComposeResponse,
    PromptCompositionV3,
    check_scene,
)
from pydantic import ValidationError


def v3():
    """The §6 example, used as the base every mutation starts from."""
    return {
        "schema_version": 3, "compiler_version": "1.3.0",
        "dictionary_version": "1.2.0",
        "target_model_id": "pornmaster-klein-9b", "target_family": "flux2",
        "profile_version": 1,
        "brief_ko": "붉은 원피스를 입은 여성이 비 오는 거리에 서 있다",
        "selections": [
            {"id": "subject.person", "source": "auto", "pinned": False,
             "entity_id": "entity-1"},
            {"id": "clothing.dress", "source": "manual", "pinned": True,
             "entity_id": "entity-1"},
            {"id": "location.street", "source": "auto", "pinned": False},
            {"id": "style.illustration", "source": "excluded"},
        ],
        "scene": {
            "entities": [{"entity_id": "entity-1", "kind": "person", "count": 1,
                          "attributes_ko": ["붉은 원피스"],
                          "evidence_ko": "붉은 원피스를 입은 여성"}],
            "relations": [{"subject_entity_id": "entity-1", "predicate_ko": "서 있다",
                           "object_entity_id": None, "evidence_ko": "거리에 서 있다"}],
            "environment": {"location_ko": "비 오는 거리", "lighting_ko": "흐린 날 빛"},
            "unmapped_details": [{"text_ko": "비에 젖은 아스팔트 반사",
                                  "entity_id": None}],
            "ambiguities": [],
        },
        "applied": {"result_id": "cmp-0123456789ab", "candidate_id": "candidate-1",
                    "provider_model": "qwen3-test",
                    "applied_at": "2026-11-21T00:00:00Z",
                    "positive_prompt": "a woman in a red dress",
                    "negative_prompt": "blurry", "summary_ko": "요약"},
        "snapshot_trim": [],
    }


def compose():
    return {
        "schema_version": 1, "request_id": "cmp-0123456789ab",
        "input_revision": "sha256:" + "6f1c" * 16,
        "dictionary_version": "1.2.0",
        "target_model_id": "pornmaster-klein-9b", "target_family": "flux2",
        "profile_version": 1, "candidate_count": 3,
        "brief_ko": "붉은 원피스를 입은 여성이 비 오는 거리에 서 있다",
        "selections": [{"id": "clothing.dress", "source": "manual", "pinned": True},
                       {"id": "style.illustration", "source": "excluded"}],
        "clarification_choices": [],
    }


def test_the_six_section_snapshot_example_is_valid():
    snapshot = PromptCompositionV3.model_validate(v3())
    # `source` and `pinned` are recorded, not flattened: the applied record is only
    # trustworthy if it says which chips the user picked and which they vetoed.
    assert [item.source for item in snapshot.selections] == [
        "auto", "manual", "auto", "excluded"]
    assert snapshot.applied.candidate_id == "candidate-1"
    assert snapshot.snapshot_trim == []


@pytest.mark.parametrize("change", [
    # A chosen selection needs `pinned`; an excluded one must not carry it (§6).
    {"selections": [{"id": "x.y", "source": "auto"}]},
    {"selections": [{"id": "x.y", "source": "excluded", "pinned": False}]},
    # A selection may only name an entity the scene defines.
    {"selections": [{"id": "x.y", "source": "manual", "pinned": False,
                     "entity_id": "entity-9"}]},
    # Neither may a relation, an unmapped detail, or an ambiguity option.
    {"scene": {"entities": [{"entity_id": "entity-1", "kind": "person"}],
               "relations": [{"subject_entity_id": "entity-9",
                              "predicate_ko": "서 있다"}]}},
    {"scene": {"entities": [{"entity_id": "entity-1", "kind": "person"}],
               "unmapped_details": [{"text_ko": "반사", "entity_id": "entity-9"}]}},
    {"scene": {"entities": [{"entity_id": "entity-1", "kind": "person"}],
               "ambiguities": [{"text_ko": "누가?", "why": "actor_unknown",
                                "options": ["entity-9"]}]}},
    # `applied` is presence-not-null: `null` would be a third state meaning nothing.
    {"applied": None},
    # A trim step outside the fixed ladder is a client bug, not a future step.
    {"snapshot_trim": ["brief_500"]},
    # v3 does not accept the v2 `remainder` key.
    {"remainder": []},
])
def test_a_broken_snapshot_is_refused(change):
    with pytest.raises(ValidationError):
        PromptCompositionV3.model_validate({**v3(), **change})


def test_a_snapshot_needs_text_or_a_chosen_selection():
    # Fix A: an empty brief is valid when a chip carries the request. The *result* is
    # checked, not just the absence of an exception: a no-op `model_validate` would
    # otherwise pass this line while proving nothing.
    only_chip = PromptCompositionV3.model_validate({**v3(), "brief_ko": "", "selections": [
        {"id": "x.y", "source": "auto", "pinned": False}]})
    assert only_chip.brief_ko == ""
    assert [item.id for item in only_chip.selections] == ["x.y"]
    # A veto alone records nothing to generate.
    with pytest.raises(ValidationError):
        PromptCompositionV3.model_validate({**v3(), "brief_ko": "", "selections": [
            {"id": "style.illustration", "source": "excluded"}]})


def test_a_v2_body_cannot_smuggle_v3_keys():
    with pytest.raises(ValidationError):
        PromptCompositionV3.model_validate({
            "schema_version": 2, "compiler_version": "1", "target_family": "sd15",
            "selections": [], "scene": {"entities": []}})


def test_check_scene_names_the_broken_reference():
    # Called directly so the message names the offending id a client has to fix.
    scene = type("Scene", (), {
        "entities": [type("Entity", (), {"entity_id": "entity-1"})()],
        "relations": [type("Relation", (), {"subject_entity_id": "entity-1",
                                            "object_entity_id": "entity-9"})()],
        "unmapped_details": [], "ambiguities": []})()
    with pytest.raises(ValueError, match="entity-9"):
        check_scene(scene)




def test_the_compose_request_accepts_selection_only_input():
    # Fix A at the request layer: no brief, one chosen chip.
    only_chip = ComposeRequest.model_validate({**compose(), "brief_ko": "", "selections": [
        {"id": "lighting.neon", "source": "manual", "pinned": False}]})
    assert only_chip.brief_ko == ""
    assert [item.id for item in only_chip.selections] == ["lighting.neon"]
    # Nothing at all is refused here rather than becoming an empty success.
    with pytest.raises(ValidationError):
        ComposeRequest.model_validate({**compose(), "brief_ko": "", "selections": []})
    with pytest.raises(ValidationError):
        ComposeRequest.model_validate({**compose(), "brief_ko": "   ", "selections": [
            {"id": "x.y", "source": "excluded"}]})


@pytest.mark.parametrize("veto", [
    {"id": "x.y", "source": "excluded", "pinned": False},
    {"id": "x.y", "source": "excluded", "entity_id": "entity-1"},
])
def test_an_excluded_request_selection_carries_only_its_id(veto):
    # The client re-sends the whole list, so a stray field on a veto is a client bug worth
    # rejecting rather than silently ignoring.
    with pytest.raises(ValidationError):
        ComposeRequest.model_validate({**compose(), "selections": [veto]})


def ready_response():
    return {
        "schema_version": 1, "status": "ready",
        "result_id": "cmp-0123456789ab", "request_id": "cmp-0123456789ab",
        "input_revision": "sha256:" + "6f1c" * 16,
        "target_model_id": "pornmaster-klein-9b", "target_family": "flux2",
        "profile_version": 1, "dictionary_version": "1.2.0",
        "summary_ko": "요약", "selections": [],
        "scene": {"entities": [], "relations": [], "environment": {},
                  "unmapped_details": [], "ambiguities": []},
        "candidates": [{"candidate_id": "candidate-1", "title_ko": "원문 충실",
                        "difference_ko": "기본 후보",
                        "positive_prompt": "a woman in a red dress"}],
        "clarifications": [], "warnings": [], "snapshot_trim": [],
        "provider": {"model": "qwen3-test", "latency_ms": 4120,
                     "finish_reason": "stop"},
    }


def test_a_cut_reply_is_flagged_and_cannot_be_an_empty_ready():
    # §5: `finish_reason: length` must not be disguised as a complete reply.
    cut = ComposeResponse.model_validate({**ready_response(), "cut_short": True})
    assert cut.cut_short is True
    # Truncation with nothing left to offer is `unavailable`, not an empty success.
    with pytest.raises(ValidationError):
        ComposeResponse.model_validate({**ready_response(), "cut_short": True,
                                        "candidates": []})


def test_provider_tokens_stay_separate_and_absent_by_default():
    response = ComposeResponse.model_validate(ready_response())
    # Absent is not zero: a provider that reports nothing must not look like one that
    # measured zero reasoning tokens.
    assert response.provider.prompt_tokens is None
    assert response.provider.reasoning_tokens is None
    assert response.provider.output_tokens is None
    used = ComposeResponse.model_validate({**ready_response(), "provider": {
        **ready_response()["provider"],
        "prompt_tokens": 1200, "reasoning_tokens": 3400, "output_tokens": 210}})
    assert used.provider.reasoning_tokens == 3400
    assert used.provider.output_tokens == 210


def test_ready_and_clarification_are_mutually_exclusive():
    clarification = {"question_id": "clar-01", "question_ko": "누가 서 있나요?",
                     "why": "actor_unknown",
                     "options": [{"option_id": "opt-01", "label_ko": "여성"}]}
    # Candidates and questions together leave the client no defined action.
    with pytest.raises(ValidationError):
        ComposeResponse.model_validate({**ready_response(),
                                        "clarifications": [clarification]})
    with pytest.raises(ValidationError):
        ComposeResponse.model_validate({**ready_response(),
                                        "status": "needs_clarification"})


def test_a_snapshot_and_a_reply_name_trim_steps_the_same_way():
    # One vocabulary: a reply that already trimmed is storable without translation.
    trimmed = ComposeResponse.model_validate({**ready_response(),
                                              "snapshot_trim": ["evidence_ko"]})
    assert trimmed.snapshot_trim == ["evidence_ko"]
    with pytest.raises(ValidationError):
        ComposeResponse.model_validate({**ready_response(),
                                        "snapshot_trim": ["brief_500"]})


def test_the_example_snapshot_stays_inside_the_byte_budget():
    # The documented example must itself fit, else the caps it demonstrates are wrong.
    size = len(json.dumps(copy.deepcopy(v3()), ensure_ascii=False,
                          separators=(",", ":")).encode("utf-8"))
    assert size < 32_768
