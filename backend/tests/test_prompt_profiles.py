"""UCP04: per-family output profiles, and the candidate checks they drive.

Nothing here calls a model. The subject is the *facts* a profile carries and the
consequences the compose service draws from them, so a change of convention is caught by a
test rather than by a screenshot of a different prompt.
"""

import math

import pytest
from app.services.prompt_compose import (
    WARNING_CANDIDATES_REDUCED,
    WARNING_DUPLICATE_CANDIDATES,
    WARNING_LIMIT,
    WARNING_PROFILE_TOKEN_WINDOW,
    WARNING_PROFILE_WEIGHTING_SYNTAX,
    ComposeInputError,
    ComposeTarget,
    ValidatedInput,
    capped_warnings,
    has_weighting_syntax,
    order_warnings,
    resolve_target,
    validate_candidates,
)
from app.services.prompt_profiles import (
    PROFILE_VERSION,
    PROFILES,
    TEST_ONLY_FAMILIES,
    estimate_tokens,
    profile_for,
    profile_versions,
    prompt_guidance,
)

REAL_FAMILIES = ("sd15", "flux2", "z-image", "moss-image")


def target(family: str) -> ComposeTarget:
    """A target built from the same registry facts the route would use."""
    profile = profile_for(family)
    assert profile is not None, family
    return ComposeTarget(
        model_id=f"{family}-model", family=family,
        negative_mode="verified", negative_requires={}, cfg_default=7.0,
        profile=profile,
    )


def validated_for(family: str, *, excluded: tuple[str, ...] = (),
                  candidate_count: int = 3) -> ValidatedInput:
    return ValidatedInput(
        brief_ko="붉은 원피스를 입은 여성이 비 오는 거리에 서 있다",
        selections=[], choices=[], revisions={}, target=target(family),
        profile_version=PROFILE_VERSION, dictionary_version="1.2.0",
        request_id="cmp-0123456789ab", candidate_count=candidate_count,
        excluded_ids=frozenset(excluded),
    )


def candidate(index: int = 1, prompt: str = "a woman in a red dress") -> dict:
    return {"candidate_id": f"candidate-{index}", "title_ko": f"후보 {index}",
            "difference_ko": "차이", "positive_prompt": prompt}


# ── the profile set itself ────────────────────────────────────────────────────


def test_every_real_family_has_exactly_one_profile_at_the_current_version():
    for family in REAL_FAMILIES:
        profile = profile_for(family)
        assert profile is not None, family
        assert profile.family == family
        # One version for the set, so a client compares one number rather than four.
        assert profile.version == PROFILE_VERSION


def test_an_unknown_family_has_no_profile_rather_than_a_default():
    # The absence is the signal: `resolve_target` refuses to invent a convention.
    assert profile_for("sdxl") is None
    assert profile_for("") is None


def test_the_joiner_matches_the_compilers_own_table():
    """`prompt_profiles` restates the separator instead of importing the compiler.

    ``frontend/src/prompt/compiler.ts`` joins with ``"; "`` for the natural-language
    families and ``", "`` for ``sd15``. Restating it is deliberate (this module must not
    depend on the frontend), so the restatement is pinned here: a silent divergence would
    make a candidate's separator disagree with the compiled draft in the same screen.
    """
    for family in REAL_FAMILIES:
        assert profile_for(family).joiner == (", " if family == "sd15" else "; "), family


def test_only_sd15_claims_a_token_window():
    """A window that is not established is ``None``, never a plausible default.

    ``sd15`` reads a 77-token CLIP encoder — a property of the family. The other three
    read a Qwen3-class LLM text encoder whose window is a property of the checkpoint
    files, which this build cannot read. Inventing 77 for them would be a fabricated
    limit, and a warning on every long prompt would train the user to ignore it.
    """
    assert profile_for("sd15").token_window == 77
    for family in ("flux2", "z-image", "moss-image"):
        profile = profile_for(family)
        assert profile.token_window is None, family
        # The reason is recorded, so a reader can tell "not established" from "forgotten".
        assert profile.token_window_source


def test_the_advertised_versions_are_the_versions_the_server_compares_against():
    advertised = profile_versions()
    assert set(advertised) == set(REAL_FAMILIES)
    for family, version in advertised.items():
        assert version == profile_for(family).version == PROFILE_VERSION


def test_a_test_only_family_is_never_advertised():
    # `fake` exists so a fake-registry deployment fails on the gate instead of on a
    # missing profile. Advertising it would suggest a family a user could compose for.
    assert set(TEST_ONLY_FAMILIES) == {"fake"}
    assert "fake" in PROFILES


# ── guidance and token estimation ─────────────────────────────────────────────


def test_the_guidance_names_the_style_the_family_reads():
    tags = prompt_guidance(profile_for("sd15"))
    assert "tag phrases" in tags
    sentences = prompt_guidance(profile_for("flux2"))
    assert "sentences" in sentences
    assert "tag list" in sentences  # the negative instruction: do not produce tags


