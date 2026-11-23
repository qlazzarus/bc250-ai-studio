"""UCP04: per-family output fixtures and the limits of an automated meaning check.

Two things are tested here, and keeping them apart is the point of the file.

1. **Structure.** Every fixture prompt is written in the format its family actually
   reads, so the fixtures cannot drift away from the profiles they are meant to exercise.
   Each family's own format rule is applied to the *other* style's prompts as well, so a
   fixture that would be wrong for a family fails that family.
2. **Meaning.** A fixture may describe the same scene with a different place, garment or
   number of people. Those are not "expressive alternatives" and must not be accepted as
   such. The judgement below is a **declared-term** check: a case lists the terms a
   faithful prompt must contain, and a prompt that drops one is called drift.

What this file does **not** establish, and must not be reported as:

* It is not evidence of image quality. No image is generated, and the profile tests
  passing says only that the fixtures are consistent.
* It is not a server-side meaning check. ``validate_candidates`` accepts a drift candidate
  exactly like a faithful one — ``test_the_server_cannot_tell_drift_from_a_paraphrase``
  pins that, so nobody mistakes this harness for the API's behaviour.
* It is not a general natural-language judgement. A paraphrase that keeps the scene but
  drops a declared term is called drift; a drift that avoids every declared term is
  missed. Real-model behaviour is UCP09's.
"""

import json
from pathlib import Path

import pytest
from app.services.prompt_compose import (
    ComposeTarget,
    ValidatedInput,
    has_weighting_syntax,
    validate_candidates,
)
from app.services.prompt_profiles import (
    PROFILE_VERSION,
    estimate_tokens,
    profile_for,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "ucp04_eval_cases.json"
REAL_FAMILIES = ("sd15", "flux2", "z-image", "moss-image")


def load_cases() -> list[dict]:
    return json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]


CASES = load_cases()
# One prompt list per case, flattened with the case and the style it was written in, so a
# failure names the scene, the convention and the entry rather than a bare index.
PROMPTS = [
    pytest.param(case, style, entry, id=f"{case['case_id']}/{style}/{entry['id']}")
    for case in CASES
    for style in ("tags", "sentence")
    for entry in case["prompts"][style]
]


def family_for(style: str) -> str:
    """The family a prompt style belongs to, read from the profiles rather than assumed."""
    return next(family for family in REAL_FAMILIES
                if profile_for(family).prompt_style == style)


def format_violations(profile, text: str) -> list[str]:
    """The format rules a prompt breaks for ``profile``.

    These are the same facts the profile puts in front of the model, applied to a fixture
    instead of to a reply: separator, sentence-vs-tag shape, character limit and — where
    the family has one — the token window.

    The comma rule for sentence families is deliberately strict, because it only ever runs
    on fixtures in this file: a hand-written sentence *may* contain a comma, and a general
    validator would be wrong to reject one. Here a comma means the author slipped into tag
    style.
    """
    problems = []
    if has_weighting_syntax(text):
        problems.append("weighting_syntax")
    if len(text) > profile.max_positive_chars:
        problems.append("too_long")
    if profile.token_window is not None and estimate_tokens(text) > profile.token_window:
        problems.append("over_window")
    if profile.prompt_style == "tags":
        if text.rstrip().endswith("."):
            problems.append("sentence_punctuation")
        if ", " not in text:
            problems.append("no_tag_separator")
        if "; " in text:
            problems.append("wrong_separator")
    else:
        if ", " in text:
            problems.append("tag_list_separator")
        if not text.rstrip().endswith(".") and profile.joiner.strip() not in text:
            problems.append("not_a_sentence")
    return problems


# ── structure: the fixtures belong to the profiles they exercise ────────────────


