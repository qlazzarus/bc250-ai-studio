"""UCP07: the v3 snapshot's byte budget and the trim ladder that protects it.

These tests exist because the ladder is easy to make *unreachable* without noticing. It
lives behind ``PromptCompositionV3.fit()``, and any earlier check that measures the same
32 KiB refuses the body before ``fit()`` runs — so the ladder appears to work, always
reports ``snapshot_trim == []``, and every oversize v3 submission is a 422 the spec says
should have been repaired.

The failing behaviour, concretely: ``check_snapshot`` measured the cap during validation,
so ``fit()`` was only ever reachable for a record that already fit. ``fit_payload`` had no
caller that could see an over-budget payload.

The pinned byte numbers come from ``measure_ladder.py``; that script re-measures, this file
asserts. A number here disagreeing with the script means the ladder changed and the doc's
table is now wrong.
"""

import copy
import json

import pytest
from app.core.studio_config import Settings
from app.main import create_app
from app.models.schemas import PromptCompositionV3
from app.services.prompt_snapshot import LADDER, MAX_SNAPSHOT_BYTES, payload_size
from conftest import ADMIN_KEY, CLIENT_KEY, HEADERS, wait_job
from fastapi.testclient import TestClient
from test_api import FailOnce


def worst_case():
    """Every semantic cap filled at once: the snapshot the ladder exists for.

    Kept identical in shape to ``measure_ladder.worst_case`` (the numbers only match if the
    input matches), but written out here so the test does not depend on a script whose job
    is to be run by hand.
    """
    entities = [
        {"entity_id": f"entity-{i}", "kind": "person", "count": 16,
         "attributes_ko": ["가" * 200] * 8, "evidence_ko": "나" * 200}
        for i in range(1, 9)
    ]
    relations = [
        {"subject_entity_id": f"entity-{(i % 8) + 1}", "predicate_ko": "다" * 200,
         "object_entity_id": f"entity-{((i + 1) % 8) + 1}", "evidence_ko": "라" * 200}
        for i in range(12)
    ]
    selections = []
    for i in range(100):
        if i % 5 == 0:
            selections.append({"id": f"d.entry{i}", "source": "excluded"})
        else:
            selections.append({"id": f"d.entry{i}", "source": "manual", "pinned": True,
                               "entity_id": f"entity-{(i % 8) + 1}"})
    return {
        "schema_version": 3, "compiler_version": "1.3.0",
        "dictionary_version": "1.2.0", "target_model_id": "m" * 100,
        "target_family": "fake", "profile_version": 1,
        "brief_ko": "사" * 4000,
        "selections": selections,
        "scene": {"entities": entities, "relations": relations,
                  "environment": {k: "아" * 200 for k in
                                  ("location_ko", "time_ko", "lighting_ko",
                                   "composition_ko", "style_ko", "mood_ko")},
                  "unmapped_details": [{"text_ko": "마" * 200, "entity_id": "entity-1"}
                                       for _ in range(8)],
                  "ambiguities": [{"text_ko": "바" * 200, "why": "actor_unknown",
                                   "options": [f"entity-{i}" for i in range(1, 7)]}
                                  for _ in range(8)]},
        "applied": {"result_id": "cmp-0123456789ab", "candidate_id": "c" * 64,
                    "provider_model": "p" * 200,
                    "applied_at": "2026-11-22T00:00:00Z",
                    "positive_prompt": "b" * 8000, "negative_prompt": "n" * 4000,
                    "summary_ko": "자" * 600},
        "snapshot_trim": [],
    }


# The exact steps the fixture loses, measured on this fixture. A change here means the
# ladder or the semantic caps moved, and the doc's table (실측 결과) needs re-measuring.
LABELED_STEPS = ["evidence_ko", "ambiguity_options", "attributes_first",
                 "brief_2000", "environment", "arrays_2"]


def test_an_oversize_v3_body_validates_and_is_trimmed_on_fit():
    """The core regression: >32 KiB must reach ``fit()``, not be refused by validation.

    Asserting only "it fits afterwards" would pass on a server that simply refused the
    input, so the test pins the three facts that make the ladder real: validation accepted
    an over-budget body, ``fit()`` reported the steps it took, and the result is under the
    budget.
    """
    payload = worst_case()
    assert payload_size(payload) > MAX_SNAPSHOT_BYTES, "fixture must be over budget"

    model = PromptCompositionV3.model_validate(payload)   # must not raise
    fitted, steps = model.fit()

    assert steps, "an over-budget record must have been trimmed"
    assert payload_size(fitted) <= MAX_SNAPSHOT_BYTES
    # `snapshot_trim` is the record of what is absent, in ladder order.
    assert fitted["snapshot_trim"] == steps
    assert steps == [name for name in LADDER if name in steps]
    assert LABELED_STEPS == steps


