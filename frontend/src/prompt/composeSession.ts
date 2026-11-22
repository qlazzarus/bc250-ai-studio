import { sha256Hex } from "./digest.ts";
import {
  hasComposeInput, MAX_BRIEF_CHARS, MAX_SELECTIONS,
  type ComposeEdit, type EditSelection, type StructuredScene,
} from "./structuredScene.ts";

/**
 * UCP02: one composition session — the request lifecycle and what the user sees.
 *
 * The module is pure: no React, no fetch, no timers. The transport is passed in, so a
 * test drives every branch with a fake and the component owns the `AbortController`.
 *
 * Three separate things live here and must not be merged:
 *
 * 1. **`edit`** — the letters, chips and answers the user typed. Never written by a
 *    reply.
 * 2. **`draft`** — the last accepted reply (scene + candidates). Replaceable, because
 *    it is the server's best reading of the current edit.
 * 3. **`applied`** — the candidate the user actually executed. Append-only history: a
 *    new reply may not overwrite it, or the record would no longer match the image.
 *
 * The split is what makes "AI reply must not overwrite user edits" checkable rather
 * than aspirational.
 */

/**
 * Four fingerprints, one per independent kind of change.
 *
 * They exist separately because the *reactions* differ: a brief edit invalidates
 * clarification answers (the old questions were about the old sentence), a chip change
 * keeps them from being re-asked but still clears the answers, and an answer alone must
 * not disturb the text or the chips.
 */
export type ComposeRevisions = {
  brief: string;
  selection: string;
  choice: string;
  /** `sha256:<hex>` over all three plus model/profile/dictionary. Sent as `input_revision`. */
  input: string;
};

export type ComposeTarget = { modelId: string; family: string; profileVersion: number; dictionaryVersion: string };

const fp = (value: unknown): string => `sha256:${sha256Hex(JSON.stringify(value))}`;

/** Chips in a stable order: the same set in a different order is the same selection. */
const chipKey = (item: EditSelection): string =>
  `${item.id}|${item.source}|${item.pinned ? 1 : 0}|${item.entityId ?? ""}`;

export function composeRevisions(edit: ComposeEdit, target: ComposeTarget): ComposeRevisions {
  const chips = [...edit.selections].map(chipKey).sort();
  const answers = [...edit.choices]
    .map((item) => `${item.questionId}|${item.optionId}`).sort();
  const brief = fp(edit.briefKo);
  const selection = fp([target.family, chips]);
  const choice = fp(answers);
  return {
    brief, selection, choice,
    input: fp([brief, selection, choice, target.modelId, target.family,
      target.profileVersion, target.dictionaryVersion]),
  };
}

export const sameRevisions = (a: ComposeRevisions, b: ComposeRevisions): boolean =>
  a.brief === b.brief && a.selection === b.selection
  && a.choice === b.choice && a.input === b.input;

export const sameTarget = (a: ComposeTarget, b: ComposeTarget): boolean =>
  a.modelId === b.modelId && a.family === b.family
  && a.profileVersion === b.profileVersion
  && a.dictionaryVersion === b.dictionaryVersion;

/**
 * Asking a new question is a new session: stale questions are not carried over, because
 * an answer naming a `question_id` the server no longer issued is a 409 (§4).
 */
export function withBrief(edit: ComposeEdit, briefKo: string): ComposeEdit {
  if (briefKo === edit.briefKo) return edit;
  return { ...edit, briefKo, choices: [] };
}

/** Any chip change also drops the answers, for the same reason as a brief edit. */
export function withSelections(edit: ComposeEdit, selections: EditSelection[]): ComposeEdit {
  return { ...edit, selections, choices: [] };
}

/**
 * Answering keeps the brief and the chips. Only `choice` moves, which is exactly the
 * third row of the revision table in §4.
 */
export function withAnswer(edit: ComposeEdit, questionId: string, optionId: string): ComposeEdit {
  if (edit.choices.some((item) => item.questionId === questionId)) return edit;
  return { ...edit, choices: [...edit.choices, { questionId, optionId }] };
}

