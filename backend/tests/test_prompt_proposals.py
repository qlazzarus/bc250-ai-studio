"""LLM-I01 fixtures: the C01-8 contract is encoded here, not model quality.

None of these payloads came from a running model. They are the agreed shape and
the decisions the validator must make, so a regression shows up as a test
failure instead of a silent UI change.
"""

import json

from app.services.prompt_proposals import (
    MAX_PROVIDER_REPLY_BYTES,
    MAX_RESPONSE_BYTES,
    DictionaryEntryRef,
    ProposalRequest,
    ProposalResponse,
    encoded_size,
    evaluate,
    parse_reply,
)

REQUEST_ID = "req-0123456789"

DICTIONARY = {
    "subject.person": DictionaryEntryRef("subject"),
    "subject.two_people": DictionaryEntryRef("subject"),
    "appearance.short_hair": DictionaryEntryRef("appearance"),
    "appearance.glasses": DictionaryEntryRef("appearance"),
    "appearance.long_hair": DictionaryEntryRef("appearance"),
    "clothing.white_shirt": DictionaryEntryRef("clothing"),
    "clothing.blue_shirt": DictionaryEntryRef("clothing"),
    "setting.plain_background": DictionaryEntryRef("setting"),
    "lighting.neon": DictionaryEntryRef("lighting"),
    "style.analog_film": DictionaryEntryRef("style"),
    "style.retired_style": DictionaryEntryRef("style", active=False),
}


def make_request(text, **changes):
    payload = {
        "kind": "selection_hint",
        "request_id": REQUEST_ID,
        "target_family": "sd15",
        "dictionary_version": "1.2.0",
        "free_text_ko": text,
        "revisions": {
            "scene": "sha256:" + "a" * 64,
            "selection": "sha256:" + "b" * 64,
            "text": "sha256:" + "c" * 64,
        },
    }
    payload.update(changes)
    return ProposalRequest.model_validate(payload)


def make_reply(**changes):
    payload = {
        "proposal_id": "prop-0123456789",
        "request_id": REQUEST_ID,
        "status": "ready",
        "kind": "selection_hint",
        "provider": {"model": "qwen2.5-vl-7b", "version": "2026-05", "latency_ms": 812,
                     "finish_reason": "stop"},
        "revisions": {
            "scene": "sha256:" + "a" * 64,
            "selection": "sha256:" + "b" * 64,
            "text": "sha256:" + "c" * 64,
        },
        "suggestions": [],
        "unresolved_spans": [],
        "ambiguities": [],
        "rejected": [],
        "truncated": False,
    }
    payload.update(changes)
    return payload


def hint(entry_id, phrase, **changes):
    payload = {"id": entry_id, "matched_phrase": phrase, "basis": "quote",
               "polarity": "affirmed", "actor": None, "confidence": 0.8,
               "reason_ko": "장면 조건"}
    payload.update(changes)
    return payload


def run(reply, request):
    return evaluate(json.dumps(reply, ensure_ascii=False).encode("utf-8"),
                    request=request, dictionary=DICTIONARY)


def test_example_1_keeps_umbrella_and_waiting_out_of_selections():
    """C01-6 #1: only a dictionary entry becomes a selection."""
    text = "비 오는 밤, 편의점 앞에서 우산을 접으며 친구를 기다리는 사람"
    request = make_request(text)
    reply = make_reply(
        suggestions=[hint("subject.person", "사람")],
        unresolved_spans=[
            {"text": "비 오는 밤", "why": "no_dictionary_entry", "polarity": "affirmed"},
            {"text": "편의점 앞", "why": "no_dictionary_entry", "polarity": "affirmed"},
            {"text": "우산을 접으며", "why": "no_dictionary_entry", "polarity": "affirmed"},
        ],
    )
    result = run(reply, request)
    assert result.status == "ready"
    assert [item.id for item in result.suggestions] == ["subject.person"]
    assert result.suggestions[0].auto_accept is True
    assert [span["text"] for span in result.unresolved_spans] == [
        "비 오는 밤", "편의점 앞", "우산을 접으며"]
    assert all(item.id != "subject.two_people" for item in result.suggestions)


