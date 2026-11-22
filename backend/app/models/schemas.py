import json
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

SamplingMethod = Literal[
    "euler",
    "euler_a",
    "heun",
    "dpm2",
    "dpm++2s_a",
    "dpm++2m",
    "dpm++2mv2",
    "ipndm",
    "ipndm_v",
    "lcm",
    "ddim_trailing",
    "tcd",
    "res_multistep",
    "res_2s",
    "er_sde",
    "euler_cfg_pp",
    "euler_a_cfg_pp",
    "euler_ge",
    "dpm++2m_sde",
    "dpm++2m_sde_bt",
    "lms",
]
Scheduler = Literal[
    "discrete",
    "karras",
    "exponential",
    "ays",
    "gits",
    "sgm_uniform",
    "simple",
    "smoothstep",
    "kl_optimal",
    "lcm",
    "bong_tangent",
    "ltx2",
    "logit_normal",
    "flux2",
    "flux",
    "beta",
    "llada_image",
]


class CompositionSceneEntity(BaseModel):
    """One subject of the scene (UCP02 contract).

    ``entity_id`` is scene-local: relations refer to it, and ``selections[].entity_id``
    points at it too. It is *not* a dictionary ID and never leaves the scene, so a
    restored snapshot cannot claim an attribution the dictionary does not have.
    """

    model_config = ConfigDict(extra="forbid")
    entity_id: str = Field(min_length=1, max_length=40)
    kind: Literal["person", "animal", "object", "place"]
    count: int = Field(default=1, ge=1, le=16)
    attributes_ko: list[str] = Field(default_factory=list, max_length=8)
    # UCP01: the first thing the trim ladder drops. It is evidence for *why* the scene
    # says this, not a fact the prompt needs, so losing it does not falsify the record.
    evidence_ko: str | None = Field(default=None, max_length=200)

    @field_validator("attributes_ko")
    @classmethod
    def check_attributes(cls, value):
        for item in value:
            if len(item) > 200:
                raise ValueError("Attribute text must be at most 200 characters")
        return value


class CompositionSceneRelation(BaseModel):
    """A directed relation between two scene entities.

    ``object_entity_id`` is optional because a unary relation (posture, state) has no
    target. An empty string is rejected rather than treated as null: a client that
    means "no object" must say so.
    """

    model_config = ConfigDict(extra="forbid")
    subject_entity_id: str = Field(min_length=1, max_length=40)
    predicate_ko: str = Field(min_length=1, max_length=200)
    object_entity_id: str | None = Field(default=None, max_length=40)
    evidence_ko: str | None = Field(default=None, max_length=200)


class CompositionSceneEnvironment(BaseModel):
    """The six environment keys, all optional. An empty string means "not stated"."""

    model_config = ConfigDict(extra="forbid")
    location_ko: str | None = Field(default=None, max_length=200)
    time_ko: str | None = Field(default=None, max_length=200)
    lighting_ko: str | None = Field(default=None, max_length=200)
    composition_ko: str | None = Field(default=None, max_length=200)
    style_ko: str | None = Field(default=None, max_length=200)
    mood_ko: str | None = Field(default=None, max_length=200)


class CompositionSceneUnmapped(BaseModel):
    """A detail the dictionary cannot express, attributed to an entity when known."""

    model_config = ConfigDict(extra="forbid")
    text_ko: str = Field(min_length=1, max_length=200)
    entity_id: str | None = Field(default=None, max_length=40)


class CompositionSceneAmbiguity(BaseModel):
    """A question the scene cannot answer by itself.

    ``options`` holds entity IDs, not free text, so an answer can only pick from the
    scene that produced it. The trim ladder drops the options first and recomputes
    them, which is why their absence is recorded in ``snapshot_trim``.
    """

    model_config = ConfigDict(extra="forbid")
    text_ko: str = Field(min_length=1, max_length=200)
    why: Literal["actor_unknown", "polarity_conflict", "model_mismatch",
                 "dictionary_missing"]
    options: list[str] = Field(default_factory=list, max_length=6)


