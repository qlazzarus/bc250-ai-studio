/**
 * UCP05: applying a candidate, and the rules that keep it from happening by accident.
 *
 * The central requirement is that **displaying results and applying them are separate
 * actions**. A compose reply shows candidates; it never touches the final prompt. Only an
 * explicit press of one candidate's apply button writes the prompt, and that press goes
 * through `planApply` first.
 *
 * `planApply` returns a *decision*, not a side effect, so the reason a press was refused
 * is data the component can show and a test can assert. Four refusals matter:
 *
 * - **expired** — the target model/profile changed, so the candidate describes another
 *   model. This is the re-validation the user asked for on model change: it is checked
 *   against the *current* target at press time, not trusted from when the reply arrived.
 * - **stale** — the user edited the brief or the chips. The candidate is not wrong, but it
 *   answers an older sentence, so applying it silently would lose the edit.
 * - **blocked** — clarification is unresolved. §4 forbids applying before an answer.
 * - **negative lost** — the candidate had a negative prompt and this model cannot take
 *   one. Applying anyway would drop it, so the plan says so and the user decides.
 *
 * Overwrite protection is the last check on purpose: it is the only refusal the user can
 * override, so it must not hide a harder one behind a confirm dialog.
 */

import {
  sameRevisions, sameTarget,
  type ComposeCandidate, type ComposeRevisions, type ComposeState, type ComposeTarget,
} from "./composeSession.ts";

export type ApplyBlock =
  | "no_candidate"
  | "expired"
  | "stale"
  | "blocked"
  | "negative_lost";

export type ApplyPlan =
  | {
      ok: true;
      candidateId: string;
      positivePrompt: string;
      negativePrompt: string | null;
      /** `true` when the final prompt holds text the user typed or restored. */
      needsConfirm: boolean;
      confirmMessage: string | null;
      /** Set when the candidate's negative prompt was knowingly discarded. */
      lossKo: string | null;
      /** The value written when `needsConfirm` is accepted. */
      summaryKo: string;
    }
  | { ok: false; block: ApplyBlock; message: string };

export const APPLY_BLOCK_COPY: Record<ApplyBlock, string> = {
  no_candidate: "적용할 후보를 찾지 못했습니다. 다시 생성하세요.",
  expired: "모델이나 출력 프로필이 바뀌어 이 후보를 적용할 수 없습니다. 다시 생성하세요.",
  stale: "원문이나 선택이 바뀌어 이 후보는 지금 장면과 다릅니다. 다시 생성하거나 후보를 확인하세요.",
  blocked: "확인이 필요한 질문에 먼저 답하세요. 답하기 전에는 후보를 적용할 수 없습니다.",
  negative_lost: "이 후보의 negative prompt는 이 모델에서 지원되지 않습니다. "
    + "적용하면 긍정 프롬프트만 들어갑니다. 계속하려면 다시 누르세요.",
};

/**
 * The note shown *after* a lossy apply.
 *
 * Kept separate from `APPLY_BLOCK_COPY` because they answer different questions: the block
 * says "this will be lost, press again to accept", this says "it was lost". One string for
 * both would leave the user unable to tell whether the press took effect.
 */
export const NEGATIVE_LOSS_NOTE = "negative prompt는 이 모델에서 지원되지 않아 적용하지 않았습니다.";

/**
 * The final prompt as the *user* left it.
 *
 * Overwrite protection keys off this, not off "the prompt is non-empty": an applied
 * candidate's own text is not user work, so re-applying a second candidate over it needs
 * no confirm. `appliedPrompt` is the last string this module wrote, which is what makes
 * the distinction possible.
 */
export function needsOverwriteConfirm(input: {
  currentPrompt: string;
  appliedPrompt: string | null;
}): boolean {
  if (!input.currentPrompt.trim()) return false;
  return input.currentPrompt !== input.appliedPrompt;
}


/**
 * Decide whether one candidate may be applied right now.
 *
 * The order is the contract's, not the code's convenience: a target mismatch is checked
 * before the candidate is even looked up, because a reply for another model must not be
 * applicable no matter which of its candidates is pressed.
 */