export const canCompose = (edit: ComposeEdit): boolean =>
  edit.briefKo.length <= MAX_BRIEF_CHARS
  && edit.selections.length <= MAX_SELECTIONS
  && hasComposeInput(edit);

/**
 * Why a composition is not `ready`. Each value is a *different* next action, which is
 * why they are not collapsed into one `error`:
 *
 * - `truncated`      — the reply was cut by the token limit; retrying may work.
 * - `partial`        — some candidates came back unusable; the rest are still shown.
 * - `timed_out`      — the browser gave up; the server may still be working.
 * - `provider_error` — the model call itself failed; retrying may work.
 * - `invalid_reply`  — the shape was wrong; retrying the same input should not help.
 * - `conflict`       — the server refused a stale dictionary/profile/revision.
 * - `expired`        — the reply arrived for a model profile that is no longer selected.
 */
export type ComposeFailure =
  | "truncated" | "partial" | "timed_out" | "provider_error"
  | "invalid_reply" | "conflict" | "expired";

export type ComposeCandidate = {
  candidateId: string;
  titleKo: string;
  differenceKo: string;
  positivePrompt: string;
  /** `null` when the target family has no negative prompt (UCP04 owns the profile). */
  negativePrompt: string | null;
  preservedKo: string[];
};

export type ComposeClarification = {
  questionId: string;
  questionKo: string;
  why: "actor_unknown" | "polarity_conflict" | "model_mismatch" | "dictionary_missing";
  options: { optionId: string; labelKo: string }[];
};

/**
 * Token accounting, split on purpose. A reply that spent its budget on reasoning and
 * produced no output is a *provider* problem, not a truncation of the user's scene, and
 * the two need different messages.
 */
export type TokenUsage = {
  promptTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
  /** `true` when the provider reported a length stop or a cut JSON body. */
  truncated: boolean;
};

/** What the user executed. Immutable once written; a later reply may not replace it. */
export type AppliedResult = {
  resultId: string;
  candidateId: string;
  providerModel: string;
  appliedAt: string;
  positivePrompt: string;
  negativePrompt: string | null;
  summaryKo: string;
};

export type ComposeOutcome =
  | { kind: "cancelled"; why: "user" | "stale" | "expired" }
  | { kind: "failed"; failure: ComposeFailure; message: string; detail: string | null }
  | { kind: "reply"; result: ComposeResult };

/**
 * A request begins. The revisions are *snapshotted* here, so a reply is judged against
 * the state it was sent for rather than against whatever is on screen now.
 */
export function startComposition(
  state: ComposeState,
  input: { requestId: string; target: ComposeTarget },
): ComposeState {
  return {
    phase: "pending",
    edit: state.edit,
    draft: state.draft,
    applied: state.applied,
    requestId: input.requestId,
    revisions: composeRevisions(state.edit, input.target),
    target: input.target,
  };
}

/**
 * A reply arrives.
 *
 * Guards run in this order, because they mean different things to the user:
 *
 * 1. **Wrong request** — an older request settled late. Dropped with no state change;
 *    it is not an error, because the newer request is still the truth.
 * 2. **Wrong target** — the model or profile changed while the call ran. The reply is
 *    about a different model, so it is refused as `expired` rather than shown.
 * 3. **Wrong revisions** — the brief or chips changed. Refused as a stale cancel,
 *    which leaves the current screen intact.
 *
 * Only then is the reply adopted, and even then the selections are merged, not replaced.
 */
