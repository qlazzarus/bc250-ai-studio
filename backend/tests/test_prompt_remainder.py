"""TRANS03: the server path for out-of-dictionary translation proposals.

No model is called. The payloads encode the decisions TRANS03 must make — which
phrase was asked about, what a reply may not do, and what happens to a reply that
breaks the rules — so a regression fails here instead of in the browser.
"""

import json

import pytest
from app.services.prompt_proposals import (
    MAX_REMAINDER_SPANS,
    REMAINDER_KIND,
    ProposalRequest,
    evaluate,
)

REQUEST_ID = "req-0123456789"
REVISIONS = {
    "scene": "sha256:" + "a" * 64,
    "selection": "sha256:" + "b" * 64,
    "text": "sha256:" + "c" * 64,
}
# The measured TRANS02 sentence. `금발` and `네온 조명` are dictionary-covered, so the
# three phrases below are what `extractRemainder` returns as offsets.
SOURCE = "비 오는 밤 편의점 앞에서 젖은 바닥에 반사된다"
PHRASES = ["비 오는 밤", "편의점", "젖은 바닥에 반사된다"]


def spans_for(*phrases):
    """Offsets of each phrase in SOURCE, as TRANS02/`toCodePointSpan` would send them."""
    return [{"start": SOURCE.index(p), "end": SOURCE.index(p) + len(p)} for p in phrases]


def request_for(*phrases, **changes):
    payload = {
        "kind": REMAINDER_KIND,
        "request_id": REQUEST_ID,
        "target_family": "sd15",
        "dictionary_version": "1.2.0",
        "free_text_ko": SOURCE,
        "revisions": REVISIONS,
        "remainder_spans": spans_for(*phrases),
    }
    payload.update(changes)
    return ProposalRequest.model_validate(payload)


def translation(source, english, **changes):
    payload = {"source_ko": source, "suggested_en": english, "confidence": 0.8}
    payload.update(changes)
    return payload


def reply(translations, **changes):
    payload = {
        "proposal_id": "prop-0123456789",
        "request_id": REQUEST_ID,
        "status": "ready",
        "kind": REMAINDER_KIND,
        "provider": {"model": "qwen-test", "version": "2026-05", "latency_ms": 5,
                     "finish_reason": "stop"},
        "revisions": REVISIONS,
        "suggestions": [],
        "translations": translations,
        "unresolved_spans": [],
        "ambiguities": [],
        "rejected": [],
        "truncated": False,
    }
    payload.update(changes)
    return payload


def run(payload, request):
    return evaluate(json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    request=request, dictionary={})



def test_spans_are_sliced_server_side_so_the_request_carries_no_phrase_text():
    """TRANS01 §3.2: offsets cross the wire, the phrase text does not."""
    request = request_for(*PHRASES)
    assert request.remainder_phrases() == tuple(PHRASES)
    # The phrase exists only once in the body: inside `free_text_ko`.
    encoded = json.dumps(request.model_dump(mode="json"), ensure_ascii=False)
    for phrase in PHRASES:
        assert encoded.count(phrase) == 1


def test_a_translation_of_each_requested_phrase_is_accepted_in_request_order():
    result = run(reply([translation("비 오는 밤", "a rainy night"),
                        translation("편의점", "a convenience store"),
                        translation("젖은 바닥에 반사된다", "reflected on the wet ground")]),
                 request_for(*PHRASES))
    assert result.status == "ready"
    assert [item.source_ko for item in result.translations] == PHRASES
    assert result.translations[0].suggested_en == "a rainy night"
    # Nothing becomes a selection: a translation has no dictionary ID (TRANS01 §2.3).
    assert result.suggestions == ()
    assert result.rejected == ()


def test_an_unrequested_or_paraphrased_phrase_is_rejected_not_carded():
    """The card must correspond to the text the user pointed at."""
    result = run(reply([translation("비 오는 밤", "a rainy night"),
                        translation("편의점 앞", "in front of the store")]),  # never sent
                 request_for(*PHRASES))
    assert [item.source_ko for item in result.translations] == ["비 오는 밤"]
    assert {"raw_id": "편의점 앞", "why": "unrequested_phrase"} in result.rejected
    # Two of three phrases went unanswered, so the reply is partial and says so.
    assert result.truncated is True


def test_two_translations_of_one_phrase_keep_only_the_first():
    result = run(reply([translation("편의점", "a convenience store"),
                        translation("편의점", "a corner shop")]),
                 request_for("편의점"))
    assert [item.suggested_en for item in result.translations] == ["a convenience store"]
    assert {"raw_id": "편의점", "why": "unrequested_phrase"} in result.rejected



def test_an_echo_is_not_a_translation():
    """A model that returns its input would look successful and change nothing."""
    result = run(reply([translation("편의점", "편의점")]), request_for("편의점"))
    assert result.translations == ()
    assert {"raw_id": "편의점", "why": "untranslated"} in result.rejected
    assert result.status == "empty"


def test_a_translation_reply_with_no_items_is_empty_not_ready():
    result = run(reply([]), request_for("편의점"))
    assert result.status == "empty"


def test_an_untranslated_phrase_marks_the_reply_truncated():
    result = run(reply([translation("비 오는 밤", "a rainy night")]),
                 request_for(*PHRASES))
    assert len(result.translations) == 1
    assert result.truncated is True