def test_the_ladder_never_touches_what_was_actually_executed():
    """`applied` and the selections survive every step, or the record stops being true."""
    fitted, steps = PromptCompositionV3.model_validate(worst_case()).fit()

    assert "scene_dropped" not in steps, "this fixture fits before the last step"
    applied = fitted["applied"]
    assert applied["positive_prompt"] == "b" * 8000
    assert applied["negative_prompt"] == "n" * 4000
    assert applied["summary_ko"] == "자" * 600
    # Selections are decisions, not derivable: every row and every veto survives.
    original = worst_case()["selections"]
    assert [item["id"] for item in fitted["selections"]] == [item["id"] for item in original]
    assert [item["source"] for item in fitted["selections"]] == \
        [item["source"] for item in original]
    # `arrays_2` keeps two entities, so an attribution to a dropped one is cleared rather
    # than dangling — the chip stays, the owner it cannot vouch for does not.
    survivors = {entity["entity_id"] for entity in fitted["scene"]["entities"]}
    assert survivors == {"entity-1", "entity-2"}
    for item in fitted["selections"]:
        assert item["entity_id"] is None or item["entity_id"] in survivors
    excluded = [item for item in fitted["selections"] if item["source"] == "excluded"]
    assert len(excluded) == 20
    # A veto carries nothing else, or it would be a claim about a chip that is not there.
    assert all(item["pinned"] is None and item["entity_id"] is None for item in excluded)


def test_a_trimmed_record_re_saves_without_losing_what_it_says_was_trimmed():
    """A restore -> apply -> submit round trip must not erase the trim record.

    ``snapshot_trim`` is the only evidence that a field is *absent* rather than *empty*
    (UCP01 fix B). The trimmed row is already inside the budget, so a second ``fit()``
    takes no steps — and writing that empty list over the stored one would make the row
    claim it was never lowered while its evidence and options are still missing.
    """
    first, steps = PromptCompositionV3.model_validate(worst_case()).fit()
    assert steps

    second, steps2 = PromptCompositionV3.model_validate(first).fit()
    assert steps2 == steps, "re-fitting an already-trimmed record must keep its history"
    assert second["snapshot_trim"] == steps
    assert payload_size(second) <= MAX_SNAPSHOT_BYTES


def test_the_ladder_still_refuses_when_it_cannot_get_under_the_budget():
    """The refusal must carry a byte count, and must not be a silently over-budget row.

    What the ladder may never remove: ``selections`` (an exclusion is the only record of a
    veto), ``brief_ko``'s first 2,000 characters, and ``applied``. Fill exactly those and
    no step can help — the honest answer is a refusal, not a snapshot cut mid-sentence.
    """
    payload = {
        "schema_version": 3, "compiler_version": "1.3.0", "dictionary_version": "1.2.0",
        "target_model_id": "m", "target_family": "fake", "profile_version": 1,
        "brief_ko": "다" * 3000,
        "selections": [{"id": f"{index:03d}" + "가" * 60, "source": "excluded"}
                       for index in range(40)],
        "scene": {"entities": [], "relations": [], "environment": {},
                  "unmapped_details": [], "ambiguities": []},
        "applied": {"result_id": "r", "candidate_id": "c", "provider_model": "p",
                    "applied_at": "2026-11-22T00:00:00Z",
                    "positive_prompt": "나" * 8000, "summary_ko": ""},
        "snapshot_trim": [],
    }
    model = PromptCompositionV3.model_validate(payload)   # legal at validation time
    with pytest.raises(ValueError) as raised:
        model.fit()
    # The count is the point: "too large" alone leaves the user with nothing to act on.
    assert "32 KiB" in str(raised.value)


