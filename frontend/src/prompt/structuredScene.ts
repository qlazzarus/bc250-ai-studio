/**
 * UCP02: the structured scene and the user's edit state.
 *
 * Two things are kept apart on purpose, because they come from different authorities:
 *
 * 1. **The scene** is what the server derived from the brief: entities, relations,
 *    environment, unmapped details, ambiguities. The client parses and checks it but
 *    never invents or edits it — one bad field means the whole reply is rejected.
 * 2. **The edit state** is what the *user* decided: which dictionary chips are
 *    selected, which were picked by hand, which are pinned, which are excluded. This
 *    is the only place `source`/`pinned`/`excluded` exist, and the server re-judges it
 *    from the request (UCP01 §4) rather than trusting it blindly.
 *
 * The partition matters for the exclusion rule: a deleted automatic chip must not
 * come back, so "excluded" is a *user* fact and must survive every AI reply. If it
 * lived in the parsed scene, each new reply would silently wipe it.
 */

import type { DictionaryEntry } from "./dictionary";
import { matchOccurrences, polarityAt } from "./matching.ts";

/** Where a chip came from. `excluded` is not a selected chip; it is a veto. */
export type SelectionSource = "auto" | "manual" | "excluded";

/** A veto the current brief contradicts. See `exclusionClashes`. */
export type ExclusionClash = { id: string; phrase: string };

/**
 * One entry of the edit state. Includes excluded IDs: they are the record that stops
 * re-selection, so dropping them here would be the same as forgetting the user's veto.
 *
 * `pinned` is present-but-ignored for `excluded` (an excluded chip has nothing to
 * keep). Keeping the field one shape lets the UI map over a single array without
 * branching on every property access; `normalizedSelections` removes it on the wire.
 */
export type EditSelection = {
  id: string;
  source: SelectionSource;
  /** Honoured only for `auto`/`manual`. Always false when `source` is `excluded`. */
  pinned: boolean;
  /** Scene-local entity ID this chip is attributed to, or `null` for whole-scene. */
  entityId: string | null;
};

export type ClarificationAnswer = { questionId: string; optionId: string };

/**
 * The complete input state of one composition session.
 *
 * `targetModelId`/`profileVersion` are part of the state, not of a request object: a
 * model change must invalidate in-flight and displayed candidates, so the values have
 * to be comparable across time.
 */
export type ComposeEdit = {
  briefKo: string;
  selections: EditSelection[];
  choices: ClarificationAnswer[];
  targetModelId: string;
  targetFamily: string;
  profileVersion: number;
  dictionaryVersion: string;
};

export const EMPTY_EDIT: ComposeEdit = {
  briefKo: "",
  selections: [],
  choices: [],
  targetModelId: "",
  targetFamily: "",
  profileVersion: 0,
  dictionaryVersion: "",
};

/** UCP01 §4 semantic caps. Characters, never bytes — the byte gate is the snapshot's. */
export const MAX_BRIEF_CHARS = 4000;
export const MAX_SELECTIONS = 100;
export const MAX_CHOICES = 8;

const find = (edit: ComposeEdit, id: string): EditSelection | undefined =>
  edit.selections.find((item) => item.id === id);

/**
 * Set or remove one row.
 *
 * An id that is not present yet is *appended* rather than ignored: `addManual` and
 * `removeSelection` both route through here, and a chip the user just picked must not
 * vanish because the row did not exist before.
 */
const replace = (edit: ComposeEdit, id: string, next: EditSelection | null): ComposeEdit => {
  if (next === null) {
    return { ...edit, selections: edit.selections.filter((item) => item.id !== id) };
  }
  const exists = edit.selections.some((item) => item.id === id);
  return {
    ...edit,
    selections: exists
      ? edit.selections.map((item) => (item.id === id ? next : item))
      : [...edit.selections, next],
  };
};


/**
 * A hand-picked chip. `source: "manual"` is sticky: `unpin` changes only `pinned`, so
 * "I chose this and later let AI replace it" is representable but a manual chip can
 * never silently become `auto` (UCP01 fix D).
 */
export function addManual(edit: ComposeEdit, input: {
  id: string; entityId?: string | null; pinned?: boolean;
}): ComposeEdit {
  const existing = find(edit, input.id);
  // Re-picking an excluded chip is an explicit undo of the veto, not a duplicate: the
  // user is saying "yes, this one". Keeping the veto would make the click a no-op.
  const next: EditSelection = {
    id: input.id,
    source: "manual",
    pinned: input.pinned ?? existing?.pinned ?? false,
    entityId: input.entityId ?? existing?.entityId ?? null,
  };
  return replace(edit, input.id, next);
}

