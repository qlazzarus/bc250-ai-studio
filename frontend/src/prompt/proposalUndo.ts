import { sameRevisions, type ProposalRevisions } from "./llmProposals.ts";
import type { SceneSpecification } from "./scene";

/**
 * LLM-I06: one-step undo of a proposal acceptance.
 *
 * The scope is deliberately narrow: undo removes **only the ids this acceptance
 * added**. It is not a scene history, so:
 *
 * - IDs the user selected by hand after the acceptance are untouched.
 * - IDs that were already selected before the acceptance are untouched.
 * - If anything else changed the scene since then, the record no longer describes
 *   what the user sees, so the undo is refused instead of guessing (`undoBlocked`).
 *
 * The refusal is decided by revisions, not by timestamps: `revisionsFor` changes when
 * the text, the family or the selection changes, so a text edit or a chip removal
 * after the acceptance blocks the undo rather than silently reverting a *different*
 * scene. Removing one of the accepted chips is fine — that only makes the undo a
 * no-op for that id.
 */

export type AcceptRecord = {
  /** IDs this acceptance added, in the order they were applied. */
  ids: string[];
  /** Labels for the button text; never used to decide anything. */
  labels: string[];
  /** The fingerprint of the scene *after* the acceptance. */
  revisions: ProposalRevisions;
};

export type UndoBlock = "no_record" | "scene_changed" | "already_undone";

export type UndoStatus =
  | { allowed: true; ids: string[]; label: string }
  | { allowed: false; why: UndoBlock; text: string };

const BLOCK_TEXT: Record<UndoBlock, string> = {
  no_record: "되돌릴 제안 수락이 없습니다",
  scene_changed: "수락 이후 선택이나 원문이 바뀌어 되돌릴 수 없습니다. 필요한 항목만 직접 해제하세요",
  already_undone: "이미 되돌렸습니다",
};

export function recordAcceptance(input: {
  ids: string[];
  labels: string[];
  /** Selection IDs before the acceptance. */
  previousIds: string[];
  revisions: ProposalRevisions;
}): AcceptRecord {
  const added = input.ids.filter((id) => !input.previousIds.includes(id));
  return {
    ids: added,
    labels: input.labels.slice(0, added.length),
    revisions: input.revisions,
  };
}

/**
 * Whether the one-step undo may run now.
 *
 * `revisions` is the fingerprint of the *current* scene. An acceptance that added
 * nothing cannot be undone (there is nothing to remove), and one whose fingerprint no
 * longer matches the screen is refused: the scene moved on, so a blind removal could
 * take away something the user added afterwards.
 */
export function undoStatus(
  record: AcceptRecord | null,
  scene: SceneSpecification,
  revisions: ProposalRevisions,
): UndoStatus {
  if (record === null || record.ids.length === 0) {
    return { allowed: false, why: "no_record", text: BLOCK_TEXT.no_record };
  }
  const present = new Set(scene.selections.map((item) => item.id));
  const remaining = record.ids.filter((id) => present.has(id));
  if (remaining.length === 0) {
    return { allowed: false, why: "already_undone", text: BLOCK_TEXT.already_undone };
  }
  if (!sameRevisions(record.revisions, revisions)) {
    return { allowed: false, why: "scene_changed", text: BLOCK_TEXT.scene_changed };
  }
  const label = remaining.length === 1
    ? `“${record.labels[record.ids.indexOf(remaining[0])] ?? remaining[0]}” 추가 되돌리기`
    : `방금 추가한 ${remaining.length}개 되돌리기`;
  return { allowed: true, ids: remaining, label };
}

/**
 * The undo itself: the current scene with the accepted IDs removed. Only ever removes
 * `ids` that this record added, so a chip the user picked by hand survives.
 */
export function undoScene(scene: SceneSpecification, record: AcceptRecord): SceneSpecification {
  const remove = new Set(record.ids);
  return { ...scene, selections: scene.selections.filter((item) => !remove.has(item.id)) };
}