class CompositionScene(BaseModel):
    """The structured scene of UCP02.

    Referential integrity is checked in one place (``check_scene``) so the snapshot,
    the compose response and the stored job all agree on what a valid scene is.
    """

    model_config = ConfigDict(extra="forbid")
    entities: list[CompositionSceneEntity] = Field(default_factory=list, max_length=8)
    relations: list[CompositionSceneRelation] = Field(default_factory=list, max_length=12)
    environment: CompositionSceneEnvironment = Field(
        default_factory=CompositionSceneEnvironment)
    unmapped_details: list[CompositionSceneUnmapped] = Field(
        default_factory=list, max_length=8)
    ambiguities: list[CompositionSceneAmbiguity] = Field(
        default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_references(self):
        return check_scene(self)


def check_scene(scene):
    """Scene-local referential integrity, shared by every model that carries a scene.

    Two facts matter and nothing else:

    - every ``entity_id`` is unique inside the scene;
    - every relation endpoint and every attribution names an entity that exists.

    A dangling reference is rejected instead of being dropped. Dropping it would turn
    "attributed to someone who is not here" into "attributed to no one", which is a
    different and unverified claim.
    """
    ids = [entity.entity_id for entity in scene.entities]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate scene entity ID")
    known = set(ids)
    for relation in scene.relations:
        for name, value in (("subject", relation.subject_entity_id),
                            ("object", relation.object_entity_id)):
            if value is not None and value not in known:
                raise ValueError(f"Relation {name} names an unknown entity: {value}")
    for item in scene.unmapped_details:
        if item.entity_id is not None and item.entity_id not in known:
            raise ValueError(f"Unmapped detail names an unknown entity: {item.entity_id}")
    for ambiguity in scene.ambiguities:
        for option in ambiguity.options:
            if option not in known:
                raise ValueError(f"Ambiguity option names an unknown entity: {option}")
    return scene


class CompositionSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=100)
    label_ko: str = Field(min_length=1, max_length=300)
    dictionary_version: str = Field(min_length=1, max_length=100)
    mapping_status: Literal["mapped", "unavailable"]
    rendered: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def check_mapping(self):
        if self.mapping_status == "mapped" and (not self.rendered or not self.rendered.strip()):
            raise ValueError("Mapped selection requires a nonempty expression")
        if self.mapping_status == "unavailable" and self.rendered is not None:
            raise ValueError("Unavailable selection must not include an expression")
        return self