export function planApply(input: {
  state: ComposeState;
  candidateId: string;
  currentTarget: ComposeTarget;
  currentRevisions: ComposeRevisions;
  currentPrompt: string;
  appliedPrompt: string | null;
  negativeSupported: boolean;
  /**
   * `true` on the second press of a candidate whose negative prompt this model cannot take.
   * The user was already told what would be lost, so the loss becomes a recorded fact
   * (`lossKo`) instead of a refusal they can never get past.
   */
  acceptNegativeLoss?: boolean;
}): ApplyPlan {
  const { state, candidateId, currentTarget, currentRevisions } = input;
  if (state.phase !== "ready" && state.phase !== "needs_clarification") {
    return { ok: false, block: "no_candidate", message: APPLY_BLOCK_COPY.no_candidate };
  }
  // A reply for another model is refused even though it parsed: the prompt it carries is
  // written in that family's convention, and the target is a fact about now.
  if (!sameTarget(state.target, currentTarget)) {
    return { ok: false, block: "expired", message: APPLY_BLOCK_COPY.expired };
  }
  if (state.phase === "needs_clarification") {
    return { ok: false, block: "blocked", message: APPLY_BLOCK_COPY.blocked };
  }
  const candidate = state.draft.candidates.find((item) => item.candidateId === candidateId);
  if (candidate === undefined) {
    return { ok: false, block: "no_candidate", message: APPLY_BLOCK_COPY.no_candidate };
  }
  if (!sameRevisions(state.revisions, currentRevisions)) {
    return { ok: false, block: "stale", message: APPLY_BLOCK_COPY.stale };
  }
  const losing = candidate.negativePrompt !== null && !input.negativeSupported;
  // §5 forbids sending a negative prompt to a model that cannot use one, and forbids
  // dropping it silently. The first press refuses *and explains*; the second one, from a
  // user who has read that sentence, proceeds with the positive only. Refusing forever
  // would make the hint's "계속하려면 다시 누르세요" a lie.
  if (losing && input.acceptNegativeLoss !== true) {
    return { ok: false, block: "negative_lost", message: APPLY_BLOCK_COPY.negative_lost };
  }
  const needsConfirm = needsOverwriteConfirm({
    currentPrompt: input.currentPrompt, appliedPrompt: input.appliedPrompt });
  return {
    ok: true,
    candidateId: candidate.candidateId,
    positivePrompt: candidate.positivePrompt,
    negativePrompt: losing ? null : candidate.negativePrompt,
    needsConfirm,
    confirmMessage: needsConfirm
      ? "최종 프롬프트에 직접 입력하거나 복원한 내용이 있습니다. 이 후보로 바꾸면 그 내용이 사라집니다. 계속할까요?"
      : null,
    lossKo: losing ? NEGATIVE_LOSS_NOTE : null,
    summaryKo: state.draft.summaryKo,
  };
}

/**
 * The negative prompt to write.
 *
 * A candidate without one leaves the user's existing negative prompt alone — §5 forbids
 * silently replacing it. Only a candidate that *carries* one overwrites the field, and only
 * after the support check in `planApply`.
 */
export function appliedNegative(candidate: ComposeCandidate, current: string): string {
  if (candidate.negativePrompt === null) return current;
  return candidate.negativePrompt;
}

/**
 * One record of what applying will change, shown before the press.
 *
 * `negative: "blocked"` is the case where the candidate has a negative prompt this model
 * cannot take; `planApply` refuses that candidate, and this mirrors the reason so the card
 * can explain itself instead of showing a dead button.
 */
export function applyDiff(candidate: ComposeCandidate, input: {
  currentPrompt: string;
  currentNegative: string;
  negativeSupported: boolean;
}): { positive: "replace" | "same"; negative: "replace" | "keep" | "blocked" } {
  return {
    positive: candidate.positivePrompt === input.currentPrompt ? "same" : "replace",
    negative: candidate.negativePrompt === null
      ? "keep"
      : input.negativeSupported ? "replace" : "blocked",
  };
}
