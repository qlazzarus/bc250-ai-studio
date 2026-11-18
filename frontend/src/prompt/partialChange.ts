import { GROUP_ORDER, groupOf } from "./presentation.ts";
import { blockReason, type CardSummary } from "./proposalCards.ts";
import type { SceneSpecification } from "./scene";

/**
 * LLM-I06: partial change ("조명만 변경").
 *
 * A partial change is not a new request type in the reply — it is the same reply
 * judged against a *scope*. The scope has two halves and both are derived here, not
 * typed by the user:
 *
 * - `targetGroups` - the display groups the model may change (C01-2 `target_groups`).
 * - `lockedIds`   - every current selection *outside* those groups. The user never
 *                   lists IDs; locking the untouched values is the whole point of the
 *                   request, so it is computed from the scene that is on screen.
 *
 * The lock is a **setting lock**: it keeps the chosen values, it does not guarantee
 * that two generations depict the same person. Every sentence shown to the user says
 * so (`LOCK_NOTE`), because the opposite claim would be a promise this code cannot keep.
 *
 * Pure module: no React, no fetch. It returns decisions; the component applies them
 * through the existing `selectEntry`/`compileScene` path.
 */

export type PartialScope = {
  /** Ordered by `GROUP_ORDER`, so two equal scopes are equal value-by-value. */
  targetGroups: string[];
  /** Selection IDs in scene order that this request must not change. */
  lockedIds: string[];
};

export const EMPTY_SCOPE: PartialScope = { targetGroups: [], lockedIds: [] };

/** The scope of a request, derived from the scene and the group the user picked. */
export function partialScope(scene: SceneSpecification, targetGroups: string[]): PartialScope {
  const wanted = new Set(targetGroups.filter((group) => GROUP_ORDER.includes(group)));
  // An unknown group must not turn into "nothing is locked": that would silently
  // allow the model to rewrite the whole scene. Unknown groups are dropped here and
  // `proposalBody` refuses the request when nothing usable is left.
  if (wanted.size === 0) return EMPTY_SCOPE;
  return {
    targetGroups: GROUP_ORDER.filter((group) => wanted.has(group)),
    lockedIds: scene.selections
      .filter((item) => !wanted.has(groupOf(item.category)))
      .map((item) => item.id),
  };
}

/** `false` means "a full scene cleanup", i.e. the LLM-I04 `selection_hint` request. */
export function scopeIsActive(scope: PartialScope): boolean {
  return scope.targetGroups.length > 0;
}

/** One line for the request area: "조명만 변경 · 고정 2개". */
export function describeScope(scope: PartialScope, labelOf: (group: string) => string): string {
  if (!scopeIsActive(scope)) return "전체 장면";
  const groups = scope.targetGroups.map(labelOf).join("·");
  return `${groups}만 변경 · 고정 ${scope.lockedIds.length}개`;
}

export const LOCK_NOTE =
  "고정은 선택 값의 유지를 뜻하며 생성 이미지의 동일 인물을 보장하지 않습니다.";

export type DiffRow = {
  key: string;
  kind: "kept" | "change" | "blocked";
  labelKo: string;
  note: string;
};

export type PartialDiff = {
  rows: DiffRow[];
  kept: number;
  changes: number;
  blocked: number;
  /** True when accepting everything acceptable would leave the selection as it is. */
  noChange: boolean;
  note: string;
};

/**
 * What accepting this reply would do to the selection, before the user clicks.
 *
 * The three rows answer what a diff has to answer: what stays (the locked values and
 * the items already chosen), what is added, and what cannot be taken. A blocked card
 * is listed with the same sentence the card shows, so the panel cannot contradict
 * itself. Nothing here mutates a scene.
 */
export function partialDiff(input: {
  cards: CardSummary;
  scene: SceneSpecification;
  scope: PartialScope;
}): PartialDiff {
  const { cards, scene, scope } = input;
  const locked = new Set(scope.lockedIds);
  const rows: DiffRow[] = [];
  const listed = new Set<string>();

  for (const item of scene.selections) {
    if (!locked.has(item.id)) continue;
    listed.add(item.id);
    rows.push({ key: `kept:${item.id}`, kind: "kept", labelKo: item.labelKo, note: "고정" });
  }

  for (const card of cards.cards) {
    if (card.id === null) continue;
    const block = card.blocks[0];
    if (block === "already_selected") {
      // Already in the scene: the acceptance changes nothing, so it is not a change.
      if (listed.has(card.id)) continue;
      listed.add(card.id);
      rows.push({ key: `kept:${card.id}`, kind: "kept", labelKo: card.labelKo, note: blockReason(block) });
      continue;
    }
    if (block !== undefined) {
      rows.push({ key: `blocked:${card.key}`, kind: "blocked", labelKo: card.labelKo, note: blockReason(block) });
      continue;
    }
    listed.add(card.id);
    rows.push({
      key: `change:${card.key}`, kind: "change", labelKo: card.labelKo,
      // An inferred card is acceptable, just never part of the batch (C01-3).
      note: card.batchEligible ? "추가" : "추가 · 개별 확인",
    });
  }

  const count = (kind: DiffRow["kind"]) => rows.filter((row) => row.kind === kind).length;
  return {
    rows,
    kept: count("kept"),
    changes: count("change"),
    blocked: count("blocked"),
    noChange: count("change") === 0,
    note: LOCK_NOTE,
  };
}
