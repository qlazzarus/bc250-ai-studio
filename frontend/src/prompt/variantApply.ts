import type { DictionaryEntry } from "./dictionary.ts";
import { revisionsFor, sameRevisions, type ProposalRevisions } from "./llmProposals.ts";
import { removeEntry, selectEntry, type SceneSpecification } from "./scene.ts";
import type { VariantCard } from "./situationVariants.ts";

/**
 * VAR02: turning a chosen situation candidate into a scene edit.
 *
 * VAR01 only rendered candidates; this module is the single place where one becomes
 * a selection change. It stays pure and narrow:
 *
 * - The composer still calls `selectEntry`/`removeEntry`, so a candidate cannot
 *   produce a scene the picker could not produce.
 * - The *final prompt* is never touched here. A candidate only changes the selection,
 *   and the composer regenerates the draft through the existing `withGeneratedDraft`
 *   path. Applying to the final prompt stays an explicit "적용" step.
 * - Undo restores the exact scene the candidate was applied to, not "the ids this
 *   click added": a candidate also *removes* place/action values, and re-adding them
 *   by id would lose their recorded expression.
 *
 * Nothing is persisted: the old candidate is discarded as soon as the text or the
 * selection changes (the reply's revisions stop matching), exactly like a card.
 */

export type VariantApply = {
  scene: SceneSpecification;
  /** Ids this candidate added, in candidate order. Shown in the notice only. */
  addedIds: string[];
  /** Ids this candidate removed, in candidate order. Shown in the notice only. */
  removedIds: string[];
};

/**
 * The scene a candidate describes, or `null` when it cannot be applied.
 *
 * A blocked card is refused here as well as in the DOM: the panel is rebuilt from the
 * current selection, but a click can race a render, and a locked or out-of-scope value
 * must never reach the scene.
 */
export function applyVariantScene(input: {
  scene: SceneSpecification;
  card: VariantCard;
  dictionary: DictionaryEntry[];
  dictionaryVersion: string;
}): VariantApply | null {
  const { scene, card, dictionary, dictionaryVersion } = input;
  if (card.blocks.length > 0) return null;
  const byId = new Map(dictionary.map((entry) => [entry.id, entry]));
  const selected = new Set(scene.selections.map((item) => item.id));
  const addedIds: string[] = [];
  const removedIds: string[] = [];
  let next = scene;
  for (const change of card.changes) {
    const entry = byId.get(change.id);
    if (!entry || !entry.active) return null;
    if (change.direction === "add") {
      // A duplicate would be a no-op scene edit: refuse instead of reporting success.
      if (selected.has(change.id)) return null;
      selected.add(change.id);
      next = selectEntry(next, entry, dictionaryVersion);
      addedIds.push(change.id);
    } else {
      if (!selected.has(change.id)) return null;
      selected.delete(change.id);
      next = removeEntry(next, change.id);
      removedIds.push(change.id);
    }
  }
  if (addedIds.length === 0 && removedIds.length === 0) return null;
  return { scene: next, addedIds, removedIds };
}

export type VariantApplyRecord = {
  /** Card key, so the panel can mark the card that produced this scene. */
  key: string;
  variantId: string;
  labelKo: string;
  /** The exact scene before the apply. Undo restores this, not a re-selection. */
  before: SceneSpecification;
  /** Fingerprint of the scene the candidate produced. */
  after: ProposalRevisions;
};

export type VariantUndoBlock = "no_record" | "scene_changed" | "already_undone";

export type VariantUndoStatus =
  | { allowed: true; label: string }
  | { allowed: false; why: VariantUndoBlock; text: string };

const BLOCK_TEXT: Record<VariantUndoBlock, string> = {
  no_record: "되돌릴 상황 적용이 없습니다",
  scene_changed: "상황을 적용한 뒤 선택이나 원문이 바뀌어 되돌릴 수 없습니다. 필요한 항목만 직접 해제하세요",
  already_undone: "이미 되돌렸습니다",
};

/** Records which card produced the current scene, and the scene to go back to. */
export function recordVariantApply(input: {
  key: string;
  variantId: string;
  labelKo: string;
  before: SceneSpecification;
  after: SceneSpecification;
}): VariantApplyRecord {
  return {
    key: input.key,
    variantId: input.variantId,
    labelKo: input.labelKo,
    before: input.before,
    after: revisionsFor(input.after),
  };
}

/**
 * Whether the one-step undo may run now. The fingerprint decides, not a timer: an
 * edit after the apply means the record no longer describes the screen, so the undo is
 * refused rather than overwriting work it did not create.
 */
export function variantUndoStatus(
  record: VariantApplyRecord | null,
  currentRevisions: ProposalRevisions,
): VariantUndoStatus {
  if (record === null) return { allowed: false, why: "no_record", text: BLOCK_TEXT.no_record };
  if (sameRevisions(record.after, currentRevisions)) {
    return { allowed: true, label: `“${record.labelKo}” 상황 적용 되돌리기` };
  }
  if (sameRevisions(revisionsFor(record.before), currentRevisions)) {
    return { allowed: false, why: "already_undone", text: BLOCK_TEXT.already_undone };
  }
  return { allowed: false, why: "scene_changed", text: BLOCK_TEXT.scene_changed };
}

/** The scene the candidate was applied to, byte for byte. */
export function undoVariantScene(record: VariantApplyRecord): SceneSpecification {
  return record.before;
}