/**
 * Removing a chip. What remains behind decides whether it can come back:
 *
 * - a `manual` chip leaves nothing — it was the user's pick, so there is no auto
 *   choice to suppress;
 * - an `auto` chip becomes `excluded`, which is the only thing that stops the next
 *   reply from re-adding it (UCP01 §4, spec 4절 선택 우선순위).
 *
 * The distinction is the whole point: turning every removal into an exclusion would
 * make re-analysis unable to ever change the automatic part of the scene.
 */
export function removeSelection(edit: ComposeEdit, id: string): ComposeEdit {
  const existing = find(edit, id);
  if (existing === undefined) return edit;
  if (existing.source === "auto") {
    return replace(edit, id, { id, source: "excluded", pinned: false, entityId: null });
  }
  return replace(edit, id, null);
}

/** Undo a veto. Removing the row entirely is what lets the next reply choose it again. */
export function clearExclusion(edit: ComposeEdit, id: string): ComposeEdit {
  const existing = find(edit, id);
  return existing?.source === "excluded" ? replace(edit, id, null) : edit;
}

/**
 * Pin/unpin. An excluded row is untouched: pinning a veto is meaningless and would
 * change what the payload claims the user decided.
 */
export function setPinned(edit: ComposeEdit, id: string, pinned: boolean): ComposeEdit {
  const existing = find(edit, id);
  if (existing === undefined || existing.source === "excluded") return edit;
  return replace(edit, id, { ...existing, pinned });
}

/**
 * Attribute a chip to an entity. Only `auto`/`manual` rows can be attributed; an
 * excluded row carries no meaning to attribute.
 */
export function attributeTo(edit: ComposeEdit, id: string, entityId: string | null): ComposeEdit {
  const existing = find(edit, id);
  if (existing === undefined || existing.source === "excluded") return edit;
  return replace(edit, id, { ...existing, entityId });
}

/** Plain text and a chosen chip both count; `excluded` alone does not. */
export function hasComposeInput(edit: ComposeEdit): boolean {
  return edit.briefKo.trim().length > 0
    || edit.selections.some((item) => item.source !== "excluded");
}

export const chosenSelections = (edit: ComposeEdit): EditSelection[] =>
  edit.selections.filter((item) => item.source !== "excluded");

export const excludedIds = (edit: ComposeEdit): string[] =>
  edit.selections.filter((item) => item.source === "excluded").map((item) => item.id);

/**
 * The exclusion a *new* brief may contradict (UCP02 required case 4).
 *
 * A veto is a statement about a phrase the earlier brief contained. If the user's
 * text now names the excluded concept again, keeping the veto would silently drop
 * something the user just asked for. This reports the clash instead of resolving it:
 * the spec forbids quietly dropping either side.
 */
export function exclusionClashes(
  edit: ComposeEdit,
  dictionary: DictionaryEntry[],
): ExclusionClash[] {
  const text = edit.briefKo.toLocaleLowerCase("ko");
  if (!text) return [];
  const clashes: ExclusionClash[] = [];
  for (const id of excludedIds(edit)) {
    const entry = dictionary.find((item) => item.id === id);
    if (entry === undefined) continue;
    for (const phrase of [entry.labelKo, ...entry.aliases]) {
      if (!phrase) continue;
      // Negated mentions are the veto itself being restated (`네온 없이`), not a clash.
      const hit = matchOccurrences(text, phrase, "label")
        .some((occurrence) => polarityAt(text, occurrence.end) === "affirmed");
      if (hit) {
        clashes.push({ id, phrase });
        break;
      }
    }
  }
  return clashes;
}

/**
 * How to resolve a clash. Listed, not applied: the spec requires the user to choose,
 * because either answer discards something the user said.
 */
export const CLASH_RESOLUTIONS = [
  { value: "drop_exclusion", labelKo: "제외 해제" },
  { value: "drop_mention", labelKo: "원문에서 지우기" },
] as const;
export type ClashResolution = (typeof CLASH_RESOLUTIONS)[number]["value"];

/**
 * One subject of the scene. `entityId` is scene-local — relations and attributions
 * point at it, and it is never a dictionary ID (UCP01 §6). Nothing here is editable by
 * the client: it is the server's reading of the brief, shown as-is.
 */
export type SceneEntity = {
  entityId: string;
  kind: "person" | "animal" | "object" | "place";
  count: number;
  attributesKo: string[];
  /** Absent when the trim ladder dropped it — absent, not empty (UCP01 fix B). */
  evidenceKo: string | null;
};

export type SceneRelation = {
  subjectEntityId: string;
  predicateKo: string;
  objectEntityId: string | null;
  evidenceKo: string | null;
};

/** The six keys are independent: a scene may name a mood and no location. */
export type SceneEnvironment = {
  locationKo: string | null;
  timeKo: string | null;
  lightingKo: string | null;
  compositionKo: string | null;
  styleKo: string | null;
  moodKo: string | null;
};

