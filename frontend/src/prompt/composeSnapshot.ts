/**
 * UCP07: the v3 snapshot — what gets saved with a generation, and what a restore rebuilds.
 *
 * The rule the module enforces is the one the contract states twice: **only the last
 * applied state is recorded**, and it is never mixed with the edit in progress.
 *
 * - `toSnapshot` takes the *applied* record and the scene/target it was applied against.
 *   A session with no apply returns `null` — an un-applied composition is not a generation
 *   history, and saving it would let a restore claim an image was made from a scene the
 *   user never executed.
 * - `fromSnapshot` reads a stored record back into a session. It never invents an `applied`
 *   block from the visible fields: absence of `applied` means "no apply is recorded",
 *   which is a different state from "applied, but we forgot the prompt".
 *
 * A v1/v2 record restores as it was written. It is not upgraded: `schema_version` is part
 * of the fact being restored, and turning a v1 row into a v3 one would claim selections,
 * pins and a scene that the row never contained. `RestoredSnapshot.origin` carries that
 * distinction so the UI can say so instead of showing empty fields as if they were data.
 */

import type { AppliedResult, ComposeCandidate, ComposeTarget } from "./composeSession.ts";
import {
  EMPTY_SCENE, type ComposeEdit, type EditSelection, type StructuredScene,
} from "./structuredScene.ts";

/**
 * The version of the *client* that assembled a v3 snapshot.
 *
 * Deliberately its own constant rather than `DICTIONARY_VERSION`. They are different
 * facts: the dictionary version says which entries were offered, this one says which build
 * of this module decided how a scene, its chips and an apply are written down. Tying them
 * together would mean a change to the snapshot shape could not be recorded without also
 * claiming the dictionary changed.
 *
 * `1.3.0` is the version the UCP01 contract examples use for v3 snapshots.
 */
export const COMPOSE_COMPILER_VERSION = "1.3.0";

/** The names of the trim steps. Must match `TrimStep` in the backend schema. */
export const TRIM_STEPS = [
  "evidence_ko", "ambiguity_options", "attributes_first", "unmapped_text",
  "brief_2000", "environment", "arrays_2", "scene_dropped",
] as const;
export type TrimStep = (typeof TRIM_STEPS)[number];

export type SnapshotSelection = {
  id: string;
  source: EditSelection["source"];
  /** Required for `auto`/`manual`, absent for `excluded` (the backend refuses otherwise). */
  pinned?: boolean;
  entity_id?: string;
};

export type SnapshotApplied = {
  result_id: string;
  candidate_id: string;
  provider_model: string;
  applied_at: string;
  positive_prompt: string;
  negative_prompt?: string;
  summary_ko: string;
};

export type SceneV3 = {
  entities: {
    entity_id: string;
    kind: string;
    count: number;
    attributes_ko: string[];
    evidence_ko?: string;
  }[];
  relations: {
    subject_entity_id: string;
    predicate_ko: string;
    object_entity_id?: string | null;
    evidence_ko?: string;
  }[];
  environment: Record<string, string>;
  unmapped_details: { text_ko: string; entity_id?: string | null }[];
  ambiguities: { text_ko: string; why: string; options: string[] }[];
};

/** A v3 snapshot exactly as it goes on the wire. */
export type SnapshotV3 = {
  schema_version: 3;
  compiler_version: string;
  dictionary_version: string;
  target_model_id: string;
  target_family: string;
  profile_version: number;
  brief_ko: string;
  selections: SnapshotSelection[];
  scene: SceneV3;
  applied?: SnapshotApplied;
  snapshot_trim: TrimStep[];
};


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** The scene in the stored shape. Absent evidence stays absent, never `""`. */
export function sceneToV3(scene: StructuredScene): SceneV3 {
  return {
    entities: scene.entities.map((entity) => ({
      entity_id: entity.entityId,
      kind: entity.kind,
      count: entity.count,
      attributes_ko: [...entity.attributesKo],
      ...(entity.evidenceKo === null ? {} : { evidence_ko: entity.evidenceKo }),
    })),
    relations: scene.relations.map((relation) => ({
      subject_entity_id: relation.subjectEntityId,
      predicate_ko: relation.predicateKo,
      object_entity_id: relation.objectEntityId,
      ...(relation.evidenceKo === null ? {} : { evidence_ko: relation.evidenceKo }),
    })),
    environment: Object.fromEntries(
      Object.entries({
        location_ko: scene.environment.locationKo,
        time_ko: scene.environment.timeKo,
        lighting_ko: scene.environment.lightingKo,
        composition_ko: scene.environment.compositionKo,
        style_ko: scene.environment.styleKo,
        mood_ko: scene.environment.moodKo,
      }).filter(([, value]) => value !== null),
    ) as Record<string, string>,
    unmapped_details: scene.unmappedDetails.map((item) => ({
      text_ko: item.textKo,
      ...(item.entityId === null ? {} : { entity_id: item.entityId }),
    })),
    ambiguities: scene.ambiguities.map((item) => ({
      text_ko: item.textKo,
      why: item.why,
      options: [...item.options],
    })),
  };
}