def test_every_real_family_has_fixtures_in_its_own_style():
    """A family with no fixture would leave its convention untested.

    The style is read from the profile, so a family whose style changed without its
    fixtures changing fails here instead of quietly testing the wrong thing.
    """
    styles = {family: profile_for(family).prompt_style for family in REAL_FAMILIES}
    covered = {style: any(style in case["prompts"] for case in CASES)
               for style in set(styles.values())}
    assert covered == {"tags": True, "sentence": True}
    # Each case is written in both styles, so one scene probes both conventions.
    for case in CASES:
        assert set(case["prompts"]) == set(styles.values()), case["case_id"]


@pytest.mark.parametrize("case,style,entry", PROMPTS)
def test_each_fixture_prompt_is_valid_in_its_family(case, style, entry):
    family = family_for(style)
    profile = profile_for(family)
    assert format_violations(profile, entry["text"]) == [], (
        f"{case['case_id']}/{entry['id']} is not valid for {family}")


@pytest.mark.parametrize("family", REAL_FAMILIES)
def test_no_fixture_prompt_is_valid_in_the_other_style(family):
    """The formats are not interchangeable, so the fixtures cannot be silently swapped.

    Cross-checking is what makes the per-family test above meaningful: if both styles
    passed for every family, "uses the right format" would be a statement about nothing.
    """
    profile = profile_for(family)
    other = "sentence" if profile.prompt_style == "tags" else "tags"
    for case in CASES:
        for entry in case["prompts"][other]:
            assert format_violations(profile, entry["text"]) != [], (
                f"{case['case_id']}/{entry['id']} should not be valid for {family}")


# ── meaning: declared-term drift is detected, and its limits are stated ─────────


def missing_anchors(case: dict, text: str) -> list[str]:
    """The case's declared terms that ``text`` does not contain, case-insensitively.

    A term is a phrase this file declares, not a word the scene needs. The check is
    lexical on purpose: it is reproducible and its failure mode is visible in the output.
    """
    lowered = text.casefold()
    return [anchor for anchor in case["anchors"] if anchor.casefold() not in lowered]


@pytest.mark.parametrize("case,style,entry", PROMPTS)
def test_a_faithful_fixture_keeps_its_declared_terms(case, style, entry):
    if entry["expect"] != "faithful":
        return
    assert missing_anchors(case, entry["text"]) == []
    # A faithful prompt must not contain a term the case declares as a drift marker.
    for forbidden in case.get("forbids", []):
        assert forbidden.casefold() not in entry["text"].casefold(), (
            f"{entry['id']} is faithful but contains {forbidden!r}")
    # No drift is declared for a faithful entry, so `violates` must be `null`.
    assert entry["violates"] is None


@pytest.mark.parametrize("case,style,entry", PROMPTS)
def test_a_drift_fixture_names_the_fact_it_changes(case, style, entry):
    """A drift case must be both *detectable* and *attributed*.

    Detectable in one of two ways, because attribution drift is purely additive — it keeps
    every fact and spreads one over the wrong subject:

    * it drops a declared anchor (a different place, garment, count or time), or
    * it contains a term the case declares as ``forbids`` ("both", where the brief says
      only one).

    Attributed: it declares which fact (place, garment, count, attribution, negation,
    time) it changes, so a passing run cannot be satisfied by a vague "it differs
    somehow". ``adds`` names what the drift introduces, which is what a reader checks the
    verdict against.
    """
    if entry["expect"] != "drift":
        return
    assert entry["violates"] is not None, entry["id"]
    assert entry["adds"], entry["id"]
    for dropped in entry["drops"]:
        assert dropped.casefold() not in entry["text"].casefold(), (
            f"{entry['id']} says it drops {dropped!r} but still contains it")
    detected = bool(missing_anchors(case, entry["text"])) or any(
        forbidden.casefold() in entry["text"].casefold()
        for forbidden in case.get("forbids", []))
    assert detected, (
        f"{entry['id']} is declared drift but keeps every declared term "
        f"and contains no forbidden one")