export type SceneUnmapped = { textKo: string; entityId: string | null };

export type SceneAmbiguity = {
  textKo: string;
  why: "actor_unknown" | "polarity_conflict" | "model_mismatch" | "dictionary_missing";
  /** Entity IDs. Empty after trimming, which is why the trim list is checked. */
  options: string[];
};

export type StructuredScene = {
  entities: SceneEntity[];
  relations: SceneRelation[];
  environment: SceneEnvironment;
  unmappedDetails: SceneUnmapped[];
  ambiguities: SceneAmbiguity[];
};

export const EMPTY_SCENE: StructuredScene = {
  entities: [], relations: [],
  environment: { locationKo: null, timeKo: null, lightingKo: null,
    compositionKo: null, styleKo: null, moodKo: null },
  unmappedDetails: [], ambiguities: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalStr = (value: unknown): string | null =>
  (typeof value === "string" ? value : null);

const WHYS = ["actor_unknown", "polarity_conflict", "model_mismatch", "dictionary_missing"] as const;
const KINDS = ["person", "animal", "object", "place"] as const;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * Parse a scene and report a reason instead of throwing.
 *
 * A malformed scene makes the whole reply unusable: keeping half of it would show the
 * user a scene the server never claimed. Referential integrity is checked here for the
 * same reason it is checked on the server — a relation naming a missing entity would
 * otherwise render as an unattributed sentence.
 */
export function parseScene(value: unknown): { scene: StructuredScene } | { error: string } {
  if (!isRecord(value)) return { error: "장면 형식이 올바르지 않습니다." };
  const entities: SceneEntity[] = [];
  for (const item of list(value.entities)) {
    if (!isRecord(item) || typeof item.entity_id !== "string" || !item.entity_id) {
      return { error: "장면 대상에 ID가 없습니다." };
    }
    entities.push({
      entityId: item.entity_id,
      kind: oneOf(item.kind, KINDS, "person"),
      count: typeof item.count === "number" && item.count >= 1 ? Math.trunc(item.count) : 1,
      attributesKo: list(item.attributes_ko)
        .filter((text): text is string => typeof text === "string"),
      evidenceKo: optionalStr(item.evidence_ko),
    });
  }
  const ids = new Set(entities.map((item) => item.entityId));
  if (ids.size !== entities.length) return { error: "장면 대상 ID가 중복되었습니다." };
  const relations: SceneRelation[] = [];
  for (const item of list(value.relations)) {
    if (!isRecord(item) || typeof item.subject_entity_id !== "string") {
      return { error: "장면 관계에 주체가 없습니다." };
    }
    const object = optionalStr(item.object_entity_id);
    if (!ids.has(item.subject_entity_id) || (object !== null && !ids.has(object))) {
      return { error: "장면 관계가 없는 대상을 가리킵니다." };
    }
    relations.push({ subjectEntityId: item.subject_entity_id,
      predicateKo: str(item.predicate_ko), objectEntityId: object,
      evidenceKo: optionalStr(item.evidence_ko) });
  }
  const unmappedDetails: SceneUnmapped[] = [];
  for (const item of list(value.unmapped_details)) {
    if (!isRecord(item) || typeof item.text_ko !== "string" || !item.text_ko) {
      return { error: "장면 미변환 항목이 올바르지 않습니다." };
    }
    const entityId = optionalStr(item.entity_id);
    if (entityId !== null && !ids.has(entityId)) {
      return { error: "장면 미변환 항목이 없는 대상을 가리킵니다." };
    }
    unmappedDetails.push({ textKo: item.text_ko, entityId });
  }
  const ambiguities: SceneAmbiguity[] = [];
  for (const item of list(value.ambiguities)) {
    if (!isRecord(item) || typeof item.text_ko !== "string" || !item.text_ko) {
      return { error: "장면 모호성 항목이 올바르지 않습니다." };
    }
    const options = list(item.options)
      .filter((option): option is string => typeof option === "string");
    if (options.some((option) => !ids.has(option))) {
      return { error: "장면 선택지가 없는 대상을 가리킵니다." };
    }
    ambiguities.push({ textKo: item.text_ko,
      why: oneOf(item.why, WHYS, "actor_unknown"), options });
  }
  const env = isRecord(value.environment) ? value.environment : {};
  return { scene: {
    entities, relations,
    environment: {
      locationKo: optionalStr(env.location_ko), timeKo: optionalStr(env.time_ko),
      lightingKo: optionalStr(env.lighting_ko), compositionKo: optionalStr(env.composition_ko),
      styleKo: optionalStr(env.style_ko), moodKo: optionalStr(env.mood_ko),
    },
    unmappedDetails, ambiguities,
  } };
}