/** The inverse of `sceneToV3`. Unknown enum values fall back rather than throwing. */
export function sceneFromV3(value: unknown): StructuredScene {
  if (!isRecord(value)) return EMPTY_SCENE;
  const kinds = ["person", "animal", "object", "place"] as const;
  const whys = ["actor_unknown", "polarity_conflict", "model_mismatch",
    "dictionary_missing"] as const;
  const list = (item: unknown): unknown[] => (Array.isArray(item) ? item : []);
  const strings = (item: unknown): string[] =>
    list(item).filter((entry): entry is string => typeof entry === "string");
  const env = isRecord(value.environment) ? value.environment : {};
  return {
    entities: list(value.entities).filter(isRecord).map((entity) => {
      const kind = kinds.find((candidate) => candidate === entity.kind) ?? "person";
      return {
        entityId: text(entity.entity_id),
        kind,
        count: typeof entity.count === "number" && entity.count >= 1
          ? Math.trunc(entity.count) : 1,
        attributesKo: strings(entity.attributes_ko),
        evidenceKo: optionalText(entity.evidence_ko) ?? null,
      };
    }),
    relations: list(value.relations).filter(isRecord).map((relation) => ({
      subjectEntityId: text(relation.subject_entity_id),
      predicateKo: text(relation.predicate_ko),
      objectEntityId: optionalText(relation.object_entity_id) ?? null,
      evidenceKo: optionalText(relation.evidence_ko) ?? null,
    })),
    environment: {
      locationKo: optionalText(env.location_ko) ?? null,
      timeKo: optionalText(env.time_ko) ?? null,
      lightingKo: optionalText(env.lighting_ko) ?? null,
      compositionKo: optionalText(env.composition_ko) ?? null,
      styleKo: optionalText(env.style_ko) ?? null,
      moodKo: optionalText(env.mood_ko) ?? null,
    },
    unmappedDetails: list(value.unmapped_details).filter(isRecord).map((item) => ({
      textKo: text(item.text_ko),
      entityId: optionalText(item.entity_id) ?? null,
    })),
    ambiguities: list(value.ambiguities).filter(isRecord).map((item) => ({
      textKo: text(item.text_ko),
      why: whys.find((candidate) => candidate === item.why) ?? "actor_unknown",
      options: strings(item.options),
    })),
  };
}

/** Everything `toSnapshot` needs, all of it already decided by the caller. */
export type SnapshotInput = {
  edit: ComposeEdit;
  scene: StructuredScene;
  applied: AppliedResult | null;
  target: ComposeTarget;
  compilerVersion: string;
  /** `warnings`/`sources` are not recordable facts, so they are not accepted here. */
};

/**
 * The last applied state, or `null` when nothing was applied.
 *
 * Three deliberate refusals:
 *
 * - **no applied record** → `null`. A snapshot is a generation history; an edit in
 *   progress has no generation behind it, and saving one would let a later restore
 *   present a scene as "what made this image" when it never ran.
 * - **applied for another family** → `null`. The record describes the other family's
 *   output profile, and the backend refuses a `target_family` mismatch (`422`), so
 *   building it here would only move the refusal to the network.
 * - **candidate applied then the brief edited** → still the *applied* text, but
 *   `brief_ko` is the current brief. The two are separate facts and both are recorded:
 *   the prompt is what ran, the brief is what the user now means. Merging them either way
 *   would falsify one of them.
 */
