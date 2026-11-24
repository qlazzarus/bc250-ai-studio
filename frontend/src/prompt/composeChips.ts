/**
 * UCP05: the chip list as the screen shows it.
 *
 * The edit state stores three independent facts per chip — where it came from
 * (`auto`/`manual`), whether the user pinned it, and whether it was vetoed. The spec
 * requires them to be *distinguishable by text, not colour alone* (§3), so they are turned
 * into a label here instead of in JSX where each call site could word them differently.
 *
 * The label pairs are deliberately distinct words:
 *
 * - `자동` — the AI picked it, and a re-analysis may replace it;
 * - `직접` — the user picked it, so its source never silently becomes automatic;
 * - `고정` — it must survive the next AI pass (a separate axis from the source);
 * - `제외` — the user vetoed it, and it must not come back (`excluded`).
 *
 * An excluded chip is listed in its own group rather than mixed into the chosen ones: it
 * is not a selection, and showing it beside them would misrepresent the scene.
 */

import type { DictionaryEntry } from "./dictionary";
import type { EditSelection, StructuredScene } from "./structuredScene";

export type ChipView = {
  id: string;
  labelKo: string;
  /** Display group, e.g. `subject`. Kept for grouping the list. */
  group: string;
  source: "auto" | "manual" | "excluded";
  pinned: boolean;
  /** Human-readable state words, in reading order. Never empty. */
  badges: string[];
  /** Entity the chip is attributed to, or `null` for the whole scene. */
  entityId: string | null;
  /** Entity label for display (`인물 1`), or `null`. */
  entityLabel: string | null;
  /** The family's English rendering, when the dictionary has one. */
  rendering: string | null;
  /** `true` when the target family has no mapping for this entry. */
  unmapped: boolean;
};

const KIND_LABEL: Record<StructuredScene["entities"][number]["kind"], string> = {
  person: "인물",
  animal: "동물",
  object: "사물",
  place: "장소",
};

const SOURCE_BADGE: Record<EditSelection["source"], string> = {
  auto: "자동",
  manual: "직접",
  excluded: "제외",
};

/**
 * `인물 1`, `사물 2` — the same words the scene panel uses, indexed from 1 in scene order.
 *
 * An entity ID that the scene does not list yields `null` rather than the raw ID: an ID is
 * a fingerprint, not something to show a user.
 */
export function entityLabels(scene: StructuredScene): Map<string, string> {
  const labels = new Map<string, string>();
  const seen: Record<string, number> = {};
  for (const entity of scene.entities) {
    const kind = KIND_LABEL[entity.kind];
    const count = (seen[entity.kind] ?? 0) + 1;
    seen[entity.kind] = count;
    labels.set(entity.entityId, `${kind} ${count}`);
  }
  return labels;
}

/**
 * One chip's display record.
 *
 * `badges` always contains the source word, and adds `고정` only for a row that can
 * actually hold one — a veto has nothing to keep, which `setPinned` also enforces.
 */
export function chipView(
  item: EditSelection,
  dictionary: readonly DictionaryEntry[],
  family: string,
  labels: Map<string, string>,
): ChipView {
  const entry = dictionary.find((candidate) => candidate.id === item.id);
  const mapping = entry?.mappings[family as keyof DictionaryEntry["mappings"]];
  const badges = [SOURCE_BADGE[item.source]];
  if (item.source !== "excluded" && item.pinned) badges.push("고정");
  return {
    id: item.id,
    labelKo: entry?.labelKo ?? item.id,
    group: entry?.category ?? "other",
    source: item.source,
    pinned: item.source !== "excluded" && item.pinned,
    badges,
    entityId: item.entityId,
    entityLabel: item.entityId !== null ? labels.get(item.entityId) ?? null : null,
    rendering: mapping?.status === "mapped" ? mapping.text : null,
    unmapped: mapping === undefined || mapping.status !== "mapped",
  };
}

export type ChipList = {
  /** Chosen chips (auto + manual), in edit order. */
  chosen: ChipView[];
  /** Vetoed chips, kept visible so the veto has a visible undo. */
  excluded: ChipView[];
  auto: number;
  manual: number;
  pinned: number;
};

/**
 * UIX02: one heading's worth of chips, for the multi-person view.
 *
 * `key` is the entity ID, or `scene` for chips attributed to nothing. `label` is what the
 * heading says — `인물 1`, `인물 2`, `장면 전체`.
 */
export type ChipGroup = { key: string; label: string; chips: ChipView[] };

/**
 * Group chosen chips by attribution, **for display only**.
 *
 * Three properties this deliberately preserves:
 *
 * 1. **Edit order inside a group.** Chips are pushed in the order they appear in
 *    `chips.chosen`, which is `edit.selections` order, so removing a chip still moves focus
 *    to the neighbour the user just saw.
 * 2. **No reordering of the state.** The caller renders from this array; `edit.selections`
 *    is never touched, so `wireSelection` order and the request body are unchanged.
 * 3. **A single group for a single-subject scene.** With one entity there is nothing to
 *    disambiguate, and one heading above one list is noise — the flat list is returned with
 *    an empty label, which the caller renders without a heading.
 *
 * `entityCount` is the number of scene entities, not the number of distinct attributions:
 * a three-person scene where every chip says `장면 전체` still needs the whole-scene heading
 * to say so, and a one-person scene never needs headings even if a chip is unattributed.
 */
export function groupChips(
  chosen: readonly ChipView[],
  labels: Map<string, string>,
  entityCount: number,
): ChipGroup[] {
  if (entityCount <= 1) return [{ key: "scene", label: "", chips: [...chosen] }];
  const order: string[] = [];
  const buckets = new Map<string, ChipView[]>();
  for (const chip of chosen) {
    const key = chip.entityId ?? "scene";
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [chip]);
      order.push(key);
    } else {
      bucket.push(chip);
    }
  }
  return order.map((key) => ({
    key,
    // A scene-local ID is a fingerprint, not a label; an unknown one degrades to the
    // whole-scene wording rather than printing it.
    label: key === "scene" ? "장면 전체" : labels.get(key) ?? "대상",
    chips: buckets.get(key) ?? [],
  }));
}

export function chipList(
  edit: { selections: EditSelection[] },
  dictionary: readonly DictionaryEntry[],
  family: string,
  scene: StructuredScene,
): ChipList {
  const labels = entityLabels(scene);
  const views = edit.selections.map((item) => chipView(item, dictionary, family, labels));
  const chosen = views.filter((item) => item.source !== "excluded");
  return {
    chosen,
    excluded: views.filter((item) => item.source === "excluded"),
    auto: chosen.filter((item) => item.source === "auto").length,
    manual: chosen.filter((item) => item.source === "manual").length,
    pinned: chosen.filter((item) => item.pinned).length,
  };
}
