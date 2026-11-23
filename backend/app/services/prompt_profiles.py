"""Versioned per-family output profiles (UCP04).

What a profile *is*: the facts about a model family that shape an English prompt — the
separator the rest of the compiler already uses, whether the family reads tag lists or
sentences, the prompt-length window its text encoder imposes, and the per-field character
limits. One profile per family, each carrying its own version number so a client can
detect that its view is stale (``409 stale_profile``).

What a profile *is not*: a claim that output quality is optimised. Nothing here was tuned
against generated images. The only numbers taken from the repository are the compiler's
separator convention (1.3.0: comma for ``sd15``, semicolon for the others) and the
registry's own per-model facts. Everything a profile cannot establish is ``None`` and
stays ``None`` rather than being filled with a plausible default.

The token window deserves its own note. ``sd15`` reads a CLIP text encoder with a 77-token
context, and that is a property of the family, not of this repository's measurements. The
other three families here read a Qwen3-class LLM text encoder whose context length is a
property of the checkpoint files, which this module cannot see — so their window is
``None`` and no window warning is ever raised for them. A blanket 77-token warning across
all families would be a fabricated limit, which §5 forbids.
"""

import math
import re
from dataclasses import dataclass
from typing import Literal, Mapping

# One version for the whole profile *set*. Bumped from the UCP03 placeholder (1) because
# 1 described nothing: it was a constant every family shared so the contract had a field.
# A family now carries real content, and the number changes with it — a client holding the
# placeholder must be told its view is stale instead of silently getting different output.
PROFILE_VERSION = 2

PromptStyle = Literal["tags", "sentence"]


@dataclass(frozen=True)
class OutputProfile:
    """One family's prompt-shaping facts.

    ``joiner`` is duplicated from the compiler on purpose: this module must not import the
    frontend's convention, so the value is restated here and a test pins it against the
    compiler's own table. A silent divergence would make a candidate's separator disagree
    with the compiled fallback prompt in the same screen.
    """

    family: str
    version: int
    prompt_style: PromptStyle
    joiner: str
    # ``None`` means "this family's window is not established here", never "unlimited".
    token_window: int | None
    token_window_source: str
    max_positive_chars: int
    max_negative_chars: int

    def describe(self) -> dict:
        """The profile as the model is told about it. Never includes a guess."""
        return {
            "family": self.family,
            "version": self.version,
            "prompt_style": self.prompt_style,
            "joiner": self.joiner,
            "token_window": self.token_window,
            "max_positive_chars": self.max_positive_chars,
        }


_SD15_CLIP = "sd15 CLIP text encoder context (77 tokens); family property, not measured here"
_LLM_ENCODER = "text encoder window is a checkpoint property this module cannot read"


PROFILES: Mapping[str, OutputProfile] = {
    # SD 1.5 reads comma-separated tag lists and is the only family here whose window is a
    # known constant. sd.cpp chunks prompts longer than the window, so exceeding it
    # degrades rather than truncates — hence a warning, never a refusal.
    "sd15": OutputProfile(
        family="sd15", version=PROFILE_VERSION, prompt_style="tags", joiner=", ",
        token_window=77, token_window_source=_SD15_CLIP,
        max_positive_chars=2_000, max_negative_chars=800,
    ),
    # The three Qwen-encoder families are asked for relationship sentences, matching the
    # compiler's semicolon joining. No token window is claimed for them.
    "flux2": OutputProfile(
        family="flux2", version=PROFILE_VERSION, prompt_style="sentence", joiner="; ",
        token_window=None, token_window_source=_LLM_ENCODER,
        max_positive_chars=2_000, max_negative_chars=800,
    ),
    "z-image": OutputProfile(
        family="z-image", version=PROFILE_VERSION, prompt_style="sentence", joiner="; ",
        token_window=None, token_window_source=_LLM_ENCODER,
        max_positive_chars=2_000, max_negative_chars=800,
    ),
    "moss-image": OutputProfile(
        family="moss-image", version=PROFILE_VERSION, prompt_style="sentence", joiner="; ",
        token_window=None, token_window_source=_LLM_ENCODER,
        max_positive_chars=2_000, max_negative_chars=800,
    ),
    # Test-only, as in `config/models.yaml`. Compose is gated on a non-`fake` engine, so
    # this entry exists only so a fake-registry deployment fails on the gate rather than
    # on a missing profile.
    "fake": OutputProfile(
        family="fake", version=PROFILE_VERSION, prompt_style="sentence", joiner="; ",
        token_window=None, token_window_source="test-only family has no real text encoder",
        max_positive_chars=2_000, max_negative_chars=800,
    ),
}


def profile_for(family: str) -> OutputProfile | None:
    """The profile for ``family``, or ``None`` when this deployment has no such family."""
    return PROFILES.get(family)


# Families that exist only so a test deployment fails on the *gate* rather than on a
# missing profile. They are never advertised: `output_profile_versions` is read by a
# browser to decide which version to send, and a `fake` entry would suggest a family a
# user could actually compose for.
TEST_ONLY_FAMILIES = frozenset({"fake"})


def profile_versions() -> dict[str, int]:
    """Advertised in ``GET /system/capabilities`` (UCP04 replaces the UCP03 constant).

    Only the families a client can target, and read from the profiles themselves, so the
    advertised number and the number the server compares against cannot disagree.
    """
    return {family: profile.version
            for family, profile in PROFILES.items()
            if family not in TEST_ONLY_FAMILIES}


def estimate_tokens(text: str) -> int:
    """A deliberately crude English token estimate, mirroring the browser's.

    ``estimateTokens`` in ``frontend/src/prompt/compiler.ts`` counts words and multiplies
    by 1.3; this is the same formula on the same text, so the draft prompt's
    ``token_budget`` warning and this module's ``profile_token_window`` warning cannot
    disagree about whether one prompt is over the window. A different formula on each side
    would let the same sentence be "over budget" in the composer and fine in the API.

    There is no tokenizer in this repository for any family's text encoder, so an estimate
    is the only honest option and it must be labelled as one wherever it is shown. Nothing
    is rejected on its basis.
    """
    words = [word for word in re.split(r"[\s,;]+", text) if word]
    return math.ceil(len(words) * 1.3)


def prompt_guidance(profile: OutputProfile) -> str:
    """The lines a family profile contributes to the system prompt.

    Kept separate from the general instructions so the *only* family-specific text is
    here: a reader checking "did UCP04 change model behaviour?" can read one function.
    """
    if profile.prompt_style == "tags":
        style = ("Write `positive_prompt` as short English tag phrases separated by "
                 f"`{profile.joiner.strip() or ','}`. Keep each phrase a plain description.")
    else:
        style = ("Write `positive_prompt` as one or two English sentences that name the "
                 "relationships between the entities. Do not turn the scene into a tag list.")
    lines = [style]
    if profile.token_window is not None:
        # An estimate, and said so: the model is not told a measured number.
        lines.append(
            f"Aim for roughly {profile.token_window} tokens per `positive_prompt`; "
            "a prompt much longer than that is only partly read by this family's "
            "text encoder.")
    lines.append(
        "Do not emit weighting syntax such as `(word:1.2)` or `<lora:...>`: "
        "the generation engine manages those itself.")
    return "\n".join(lines)