def test_only_a_known_window_is_put_in_front_of_the_model():
    # A model told "aim for 77 tokens" for a family with no established window would be
    # asked to satisfy a number nobody measured.
    assert "77 tokens" in prompt_guidance(profile_for("sd15"))
    for family in ("flux2", "z-image", "moss-image"):
        assert "roughly" not in prompt_guidance(profile_for(family)), family


def test_every_profile_forbids_emitting_weighting_syntax():
    for family in REAL_FAMILIES:
        guidance = prompt_guidance(profile_for(family))
        assert "(word:1.2)" in guidance and "<lora:" in guidance, family


def test_the_token_estimate_is_the_same_formula_as_the_browsers():
    """The backend and the frontend must not disagree about one prompt's size.

    ``estimateTokens`` in ``frontend/src/prompt/compiler.ts`` is ``ceil(words * 1.3)``
    with the split on whitespace and separators. If the two formulas differed, the same
    sentence could be "over the window" in the composer and fine in the API.
    """
    text = "a woman in a red dress, standing on a rainy street"
    assert estimate_tokens(text) == math.ceil(len(text.split()) * 1.3)
    # Separators are boundaries too, not part of a word.
    assert estimate_tokens("a,b;c d") == math.ceil(4 * 1.3)
    assert estimate_tokens("") == 0


# ── warning ordering ──────────────────────────────────────────────────────────


def test_a_dropped_candidate_survives_the_cap_however_many_warnings_there_are():
    """The cap must never be the reason the client thinks a short list is complete.

    `capped_warnings` is applied last and the load-bearing codes are ordered first, so
    four advisory codes cannot evict `candidates_reduced`.
    """
    advisory = ["unknown_ids_dropped", "dictionary_truncated", "negative_unsupported",
                "negative_requires_cfg", WARNING_PROFILE_WEIGHTING_SYNTAX]
    result = capped_warnings([*advisory, WARNING_CANDIDATES_REDUCED])
    assert len(result) <= WARNING_LIMIT
    assert result[0] == WARNING_CANDIDATES_REDUCED


def test_an_over_window_warning_is_ordered_next_to_a_dropped_candidate():
    result = capped_warnings([WARNING_DUPLICATE_CANDIDATES, WARNING_PROFILE_TOKEN_WINDOW,
                              WARNING_CANDIDATES_REDUCED, "unknown_ids_dropped"])
    assert result[:2] == [WARNING_CANDIDATES_REDUCED, WARNING_PROFILE_TOKEN_WINDOW]


def test_ordering_deduplicates_without_reordering_the_rest():
    # The same code twice is one warning: the wire cap counts entries, so a duplicate
    # would waste one of four slots on a repetition.
    assert order_warnings(["b", "a", "b"]) == ["b", "a"]
    assert order_warnings([]) == []


# ── candidate-level validation ────────────────────────────────────────────────


def test_two_identical_prompts_are_one_candidate_and_say_so():
    kept, warnings, dropped = validate_candidates(
        [candidate(1, "a woman in a red dress"), candidate(2, "A Woman In A Red Dress ")],
        validated=validated_for("flux2"), candidate_count=3)
    assert len(kept) == 1
    assert dropped == 1
    # Distinct from `candidates_reduced`: the list is short because the model repeated
    # itself, not because a rule rejected content.
    assert WARNING_DUPLICATE_CANDIDATES in warnings
    assert WARNING_CANDIDATES_REDUCED in warnings


def test_a_candidate_longer_than_the_profile_allows_is_dropped_whole():
    profile = profile_for("flux2")
    kept, warnings, dropped = validate_candidates(
        [candidate(1, "ok prompt"), candidate(2, "a" * (profile.max_positive_chars + 1))],
        validated=validated_for("flux2"), candidate_count=3)
    assert [item.candidate_id for item in kept] == ["candidate-1"]
    assert dropped == 1
    # Never trimmed: a shortened prompt is a different image.
    assert kept[0].positive_prompt == "ok prompt"


def test_the_character_limit_is_the_profiles_not_a_second_constant():
    # The same length is legal or not depending on the profile it is checked against,
    # which proves the check reads the profile rather than a hard-coded number.
    profile = profile_for("sd15")
    kept, _, dropped = validate_candidates(
        [candidate(1, "a" * profile.max_positive_chars)],
        validated=validated_for("sd15"), candidate_count=3)
    assert [item.candidate_id for item in kept] == ["candidate-1"]
    assert dropped == 0


@pytest.mark.parametrize("prompt", [
    "a woman, (red dress:1.3), rainy street",
    "a woman, (red dress: 1.3)",
    "a woman, <lora:detail-tweaker:0.7>, rainy street",
    "a woman, <LORA:Detail:0.5>",
])
def test_weighting_syntax_is_detected(prompt):
    assert has_weighting_syntax(prompt)


@pytest.mark.parametrize("prompt", [
    "a woman in a red dress on a rainy street",
    "a woman (center) in a red dress",         # a plain parenthetical, no weight
    "a woman: standing in the rain",           # a colon, not a weight
    "a woman, 2:1 aspect",                     # a ratio, not a parenthesised weight
])
def test_plain_text_is_not_mistaken_for_weighting_syntax(prompt):
    assert not has_weighting_syntax(prompt)