def test_example_2_rejects_glasses_behind_a_negation():
    """C01-6 #2: 안경 없이 must not become appearance.glasses."""
    text = "안경 없이 짧은 머리의 사람"
    request = make_request(text)
    reply = make_reply(
        suggestions=[
            hint("appearance.short_hair", "짧은 머리"),
            hint("subject.person", "사람"),
            # The provider wrongly says affirmed; the text negates 안경.
            hint("appearance.glasses", "안경"),
        ],
        unresolved_spans=[{"text": "안경 없이", "why": "negated", "polarity": "negated"}],
    )
    result = run(reply, request)
    assert [item.id for item in result.suggestions] == [
        "appearance.short_hair", "subject.person"]
    # 짧은 머리 is not inside the negation window, so it must survive.
    assert any(span["why"] == "polarity_conflict" for span in result.unresolved_spans)


def test_negation_guard_only_holds_the_negated_noun():
    """C01-6 #2: 안경 is held, 짧은 머리 in the same sentence is not.

    A symmetric "앞뒤 12자" window would also hold 짧은 머리, because 없이 sits
    inside 12 characters before it. Korean attaches the marker after the noun,
    so the guard must look forward only.
    """
    text = "안경 없이 짧은 머리의 사람"
    request = make_request(text)
    reply = make_reply(suggestions=[hint("appearance.glasses", "안경"),
                                    hint("appearance.short_hair", "짧은 머리")])
    result = run(reply, request)
    assert [item.id for item in result.suggestions] == ["appearance.short_hair"]
    assert [span["why"] for span in result.unresolved_spans] == ["polarity_conflict"]


def test_negation_guard_works_for_long_hair_and_glasses_cases():
    for text, entry_id, phrase in [
        ("안경을 쓰지 않은 사람", "appearance.glasses", "안경"),
        ("긴 머리가 아닌 사람", "appearance.long_hair", "긴 머리"),
        ("안경 제외한 사람", "appearance.glasses", "안경"),
    ]:
        request = make_request(text)
        result = run(make_reply(suggestions=[hint(entry_id, phrase)]), request)
        assert result.suggestions == (), text
        assert result.unresolved_spans[0]["why"] == "polarity_conflict", text

    """C01-6 #3: two people's clothing cannot be attributed in Scene v1."""
    text = "빨간 옷을 입은 사람이 파란 옷을 입은 사람에게 책을 건넨다"
    request = make_request(text)
    reply = make_reply(
        suggestions=[hint("subject.person", "사람")],
        unresolved_spans=[
            {"text": "빨간 옷", "why": "no_dictionary_entry", "polarity": "affirmed"},
            {"text": "파란 옷", "why": "no_dictionary_entry", "polarity": "affirmed"},
            {"text": "책을 건넨다", "why": "no_dictionary_entry", "polarity": "affirmed"},
        ],
        ambiguities=[{"text": "그 사람", "why": "actor_unknown",
                      "candidates": ["subject.person"]}],
    )
    result = run(reply, request)
    assert [item.id for item in result.suggestions] == ["subject.person"]
    assert result.ambiguities[0]["why"] == "actor_unknown"
    assert all("clothing" not in item.id for item in result.suggestions)


def test_example_4_marks_inferred_without_accepting_it():
    """C01-6 #4: a setting the text does not name is shown, not batch-accepted."""
    text = "흰 배경 위 유리병 제품, 글자 없이"
    request = make_request(text)
    reply = make_reply(
        suggestions=[hint("setting.plain_background", "흰 배경", basis="inferred")],
        unresolved_spans=[
            {"text": "유리병 제품", "why": "no_dictionary_entry", "polarity": "affirmed"},
            {"text": "글자 없이", "why": "negated", "polarity": "negated"},
        ],
    )
    result = run(reply, request)
    assert [item.id for item in result.suggestions] == ["setting.plain_background"]
    assert result.suggestions[0].basis == "inferred"


