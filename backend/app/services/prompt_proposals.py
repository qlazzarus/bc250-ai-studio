"""Structured scene-proposal contract and validator.

This module implements the contract fixed in LLM-C01/C02 of
``docs/PROMPT_COMPOSER_EXECUTION_TASKS.md``. It is deliberately pure: no network,
no database, no GPU. The dictionary is *injected* as a reference mapping so the
Python side never keeps a second copy of the operator dictionary.

Nothing here replaces ``compileScene``: accepted proposals are only candidate IDs.
"""

import json
from dataclasses import dataclass
from typing import Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError

# C01-5 limits. Keep in sync with the documented contract, not with the dictionary.
# What the UI may receive at most (bytes, items, characters).
MAX_RESPONSE_BYTES = 16 * 1024
# Transport guard for the provider reply. It is deliberately larger than the
# 16 KiB UI budget: C01-5 says an oversized reply is *trimmed* to the budget with
# `truncated: true`, so a hard cap here must only stop runaway bodies.
MAX_PROVIDER_REPLY_BYTES = 64 * 1024
MAX_SUGGESTIONS = 8
MAX_UNRESOLVED = 8
MAX_UNRESOLVED_CHARS = 200
MAX_AMBIGUITIES = 8
MAX_REJECTED = 12
# Parse ceilings: a reply may contain more items than we adopt, so that
# "8개 초과" is reported as truncated rather than as a schema failure. The
# 16 KiB byte cap is the real abuse guard, this only bounds memory.
HARD_MAX_ITEMS = 32
MAX_REASON_CHARS = 80
# VAR01: a situation-variant reply carries at most three Korean candidates. Three is
# the display limit (VAR02 shows them as cards), not a model preference: a fourth is
# trimmed with `truncated: true` instead of silently vanishing.
MAX_VARIANTS = 3
# VAR01: the Korean sentence of one candidate. Longer than a `reason_ko` because it is
# the candidate itself, shorter than `free_text_ko` because it is one sentence and is
# echoed back to the UI as a card title/body.
MAX_VARIANT_PROMPT_CHARS = 200
MAX_VARIANT_LABEL_CHARS = 40
# One candidate replaces a place and an action, so the diff is small by design. The
# cap bounds a single variant, not the reply: 3 variants × 2 lists still fit 16 KiB.
MAX_VARIANT_IDS = 20
# VAR01 says "장소와 행동만 바꾼 상황". Everything else (subject, outfit, style) is
# what `partial_change` is for; letting a variant re-cast the person would make the
# three cards incomparable and would need SCENE01/02 attribution.
# Both dictionary spellings count: legacy `action`/`location` and newer `pose`/
# `setting` are the same display group (``DISPLAY_GROUP``), so the check runs on the
# group rather than on the raw category.
VARIANT_GROUPS = frozenset({"pose", "setting"})
# ``proposals.ts`` MIN_PHRASE = 2. A 1-character "quote" matches almost any
# Korean sentence, so it must never be batch-accepted.
MIN_MATCHED_PHRASE = 2
MAX_MATCHED_PHRASE = 40

# C01-4 negation markers. Korean attaches the marker *after* the negated noun
# ("안경 없이", "긴 머리가 아닌", "안경 안 쓴"), so only the characters following
# each occurrence are inspected. A symmetric window would wrongly hold 짧은 머리
# in "안경 없이 짧은 머리의 사람", which C01-6 #2 requires to be accepted.
NEGATION_MARKERS = (
    "없이", "아닌", "아님", "아니", "않", "안 ", "못 ", "말고", "빼고", "제외",
)
MATCH_AFTER_WINDOW = 8

DISPLAY_GROUP = {"action": "pose", "location": "setting", "composition": "camera"}

ProposalKind = Literal["selection_hint", "partial_change", "situation_variants"]
# VAR01: the third kind. Kept as a name too, because both the validator and the
# endpoint branch on it and a bare string literal in three places drifts.
VARIANT_KIND = "situation_variants"
ProposalStatus = Literal["ready", "empty", "unavailable", "unsupported_v1"]
Polarity = Literal["affirmed", "negated"]
SpanWhy = Literal["no_dictionary_entry", "negated", "negation_unsupported",
                  "ambiguous_attribution", "polarity_conflict"]