def end_to_end_body():
    """An over-budget snapshot that still fits the *request* cap.

    Two limits stack: the snapshot budget (32 KiB) and the whole-body cap
    (``max_body_bytes``, 64 KiB by default). ``worst_case`` is 100 KB, so it never reaches
    validation at all — a 413 at the door. The ladder is only reachable in the window
    between them, which is why this fixture is deliberately modest: one huge field the
    ladder can lower, and nothing else inflated.
    """
    payload = worst_case()
    payload["brief_ko"] = "사" * 4000
    payload["scene"] = {"entities": [], "relations": [], "environment": {},
                        "unmapped_details": [{"text_ko": "마" * 200} for _ in range(8)],
                        "ambiguities": []}
    payload["selections"] = [{"id": f"d.entry{i}", "source": "manual", "pinned": True}
                             for i in range(100)]
    payload["applied"]["positive_prompt"] = "b" * 8000
    payload["applied"]["negative_prompt"] = "n" * 4000
    return payload


def test_an_oversize_v3_body_is_accepted_end_to_end_and_read_back_trimmed(client):
    """The whole path: 202, a stored trimmed row, and a stable re-submit of that row.

    Unit tests on ``fit()`` cannot tell whether ``resolve`` calls it, and the bug this
    guards against was exactly a body that never got that far. So this goes through
    ``POST /api/v1/jobs`` and reads the row back from the API.
    """
    body = end_to_end_body()
    assert payload_size(body) > MAX_SNAPSHOT_BYTES, "fixture must be over snapshot budget"
    assert payload_size(body) < 65536, "fixture must survive the request cap"
    response = client.post("/api/v1/jobs", json={
        "model_id": "fake", "prompt": "a woman in a red dress",
        "prompt_composition": body})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()["job_id"])

    stored = job["prompt_composition"]
    assert stored["schema_version"] == 3
    assert stored["snapshot_trim"], "this fixture must have needed the ladder"
    assert payload_size(stored) <= MAX_SNAPSHOT_BYTES
    # What was executed is intact; that is the whole reason these steps are allowed.
    assert stored["applied"]["positive_prompt"] == "b" * 8000
    assert job["prompt"] == "a woman in a red dress"

    # Submitting the stored row again must be accepted and must not lose the trim record.
    again = client.post("/api/v1/jobs", json={
        "model_id": "fake", "prompt": "a woman in a red dress",
        "prompt_composition": copy.deepcopy(stored)})
    assert again.status_code == 202, again.text
    second = wait_job(client, again.json()["job_id"])
    assert second["prompt_composition"]["snapshot_trim"] == stored["snapshot_trim"]
    assert payload_size(second["prompt_composition"]) <= MAX_SNAPSHOT_BYTES
    assert json.dumps(second["prompt_composition"]["applied"], sort_keys=True) \
        == json.dumps(stored["applied"], sort_keys=True)


def test_saving_a_record_does_not_grow_it():
    """``fit(fit(x))`` must be byte-for-byte ``fit(x)``.

    Save -> read -> re-save is a path the contract names explicitly (restore, then apply,
    then submit), so it has to be a fixed point. A record that changed size on the second
    pass would mean the stored bytes are not the bytes ``fit()`` measured — and the size
    a reader sees is then not the size the budget was checked against.

    This is the regression guard for ``CompositionSceneEnvironment.omit_unstated``: with
    six ``null`` keys emitted, the *first* dump is already padded, so the two passes do
    agree byte-for-byte and only the shape test below catches it. Keeping this here means
    a future serializer change that drops padding on read but not on write fails loudly.
    """
    first, steps = PromptCompositionV3.model_validate(end_to_end_body()).fit()
    second, steps2 = PromptCompositionV3.model_validate(first).fit()

    assert payload_size(first) == payload_size(second)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert steps2 == steps


def test_an_unstated_environment_is_an_empty_object_not_six_nulls():
    """The rule is "빈 문자열은 키 생략": the stored shape has to match the doc's examples.

    ``{"environment": {}}`` appears verbatim in §5's scene examples, and the table says
    at most six keys with unstated ones omitted. Emitting ``location_ko: null`` and five
    siblings instead would make "not stated" indistinguishable from "explicitly cleared".
    """
    payload = PromptCompositionV3.model_validate(worst_case()).model_dump(mode="json")
    assert payload["scene"]["environment"] == {
        key: "아" * 200 for key in ("location_ko", "time_ko", "lighting_ko",
                                   "composition_ko", "style_ko", "mood_ko")}

    bare = {**worst_case(), "scene": {**worst_case()["scene"], "environment": {}}}
    dumped = PromptCompositionV3.model_validate(bare).model_dump(mode="json")
    assert dumped["scene"]["environment"] == {}

    # A partially stated environment keeps only what was stated, and a stated empty
    # string is still "not stated" rather than a seventh state.
    partial = {**worst_case(), "scene": {**worst_case()["scene"],
                                        "environment": {"location_ko": "비 오는 거리",
                                                        "mood_ko": ""}}}
    dumped = PromptCompositionV3.model_validate(partial).model_dump(mode="json")
    assert dumped["scene"]["environment"] == {"location_ko": "비 오는 거리"}