def test_example_5_partial_change_honours_locks_and_scope():
    """C01-6 #5: a setting-only change rejects locked and out-of-group items."""
    text = "같은 인물과 의상을 유지하고 장소만 바꿔줘"
    request = make_request(
        text, kind="partial_change",
        selections=[{"id": "subject.person", "category": "subject"},
                    {"id": "clothing.white_shirt", "category": "clothing"}],
        locked_ids=["subject.person", "clothing.white_shirt"],
        target_groups=["setting"],
    )
    reply = make_reply(
        kind="partial_change",
        suggestions=[
            hint("lighting.neon", "장소"),  # wrong group
            hint("style.analog_film", "장소", basis="inferred"),  # wrong group
            hint("setting.plain_background", "장소"),  # in scope
        ],
    )
    result = run(reply, request)
    assert [item.id for item in result.suggestions] == ["setting.plain_background"]
    reasons = {item["raw_id"]: item["why"] for item in result.rejected}
    assert reasons["lighting.neon"] == "out_of_scope"
    assert reasons["style.analog_film"] == "out_of_scope"
    # Already-selected IDs are omitted, never reported as rejects.
    assert "subject.person" not in reasons


def test_locked_id_is_rejected_when_scope_allows_it():
    """C01-8: 잠긴 ID 재제안 -> locked."""
    text = "의상만 바꿔줘"
    request = make_request(
        text, kind="partial_change",
        locked_ids=["clothing.white_shirt"],
        target_groups=["clothing"],
    )
    reply = make_reply(kind="partial_change",
                       suggestions=[hint("clothing.white_shirt", "의상")])
    result = run(reply, request)
    assert result.suggestions == ()
    assert result.rejected == ({"raw_id": "clothing.white_shirt", "why": "locked"},)


def test_unknown_id_is_rejected_not_accepted():
    """C01-8: 없는 ID -> not_in_dictionary, never a 422 style hard failure."""
    text = "네온 조명"
    request = make_request(text)
    reply = make_reply(suggestions=[hint("lighting.glow", "네온")])
    result = run(reply, request)
    assert result.status == "empty"
    assert result.rejected == ({"raw_id": "lighting.glow", "why": "not_in_dictionary"},)


def test_inactive_entry_is_rejected():
    text = "레트로 스타일"
    request = make_request(text)
    reply = make_reply(suggestions=[hint("style.retired_style", "스타일")])
    result = run(reply, request)
    assert result.rejected == ({"raw_id": "style.retired_style", "why": "inactive_entry"},)


def test_quote_that_is_not_in_the_text_is_downgraded():
    """C01-8: matched_phrase가 원문에 없음 -> basis inferred."""
    text = "짧은 머리의 사람"
    request = make_request(text)
    reply = make_reply(suggestions=[hint("lighting.neon", "네온 조명", basis="quote")])
    result = run(reply, request)
    assert result.suggestions[0].basis == "inferred"
    assert result.suggestions[0].auto_accept is False


def test_actor_suggestion_is_held_as_ambiguity():
    """C01-8: actor 지정 제안 -> attribution_unsupported_v1."""
    text = "빨간 옷의 사람"
    request = make_request(text)
    reply = make_reply(suggestions=[hint("clothing.white_shirt", "빨간 옷",
                                         actor="person-1")])
    result = run(reply, request)
    assert result.suggestions == ()
    assert result.rejected[0]["why"] == "attribution_unsupported_v1"
    assert result.ambiguities[0]["candidates"] == ["clothing.white_shirt"]


def test_length_finish_discards_partial_suggestions():
    """C01-8: finish_reason length -> unavailable, partial output dropped."""
    text = "짧은 머리의 사람"
    request = make_request(text)
    reply = make_reply(
        suggestions=[hint("appearance.short_hair", "짧은 머리")],
        provider={"model": "qwen2.5-vl-7b", "version": "2026-05", "latency_ms": 812,
                  "finish_reason": "length"},
    )
    result = run(reply, request)
    assert result.status == "unavailable"
    assert result.why == "incomplete_reply"
    assert result.suggestions == ()
    assert result.truncated is True


def test_more_than_eight_suggestions_keeps_the_first_eight():
    """C01-8: 8개 초과 -> truncated true, only the first 8 adopted."""
    ids = [f"lighting.extra_{index}" for index in range(11)]
    dictionary = {entry: DictionaryEntryRef("lighting") for entry in ids}
    word = "네온 조명입니다"
    text = " ".join([word] * len(ids))
    request = make_request(text)
    suggestions = [{"id": entry, "matched_phrase": word, "basis": "quote",
                    "polarity": "affirmed", "actor": None, "confidence": 0.8,
                    "reason_ko": "조명 조건"} for entry in ids]
    payload = json.dumps(make_reply(suggestions=suggestions),
                         ensure_ascii=False).encode("utf-8")
    result = evaluate(payload, request=request, dictionary=dictionary)
    assert len(result.suggestions) == 8
    assert result.truncated is True
    assert [item.id for item in result.suggestions] == ids[:8]