AmbiguityWhy = Literal["actor_unknown"]
FinishReason = Literal["stop", "length", "abort", "content_filter", "other"]


class ProposalParseError(ValueError):
    """The provider reply is not the agreed schema; it must not be adopted."""


@dataclass(frozen=True)
class DictionaryEntryRef:
    """Only the facts the validator needs. Never the rendered expression."""

    category: str
    active: bool = True


class ProposalSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=100)


class ProposalRevisions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene: str = Field(min_length=8, max_length=80)
    selection: str = Field(min_length=8, max_length=80)
    text: str = Field(min_length=8, max_length=80)


class ProposalLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_suggestions: int = Field(default=MAX_SUGGESTIONS, ge=1, le=MAX_SUGGESTIONS)
    max_unresolved: int = Field(default=MAX_UNRESOLVED, ge=1, le=MAX_UNRESOLVED)


class ProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ProposalKind
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    target_family: str = Field(min_length=1, max_length=100)
    dictionary_version: str = Field(min_length=1, max_length=100)
    free_text_ko: str = Field(min_length=1, max_length=4000)
    selections: list[ProposalSelection] = Field(default_factory=list, max_length=100)
    locked_ids: list[str] = Field(default_factory=list, max_length=100)
    target_groups: list[str] = Field(default_factory=list, max_length=10)
    revisions: ProposalRevisions
    limits: ProposalLimits = Field(default_factory=ProposalLimits)


class RawSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    matched_phrase: str = Field(min_length=1, max_length=MAX_MATCHED_PHRASE)
    basis: Literal["quote", "inferred"] = "quote"
    polarity: Polarity = "affirmed"
    actor: str | None = Field(default=None, max_length=100)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    reason_ko: str = Field(default="", max_length=MAX_REASON_CHARS)


class RawUnresolvedSpan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=MAX_UNRESOLVED_CHARS)
    why: SpanWhy = "no_dictionary_entry"
    polarity: Polarity = "affirmed"


class RawAmbiguity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=MAX_UNRESOLVED_CHARS)
    why: AmbiguityWhy = "actor_unknown"
    candidates: list[str] = Field(default_factory=list, max_length=HARD_MAX_ITEMS)


class RawVariant(BaseModel):
    """VAR01: one Korean *situation* candidate (place/action swapped, cast kept).

    The model proposes; ``validate_variants`` decides. Every ID is checked against
    the same dictionary and the same ``locked_ids`` as ``selection_hint``, so a
    candidate can never be built from an ID the browser does not have. ``actor``
    exists only so a multi-person reading can be *rejected* explicitly: v1 has no
    place to store "this attribute belongs to that person" (SCENE01/02 pending).
    """

    model_config = ConfigDict(extra="forbid")
    variant_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    label_ko: str = Field(min_length=1, max_length=MAX_VARIANT_LABEL_CHARS)
    prompt_ko: str = Field(min_length=1, max_length=MAX_VARIANT_PROMPT_CHARS)
    changed_ids: list[str] = Field(default_factory=list, max_length=MAX_VARIANT_IDS)
    removed_ids: list[str] = Field(default_factory=list, max_length=MAX_VARIANT_IDS)
    unresolved_ko: list[str] = Field(default_factory=list, max_length=HARD_MAX_ITEMS)
    actor: str | None = Field(default=None, max_length=100)