def test_a_trimmed_v3_record_survives_a_restart_and_a_retry(tmp_path):
    """UCP07 checklist 2 & 4: stored on disk, read by another process, retried intact.

    Every other test here reads the row back through the app that wrote it, so a server
    that kept the snapshot in memory (or re-derived it) would still pass. Restarting on the
    same data directory is the only way to tell "stored" from "remembered" — and it is the
    path where a trim bug is worst, because a record that lost its `snapshot_trim` on the
    way back also loses the fact that its scene is incomplete.

    The retry leg matters for the same reason: a retry re-uses the stored spec instead of
    recompiling, so it is a genuine second read of the trimmed row rather than a re-fit.
    """
    settings = Settings(
        data_dir=tmp_path / "data", api_key=CLIENT_KEY, admin_key=ADMIN_KEY,
        policy="image_priority", poll_interval=0.01, fake_delay=0.01,
    )
    body = end_to_end_body()
    with TestClient(create_app(settings, engine=FailOnce()), headers=HEADERS) as client:
        response = client.post("/api/v1/jobs", json={
            "model_id": "fake", "prompt": "a woman in a red dress",
            "prompt_composition": body})
        assert response.status_code == 202, response.text
        first = wait_job(client, response.json()["job_id"])
        assert first["status"] == "failed", "the fake engine fails once, to set up a retry"
        job_id = first["job_id"]
        steps = first["prompt_composition"]["snapshot_trim"]
        assert steps

    # A second process on the same data directory: nothing shared but sqlite and sidecar.
    with TestClient(create_app(settings), headers=HEADERS) as client:
        stored = client.get(f"/api/v1/jobs/{job_id}").json()["prompt_composition"]
        assert stored["schema_version"] == 3
        assert stored["snapshot_trim"] == steps
        assert payload_size(stored) <= MAX_SNAPSHOT_BYTES
        assert stored["applied"]["positive_prompt"] == "b" * 8000

        # The retry copies the stored spec, so this is the trimmed row read a third time.
        retried = client.post(f"/api/v1/jobs/{job_id}/retry")
        assert retried.status_code == 202, retried.text
        second = wait_job(client, retried.json()["job_id"])
        assert second["status"] == "completed"
        assert second["prompt_composition"] == stored
        assert second["prompt"] == "a woman in a red dress"

        # Checklist 2's three other copies. Each is a separate write, so asserting only
        # the row would pass while the sidecar still carried an untrimmed snapshot.
        asset_id = second["output_asset_ids"][0]
        metadata = client.get(f"/api/v1/assets/{asset_id}/metadata").json()
        assert metadata["prompt_composition"] == stored
        events = client.get(f"/api/v1/jobs/{second['job_id']}/events").text
        assert '"schema_version":3' in events.replace(" ", "")
        sidecar = next((settings.data_dir / "outputs").rglob("*.json"))
        assert json.loads(sidecar.read_text())["prompt_composition"] == stored


def test_a_record_that_the_ladder_cannot_save_is_a_422_not_a_broken_row(client):
    """A refusal is a 422 before the row exists, so nothing unreadable is ever stored."""
    payload = {
        "schema_version": 3, "compiler_version": "1.3.0", "dictionary_version": "1.2.0",
        "target_model_id": "fake", "target_family": "fake", "profile_version": 1,
        "brief_ko": "다" * 3000,
        "selections": [{"id": f"{index:03d}" + "가" * 60, "source": "excluded"}
                       for index in range(40)],
        "scene": {"entities": [], "relations": [], "environment": {},
                  "unmapped_details": [], "ambiguities": []},
        "applied": {"result_id": "r", "candidate_id": "c", "provider_model": "p",
                    "applied_at": "2026-11-22T00:00:00Z",
                    "positive_prompt": "나" * 8000, "summary_ko": ""},
        "snapshot_trim": [],
    }
    response = client.post("/api/v1/jobs", json={
        "model_id": "fake", "prompt": "x", "prompt_composition": payload})
    assert response.status_code == 422, response.text
    # And the queue is still readable: no half-written snapshot left behind.
    assert client.get("/api/v1/jobs").status_code == 200