export function settleComposition(
  state: ComposeState,
  input: {
    outcome: ComposeOutcome;
    currentRevisions: ComposeRevisions;
    currentTarget: ComposeTarget;
  },
): ComposeState {
  if (state.phase !== "pending") return state;
  const { outcome, currentRevisions, currentTarget } = input;
  if (outcome.kind === "cancelled") {
    return { phase: "cancelled", edit: state.edit, draft: state.draft,
      applied: state.applied, requestId: state.requestId };
  }
  if (outcome.kind === "failed") {
    return { phase: "failed", edit: state.edit, draft: state.draft,
      applied: state.applied, failure: outcome.failure,
      message: outcome.message, detail: outcome.detail };
  }
  const { result } = outcome;
  if (result.requestId !== state.requestId) return state;
  if (!sameTarget(state.target, currentTarget)) {
    return { phase: "failed", edit: state.edit, draft: state.draft,
      applied: state.applied, failure: "expired",
      message: "모델이나 출력 프로필이 바뀌어 이전 결과를 버렸습니다. 다시 생성하세요.",
      detail: null };
  }
  if (!sameRevisions(result.revisions, state.revisions)
      || !sameRevisions(currentRevisions, state.revisions)) {
    return { phase: "cancelled", edit: state.edit, draft: state.draft,
      applied: state.applied, requestId: state.requestId };
  }
  const draft: ComposeResult = {
    ...result,
    selections: mergeSelections(state.edit.selections, result.selections),
  };
  if (result.questions.length > 0) {
    return { phase: "needs_clarification", edit: state.edit, draft,
      applied: state.applied, requestId: state.requestId,
      revisions: state.revisions, target: state.target, questions: result.questions };
  }
  return { phase: "ready", edit: state.edit, draft, applied: state.applied,
    requestId: state.requestId, revisions: state.revisions, target: state.target,
    warnings: result.warnings, tokens: result.tokens };
}

/** Explicit cancel. Only a request in flight can be cancelled. */
export function cancelComposition(state: ComposeState): ComposeState {
  return state.phase === "pending"
    ? { phase: "cancelled", edit: state.edit, draft: state.draft,
        applied: state.applied, requestId: state.requestId }
    : state;
}

/**
 * The edit changed under a live or settled draft.
 *
 * `pending` becomes a stale cancel — the reply can no longer be shown. A settled draft
 * is *kept*: the user may still want to apply it, and a chip edit does not make the
 * sentences wrong. What it does do is make the draft describe an older edit, which
 * `draftIsStale` reports so the UI can say so instead of claiming it is current.
 */
export function invalidateComposition(
  state: ComposeState,
  currentRevisions: ComposeRevisions,
): ComposeState {
  if (state.phase !== "pending") return state;
  return sameRevisions(state.revisions, currentRevisions)
    ? state
    : { phase: "cancelled", edit: state.edit, draft: state.draft,
        applied: state.applied, requestId: state.requestId };
}

export function draftIsStale(
  state: ComposeState,
  currentRevisions: ComposeRevisions,
): boolean {
  if (state.phase !== "ready" && state.phase !== "needs_clarification") return false;
  return !sameRevisions(state.revisions, currentRevisions);
}

/**
 * A candidate is executed.
 *
 * Applied is deliberately *not* derived from `draft`: the user may apply candidate B of
 * a reply, then edit the brief, then apply candidate A of a newer reply. What was
 * executed is a fact about the past, so it is recorded as one.
 */
export function applyCandidate(
  state: ComposeState,
  input: { candidateId: string; providerModel: string; appliedAt: string; resultId: string },
): ComposeState {
  if (state.phase !== "ready" && state.phase !== "needs_clarification") return state;
  const candidate = state.draft.candidates.find((item) => item.candidateId === input.candidateId);
  if (candidate === undefined) return state;
  const applied: AppliedResult = {
    resultId: input.resultId,
    candidateId: candidate.candidateId,
    providerModel: input.providerModel,
    appliedAt: input.appliedAt,
    positivePrompt: candidate.positivePrompt,
    negativePrompt: candidate.negativePrompt,
    summaryKo: state.draft.summaryKo,
  };
  return { ...state, applied };
}

/**
 * One-step undo of the *last apply*, and nothing else.
 *
 * `previous` is what `applied` held before the last `applyCandidate`, captured by the
 * caller. The state itself is not a log: keeping a stack here would let the UI undo past
 * the point the user can see, and the spec only requires one step.
 *
 * `edit` and `draft` are left untouched. Undoing the letters too would throw away typing
 * done after applying, which is the failure the spec calls out. When the user *has*
 * edited since applying, the caller surfaces `undoOverwritesEdits` rather than reverting
 * silently.
 */