class ProposalProvider(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str = Field(min_length=1, max_length=200)
    version: str = Field(default="", max_length=100)
    latency_ms: int = Field(default=0, ge=0)
    finish_reason: FinishReason = "stop"


class ProposalResponse(BaseModel):
    """Exactly the agreed reply shape. Unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")
    proposal_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    status: ProposalStatus
    kind: str = Field(min_length=1, max_length=40)
    provider: ProposalProvider
    revisions: ProposalRevisions
    suggestions: list[RawSuggestion] = Field(default_factory=list, max_length=HARD_MAX_ITEMS)
    unresolved_spans: list[RawUnresolvedSpan] = Field(
        default_factory=list, max_length=HARD_MAX_ITEMS
    )
    ambiguities: list[RawAmbiguity] = Field(default_factory=list, max_length=HARD_MAX_ITEMS)
    # VAR01: present only for ``kind: "situation_variants"``. Omitted-when-empty keeps
    # the two older kinds byte-identical to the reply C01/I06 already fixed.
    variants: list[RawVariant] = Field(default_factory=list, max_length=HARD_MAX_ITEMS)
    rejected: list[dict] = Field(default_factory=list, max_length=HARD_MAX_ITEMS)
    truncated: bool = False


@dataclass(frozen=True)
class AcceptedSuggestion:
    """One proposal the UI may show. ``auto_accept`` mirrors C01-3 ``basis``."""

    id: str
    matched_phrase: str
    basis: Literal["quote", "inferred"]
    confidence: float
    reason_ko: str
    auto_accept: bool


@dataclass(frozen=True)
class AcceptedVariant:
    """VAR01: one candidate the UI may show. Not a scene, not an applied change."""

    variant_id: str
    label_ko: str
    prompt_ko: str
    changed_ids: tuple[str, ...]
    removed_ids: tuple[str, ...]
    unresolved_ko: tuple[str, ...]


@dataclass(frozen=True)
class ValidatedProposal:
    status: ProposalStatus
    why: str | None
    suggestions: tuple[AcceptedSuggestion, ...]
    unresolved_spans: tuple[dict, ...]
    ambiguities: tuple[dict, ...]
    rejected: tuple[dict, ...]
    truncated: bool
    # VAR01: candidates are only ever produced for ``situation_variants``, and they
    # are *never* suggestions: a variant is a Korean sentence for the user to read,
    # not a dictionary ID to accept (C01-6 #1).
    variants: tuple[AcceptedVariant, ...] = ()
    # C01-3 response metadata, copied from the accepted reply so the endpoint can
    # echo it without re-parsing. ``None`` when the reply was never accepted.
    proposal_id: str | None = None
    provider: ProposalProvider | None = None


def encode(response: ProposalResponse) -> str:
    """Serialize exactly what the browser will receive.

    ``ensure_ascii=False`` keeps Korean readable; byte length is what C01-5 caps.
    """
    return json.dumps(response.model_dump(mode="json"), ensure_ascii=False,
                      separators=(",", ":"))


def encoded_size(response: ProposalResponse) -> int:
    return len(encode(response).encode("utf-8"))


def parse_reply(payload: bytes, *, request: ProposalRequest) -> ProposalResponse:
    """Parse a provider reply or raise ``ProposalParseError``.

    Never repairs, never truncates, never fills defaults for missing required keys.
    """
    # Transport guard only: a 16 KiB reply is trimmed, not discarded (C01-5).
    if len(payload) > MAX_PROVIDER_REPLY_BYTES:
        raise ProposalParseError(f"reply exceeds {MAX_PROVIDER_REPLY_BYTES} bytes")
    try:
        data = json.loads(payload)
    except (ValueError, UnicodeDecodeError) as error:
        raise ProposalParseError("reply is not valid JSON") from error
    try:
        response = ProposalResponse.model_validate(data)
    except ValidationError as error:
        raise ProposalParseError("reply does not match schema") from error
    if response.request_id != request.request_id:
        raise ProposalParseError("reply request_id does not match the request")
    if response.revisions != request.revisions:
        # C01-2: revisions are the client's state fingerprint. A reply computed from
        # a different state must not be applied, even if every ID happens to be valid.
        raise ProposalParseError("reply revisions do not match the request")
    return response


def _negated_in_source(phrase: str, source: str) -> bool:
    """True when a negation marker immediately follows an occurrence of ``phrase``.

    This is the deterministic guard the rule engine lacks. Korean negates a noun by
    attaching a marker after it (``안경 없이``, ``긴 머리가 아닌``), so only the
    characters right after each occurrence are inspected. Scanning a symmetric
    window would wrongly hold ``짧은 머리`` in ``안경 없이 짧은 머리의 사람``.
    """
    start = 0
    while True:
        index = source.find(phrase, start)
        if index < 0:
            return False
        after = source[index + len(phrase):index + len(phrase) + MATCH_AFTER_WINDOW]
        if any(marker in after for marker in NEGATION_MARKERS):
            return True
        start = index + 1


def _variant_rejections(item: RawVariant, *, request: ProposalRequest,
                        dictionary: Mapping[str, DictionaryEntryRef]) -> list[dict]:
    """Every reason this candidate cannot be shown. Empty means it may be shown.

    A candidate is rejected as a whole: half a situation ("place changed, action
    silently dropped") would read as a promise the reply does not make.
    """
    reasons: list[dict] = []
    if item.actor is not None:
        # SCENE01/02 are unresolved, so v1 has nowhere to store per-person
        # attribution. Compressing it into one flat scene would lose who owns what.
        reasons.append({"raw_id": item.variant_id, "why": "attribution_unsupported_v1"})
        return reasons
    locked = set(request.locked_ids)
    selected = {entry.id for entry in request.selections}
    if not item.changed_ids and not item.removed_ids:
        reasons.append({"raw_id": item.variant_id, "why": "no_change"})
    for entry_id in item.changed_ids:
        entry = dictionary.get(entry_id)
        if entry is None:
            reasons.append({"raw_id": item.variant_id, "why": "not_in_dictionary",
                            "id": entry_id})
        elif not entry.active:
            reasons.append({"raw_id": item.variant_id, "why": "inactive_entry", "id": entry_id})
        elif entry_id in locked:
            # Same table as `selection_hint`: a locked value is fixed for the request.
            reasons.append({"raw_id": item.variant_id, "why": "locked", "id": entry_id})
        elif entry_id in selected:
            # "Change to what is already chosen" is not a variant; keeping it would
            # also collide with the value the model meant to replace.
            reasons.append({"raw_id": item.variant_id, "why": "already_selected",
                            "id": entry_id})
        elif DISPLAY_GROUP.get(entry.category, entry.category) not in VARIANT_GROUPS:
            # VAR01 is scoped to place and action. A `clothing` or `subject` diff is
            # a `partial_change` and would make the three cards incomparable.
            reasons.append({"raw_id": item.variant_id, "why": "out_of_scope",
                            "id": entry_id})
    for entry_id in item.removed_ids:
        if entry_id in locked:
            reasons.append({"raw_id": item.variant_id, "why": "locked", "id": entry_id})
        elif entry_id not in selected:
            # Removing something the scene does not contain is a diff that cannot
            # be applied, so the candidate would describe a different scene.
            reasons.append({"raw_id": item.variant_id, "why": "not_selected", "id": entry_id})
        else:
            removed = dictionary.get(entry_id)
            if removed is not None and (
                DISPLAY_GROUP.get(removed.category, removed.category) not in VARIANT_GROUPS
            ):
                # Dropping the subject or the outfit is not a place/action variant.
                reasons.append({"raw_id": item.variant_id, "why": "out_of_scope",
                                "id": entry_id})
    return reasons


def validate_variants(
    response: ProposalResponse,
    *,
    request: ProposalRequest,
    dictionary: Mapping[str, DictionaryEntryRef],
) -> tuple[tuple[AcceptedVariant, ...], list[dict], list[dict], bool]:
    """VAR01 decision table for ``situation_variants``.

    Returns the accepted candidates, the extra ``rejected`` rows, the extra
    ``ambiguities`` and whether anything was cut, so the caller can keep one
    ``truncated`` flag for the whole reply.
    """
    rejected: list[dict] = []
    ambiguities: list[dict] = []
    accepted: list[AcceptedVariant] = []
    seen: set[str] = set()
    for item in response.variants:
        if item.variant_id in seen:
            rejected.append({"raw_id": item.variant_id, "why": "duplicate"})
            continue
        seen.add(item.variant_id)
        reasons = _variant_rejections(item, request=request, dictionary=dictionary)
        if item.actor is not None:
            ambiguities.append({"text": item.label_ko, "why": "actor_unknown",
                                "candidates": [item.variant_id]})
        if reasons:
            rejected.extend(reasons)
            continue
        accepted.append(AcceptedVariant(
            variant_id=item.variant_id, label_ko=item.label_ko, prompt_ko=item.prompt_ko,
            changed_ids=tuple(item.changed_ids), removed_ids=tuple(item.removed_ids),
            unresolved_ko=tuple(item.unresolved_ko),
        ))
    kept = tuple(accepted[:MAX_VARIANTS])
    return kept, rejected, ambiguities, len(accepted) > len(kept)


def validate_reply(
    response: ProposalResponse,
    *,
    request: ProposalRequest,
    dictionary: Mapping[str, DictionaryEntryRef],
) -> ValidatedProposal:
    """Apply the C01-4 decision table. Incomplete replies are never adopted."""
    rejected: list[dict] = []
    ambiguities: list[dict] = [
        {"text": item.text, "why": item.why, "candidates": list(item.candidates)}
        for item in response.ambiguities
    ]
    held: list[dict] = []
    accepted: list[AcceptedSuggestion] = []
    seen: set[str] = set()
    selected = {item.id for item in request.selections}
    scoped = set(request.target_groups)
    locked = set(request.locked_ids)

    for item in response.suggestions:
        if item.id in seen:
            rejected.append({"raw_id": item.id, "why": "duplicate"})
            continue
        seen.add(item.id)
        entry = dictionary.get(item.id)
        if entry is None:
            rejected.append({"raw_id": item.id, "why": "not_in_dictionary"})
            continue
        if not entry.active:
            rejected.append({"raw_id": item.id, "why": "inactive_entry"})
            continue
        if item.id in selected:
            # Already applied: omit it without calling it a rejection (C01-4).
            continue
        if item.actor is not None:
            rejected.append({"raw_id": item.id, "why": "attribution_unsupported_v1"})
            ambiguities.append({"text": item.matched_phrase, "why": "actor_unknown",
                                "candidates": [item.id]})
            continue
        if item.polarity == "negated":
            held.append({"text": item.matched_phrase, "why": "negated",
                         "polarity": "negated"})
            continue
        if _negated_in_source(item.matched_phrase, request.free_text_ko):
            # Provider says affirmed while the text negates it: fail closed.
            held.append({"text": item.matched_phrase, "why": "polarity_conflict",
                         "polarity": "negated"})
            continue
        if item.id in locked:
            rejected.append({"raw_id": item.id, "why": "locked"})
            continue
        if scoped:
            group = DISPLAY_GROUP.get(entry.category, entry.category)
            if group not in scoped:
                rejected.append({"raw_id": item.id, "why": "out_of_scope"})
                continue
        quoted = (len(item.matched_phrase) >= MIN_MATCHED_PHRASE
                  and item.matched_phrase in request.free_text_ko)
        basis = item.basis
        if basis == "quote" and not quoted:
            # Claimed a quote that is not in the text: still shown, but it must
            # not enter batch acceptance.
            basis = "inferred"
        accepted.append(AcceptedSuggestion(
            id=item.id, matched_phrase=item.matched_phrase, basis=basis,
            confidence=item.confidence, reason_ko=item.reason_ko,
            auto_accept=basis == "quote",
        ))

    suggestions = tuple(accepted[: request.limits.max_suggestions])
    spans = tuple(
        [{"text": span.text, "why": span.why, "polarity": span.polarity}
         for span in response.unresolved_spans] + held
    )[: request.limits.max_unresolved]
    variants: tuple[AcceptedVariant, ...] = ()
    variants_cut = False
    if request.kind == VARIANT_KIND:
        # VAR01: candidates only exist for their own kind. A `selection_hint` reply
        # that carries `variants` is not silently accepted as hints, and vice versa:
        # the two answers mean different things on screen.
        variants, variant_rejected, variant_ambiguities, variants_cut = validate_variants(
            response, request=request, dictionary=dictionary
        )
        rejected = variant_rejected + rejected
        ambiguities = variant_ambiguities + ambiguities
    elif response.variants:
        rejected = [{"raw_id": item.variant_id, "why": "unexpected_kind"} for item in response.variants] + rejected
    kept_ambiguities = ambiguities[:MAX_AMBIGUITIES]
    kept_rejected = rejected[:MAX_REJECTED]
    overflowed = (
        len(accepted) > len(suggestions)
        or len(response.unresolved_spans) + len(held) > len(spans)
        or len(ambiguities) > len(kept_ambiguities)
        or len(rejected) > len(kept_rejected)
        or variants_cut
    )
    truncated = response.truncated or overflowed

    if response.provider.finish_reason != "stop":
        # Partially decoded output is discarded, never adopted (C01-4 last row).
        return ValidatedProposal(
            status="unavailable", why="incomplete_reply", suggestions=(),
            unresolved_spans=spans, ambiguities=tuple(kept_ambiguities),
            rejected=tuple(kept_rejected), truncated=True,
            proposal_id=response.proposal_id, provider=response.provider,
        )
    # VAR01: candidates are the answer for their own kind, so "has variants" counts
    # towards `ready`. A reply with neither hints nor candidates is still `empty`,
    # which is what the UI must show instead of an empty card area.
    answered = bool(suggestions or variants)
    return ValidatedProposal(
        status="ready" if answered else "empty", why=None, suggestions=suggestions,
        unresolved_spans=spans, ambiguities=tuple(kept_ambiguities),
        rejected=tuple(kept_rejected), truncated=truncated,
        proposal_id=response.proposal_id, provider=response.provider,
        variants=variants,
    )


def evaluate(
    payload: bytes,
    *,
    request: ProposalRequest,
    dictionary: Mapping[str, DictionaryEntryRef],
) -> ValidatedProposal:
    """Parse, validate and fit the reply into C01-5 budgets.

    Provider defects become ``status: "unavailable"``, never exceptions: the
    caller must keep the existing text and selections untouched.
    """
    try:
        response = parse_reply(payload, request=request)
    except ProposalParseError as error:
        return ValidatedProposal(
            status="unavailable", why=str(error), suggestions=(),
            unresolved_spans=(), ambiguities=(), rejected=(), truncated=False,
        )
    result = validate_reply(response, request=request, dictionary=dictionary)
    return fit_budget(result, response, request=request)


def fit_budget(
    result: ValidatedProposal,
    response: ProposalResponse,
    *,
    request: ProposalRequest,
) -> ValidatedProposal:
    """Trim tail items until the serialized reply fits the 16 KiB budget.

    C01-5 order: drop trailing ``suggestions`` first, then trailing
    ``unresolved_spans``; anything dropped sets ``truncated: true``. The caller
    renders the banner "제안 일부를 표시하지 못했습니다" from that flag, so nothing
    disappears silently.
    """
    suggestions = list(result.suggestions)
    variants = list(result.variants)
    spans = list(result.unresolved_spans)
    ambiguities = list(result.ambiguities)
    rejected = list(result.rejected)[:MAX_REJECTED]
    dropped = False

    def candidate_items():
        return [
            {"id": item.id, "matched_phrase": item.matched_phrase,
             "basis": item.basis, "polarity": "affirmed", "actor": None,
             "confidence": item.confidence, "reason_ko": item.reason_ko}
            for item in suggestions
        ]

    def variant_items():
        return [
            {"variant_id": item.variant_id, "label_ko": item.label_ko,
             "prompt_ko": item.prompt_ko, "changed_ids": list(item.changed_ids),
             "removed_ids": list(item.removed_ids),
             "unresolved_ko": list(item.unresolved_ko), "actor": None}
            for item in variants
        ]

    def fits() -> bool:
        candidate = ProposalResponse(
            **{
                **response.model_dump(mode="python"),
                "suggestions": candidate_items(),
                "variants": variant_items(),
                "unresolved_spans": spans,
                "ambiguities": ambiguities,
                "rejected": rejected,
            }
        )
        return encoded_size(candidate) <= MAX_RESPONSE_BYTES

    while not fits():
        if suggestions:
            suggestions.pop()
        elif variants:
            # VAR01: a candidate is the largest item, so 3 × 200 chars can never
            # be trimmed by spans alone. Dropping the tail keeps candidates 1..n-1.
            variants.pop()
        elif spans:
            spans.pop()
        elif ambiguities:
            ambiguities.pop()
        elif rejected:
            rejected.pop()
        else:
            # Even an empty reply exceeds the budget: the provider is broken.
            return ValidatedProposal(
                status="unavailable", why="reply_exceeds_budget", suggestions=(),
                unresolved_spans=(), ambiguities=(), rejected=(), truncated=True,
            )
        dropped = True

    answered = bool(suggestions or variants)
    return ValidatedProposal(
        status=result.status if answered or result.status == "unavailable" else "empty",
        why=result.why,
        suggestions=tuple(suggestions), unresolved_spans=tuple(spans),
        ambiguities=tuple(ambiguities), rejected=tuple(rejected),
        truncated=result.truncated or dropped,
        proposal_id=result.proposal_id, provider=result.provider,
        variants=tuple(variants),
    )