@pytest.mark.parametrize("case,style,entry", PROMPTS)
def test_a_drift_fixture_adds_something_the_brief_does_not_say(case, style, entry):
    """§4: no person, garment, action, style or quality word the brief lacks.

    Each ``adds`` entry must be absent from the brief, so the fixture really is an
    addition and not a rewording of something already there.
    """
    if entry["expect"] != "drift":
        return
    brief = case["brief_ko"].casefold()
    for added in entry["adds"]:
        assert added.casefold() not in brief, (
            f"{entry['id']} calls {added!r} an addition but the brief says it")


# ── the limit: the server does not judge meaning, and this file must not pretend it does ─


def target(family: str = "flux2") -> ComposeTarget:
    return ComposeTarget(
        model_id=f"{family}-model", family=family, negative_mode="unsupported",
        negative_requires={}, cfg_default=3.0, profile=profile_for(family),
    )


def validated(family: str = "flux2") -> ValidatedInput:
    return ValidatedInput(
        brief_ko="붉은 원피스를 입은 여성이 비 오는 거리에 서 있다",
        selections=[], choices=[], revisions={}, target=target(family),
        profile_version=PROFILE_VERSION, dictionary_version="1.2.0",
        request_id="cmp-0123456789ab", candidate_count=3,
        excluded_ids=frozenset(),
    )


def candidate(index: int, prompt: str) -> dict:
    return {"candidate_id": f"candidate-{index}", "title_ko": f"후보 {index}",
            "difference_ko": "차이", "positive_prompt": prompt}


def test_the_server_cannot_tell_drift_from_a_paraphrase():
    """The reason the meaning cases above are *not* a server-side guarantee.

    A faithful prompt and one that moves the scene to a cafe both come back `ready`, both
    keep their declared text and neither raises a warning. ``validate_candidates`` checks
    structure — length, duplicates, separators, an excluded ID, the token window — not
    whether the sentence describes the brief. So a green run of this file is evidence
    that the fixtures are well formed, and evidence that the profile format holds, and
    nothing at all about meaning.
    """
    case = next(item for item in CASES if item["case_id"] == "rain-street-dress")
    faithful = next(entry for entry in case["prompts"]["sentence"]
                    if entry["expect"] == "faithful")
    drift = next(entry for entry in case["prompts"]["sentence"]
                 if entry["violates"] == "location")

    kept, warnings, dropped = validate_candidates(
        [candidate(1, faithful["text"]), candidate(2, drift["text"])],
        validated=validated("flux2"), candidate_count=3)

    assert dropped == 0 and len(kept) == 2
    # The drift is returned verbatim, side by side with the faithful sentence.
    assert kept[1].positive_prompt == drift["text"]
    assert warnings == []
    # Only the harness knows which of the two is wrong. That knowledge lives in the file,
    # not in the service, and that asymmetry is what this test records.
    assert missing_anchors(case, faithful["text"]) == []
    assert missing_anchors(case, drift["text"]) == ["rainy street"]


def test_a_prompt_that_only_breaks_the_profile_format_is_still_returned():
    """Format advice and meaning are separate, and the server enforces only the former.

    A `sd15`-style tag list sent for `flux2` is not refused: the profile is guidance to
    the model and a warning surface for the client, not a reject rule. Refusing would drop
    a usable prompt because of a separator.
    """
    tags = "a woman, red dress, bright cafe"
    kept, warnings, dropped = validate_candidates(
        [candidate(1, tags)], validated=validated("flux2"), candidate_count=3)
    assert dropped == 0
    assert kept[0].positive_prompt == tags
    assert "profile_weighting_syntax" not in warnings
    # The fixture layer is where the style violation is caught, not the service.
    assert "tag_list_separator" in format_violations(profile_for("flux2"), tags)


def test_every_case_declares_at_least_one_drift_and_one_faithful_prompt():
    # A case with only faithful prompts cannot demonstrate that drift is caught; a case
    # with only drift prompts gives no baseline to compare against.
    for case in CASES:
        expectations = [entry["expect"] for style in case["prompts"]
                        for entry in case["prompts"][style]]
        assert "faithful" in expectations, case["case_id"]
        assert "drift" in expectations, case["case_id"]