export function toSnapshot(input: SnapshotInput): SnapshotV3 | null {
  const { applied, target, edit } = input;
  if (applied === null) return null;
  if (edit.targetFamily && edit.targetFamily !== target.family) return null;
  const selections: SnapshotSelection[] = edit.selections.map((item) =>
    item.source === "excluded"
      // The backend rejects an excluded row carrying `pinned`/`entity_id`; sending the
      // row's stored values would be a 422 for a state the UI can legitimately reach.
      ? { id: item.id, source: "excluded" }
      : {
          id: item.id,
          source: item.source,
          pinned: item.pinned,
          ...(item.entityId === null ? {} : { entity_id: item.entityId }),
        });
  const snapshot: SnapshotV3 = {
    schema_version: 3,
    compiler_version: input.compilerVersion,
    dictionary_version: target.dictionaryVersion,
    target_model_id: target.modelId,
    target_family: target.family,
    profile_version: target.profileVersion,
    brief_ko: edit.briefKo,
    selections,
    scene: sceneToV3(input.scene),
    applied: {
      result_id: applied.resultId,
      candidate_id: applied.candidateId,
      provider_model: applied.providerModel,
      applied_at: applied.appliedAt,
      positive_prompt: applied.positivePrompt,
      ...(applied.negativePrompt === null
        ? {} : { negative_prompt: applied.negativePrompt }),
      summary_ko: applied.summaryKo,
    },
    // Filled by the server when it has to lower the record; empty on the way out.
    snapshot_trim: [],
  };
  return snapshot;
}



/**
 * A stored record read back into the state a screen can render.
 *
 * `origin` is the version that was actually stored, because the three versions record
 * different facts and a restore must not upgrade one into another:
 *
 * - `v3` carries the scene, the chips' sources and the apply record;
 * - `v2` adds accepted translations to v1 but still has no scene, no sources, no apply;
 * - `v1` is text + selections + draft only.
 *
 * `applied` is `null` for v1/v2 — not an empty object, and never reconstructed from
 * `draft_prompt`. The English a v1 row holds is a *draft*, which may differ from what was
 * executed; claiming it was applied would be an inference, and the contract forbids
 * exactly that.
 *
 * A record whose `selections[].entity_id` names an entity the stored scene does not have is
 * refused rather than repaired: the same rule the server applies. Restoring a dangling
 * attribution as "whole scene" would silently move an attribute from one person to nobody.
 */
export type RestoredSnapshot = {
  origin: 1 | 2 | 3;
  edit: ComposeEdit;
  scene: StructuredScene;
  applied: AppliedResult | null;
  snapshotTrim: TrimStep[];
  /** `true` when the server had to lower the record before storing it. */
  trimmed: boolean;
};

export type RestoreResult =
  | { ok: true; restored: RestoredSnapshot }
  | { ok: false; reason: "malformed" | "dangling_reference" | "unsupported_version";
      message: string };

const RESTORE_ERRORS = {
  malformed: "저장된 구성 기록의 형식이 올바르지 않습니다.",
  dangling_reference: "저장된 구성이 장면에 없는 대상을 가리킵니다. 기록을 신뢰할 수 없어 복원하지 않았습니다.",
  unsupported_version: "이 화면이 읽을 수 없는 구성 버전입니다.",
} as const;

const trimList = (value: unknown): TrimStep[] =>
  Array.isArray(value)
    ? value.filter((item): item is TrimStep =>
        typeof item === "string" && (TRIM_STEPS as readonly string[]).includes(item))
    : [];