def test_exactly_eight_suggestions_is_not_truncation():
    ids = [f"lighting.extra_{index}" for index in range(8)]
    dictionary = {entry: DictionaryEntryRef("lighting") for entry in ids}
    word = "네온 조명입니다"
    request = make_request(" ".join([word] * len(ids)))
    suggestions = [{"id": entry, "matched_phrase": word, "basis": "quote",
                    "polarity": "affirmed", "actor": None, "confidence": 0.8,
                    "reason_ko": "조명 조건"} for entry in ids]
    payload = json.dumps(make_reply(suggestions=suggestions),
                         ensure_ascii=False).encode("utf-8")
    result = evaluate(payload, request=request, dictionary=dictionary)
    assert len(result.suggestions) == 8
    assert result.truncated is False


def test_duplicate_suggestions_are_rejected_once():
    text = "짧은 머리의 사람"
    request = make_request(text)
    reply = make_reply(suggestions=[hint("appearance.short_hair", "짧은 머리"),
                                    hint("appearance.short_hair", "머리")])
    result = run(reply, request)
    assert len(result.suggestions) == 1
    assert result.rejected == ({"raw_id": "appearance.short_hair", "why": "duplicate"},)


def test_oversized_reply_is_trimmed_to_the_budget():
    """C01-5: over 16 KiB -> trim trailing items, keep the head, flag truncated."""
    ids = [f"lighting.extra_{index}" for index in range(8)]
    dictionary = {entry: DictionaryEntryRef("lighting") for entry in ids}
    word = "네온 조명입니다"
    suggestions = [{"id": entry, "matched_phrase": word, "basis": "quote",
                    "polarity": "affirmed", "actor": None, "confidence": 0.8,
                    "reason_ko": "조명" * 40} for entry in ids]
    # Ambiguities are the cheapest way past 16 KiB: 200-char text + 32 candidates.
    ambiguities = [{"text": (f"{word} {index}" * 40)[:200], "why": "actor_unknown",
                    "candidates": [f"subject.person_{index}_{n:02d}" for n in range(32)]}
                   for index in range(8)]
    spans = [{"text": (f"{word} {index}" * 40)[:200], "why": "no_dictionary_entry",
              "polarity": "affirmed"} for index in range(8)]
    request = make_request(" ".join([word] * 8))
    payload = json.dumps(
        make_reply(suggestions=suggestions, unresolved_spans=spans, ambiguities=ambiguities),
        ensure_ascii=False,
    ).encode("utf-8")
    raw = ProposalResponse.model_validate(json.loads(payload))
    assert encoded_size(raw) > MAX_RESPONSE_BYTES

    result = evaluate(payload, request=request, dictionary=dictionary)
    assert result.truncated is True
    assert result.status in {"ready", "empty"}
    # The head of the list survives; only the tail is dropped.
    assert [item.id for item in result.suggestions] == ids[:len(result.suggestions)]
    result = evaluate(payload, request=request, dictionary=dictionary)
    assert result.truncated is True
    assert result.status in {"ready", "empty"}
    # The leading suggestions are the ones kept.
    assert [item.id for item in result.suggestions] == ids[:len(result.suggestions)]


def test_runaway_provider_body_is_unavailable():
    """A body past the transport guard is dropped before JSON parsing."""
    request = make_request("짧은 머리의 사람")
    payload = b'{"padding":"' + b"a" * (MAX_PROVIDER_REPLY_BYTES + 1) + b'"}'
    result = evaluate(payload, request=request, dictionary=DICTIONARY)
    assert result.status == "unavailable"
    assert result.suggestions == ()


def test_invalid_json_and_schema_are_unavailable():
    request = make_request("짧은 머리의 사람")
    assert evaluate(b"not json", request=request, dictionary=DICTIONARY).status == "unavailable"
    broken = make_reply()
    del broken["provider"]
    result = run(broken, request)
    assert result.status == "unavailable"
    assert result.suggestions == ()