def test_a_cut_off_reply_is_discarded_entirely():
    """C01-4 last row: `finish_reason: length` is never partially adopted."""
    result = run(reply([translation("편의점", "a convenience store")],
                       provider={"model": "qwen-test", "version": "",
                                 "latency_ms": 5, "finish_reason": "length"}),
                 request_for("편의점"))
    assert result.status == "unavailable"
    assert result.why == "incomplete_reply"
    assert result.translations == ()
    assert result.truncated is True


def test_suggestions_from_a_translation_reply_are_rejected_as_the_wrong_kind():
    """One shape per kind: an ID answer cannot ride along with a translation."""
    payload = reply([translation("편의점", "a convenience store")], suggestions=[{
        "id": "setting.store", "matched_phrase": "편의점", "basis": "quote",
        "polarity": "affirmed", "actor": None, "confidence": 0.9, "reason_ko": "장소",
    }])
    result = run(payload, request_for("편의점"))
    assert result.suggestions == ()


def test_the_korean_source_is_never_modified_by_the_reply():
    """Requirement: `free_text_ko` is input only. Nothing here can write it back."""
    request = request_for("편의점")
    before = request.free_text_ko
    run(reply([translation("편의점", "a convenience store")]), request)
    assert request.free_text_ko == before
    assert request.remainder_phrases() == ("편의점",)


def test_more_translations_than_the_cap_are_trimmed_and_flagged():
    """The schema caps the request at 8 spans, so the answer can be trimmed too."""
    phrases = ["비 오는", "오는 밤", "밤 편의점", "편의점 앞에서",
               "앞에서 젖은", "젖은 바닥에", "바닥에 반사된다", "반사된다"]
    assert len(phrases) == MAX_REMAINDER_SPANS
    # Nine translations for eight phrases: the ninth names a phrase never sent.
    many = [translation(p, f"translation {index}") for index, p in enumerate(phrases)]
    many.append(translation(phrases[0], "a duplicate"))
    result = run(reply(many), request_for(*phrases))
    assert len(result.translations) == MAX_REMAINDER_SPANS
    assert {"raw_id": phrases[0], "why": "unrequested_phrase"} in result.rejected


@pytest.mark.parametrize("changes", [
    # A span that names no text cannot be translated.
    {"remainder_spans": []},
    # `selections` cannot influence a translation and only spends the 8 KiB budget.
    {"selections": [{"id": "subject.person", "category": "subject"}]},
    # Twice the same phrase would make two indistinguishable cards.
    {"remainder_spans": spans_for("편의점") * 2},
    # An offset past the end of `free_text_ko` would slice nothing.
    {"remainder_spans": [{"start": 0, "end": len(SOURCE) + 1}]},
    # Shorter than `MIN_REMAINDER_CHARS` is a particle, not a phrase.
    {"remainder_spans": [{"start": 0, "end": 1}]},
    # A blank slice is not text to translate: `SOURCE[1:3]` is " 오", but `[1:2]` is " ".
    {"remainder_spans": [{"start": 6, "end": 7}, {"start": 10, "end": 11}]},
    # Negative offsets are not in the coordinate system.
    {"remainder_spans": [{"start": -1, "end": 3}]},
])
def test_a_request_outside_the_span_contract_is_refused(changes):
    payload = {
        "kind": REMAINDER_KIND,
        "request_id": REQUEST_ID,
        "target_family": "sd15",
        "dictionary_version": "1.2.0",
        "free_text_ko": SOURCE,
        "revisions": REVISIONS,
        "remainder_spans": spans_for("편의점"),
    }
    payload.update(changes)
    with pytest.raises(ValueError):
        ProposalRequest.model_validate(payload)


def test_spans_are_only_valid_for_their_own_kind():
    """A span on a dictionary kind would be ignored, and "ignored" reads as "done"."""
    payload = {
        "kind": "selection_hint",
        "request_id": REQUEST_ID,
        "target_family": "sd15",
        "dictionary_version": "1.2.0",
        "free_text_ko": SOURCE,
        "revisions": REVISIONS,
        "remainder_spans": spans_for("편의점"),
    }
    with pytest.raises(ValueError):
        ProposalRequest.model_validate(payload)


def test_offsets_are_python_code_points_not_utf16_units():
    """The hazard `toCodePointSpan` exists for.

    JS `indexOf` counts UTF-16 code units, Python slices count code points. For a
    phrase after an astral character the two differ, and a raw JS offset would start
    mid-phrase — silently, because it is still a valid index.
    """
    text = "İstanbul 😀 카페"
    prefix = text[:text.index("카페")]
    utf16_prefix = len(prefix.encode("utf-16-le")) // 2
    python_index = text.index("카페")
    # One emoji = 2 UTF-16 units but 1 code point, so the offsets disagree by 1.
    assert utf16_prefix == python_index + 1
    # The JS offset would slice the wrong text; the converted one does not.
    assert text[utf16_prefix:utf16_prefix + 2] != "카페"
    request = ProposalRequest.model_validate({
        "kind": REMAINDER_KIND, "request_id": REQUEST_ID, "target_family": "sd15",
        "dictionary_version": "1.2.0", "free_text_ko": text, "revisions": REVISIONS,
        "remainder_spans": [{"start": python_index, "end": python_index + 2}],
    })
    assert request.remainder_phrases() == ("카페",)