class CompositionUnresolved(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["selection", "free_text"]
    id: str | None = Field(default=None, max_length=100)
    text: str = Field(min_length=1, max_length=4000)


def check_snapshot(model):
    """The two snapshot checks both schema versions share.

    TRANS01 §3.1: 32 KiB of UTF-8 is the *only* binding size limit. Adding a second
    per-field byte budget would create a truth that drifts from ``validateComposition``
    in the browser, so field caps stay semantic (how many cards to show) and this check
    stays the one that decides what can be saved.
    """
    ids = [entry.id for entry in model.selections]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate composition selection ID")
    payload = model.model_dump(mode="json")
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 32768:
        raise ValueError("Prompt composition exceeds 32 KiB")

    def contains_nul(value):
        if isinstance(value, str):
            return "\x00" in value
        if isinstance(value, dict):
            return any(contains_nul(item) for item in value.values())
        if isinstance(value, list):
            return any(contains_nul(item) for item in value)
        return False

    if contains_nul(payload):
        raise ValueError("NUL characters are not allowed")
    return model


class CompositionRemainder(BaseModel):
    """TRANS01 §2: one accepted translation of a phrase the dictionary cannot express.

    ``source_ko`` is the *text*, not an offset. A saved snapshot is a record of what was
    accepted, and ``free_text_ko`` may be edited afterwards; an offset would then point
    somewhere else and the record would silently lie. The request side deliberately does
    the opposite (``RemainderReference``) because there the text is already on the wire.
    """

    model_config = ConfigDict(extra="forbid")
    source_ko: str = Field(min_length=1, max_length=200)
    suggested_en: str = Field(min_length=1, max_length=200)
    # C01-2 provenance vocabulary, reused per item (principle 7). One composition can mix
    # translations from different calls, so one top-level set could not say which phrase
    # came from which reply.
    proposal_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    proposal_model: str = Field(min_length=1, max_length=200)
    # ISO-8601 UTC, second precision: ``YYYY-MM-DDTHH:MM:SSZ``.
    accepted_at: str = Field(min_length=20, max_length=20,
                             pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    @model_validator(mode="after")
    def check_text(self):
        if not self.source_ko.strip() or not self.suggested_en.strip():
            raise ValueError("Remainder text must not be blank")
        return self


class PromptCompositionV1(BaseModel):
    """The v1 snapshot, unchanged. Saved assets keep validating against this shape."""

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    compiler_version: str = Field(min_length=1, max_length=100)
    target_family: str = Field(min_length=1, max_length=100)
    selections: list[CompositionSelection] = Field(max_length=100)
    free_text_ko: str = Field(default="", max_length=4000)
    draft_prompt: str = Field(default="", max_length=8000)
    unresolved: list[CompositionUnresolved] = Field(default_factory=list, max_length=101)

    @model_validator(mode="after")
    def validate_snapshot(self):
        return check_snapshot(self)


class PromptCompositionV2(BaseModel):
    """v1 plus ``remainder``. ``extra="forbid"`` keeps a v2 key out of a v1 body."""

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[2]
    compiler_version: str = Field(min_length=1, max_length=100)
    target_family: str = Field(min_length=1, max_length=100)
    selections: list[CompositionSelection] = Field(max_length=100)
    free_text_ko: str = Field(default="", max_length=4000)
    draft_prompt: str = Field(default="", max_length=8000)
    unresolved: list[CompositionUnresolved] = Field(default_factory=list, max_length=101)
    # 8 is the server's MAX_UNRESOLVED, i.e. how many uncovered phrases one reply can
    # describe. No separate byte budget: ``validate_snapshot`` is the only binding limit.
    remainder: list[CompositionRemainder] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_snapshot(self):
        return check_snapshot(self)


TrimStep = Literal["evidence_ko", "ambiguity_options", "attributes_first",
                   "unmapped_text", "brief_2000", "environment", "arrays_2",
                   "scene_dropped"]


class CompositionSnapshotSelection(BaseModel):
    """One entry of the v3 ``selections`` array: chosen, manual, or excluded.

    The three sources share one array (UCP01 §6) because a separate ``excluded_ids``
    list would let the same dictionary ID be recorded twice. ``pinned`` is required for
    a chosen entry and forbidden for an excluded one — an excluded chip has nothing to
    keep, so a ``pinned`` flag there would be a contradiction rather than a default.
    """

    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    source: Literal["auto", "manual", "excluded"]
    pinned: bool | None = None
    entity_id: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def check_source(self):
        if self.source == "excluded":
            if self.pinned is not None:
                raise ValueError("An excluded selection must not carry `pinned`")
            if self.entity_id is not None:
                raise ValueError("An excluded selection must not carry `entity_id`")
        elif self.pinned is None:
            raise ValueError("A chosen selection requires `pinned`")
        return self


class CompositionApplied(BaseModel):
    """What was actually executed when the user applied a candidate.

    Present only after an apply. ``None`` is never written: the absence of the key is
    the fact "not applied yet" (UCP01 §6), so a v3 snapshot with ``applied: null`` is
    invalid rather than meaning the same thing.
    """

    model_config = ConfigDict(extra="forbid")
    result_id: str = Field(min_length=1, max_length=64)
    candidate_id: str = Field(min_length=1, max_length=64)
    provider_model: str = Field(min_length=1, max_length=200)
    applied_at: str = Field(min_length=20, max_length=20,
                            pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
    positive_prompt: str = Field(min_length=1, max_length=8000)
    negative_prompt: str | None = Field(default=None, max_length=4000)
    summary_ko: str = Field(default="", max_length=600)


class PromptCompositionV3(BaseModel):
    """The integrated snapshot: scene, sources, and the executed result.

    ``brief_ko`` may be empty: a scene built from dictionary selections alone is a
    valid composition (UCP01 fix A). What is not allowed is a snapshot with neither
    text nor a chosen selection, which records nothing.
    """

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[3]
    compiler_version: str = Field(min_length=1, max_length=100)
    dictionary_version: str = Field(min_length=1, max_length=100)
    target_model_id: str = Field(min_length=1, max_length=100)
    target_family: str = Field(min_length=1, max_length=100)
    profile_version: int = Field(ge=1)
    brief_ko: str = Field(default="", max_length=4000)
    selections: list[CompositionSnapshotSelection] = Field(
        default_factory=list, max_length=100)
    scene: CompositionScene = Field(default_factory=CompositionScene)
    # Absent means "not applied yet". `null` is rejected outright: the spec makes the
    # key's presence the fact, so a null would be a third state that means nothing.
    applied: CompositionApplied | None = None
    # The trim steps that were applied, in order. Empty means nothing was trimmed, and
    # a nonempty list tells the restore path that evidence/options/attributes are
    # *absent*, not empty (UCP01 fix B).
    snapshot_trim: list[TrimStep] = Field(default_factory=list, max_length=8)

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null_applied(cls, data):
        # `applied: null` and "no applied key" would otherwise collapse into the same
        # value. The contract distinguishes them, so the null form is refused here
        # before pydantic fills in the default.
        if isinstance(data, dict) and "applied" in data and data["applied"] is None:
            raise ValueError("`applied` must be omitted, not null, before an apply")
        return data

    @model_validator(mode="after")
    def validate_snapshot(self):
        if not self.brief_ko.strip() and not any(
                item.source != "excluded" for item in self.selections):
            raise ValueError("A snapshot needs Korean text or a chosen selection")
        for item in self.selections:
            if item.entity_id is not None:
                known = {entity.entity_id for entity in self.scene.entities}
                if item.entity_id not in known:
                    raise ValueError(
                        f"Selection names an unknown entity: {item.entity_id}")
        return check_snapshot(self)


# A discriminated union, not a version field the caller may lie about: `schema_version`
# selects the model, so a v2 body carrying `remainder` under `schema_version: 1` fails
# with ``extra_forbidden`` instead of being read as v1 and losing the translations.
PromptComposition = Annotated[
    Union[PromptCompositionV1, PromptCompositionV2, PromptCompositionV3],
    Field(discriminator="schema_version"),
]


class ComposeSelection(BaseModel):
    """One selection on the compose request.

    ``source`` is accepted here — unlike the earlier draft, which ignored it — because
    ``manual`` and ``excluded`` are the only record of user intent. The server
    re-judges each item (UCP01 §4): `manual`/`excluded` are preserved, `auto` is
    re-validated, and a missing `source` is read as `auto` for old clients.

    ``pinned`` is a separate axis from ``source``: `manual` + `pinned: false` means
    "I picked this, but it may be replaced next time", which is not the same as an
    automatic choice.
    """

    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    source: Literal["auto", "manual", "excluded"] | None = None
    pinned: bool | None = None
    entity_id: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def check_source(self):
        # An excluded item is a "do not add this" marker: it has no pin and no
        # attribution. Sending one is a client bug, not a default to fill in.
        if self.source == "excluded" and (self.pinned is not None
                                          or self.entity_id is not None):
            raise ValueError("An excluded selection must carry only `id`")
        return self


class ComposeClarificationChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: str = Field(min_length=1, max_length=64)
    option_id: str = Field(min_length=1, max_length=64)


class ComposeRequest(BaseModel):
    """`POST /api/v1/prompt/compose` body (UCP01 §4).

    ``brief_ko`` may be empty when selections carry the request (UCP01 fix A). The
    "nothing at all" case is rejected here rather than in a service, so no route can
    accidentally treat it as an empty success.
    """

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    request_id: str = Field(min_length=16, max_length=16, pattern=r"^cmp-[0-9a-f]{12}$")
    input_revision: str = Field(min_length=71, max_length=71,
                                pattern=r"^sha256:[0-9a-f]{64}$")
    dictionary_version: str = Field(min_length=1, max_length=100)
    target_model_id: str = Field(min_length=1, max_length=100)
    target_family: str = Field(min_length=1, max_length=100)
    profile_version: int = Field(ge=1)
    candidate_count: int = Field(default=3, ge=1, le=3)
    brief_ko: str = Field(default="", max_length=4000)
    selections: list[ComposeSelection] = Field(default_factory=list, max_length=100)
    clarification_choices: list[ComposeClarificationChoice] = Field(
        default_factory=list, max_length=8)

    @model_validator(mode="after")
    def validate_input(self):
        has_text = bool(self.brief_ko.strip())
        has_selection = any(item.source != "excluded" for item in self.selections)
        if not has_text and not has_selection:
            raise ValueError("Compose needs Korean text or at least one chosen selection")
        questions = [choice.question_id for choice in self.clarification_choices]
        if len(questions) != len(set(questions)):
            raise ValueError("Duplicate clarification question ID")
        return self


class ComposeCandidate(BaseModel):
    """One English candidate. ``negative_prompt`` is absent when unsupported."""

    model_config = ConfigDict(extra="forbid")
    candidate_id: str = Field(min_length=1, max_length=64)
    title_ko: str = Field(min_length=1, max_length=40)
    difference_ko: str = Field(min_length=1, max_length=240)
    positive_prompt: str = Field(min_length=1, max_length=2000)
    negative_prompt: str | None = Field(default=None, max_length=800)
    preserved_ko: list[str] = Field(default_factory=list, max_length=6)


class ComposeClarificationOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    option_id: str = Field(min_length=1, max_length=64)
    label_ko: str = Field(min_length=1, max_length=80)


class ComposeClarification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: str = Field(min_length=1, max_length=64)
    question_ko: str = Field(min_length=1, max_length=200)
    why: Literal["actor_unknown", "polarity_conflict", "model_mismatch",
                 "dictionary_missing"]
    options: list[ComposeClarificationOption] = Field(default_factory=list, max_length=6)


class ComposeProvider(BaseModel):
    """What the model call itself reported.

    The three token counts stay separate on purpose. A reply that spent its whole budget
    on reasoning and emitted no output is a *provider* problem with a retry, while a
    reply cut by `finish_reason: length` is a truncation the caller must surface. Adding
    them together would make the two indistinguishable (UCP01 §5, `cut_short`).
    """

    model_config = ConfigDict(extra="forbid")
    model: str = Field(min_length=1, max_length=200)
    latency_ms: int = Field(ge=0)
    finish_reason: str = Field(min_length=1, max_length=40)
    # Absent, not zero: a provider that does not report usage and one that reports `0`
    # are different facts, and a 0 would look like a measurement.
    prompt_tokens: int | None = Field(default=None, ge=0)
    reasoning_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)



class ComposeResponse(BaseModel):
    """The compose reply. ``candidates`` and ``clarifications`` never both fill."""

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    status: Literal["ready", "needs_clarification", "unavailable"]
    result_id: str = Field(min_length=1, max_length=64)
    request_id: str = Field(min_length=1, max_length=64)
    input_revision: str = Field(min_length=1, max_length=80)
    target_model_id: str = Field(min_length=1, max_length=100)
    target_family: str = Field(min_length=1, max_length=100)
    profile_version: int = Field(ge=1)
    dictionary_version: str = Field(min_length=1, max_length=100)
    summary_ko: str = Field(default="", max_length=600)
    selections: list[CompositionSnapshotSelection] = Field(
        default_factory=list, max_length=100)
    scene: CompositionScene = Field(default_factory=CompositionScene)
    candidates: list[ComposeCandidate] = Field(default_factory=list, max_length=3)
    clarifications: list[ComposeClarification] = Field(default_factory=list, max_length=3)
    warnings: list[str] = Field(default_factory=list, max_length=4)
    # Same vocabulary as the v3 snapshot: a reply that already had to trim cannot be
    # written as an untrimmed snapshot, so both sides name the steps identically.
    snapshot_trim: list[TrimStep] = Field(default_factory=list, max_length=8)
    provider: ComposeProvider | None = None
    # `finish_reason: length` must not be disguised as a complete reply (§5). A cut
    # candidate is dropped rather than repaired, so `cut_short` is the *only* signal
    # that some output was lost — without it the client cannot tell a reduced reply
    # from a genuinely small one.
    cut_short: bool = False
    dictionary_truncated: bool = False

    @model_validator(mode="after")
    def check_status(self):
        # The three server states are mutually exclusive: a reply that offers candidates
        # *and* questions leaves the client with no defined button to press.
        if self.status == "ready" and self.clarifications:
            raise ValueError("A ready reply must not carry clarifications")
        if self.status == "needs_clarification" and self.candidates:
            raise ValueError("A clarification reply must not carry candidates")
        # A cut reply with nothing left to offer is `unavailable`, not an empty `ready`:
        # an empty success would look like "your scene needs no candidates".
        if self.cut_short and not self.candidates and self.status == "ready":
            raise ValueError("A cut reply with no candidates must be `unavailable`")
        # Truncation is a fact about the provider call, so it needs the call's record.
        if self.cut_short and self.provider is None:
            raise ValueError("`cut_short` requires a provider block")
        for item in self.selections:
            if item.entity_id is not None and item.entity_id not in {
                    entity.entity_id for entity in self.scene.entities}:
                raise ValueError(
                    f"Selection names an unknown entity: {item.entity_id}")
        return self


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_type: Literal["image.generate", "image.batch"] = "image.generate"
    source: Literal["rp", "nsfw", "pixel"] = "rp"
    project_id: None = None
    model_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    prompt: str = Field(min_length=1, max_length=8000)
    negative_prompt: str = Field(default="", max_length=4000)
    width: int | None = Field(default=None, ge=64, le=2048, multiple_of=8)
    height: int | None = Field(default=None, ge=64, le=2048, multiple_of=8)
    steps: int | None = Field(default=None, ge=1, le=100)
    cfg_scale: float | None = Field(default=None, ge=0, le=30, allow_inf_nan=False)
    sampling_method: SamplingMethod | None = None
    scheduler: Scheduler | None = None
    seed: int = Field(default=-1, ge=-1, le=2147483631)
    priority: int = Field(default=0, ge=0, le=100)
    batch_count: int = Field(default=1, ge=1, le=16)
    preset: Literal["fast", "balanced", "quality"] = "balanced"
    lora_enabled: StrictBool | None = None
    client_reference: str | None = Field(default=None, max_length=200)
    prompt_composition: PromptComposition | None = None

    @model_validator(mode="after")
    def validate_batch(self):
        if self.job_type == "image.generate" and self.batch_count != 1:
            raise ValueError("Use image.batch for multiple images")
        if not self.prompt.strip():
            raise ValueError("Prompt must contain text")
        if "\x00" in self.prompt or "\x00" in self.negative_prompt:
            raise ValueError("NUL characters are not allowed")
        return self


class Policy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["manual", "chat_priority", "image_priority"]


class RecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed_no_image_worker: Literal[True]


JobStatus = Literal[
    "queued", "waiting_for_gpu", "running", "completed", "failed", "cancelled", "interrupted"
]


class AcceptedJob(BaseModel):
    job_id: str
    status: JobStatus


class BatchItem(BaseModel):
    index: int
    seed: int
    status: Literal["pending", "running", "completed", "failed", "cancelled", "interrupted"]
    asset_id: str | None = None
    error_message: str | None = None


class JobView(JobRequest):
    job_id: str
    status: JobStatus
    model_snapshot: dict
    items: list[BatchItem]
    output_asset_ids: list[str]
    cancel_requested: bool
    created_at: str
    started_at: str | None
    completed_at: str | None
    error_message: str | None
    retry_of: str | None


class AssetView(BaseModel):
    asset_id: str
    job_id: str
    namespace: Literal["rp", "nsfw", "pixel"]
    created_at: str
    archived_at: str | None
    file_url: str


PixelKind = Literal["unit", "building", "terrain", "decoration", "item", "ui", "effect"]


class PixelProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    art_bible: dict = Field(default_factory=dict)


class PixelProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    art_bible: dict | None = None


class PixelProjectView(BaseModel):
    project_id: str
    name: str
    art_bible: dict
    created_at: str
    updated_at: str


class PixelAssetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    kind: PixelKind
    source_asset_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-f0-9]+$")


class PixelProcessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width: int = Field(ge=16, le=2048, multiple_of=8)
    height: int = Field(ge=16, le=2048, multiple_of=8)
    palette_colors: int = Field(default=16, ge=2, le=256)
    remove_solid_background: bool = True
    trim: bool = True
    center: bool = True


class PixelVersionView(BaseModel):
    version_id: str
    asset_id: str
    operation: str
    details: dict
    created_at: str
    file_url: str


class PixelAssetView(BaseModel):
    asset_id: str
    project_id: str
    kind: PixelKind
    name: str
    source_asset_id: str
    status: Literal["draft", "approved"]
    approved_version_id: str | None
    created_at: str
    updated_at: str
    archived_at: str | None
    versions: list[PixelVersionView] = Field(default_factory=list)