def test_unknown_field_in_reply_is_rejected():
    request = make_request("짧은 머리의 사람")
    reply = make_reply()
    reply["translated_prompt"] = "a photo of a person"
    assert run(reply, request).status == "unavailable"


def test_mismatched_request_id_is_unavailable():
    """A late reply from a previous request must never be adopted."""
    request = make_request("짧은 머리의 사람")
    reply = make_reply(request_id="req-stale-00000")
    result = run(reply, request)
    assert result.status == "unavailable"
    assert "request_id" in result.why


def test_parse_reply_accepts_the_documented_example():
    request = make_request("네온 조명")
    payload = json.dumps(make_reply(suggestions=[hint("lighting.neon", "네온")]),
                         ensure_ascii=False).encode("utf-8")
    parsed = parse_reply(payload, request=request)
    assert parsed.suggestions[0].id == "lighting.neon"

# ---------------------------------------------------------------------------
# VAR01: the non-persistent situation-variant contract.
#
# A candidate is a Korean sentence plus the place/action IDs it would swap. Nothing
# here is a stored scene, an applied change or a generated image: these tests only
# fix which candidates may be shown and which must be refused.
# ---------------------------------------------------------------------------

VARIANT_DICTIONARY = {
    **DICTIONARY,
    "action.standing": DictionaryEntryRef("action"),
    "action.walking": DictionaryEntryRef("action"),
    "pose.sitting": DictionaryEntryRef("pose"),
    "location.street": DictionaryEntryRef("location"),
    "location.room": DictionaryEntryRef("location"),
    "setting.park": DictionaryEntryRef("setting"),
}


def variant_request(**changes):
    payload = {
        "kind": "situation_variants",
        "selections": [
            {"id": "subject.person", "category": "subject"},
            {"id": "clothing.white_shirt", "category": "clothing"},
            {"id": "location.street", "category": "location"},
            {"id": "action.standing", "category": "action"},
        ],
        "locked_ids": ["subject.person", "clothing.white_shirt"],
    }
    payload.update(changes)
    return make_request("같은 인물과 의상으로 다른 상황 3개", **payload)


def variant(variant_id="v1", **changes):
    payload = {
        "variant_id": variant_id,
        "label_ko": "공원에서 걷기",
        "prompt_ko": "같은 인물이 공원을 걷는다",
        "changed_ids": ["setting.park", "action.walking"],
        "removed_ids": ["location.street", "action.standing"],
        "unresolved_ko": [],
        "actor": None,
    }
    payload.update(changes)
    return payload


def run_variants(variants, request):
    payload = json.dumps(
        make_reply(kind="situation_variants", variants=variants), ensure_ascii=False
    ).encode("utf-8")
    return evaluate(payload, request=request, dictionary=VARIANT_DICTIONARY)



def test_situation_variants_are_adopted_with_their_diff():
    result = run_variants([variant()], variant_request())
    assert result.status == "ready"
    # VAR01: a candidate is not a suggestion. It never enters the accept path.
    assert result.suggestions == ()
    assert [item.variant_id for item in result.variants] == ["v1"]
    kept = result.variants[0]
    assert kept.label_ko == "공원에서 걷기"
    assert kept.changed_ids == ("setting.park", "action.walking")
    assert kept.removed_ids == ("location.street", "action.standing")


def test_only_the_first_three_candidates_are_kept():
    """C01-5 order: over the cap is trimmed and flagged, never dropped silently."""
    result = run_variants([variant(f"v{index}") for index in range(4)], variant_request())
    assert [item.variant_id for item in result.variants] == ["v0", "v1", "v2"]
    assert result.truncated is True


def test_exactly_three_candidates_is_not_truncation():
    result = run_variants([variant(f"v{index}") for index in range(3)], variant_request())
    assert len(result.variants) == 3
    assert result.truncated is False


def test_candidate_that_changes_a_locked_id_is_rejected():
    """A locked value is what the request fixed; a variant cannot undo that."""
    request = variant_request(
        locked_ids=["subject.person", "clothing.white_shirt", "location.street"])
    result = run_variants([variant()], request)
    assert result.variants == ()
    assert {"raw_id": "v1", "why": "locked", "id": "location.street"} in result.rejected