export function undoApply(state: ComposeState, previous: AppliedResult | null): ComposeState {
  if (state.applied === null) return state;
  return { ...state, applied: previous };
}


/** `true` when undoing would discard letters typed after the last apply. */
export function undoOverwritesEdits(
  state: ComposeState,
  appliedRevision: ComposeRevisions,
  currentRevisions: ComposeRevisions,
): boolean {
  return state.applied !== null && !sameRevisions(appliedRevision, currentRevisions);
}

/**
 * The user rewrote the generated English prompt by hand.
 *
 * Only the applied record changes, and only its text: `appliedAt` and `summaryKo` stay,
 * because the *fact* that this result was applied has not changed, just its wording.
 * Recording it as a new apply would make the history claim a second execution happened.
 */
export function editAppliedPrompt(
  state: ComposeState,
  input: { positivePrompt: string; negativePrompt: string | null },
): ComposeState {
  if (state.applied === null) return state;
  return { ...state, applied: {
    ...state.applied,
    positivePrompt: input.positivePrompt,
    negativePrompt: input.negativePrompt,
  } };
}

/**
 * Model or output-profile change.
 *
 * The draft is dropped because it was produced for another model; `applied` and `edit`
 * are kept, because the scene meaning and the user's constraints are not model-bound
 * (spec §4, 마지막 항목). An in-flight request is cancelled rather than left to land.
 */
export function expireForTarget(state: ComposeState, target: ComposeTarget): ComposeState {
  const edit = { ...state.edit, targetModelId: target.modelId,
    targetFamily: target.family, profileVersion: target.profileVersion,
    dictionaryVersion: target.dictionaryVersion };
  switch (state.phase) {
    case "pending":
      return { phase: "cancelled", edit, draft: null, applied: state.applied,
        requestId: state.requestId };
    case "ready":
    case "needs_clarification":
      return { phase: "idle", edit, draft: null, applied: state.applied };
    default:
      return { ...state, edit };
  }
}

/**
 * The server rejected the request as out of date (`409`).
 *
 * Which fingerprint disagreed decides the message: a stale `choice_revision` means the
 * questions are gone and must be re-asked, while a stale `selection_revision` only means
 * the chips moved. Both keep the letters and the applied record.
 */
export function settleConflict(
  state: ComposeState,
  input: { code: string; staleField: "brief" | "selection" | "choice" | "unknown" },
): ComposeState {
  const message = input.staleField === "choice"
    ? "확인 질문이 만료되었습니다. 다시 생성해 질문을 받아 주세요."
    : input.staleField === "selection"
      ? "칩 구성이 바뀌어 요청이 만료되었습니다. 다시 생성하세요."
      : "입력이 바뀌어 요청이 만료되었습니다. 다시 생성하세요.";
  return { phase: "failed", edit: state.edit, draft: state.draft,
    applied: state.applied, failure: "conflict", message, detail: input.code };
}

/** Cancel token for an in-flight request, so a component can abort its own fetch. */
export const isPending = (state: ComposeState): state is Extract<ComposeState, { phase: "pending" }> =>
  state.phase === "pending";

/**
 * `cmp-` + 12 hex, which is the only shape the server accepts (`ComposeRequest`).
 *
 * Generated from `crypto.getRandomValues` when available and `Math.random` otherwise, so
 * the same function works in a browser and under `node --test`. This is not a secret: it
 * only has to be unique enough that a late reply can be matched to its own request.
 */
export function newComposeRequestId(random: () => number = Math.random): string {
  let hex = "";
  for (let i = 0; i < 12; i += 1) {
    hex += Math.floor(random() * 16).toString(16);
  }
  return `cmp-${hex}`;
}