def test_weighting_syntax_is_a_warning_and_never_a_drop():
    """Dropping would delete a usable prompt over a formatting habit.

    The engine's own LoRA tag is added at generation time regardless, so the client is
    told rather than corrected.
    """
    kept, warnings, dropped = validate_candidates(
        [candidate(1, "a woman, (red dress:1.3), rainy street")],
        validated=validated_for("flux2"), candidate_count=3)
    assert len(kept) == 1
    assert dropped == 0
    assert WARNING_PROFILE_WEIGHTING_SYNTAX in warnings
    assert WARNING_CANDIDATES_REDUCED not in warnings


def test_the_token_window_is_checked_only_where_a_window_exists():
    long_prompt = " ".join(["a woman in a red dress"] * 40)  # ~240 words, ~312 tokens

    _, sd15_warnings, _ = validate_candidates(
        [candidate(1, long_prompt)], validated=validated_for("sd15"), candidate_count=3)
    assert WARNING_PROFILE_TOKEN_WINDOW in sd15_warnings

    # Same text, a family with no established window: warn nothing rather than applying
    # sd15's 77-token limit to a family that does not have it.
    _, flux_warnings, _ = validate_candidates(
        [candidate(1, long_prompt)], validated=validated_for("flux2"), candidate_count=3)
    assert WARNING_PROFILE_TOKEN_WINDOW not in flux_warnings


def test_no_window_warning_for_a_prompt_inside_the_window():
    _, warnings, _ = validate_candidates(
        [candidate(1, "a woman in a red dress")],
        validated=validated_for("sd15"), candidate_count=3)
    assert WARNING_PROFILE_TOKEN_WINDOW not in warnings


def test_a_warning_never_describes_text_the_client_will_not_see():
    # The over-long candidate is dropped for exceeding the character limit, so the
    # surviving list holds nothing long — and no over-window warning is raised about text
    # that never reaches the client.
    profile = profile_for("sd15")
    too_long = " ".join(["word"] * 500)  # over 77 tokens and over 2,000 chars
    assert len(too_long) > profile.max_positive_chars
    kept, warnings, dropped = validate_candidates(
        [candidate(1, "a woman in a red dress"), candidate(2, too_long)],
        validated=validated_for("sd15"), candidate_count=3)
    assert [item.candidate_id for item in kept] == ["candidate-1"]
    assert dropped == 1
    assert WARNING_PROFILE_TOKEN_WINDOW not in warnings


def test_an_excluded_id_inside_a_candidate_sentence_drops_only_that_candidate():
    kept, warnings, dropped = validate_candidates(
        [candidate(1, "a woman in a red dress"),
         candidate(2, "a woman, style.illustration, red dress")],
        validated=validated_for("flux2", excluded=("style.illustration",)),
        candidate_count=3)
    assert [item.candidate_id for item in kept] == ["candidate-1"]
    assert dropped == 1
    assert WARNING_CANDIDATES_REDUCED in warnings


def test_more_candidates_than_requested_keeps_the_requested_number():
    # The client budgeted for `candidate_count` cards; the extra is reported, not shown.
    kept, warnings, dropped = validate_candidates(
        [candidate(index, f"a woman in outfit {index}") for index in (1, 2, 3, 4)],
        validated=validated_for("flux2"), candidate_count=3)
    assert len(kept) == 3
    assert dropped == 1
    assert WARNING_CANDIDATES_REDUCED in warnings


def test_a_missing_candidate_list_is_no_warning_at_all():
    assert validate_candidates(None, validated=validated_for("flux2"),
                               candidate_count=3) == ([], [], 0)


# ── target resolution (the profile is part of the target) ─────────────────────


class FakeRegistry:
    """The smallest thing ``resolve_target`` needs: ``get`` over a dict of models."""

    def __init__(self, models):
        self._models = models

    def get(self, model_id):
        if model_id not in self._models:
            raise KeyError(model_id)
        return self._models[model_id]


def registry(**models):
    return FakeRegistry({
        model_id: {"family": family, "generation_options": {}, "presets": {},
                   "validation_status": "tested", **extra}
        for model_id, (family, extra) in models.items()})


def test_a_family_without_a_profile_is_refused_rather_than_given_a_generic_one():
    # A registry entry whose family this build cannot describe has no convention to
    # follow, so the target is refused instead of silently applying the wrong one.
    with pytest.raises(ComposeInputError) as raised:
        resolve_target(registry(odd=("sdxl", {})), model_id="odd", family="sdxl")
    assert raised.value.status_code == 422
    assert raised.value.why == "model_family_mismatch"
    assert "no output profile" in raised.value.detail


def test_a_resolved_target_carries_the_family_profile():
    resolved = resolve_target(registry(model=("sd15", {})), model_id="model",
                              family="sd15")
    assert resolved.profile is profile_for("sd15")