def test_candidate_that_changes_the_outfit_is_out_of_scope():
    """VAR01 is "장소와 행동만 바꾼 상황"; re-casting the outfit is partial_change."""
    result = run_variants(
        [variant(changed_ids=["clothing.blue_shirt", "setting.park"],
                 removed_ids=["clothing.white_shirt"])],
        variant_request(locked_ids=[]),
    )
    assert result.variants == ()
    reasons = {(item.get("id"), item["why"]) for item in result.rejected}
    assert ("clothing.blue_shirt", "out_of_scope") in reasons


def test_candidate_that_removes_an_unselected_value_is_rejected():
    result = run_variants([variant(removed_ids=["location.room"])], variant_request())
    assert result.variants == ()
    assert {"raw_id": "v1", "why": "not_selected", "id": "location.room"} in result.rejected


def test_candidate_without_any_change_is_rejected():
    result = run_variants([variant(changed_ids=[], removed_ids=[])], variant_request())
    assert result.variants == ()
    assert {"raw_id": "v1", "why": "no_change"} in result.rejected


def test_candidate_that_re_adds_an_already_selected_value_is_rejected():
    result = run_variants(
        [variant(changed_ids=["location.street"], removed_ids=["action.standing"])],
        variant_request(),
    )
    assert result.variants == ()
    rejected = result.rejected
    assert {"raw_id": "v1", "why": "already_selected", "id": "location.street"} in rejected




def test_candidate_with_an_unknown_or_inactive_id_is_rejected():
    unknown = run_variants([variant(changed_ids=["setting.nowhere"])], variant_request())
    assert unknown.variants == ()
    assert ({"raw_id": "v1", "why": "not_in_dictionary", "id": "setting.nowhere"}
            in unknown.rejected)

    inactive = run_variants([variant(changed_ids=["style.retired_style"])],
                            variant_request())
    assert inactive.variants == ()
    assert ({"raw_id": "v1", "why": "inactive_entry", "id": "style.retired_style"}
            in inactive.rejected)


def test_a_per_person_candidate_is_refused_instead_of_compressed():
    """SCENE01/02 are unresolved: v1 must not flatten who owns which attribute."""
    result = run_variants([variant(actor="왼쪽 사람")], variant_request())
    assert result.variants == ()
    assert {"raw_id": "v1", "why": "attribution_unsupported_v1"} in result.rejected
    assert {"text": "공원에서 걷기", "why": "actor_unknown",
            "candidates": ["v1"]} in result.ambiguities


def test_duplicate_variant_ids_are_rejected_once():
    result = run_variants([variant("v1"), variant("v1")], variant_request())
    assert [item.variant_id for item in result.variants] == ["v1"]
    assert {"raw_id": "v1", "why": "duplicate"} in result.rejected


def test_a_candidate_over_200_characters_breaks_the_schema():
    """The sentence is a card body, so its cap is a contract, not a preference."""
    result = run_variants([variant(prompt_ko="가" * 201)], variant_request())
    assert result.status == "unavailable"
    assert result.variants == ()


def test_variants_in_a_selection_hint_reply_are_not_adopted():
    """Kinds are not interchangeable: a candidate is not a selectable dictionary ID."""
    payload = json.dumps(make_reply(variants=[variant()]),
                         ensure_ascii=False).encode("utf-8")
    result = evaluate(payload, request=make_request("짧은 머리의 사람"),
                      dictionary=VARIANT_DICTIONARY)
    assert result.variants == ()
    assert {"raw_id": "v1", "why": "unexpected_kind"} in result.rejected


def test_an_empty_candidate_list_stays_empty_not_ready():
    result = run_variants([], variant_request())
    assert result.status == "empty"
    assert result.variants == ()


def test_out_of_dictionary_words_are_kept_for_display():
    """A compound situation the dictionary cannot express is shown as unresolved."""
    result = run_variants([variant(unresolved_ko=["비를 맞으며", "우산을 접으며"])],
                          variant_request())
    assert result.status == "ready"
    assert result.variants[0].unresolved_ko == ("비를 맞으며", "우산을 접으며")