export type ComposeState =
  /** Nothing requested yet. `edit` still holds whatever the user typed. */
  | { phase: "idle"; edit: ComposeEdit; draft: null; applied: AppliedResult | null }
  | {
      phase: "pending";
      edit: ComposeEdit;
      draft: ComposeResult | null;
      applied: AppliedResult | null;
      requestId: string;
      revisions: ComposeRevisions;
      target: ComposeTarget;
    }
  /** A usable reply. `warnings` never disappear silently; the UI shows them. */
  | {
      phase: "ready";
      edit: ComposeEdit;
      draft: ComposeResult;
      applied: AppliedResult | null;
      requestId: string;
      revisions: ComposeRevisions;
      target: ComposeTarget;
      /** §5: a dropped candidate surfaces as `candidates_reduced` here, not silently. */
      warnings: string[];
      tokens: TokenUsage;
    }
  /** The server needs an answer before it will produce candidates. */
  | {
      phase: "needs_clarification";
      edit: ComposeEdit;
      draft: ComposeResult;
      applied: AppliedResult | null;
      requestId: string;
      revisions: ComposeRevisions;
      target: ComposeTarget;
      questions: ComposeClarification[];
    }
  /**
   * A settled non-success. `previous` keeps the last good draft so a failure does not
   * blank the screen — the spec requires the input to survive every failure path.
   */
  | {
      phase: "failed";
      edit: ComposeEdit;
      draft: ComposeResult | null;
      applied: AppliedResult | null;
      failure: ComposeFailure;
      message: string;
      /** Server byte/shape detail, when there is one. Never shown raw to the user. */
      detail: string | null;
    }
  /** Explicit cancel. Distinct from `failed`: nothing went wrong. */
  | { phase: "cancelled"; edit: ComposeEdit; draft: ComposeResult | null; applied: AppliedResult | null; requestId: string | null };

export type ComposeResult = {
  resultId: string;
  requestId: string;
  revisions: ComposeRevisions;
  summaryKo: string;
  scene: StructuredScene;
  selections: EditSelection[];
  candidates: ComposeCandidate[];
  questions: ComposeClarification[];
  warnings: string[];
  /** Nonempty means the stored snapshot was trimmed: not a full restore (UCP01 fix B). */
  snapshotTrim: string[];
  providerModel: string | null;
  tokens: TokenUsage;
};

export const IDLE_COMPOSE = (edit: ComposeEdit, applied: AppliedResult | null = null): ComposeState =>
  ({ phase: "idle", edit, draft: null, applied });

/**
 * Merge a server reading of the selections into what the user already decided.
 *
 * The server never sends `excluded` (it is a client-side veto), so exclusion is carried
 * over wholesale. For the rest the rule is one-way trust:
 *
 * - `manual` survives even when the server says `auto`, and keeps its own `pinned`;
 * - a pinned `auto` survives, because the user asked to keep it;
 * - everything else is the server's to replace — that is what makes re-analysis work.
 *
 * Without the merge, every reply would reset the user's picks and silently un-exclude
 * deleted chips. That is exactly the failure this function exists to prevent.
 */
export function mergeSelections(current: EditSelection[], fromServer: EditSelection[]): EditSelection[] {
  const kept = new Map<string, EditSelection>();
  for (const item of current) {
    if (item.source === "manual" || item.pinned || item.source === "excluded") {
      kept.set(item.id, item);
    }
  }
  const merged: EditSelection[] = fromServer
    .filter((item) => item.source !== "excluded")
    .map((item) => {
      const mine = kept.get(item.id);
      if (mine === undefined) return item;
      // The veto is checked first: the server re-deriving a chip the user deleted must
      // not revive it. This is the case `mergeSelections` exists for.
      if (mine.source === "excluded") return mine;
      // A manual chip stays manual; a pinned auto chip keeps its pin. Attribution from
      // the server is preferred because it is derived from the current brief.
      return mine.source === "manual"
        ? { ...mine, entityId: item.entityId ?? mine.entityId }
        : { ...item, pinned: true };
    });
  const present = new Set(merged.map((item) => item.id));
  // Keep rows the server did not mention: the server dropped them, but the user either
  // vetoed them or picked them, and "the model forgot" is not permission to remove a
  // user decision.
  for (const [id, item] of kept) {
    if (!present.has(id)) merged.push(item);
  }
  return merged;
}