export function fromSnapshot(value: unknown): RestoreResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "malformed", message: RESTORE_ERRORS.malformed };
  }
  const version = value.schema_version;
  if (version !== 1 && version !== 2 && version !== 3) {
    return { ok: false, reason: "unsupported_version",
      message: RESTORE_ERRORS.unsupported_version };
  }
  // v1/v2 predate the per-chip `source`, so every row is a chosen one. Reading them as
  // `manual` rather than `auto` is the conservative choice: a manual chip cannot be
  // replaced by a later reply, so a restored record cannot silently lose a user's pick.
  const legacySelections: EditSelection[] = Array.isArray(value.selections)
    ? value.selections.filter(isRecord).map((item) => ({
        id: text(item.id),
        source: "manual" as const,
        pinned: false,
        entityId: null,
      }))
    : [];
  if (version !== 3) {
    return { ok: true, restored: {
      origin: version,
      edit: {
        briefKo: text(value.free_text_ko),
        selections: legacySelections,
        choices: [],
        targetModelId: "",
        targetFamily: text(value.target_family),
        profileVersion: 0,
        dictionaryVersion: "",
      },
      scene: EMPTY_SCENE,
      applied: null,
      snapshotTrim: [],
      trimmed: false,
    } };
  }
  const scene = sceneFromV3(value.scene);
  const known = new Set(scene.entities.map((entity) => entity.entityId));
  const selections: EditSelection[] = [];
  for (const item of Array.isArray(value.selections) ? value.selections : []) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) {
      return { ok: false, reason: "malformed", message: RESTORE_ERRORS.malformed };
    }
    const source = item.source;
    if (source !== "auto" && source !== "manual" && source !== "excluded") {
      return { ok: false, reason: "malformed", message: RESTORE_ERRORS.malformed };
    }
    const entityId = optionalText(item.entity_id) ?? null;
    if (entityId !== null && !known.has(entityId)) {
      return { ok: false, reason: "dangling_reference",
        message: RESTORE_ERRORS.dangling_reference };
    }
    selections.push({
      id: item.id,
      source,
      // An excluded row's `pinned` is not stored, and must not be invented as `true`.
      pinned: source === "excluded" ? false : item.pinned === true,
      entityId: source === "excluded" ? null : entityId,
    });
  }
  const rawApplied = isRecord(value.applied) ? value.applied : null;
  const applied: AppliedResult | null = rawApplied === null ? null : {
    resultId: text(rawApplied.result_id),
    candidateId: text(rawApplied.candidate_id),
    providerModel: text(rawApplied.provider_model),
    appliedAt: text(rawApplied.applied_at),
    positivePrompt: text(rawApplied.positive_prompt),
    negativePrompt: optionalText(rawApplied.negative_prompt) ?? null,
    summaryKo: text(rawApplied.summary_ko),
  };
  const snapshotTrim = trimList(value.snapshot_trim);
  return { ok: true, restored: {
    origin: 3,
    edit: {
      briefKo: text(value.brief_ko),
      selections,
      choices: [],
      targetModelId: text(value.target_model_id),
      targetFamily: text(value.target_family),
      profileVersion: typeof value.profile_version === "number"
        ? value.profile_version : 0,
      dictionaryVersion: text(value.dictionary_version),
    },
    scene,
    applied,
    snapshotTrim,
    trimmed: snapshotTrim.length > 0,
  } };
}

/**
 * §5's "a restored historical candidate must not become applicable again".
 *
 * A restore rebuilds the *record*, not a live reply, and the record never contained
 * candidates: the snapshot stores the *applied* prompt, not the three options the user
 * chose between. A candidate generated against an older dictionary, profile or model can
 * become applicable only by being re-validated against the current target — which is a new
 * compose call, not a restore. Offering the old ones again would present a button whose
 * prompt may name a chip the current dictionary no longer has.
 *
 * The field exists (always empty) rather than the function existing, so the guarantee is
 * something a test and the component read, not a comment to be trusted.
 */
export const RESTORED_CANDIDATES: readonly ComposeCandidate[] = [];

/**
 * What a restored record cannot tell the screen, per version.
 *
 * Kept as data rather than sprinkled through the component: the sentences are the
 * user-visible consequence of the record's shape, and a test asserts both the list and the
 * fact that it is *empty* for a complete v3 record with no trimming.
 */
export function restoreGaps(restored: RestoredSnapshot): string[] {
  const gaps: string[] = [];
  if (restored.origin === 1 || restored.origin === 2) {
    gaps.push("이 기록에는 장면 구조와 선택 출처가 없습니다. 선택 목록은 수동 선택으로 복원됩니다.");
  }
  if (restored.origin !== 3 || restored.applied === null) {
    gaps.push("이 기록에는 후보 적용 이력이 없습니다. 최종 프롬프트는 기록에서 역산하지 않습니다.");
  }
  if (restored.trimmed) {
    gaps.push(`저장할 때 크기 제한으로 일부가 축소되었습니다(${restored.snapshotTrim.join(", ")}). 축소된 값은 원래 있었는지 알 수 없습니다.`);
  }
  return gaps;
}
