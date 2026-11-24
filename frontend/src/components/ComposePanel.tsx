/**
 * UCP05: the integrated compose panel.
 *
 * One entry point, one apply gesture. The user writes Korean, presses generate once, and
 * gets the interpretation, the chosen chips and up to three English candidates in one
 * screen. Applying is a *separate* press on a *single* candidate — this component never
 * writes the final prompt on its own.
 *
 * ## What this component owns, and what it does not
 *
 * - It owns the compose session (`ComposeState` from `composeSession.ts`) and the request
 *   lifecycle. Everything the user typed lives inside `state.edit`, so a failed reply, a
 *   cancel or a layout change cannot lose it.
 * - It does **not** own the final prompt. `onApply` is the only way to change it, and it is
 *   only called from a successful `planApply`, so the legacy free-form path keeps working
 *   untouched when compose is unused or unavailable.
 *
 * ## Stale replies
 *
 * Three independent guards, because they catch different races:
 *
 * 1. the `AbortController` stops a request the user cancelled (and the server drops it);
 * 2. `requestId` matching discards a reply for an older request that was not aborted;
 * 3. `input_revision` matching discards a reply that arrived after the edit changed.
 *
 * A late reply is settled through `settleComposition`, which re-checks all of them against
 * the state at *settle* time, so a reply that lands after the user typed cannot overwrite
 * the newer edit.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DICTIONARY, DICTIONARY_VERSION, searchDictionary, type DictionaryEntry } from "../prompt/dictionary";
import {
  CLASH_RESOLUTIONS, EMPTY_SCENE, MAX_BRIEF_CHARS, addManual, attributeTo, clearExclusion,
  exclusionClashes, makeAuto, removeSelection, resolveClash, sceneEntityIds, setPinned,
  type ClashResolution, type EditSelection, type StructuredScene,
} from "../prompt/structuredScene";
import {
  IDLE_COMPOSE, appliedForRestoredPrompt, applyCandidate, cancelComposition,
  composeRevisions, draftIsStale,
  invalidateForTarget, isPending, newComposeRequestId, sameTarget, settleComposition,
  startComposition, undoApply, withAnswer, withBrief, withEdit,
  type AppliedResult, type ComposeState, type ComposeTarget,
} from "../prompt/composeSession";
import { buildComposeBody, parseComposeReply } from "../prompt/composeRequest";
import { failureAlert, warningAlerts, type ComposeAlert } from "../prompt/composeAlerts";
import { chipList, entityLabels as entityLabelMap, groupChips } from "../prompt/composeChips";
import { applyDiff, needsOverwriteConfirm, planApply } from "../prompt/composeApply";
import { composeFallbackNotice, type ComposeCapability } from "../prompt/composeCapability";

export type ComposePanelProps = {
  /** Live capability. `supported: false` keeps the rules-only path and says why. */
  capability: ComposeCapability;
  /** The current target; a change re-validates displayed candidates. */
  target: ComposeTarget | null;
  /** Candidate count to ask for (1–3). */
  candidateCount?: number;
  /** Whether the selected model can take a negative prompt. */
  negativeSupported: boolean;
  /** The final prompt as it stands. Read-only here; `onApply` changes it. */
  prompt: string;
  /** The negative prompt as it stands, so the diff and undo can name what they touch. */
  negative: string;
  /** Applies one candidate's prompts. The only write path to the final prompt. */
  onApply: (input: { positive: string; negative: string | null }) => void;
  /**
   * UCP07: the applied record plus the scene it was applied against.
   *
   * `onApply` writes two text fields; a v3 snapshot also needs the *record* (which
   * candidate, which model, when) and the scene the chips were attributed to. Both live in
   * this component's session, so it reports them here instead of `App` reaching into it.
   * Called after `onApply`, from the same press, so the two can never describe different
   * applies.
   *
   * `null` means "nothing is applied any more" — an undo back past the first apply, or a
   * restored record being cleared by the user. A v3 body is then not sent at all.
   */
  onAppliedChange?: (applied: {
    applied: AppliedResult | null;
    scene: StructuredScene;
    briefKo: string;
    selections: EditSelection[];
  }) => void;
  /**
   * UCP06: writes back a previous state of the prompt fields for one-step undo.
   *
   * The panel holds the compose session but not the prompt, so undo cannot be done here.
   * `appliedPrompt` travels with it because it is what tells the next apply whether the
   * field is still panel-written.
   */
  onRestore?: (input: { positive: string; negative: string; appliedPrompt: string | null }) => void;
  /** The prompt text last written by an apply, for overwrite protection. */
  appliedPrompt: string | null;
  /** The transport. `undefined` disables the button rather than showing a dead control. */
  send?: (body: unknown, signal: AbortSignal) => Promise<unknown>;
  /** Korean examples, so a first-time user is not facing an empty box. */
  examples?: string[];
  /**
   * UIX01: move to the English field from the place that explains why compose is unavailable.
   *
   * The fallback text already tells the user to write the prompt themselves; without this
   * the instruction was a dead end and the field it names was somewhere down the form. It
   * only moves focus — it never writes a prompt, so a refused candidate cannot become one.
   */
  onUseDirectInput?: () => void;
  /**
   * UIX01/UIX03: a read-only projection of the compose session, for the strip App shows
   * while the Korean region is folded.
   *
   * This is a *projection*, not a second source: it is derived here from `visible` and
   * reported one way. App never writes it back, and nothing fetches because of it — so a
   * folded region can still say "생성 중", "후보 3개 준비됨", "실패", "다시 구성 필요"
   * without a duplicate state machine and without a second truth.
   */
  onStatusChange?: (status: ComposeStatusView) => void;
};

/** The four facts the folded strip needs. Deliberately flat and serializable. */
export type ComposeStatusView = {
  phase: "idle" | "pending" | "ready" | "needs_clarification" | "failed" | "cancelled";
  /** Usable candidates in the current draft; 0 unless the phase carries a reply. */
  candidateCount: number;
  /** The displayed reply no longer matches the edit (brief/chips/model moved). */
  stale: boolean;
  /** The headline of the failure alert, when the phase is `failed`. */
  failureKo: string | null;
};

type CandidateView = { key: string; expanded: string[]; collapsed: string[] };

const GROUP_LABEL: Record<string, string> = {
  subject: "대상", appearance: "외형", clothing: "의상", expression: "표정",
  action: "동작", pose: "포즈", location: "장소", setting: "배경", composition: "구도",
  camera: "카메라", lighting: "조명", style: "스타일", mood: "분위기", other: "기타",
};

const groupLabel = (group: string): string => GROUP_LABEL[group] ?? group;

/** Why a clarification question was asked, in words the user can act on. */
const WHY_LABEL: Record<string, string> = {
  actor_unknown: "누구인지 확정되지 않음",
  polarity_conflict: "서로 반대되는 표현",
  model_mismatch: "이 모델에 없는 표현",
  dictionary_missing: "사전에 없는 표현",
};


export default function ComposePanel({
  capability, target: targetProp, candidateCount = 3, negativeSupported, prompt, negative,
  onApply, onRestore, onAppliedChange, appliedPrompt, send, examples = [], onUseDirectInput,
  onStatusChange,
}: ComposePanelProps) {
  /**
   * A placeholder target for the no-model state. It is never sent: `capability.supported`
   * is false in that state, and `buildComposeBody` refuses a zero profile version. Using a
   * placeholder keeps the edit state mounted across a model deselection, so the typed brief
   * is not lost when the selector is cleared.
   */
  const target: ComposeTarget = targetProp ?? {
    modelId: "", family: "", profileVersion: 0, dictionaryVersion: DICTIONARY_VERSION,
  };
  const [state, setState] = useState<ComposeState>(() => IDLE_COMPOSE({
    briefKo: "", selections: [], choices: [],
    targetModelId: target.modelId, targetFamily: target.family,
    profileVersion: target.profileVersion, dictionaryVersion: target.dictionaryVersion,
  }));
  /**
   * The target is a prop, so it is *derived* into the state during render rather than
   * written by an effect. An effect runs after a commit that still shows the old
   * candidates, and a press in that window would apply a prompt for the previous model.
   */
  const visible = invalidateForTarget(state, target);
  const abortRef = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const resultRef = useRef<HTMLDivElement | null>(null);
  /** Set before a render that removes a chip; the id is focused after that commit. */
  const pendingFocusRef = useRef<string | null>(null);
  /**
   * UCP06: what the prompt fields held before the last apply, so one undo can restore it.
   *
   * A ref, not state: writing it in the same handler that calls `onApply` must not schedule
   * a second render, and nothing renders from it. Only *one* step is kept — the spec's undo
   * is one apply deep, and a stack would let the user undo past what the screen explains.
   */
  const undoRef = useRef<{ positive: string; negative: string;
    appliedPrompt: string | null; applied: AppliedResult | null;
    target: ComposeTarget } | null>(null);
  /**
   * Whether a step is still available, and *which target* it was captured for.
   *
   * Separate state because the button's *existence* depends on it: `undoRef` is a ref, so
   * clearing it renders nothing new, and `visible.applied` is the wrong test — undoing the
   * second of two applies restores the first one's record, leaving `applied` non-null with no
   * step left. Without this flag the row stays on screen and the press silently does nothing.
   *
   * The stored target is not decoration. An `AppliedResult` records the *provider* model
   * (`qwen3-4b`), not the image model it was generated for, so it cannot answer "was this
   * prompt written for the model selected now?". Only this component knows that, because the
   * target is a prop. Keeping the captured target here is what lets the record be dropped —
   * while the text is still restored — when the model changed in between.
   */
  const [undoTarget, setUndoTarget] = useState<ComposeTarget | null>(null);
  /** A candidate the user must press twice: the first press explains the negative loss. */
  const [armed, setArmed] = useState<string | null>(null);
  /**
   * UIX03: which candidate bodies are open.
   *
   * Keyed by the draft's `resultId`, so a *new* reply starts from the default (first body
   * open) instead of inheriting the previous reply's expansion — two replies can even share
   * a candidate id, and a bare id set would open the wrong card. `collapsed` exists so the
   * default-open first card can be closed; without it, closing it would be indistinguishable
   * from "not touched yet" and it would spring back open on the next render.
   *
   * View state only: toggling a body never touches `edit`, so no revision moves, nothing is
   * sent, and the final prompt cannot change.
   */
  const [candidateView, setCandidateView] = useState<CandidateView>({ key: "", expanded: [], collapsed: [] });

  const pending = isPending(visible);
  const edit = visible.edit;
  const revisions = composeRevisions(edit, target);
  const stale = draftIsStale(visible, revisions);
  const chosen = edit.selections.filter((item) => item.source !== "excluded");
  const canSend = capability.supported && Boolean(send) && !pending
    && (edit.briefKo.trim().length > 0 || chosen.length > 0);

  const scene: StructuredScene = visible.draft?.scene ?? EMPTY_SCENE;
  const chips = chipList(edit, DICTIONARY, target.family, scene);
  /** Entity labels come from the parsed scene, so an unattributed chip can name a target. */
  const entityLabels = entityLabelMap(scene);
  const entities = scene.entities;
  const scoped = group ? DICTIONARY.filter((entry) => entry.category === group) : DICTIONARY;
  const options: DictionaryEntry[] = searchDictionary(scoped, query);
  const selectedIds = new Set(edit.selections.map((item) => item.id));

  /** An unmounting panel must not leave a request running against the server. */
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  /** One-shot focus restore after a chip is removed, so the keyboard path is not lost. */
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id === null) return;
    pendingFocusRef.current = null;
    const node = document.getElementById(`compose-chip-${id}`);
    if (node) node.focus();
  });

  /**
   * Write the user's edit into the session. Every handler routes through here, so there is
   * exactly one copy of the letters and chips and no path can desynchronise the two.
   *
   * The base is `visible`, not `current`: if the target just changed, the stored state still
   * describes the old model, and writing onto it would resurrect the old target — which the
   * reply's `sameTarget` guard then compares against. Writing onto the invalidated state
   * keeps a single truth, and because it is `visible`'s object identity, a no-change target
   * costs nothing extra.
   */
  const update = (next: (current: typeof edit) => typeof edit) => {
    setState((current) => withEdit(invalidateForTarget(current, target),
      next(invalidateForTarget(current, target).edit)));
  };

  /**
   * Korean IME guard for the brief (spec §3, 한글 IME row).
   *
   * The spec's rule is "composition 중 Enter를 제출/선택 확정으로 처리하지 않음" and
   * "textarea Enter는 기본 줄바꿈, 실행은 명시적 버튼". This textarea has no submit at all,
   * so plain Enter already inserts a newline — which is the required behaviour.
   *
   * The guard exists for the *container*: this panel is rendered inside App's
   * `<form onSubmit={submit}>`, so an implicit submission is one stray `<button>` away.
   * While an IME composition is live, Enter must not be allowed to bubble to the form;
   * `keyCode === 229` covers Safari and older Chromium, which do not reliably set
   * `isComposing` for the Enter that confirms a Hangul composition. Cancelling only the
   * composing Enter leaves the newline behaviour and the explicit generate button intact.
   */
  const onBriefKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) event.preventDefault();
  };

  /**
   * Enter in the dictionary search must not reach the surrounding form.
   *
   * The list is filtered on every keystroke, so Enter has no meaning here — but the input
   * lives inside App's image form, where a bare Enter is an implicit submit. Cancelling it
   * unconditionally is the only safe rule: unlike the brief there is no newline to protect,
   * and a composition-confirming Enter must be swallowed for the same reason as above.
   */
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.preventDefault();
  };

  /**
   * Send one composition.
   *
   * The revisions are snapshotted from the edit *at this moment* and the reply is settled
   * against the state the component holds *when it arrives*. That is what turns an edit
   * during the request into a stale cancel instead of an overwritten screen.
   */
  const runSend = (async (nextEdit: typeof edit) => {
    if (!send || !capability.supported) {
      setNotice(composeFallbackNotice(capability) ?? "통합 생성을 사용할 수 없습니다.");
      return;
    }
    setNotice("");
    setArmed(null);
    const requestId = newComposeRequestId();
    const built = buildComposeBody({ edit: nextEdit, target, requestId, candidateCount });
    if (!built.ok) {
      // Nothing was sent, so there is no request to cancel; the failure names the field.
      setState((current) => ({ phase: "failed", edit: current.edit, draft: current.draft,
        applied: current.applied, failure: built.failure, message: built.message,
        detail: built.detail }));
      return;
    }
    const snapshot = composeRevisions(nextEdit, target);
    setState((current) => startComposition(withEdit(current, nextEdit),
      { requestId, target }));
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), capability.timeoutMs);
    try {
      const body = await send(built.body, controller.signal);
      const parsed = parseComposeReply(body, { requestId, revisions: snapshot });
      setState((current) => settleComposition(current, {
        outcome: parsed.ok
          ? { kind: "reply", result: parsed.result }
          : { kind: "failed", failure: parsed.failure,
              message: failureAlert(parsed.failure, parsed.detail).message,
              detail: parsed.detail },
        // Read at settle time, from the state that exists now — not from the closure.
        currentRevisions: composeRevisions(current.edit, target),
        currentTarget: target,
      }));
    } catch (reason) {
      if (controller.signal.aborted) return;
      const status = reason !== null && typeof reason === "object" && "status" in reason
        ? Number((reason as { status: unknown }).status) : 0;
      // A 409 is a stale view (the server recomputed the fingerprint and disagreed);
      // anything else is a transport or server fact. Neither may lose the text.
      const failure = status === 409 ? "conflict" as const
        : status === 413 || status === 422 ? "invalid_reply" as const
        : "provider_error" as const;
      setState((current) => settleComposition(current, {
        outcome: { kind: "failed", failure, message: "", detail: null },
        currentRevisions: composeRevisions(current.edit, target),
        currentTarget: target,
      }));
    } finally {
      window.clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
    }
  });

  const composeNow = (() => { void runSend(edit); });

  const cancel = (() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(cancelComposition);
    setNotice("요청을 취소했습니다. 입력과 선택은 그대로 남아 있습니다.");
  });

  /** Retry sends the *current* edit, so a retry after typing picks the typing up. */
  const retry = (() => { void runSend(edit); });

  /** An answer keeps the brief and chips; only `choice` moves (§4 revision table). */
  const answer = ((questionId: string, optionId: string) => {
    const next = withAnswer(edit, questionId, optionId);
    if (next === edit) return;
    setState((current) => withEdit(current, next));
    void runSend(next);
  });

  /**
   * Apply one candidate.
   *
   * `planApply` decides; this handler only obeys. Three things happen here that the plan
   * cannot do itself:
   *
   * 1. **The pre-apply fields are snapshotted** into `undoRef` *before* `onApply` writes,
   *    so one undo can put back exactly what the user had — including their own typing.
   * 2. **A lossy press is two-step.** The first press arms the candidate and explains the
   *    negative loss; the second one passes `acceptNegativeLoss` and proceeds positive-only.
   * 3. **The loss note is a recorded fact**, not a hint: after a lossy apply the notice
   *    says the negative prompt was dropped, so "적용됨" is never mistaken for "everything
   *    was applied".
   */
  const apply = ((candidateId: string) => {
    const accepting = armed === candidateId;
    const plan = planApply({
      state: visible, candidateId, currentTarget: target, currentRevisions: revisions,
      currentPrompt: prompt, appliedPrompt, negativeSupported,
      acceptNegativeLoss: accepting,
    });
    if (!plan.ok) {
      if (plan.block === "negative_lost" && armed !== candidateId) setArmed(candidateId);
      setNotice(plan.message);
      return;
    }
    if (plan.needsConfirm && plan.confirmMessage
        && !window.confirm(plan.confirmMessage)) return;
    undoRef.current = { positive: prompt, negative, appliedPrompt,
      applied: visible.applied, target };
    setUndoTarget(target);
    setArmed(null);
    onApply({ positive: plan.positivePrompt, negative: plan.negativePrompt });
    const appliedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const resultId = visible.draft?.resultId ?? candidateId;
    // The record stores what `planApply` decided to *write*, not what the candidate offered.
    // A model that cannot take a negative prompt gets `plan.negativePrompt === null`, and
    // recording the candidate's own string would make the v3 record claim a negative the
    // engine never received — visible later as a restore that shows a prompt that was not run.
    // When the plan keeps the user's negative (`null` = "leave the field alone"), the field's
    // current value is what was executed.
    const negativeWritten = negativeSupported
      ? (plan.negativePrompt ?? negative)
      : null;
    setState((current) => {
      const next = applyCandidate(current, {
        candidateId,
        providerModel: visible.draft?.providerModel ?? "unknown",
        appliedAt,
        resultId,
        negativePrompt: negativeWritten,
      });
      // UCP07: report the applied record *and* the scene it was applied against, from the
      // same state transition that created it. Reporting from the render instead would let
      // a re-render report an older apply than the one the prompt holds.
      const recorded = next.applied;
      if (recorded !== null) {
        onAppliedChange?.({ applied: recorded, scene, briefKo: next.edit.briefKo,
          selections: next.edit.selections });
      }
      return next;
    });
    setNotice(plan.lossKo ?? "후보를 최종 프롬프트에 적용했습니다.");
    resultRef.current?.focus();
  });

  /**
   * UCP06: one-step undo of the last apply.
   *
   * What it restores is exactly the two prompt fields as they were before that press, plus
   * the `applied` record that went with them — *not* the edit or the draft. Restoring the
   * previous record matters: applying candidate B then undoing must leave A recorded as what
   * the prompt holds, otherwise the A card would stop claiming "적용됨" for text that is
   * literally back on screen. When the restored text was the user's own typing there is no
   * such record, so `appliedForRestoredPrompt` returns `null` rather than a claim that
   * disagrees with the field.
   *
   * Candidates and revisions are untouched: undo never revives an expired reply, and it
   * never re-opens a superseded `requestId`.
   *
   * **The record is only restored for the target it was applied against.** `appliedForRestoredPrompt`
   * compares text, and text cannot tell a Klein prompt from a Klein-Q8 prompt. When the model
   * changed between the apply and the undo, the restored text still belongs to the user, so it
   * is written back, but the record is dropped: submitting it would attach a prompt generated
   * for another model to a v3 row whose `target_model_id` is the new one.
   */
  const undo = (() => {
    const snapshot = undoRef.current;
    if (snapshot === null || !onRestore) return;
    const sameTargetAsApplied = sameTarget(snapshot.target, target);
    const restored = sameTargetAsApplied
      ? appliedForRestoredPrompt(snapshot.applied,
          { positive: snapshot.positive, negative: snapshot.negative })
      : null;
    onRestore({ positive: snapshot.positive, negative: snapshot.negative,
      appliedPrompt: sameTargetAsApplied ? snapshot.appliedPrompt : null });
    setState((current) => {
      const next = undoApply(current, restored);
      // UCP07: the record went back with the prompt. An undo past the first apply means
      // "nothing is applied", and the next submission must not claim a v3 apply history.
      onAppliedChange?.({ applied: next.applied, scene, briefKo: next.edit.briefKo,
        selections: next.edit.selections });
      return next;
    });
    undoRef.current = null;
    setUndoTarget(null);
    setArmed(null);
    setNotice(sameTargetAsApplied
      ? "적용을 되돌렸습니다. 프롬프트는 적용 전 상태입니다."
      : "적용을 되돌렸습니다. 모델이 바뀌어 적용 기록은 복원하지 않았습니다.");
    resultRef.current?.focus();
  });

  /**
   * `true` when undo would replace text the user wrote after applying.
   *
   * Only the final prompt counts. An edit to the *brief* does not, because undo restores the
   * prompt fields and leaves `edit` alone — warning about it would describe a loss that does
   * not happen, and a warning that fires on unrelated changes stops being read.
   */
  const undoLossy = needsOverwriteConfirm({ currentPrompt: prompt, appliedPrompt });

  /**
   * Resolve one exclusion/brief contradiction. Both outcomes are user choices, so this is
   * only ever called from an explicit press on one of `CLASH_RESOLUTIONS`.
   */
  const resolve = ((clashId: string, resolution: ClashResolution) => {
    const clash = clashes.find((item) => item.id === clashId);
    if (clash === undefined) return;
    update((current) => resolveClash(current, clash, resolution, DICTIONARY));
    setNotice("충돌을 정리했습니다. 다시 생성하면 정리된 장면으로 후보를 만듭니다.");
  });

  /**
   * Removing a chip: an `auto` chip becomes `excluded` (a veto), a `manual` one just leaves.
   * The distinction lives in `removeSelection`; this only moves focus to the next chip.
   */
  const dropChip = ((id: string) => {
    const index = edit.selections.findIndex((item) => item.id === id);
    const next = edit.selections[index + 1] ?? edit.selections[index - 1];
    pendingFocusRef.current = next?.id ?? null;
    update((current) => removeSelection(current, id));
  });

  const togglePin = ((id: string, pinned: boolean) => {
    update((current) => setPinned(current, id, pinned));
  });

  const unexclude = ((id: string) => {
    // Clearing the row entirely is what lets the next reply choose it again.
    update((current) => clearExclusion(current, id));
  });

  const pick = ((id: string) => {
    update((current) => addManual(current, { id }));
  });

  /**
   * Hand a chip back to the AI (UCP06). The only path from `manual` to `auto`: a reply
   * never demotes a hand-picked chip, so the user has to say so explicitly.
   */
  const toAuto = ((id: string) => {
    update((current) => makeAuto(current, id));
  });

  /**
   * Re-attribute a chip to another entity. `sceneEntityIds` is passed so an ID the current
   * scene does not contain is refused here rather than becoming a `422` on the next send.
   */
  const attribute = ((id: string, entityId: string | null) => {
    update((current) => attributeTo(current, id, entityId, sceneEntityIds(scene)));
  });

  /** The scene summary → results link (§3). Focus moves; the press never scrolls by itself. */
  const jumpToResults = (() => {
    const first = resultRef.current?.querySelector<HTMLElement>(".compose-candidate");
    if (first) { first.focus(); return; }
    resultRef.current?.focus();
  });

  const alerts: ComposeAlert[] = visible.phase === "failed"
    ? [failureAlert(visible.failure, visible.detail, visible.message || undefined)]
    : visible.phase === "ready" ? warningAlerts(visible.warnings) : [];

  /**
   * UCP06: vetoes the current brief contradicts.
   *
   * Derived, never stored: it is a function of the two things that can change independently
   * (the brief and the vetoes), and caching it would let a stale list survive an edit. Shown
   * as a choice, because resolving it discards something the user said either way.
   */
  const clashes = exclusionClashes(edit, DICTIONARY);

  /**
   * UIX02: the three numbers the user needs while the dictionary is folded.
   *
   * Derived from the same `chips`/`clashes` the rest of the panel renders, so the bar can
   * never disagree with the lists below it. `chips.chosen`/`chips.excluded` are already
   * filtered by `source`, which is why `excluded` here is a length and not a second filter.
   */
  const counts = {
    chosen: chips.chosen.length,
    excluded: chips.excluded.length,
    clashes: clashes.length,
    pinned: chips.pinned,
  };
  /**
   * Chips grouped by attribution for the multi-person view. Display only — the state array
   * is untouched, so request order and serialization do not move (UIX02 constraint).
   */
  const chipGroups = groupChips(chips.chosen, entityLabels, entities.length);

  const summary = visible.draft?.summaryKo ?? "";
  const questions = visible.phase === "needs_clarification" ? visible.questions : [];
  const candidates = visible.phase === "ready" ? visible.draft.candidates : [];
  const groups = Array.from(new Set(options.map((entry) => entry.category)));

  /**
   * UIX03: which candidate bodies are open for the *current* reply.
   *
   * A mismatched key means "this is a different reply", so the stored expansion is ignored
   * wholesale and the defaults apply. Deriving it here — instead of clearing it in an effect
   * — means the first render of a new reply already shows the right card, so no frame ever
   * pairs the new candidate ids with the previous reply's open set.
   */
  const viewKey = visible.draft?.resultId ?? "";
  const bodyView = candidateView.key === viewKey
    ? candidateView : { key: viewKey, expanded: [], collapsed: [] };
  /** The first body is open unless the user closed it; the rest only on request. */
  const bodyOpen = (candidateId: string, index: number): boolean => index === 0
    ? !bodyView.collapsed.includes(candidateId) : bodyView.expanded.includes(candidateId);
  const toggleBody = (candidateId: string, index: number) => {
    setCandidateView((current) => {
      const base = current.key === viewKey
        ? current : { key: viewKey, expanded: [], collapsed: [] };
      const list = index === 0 ? base.collapsed : base.expanded;
      const next = list.includes(candidateId)
        ? list.filter((id) => id !== candidateId) : [...list, candidateId];
      return index === 0 ? { ...base, collapsed: next } : { ...base, expanded: next };
    });
  };

  /**
   * UIX01 hand-off: report the session to `App` for the folded strip.
   *
   * Reported from the *same* `visible` the panel renders, so the strip cannot describe a
   * phase the panel is not in. The effect depends on the five scalars only — an object
   * dependency would fire every render and loop if `App` stored it unconditionally.
   */
  const statusFailure = visible.phase === "failed"
    ? failureAlert(visible.failure, visible.detail, visible.message || undefined).title : null;
  const statusPhase = visible.phase;
  const statusCandidateCount = candidates.length;
  useEffect(() => {
    onStatusChange?.({ phase: statusPhase, candidateCount: statusCandidateCount,
      stale, failureKo: statusFailure });
  }, [onStatusChange, statusPhase, statusCandidateCount, stale, statusFailure]);

  const fallback = composeFallbackNotice(capability);
  const placeholder = "예: 붉은 원피스를 입은 여성이 비 오는 거리에 서 있다";
  return <section className="compose" aria-label="통합 프롬프트 작성">
    {/* 1. Input. One Korean field; the dictionary is a second entry point, not a form. */}
    <div className="compose-input">
      <label className="compose-brief">장면 설명 (한국어)
        <textarea
          id="compose-brief" value={edit.briefKo} rows={4}
          maxLength={MAX_BRIEF_CHARS} placeholder={placeholder}
          aria-describedby="compose-brief-meta"
          onChange={(event) => update((current) => withBrief(current, event.target.value))}
          onKeyDown={onBriefKeyDown}
        />
      </label>
      <p className="compose-meta" id="compose-brief-meta">
        {edit.briefKo.length}/{MAX_BRIEF_CHARS}자 · 사전 선택만으로도 생성할 수 있습니다.
      </p>
      {examples.length > 0 && edit.briefKo.length === 0
        && <div className="compose-examples" role="group" aria-label="예시">
          {examples.map((example) => <button type="button" className="quiet" key={example}
            onClick={() => update((current) => withBrief(current, example))}>{example}</button>)}
        </div>}
      <div className="compose-actions">
        <button type="button" className="compose-generate" disabled={!canSend}
          aria-describedby="compose-status" onClick={composeNow}>
          {pending ? "생성 중…" : "프롬프트 만들기"}
        </button>
        {pending && <button type="button" className="quiet" onClick={cancel}>취소</button>}
        {(visible.phase === "failed" || visible.phase === "cancelled") && canSend
          && <button type="button" className="quiet" onClick={retry}>다시 시도</button>}
        <button type="button" className="quiet" aria-expanded={panelOpen}
          aria-controls="compose-dictionary" onClick={() => setPanelOpen((open) => !open)}>
          {panelOpen ? "사전 접기" : "사전에서 고르기"}
        </button>
      </div>
      {/* UIX02: the counts live *outside* `#compose-dictionary` so folding the panel keeps
          them readable. Each is a word plus a number — a colour or an icon alone would not
          survive a screenshot in a bug report. */}
      <div className="compose-counts" role="group" aria-label="선택 요약">
        <span className="compose-count" data-kind="chosen">
          선택 <strong>{counts.chosen}</strong>개
        </span>
        <span className="compose-count" data-kind="pinned">
          고정 <strong>{counts.pinned}</strong>개
        </span>
        <span className="compose-count" data-kind="excluded">
          제외 <strong>{counts.excluded}</strong>개
        </span>
        <span className="compose-count" data-kind="clashes"
          data-alert={counts.clashes > 0 || undefined}>
          미해결 충돌 <strong>{counts.clashes}</strong>건
        </span>
      </div>
      {fallback && <div className="compose-unavailable">
        <p className="compose-fallback" data-tone="caution">{fallback}</p>
        {onUseDirectInput && <button type="button" className="quiet compose-direct" onClick={onUseDirectInput}>
          최종 프롬프트 직접 입력
        </button>}
      </div>}
      <p className="compose-status" id="compose-status" role="status">{notice}</p>
    </div>

    {/* 2. Dictionary: search, group filter and counts stay together (§3). */}
    {panelOpen && <div id="compose-dictionary" className="compose-dictionary">
      <label>사전 검색
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="예: 인물, 조명, 전신" />
      </label>
      {/* UIX02: the search result count and the selection count are two different numbers,
          so they are labelled as such instead of both being "개". */}
      <p className="compose-meta compose-search-count" role="status">
        검색 결과 {options.length}개 · 선택 {counts.chosen}개
        {group ? ` · ${groupLabel(group)} 분류` : ""}
      </p>
      <div className="compose-groups" role="group" aria-label="사전 분류">
        {["", ...groups].map((item) => <button type="button" key={item || "all"}
          aria-pressed={group === item} onClick={() => setGroup(item)}>
          {item ? groupLabel(item) : "전체"}
          <span className="compose-group-count">
            {item ? chips.chosen.filter((chip) => chip.group === item).length : chips.chosen.length}
          </span>
        </button>)}
      </div>
      {options.length === 0 && <div className="compose-empty">
        <p>검색 결과가 없습니다.</p>
        <div className="compose-empty-actions">
          {query.length > 0 && <button type="button" className="quiet"
            onClick={() => setQuery("")}>검색어 지우기</button>}
          {group.length > 0 && <button type="button" className="quiet"
            onClick={() => setGroup("")}>전체 분류 보기</button>}
        </div>
      </div>}
      <ul className="compose-options">
        {options.slice(0, 40).map((entry) => {
          const selected = selectedIds.has(entry.id);
          const vetoed = edit.selections.some(
            (item) => item.id === entry.id && item.source === "excluded");
          return <li key={entry.id}>
            <button type="button" className="compose-option" aria-pressed={selected}
              data-excluded={vetoed || undefined}
              onClick={() => (vetoed ? unexclude(entry.id) : pick(entry.id))}>
              <span>{entry.labelKo}</span>
              <small>{groupLabel(entry.category)}{vetoed ? " · 제외됨" : ""}</small>
            </button>
          </li>;
        })}
      </ul>
      {options.length > 40 && <p className="compose-meta">
        {options.length}개 중 40개를 표시합니다. 검색으로 좁히세요.
      </p>}
    </div>}

    {/* 3. Interpretation: summary, chips by state, unmapped details. */}
    {visible.draft && <section className="compose-scene" aria-label="이렇게 이해했어요">
      <h3 className="compose-heading">이렇게 이해했어요</h3>
      <p className="compose-summary">{summary || "장면 요약이 없습니다."}</p>
      <div className="compose-chips">
        {/* UIX02: name and source are read first; the controls that edit this chip live in
            a labelled group inside the same card, so a press can never be ambiguous about
            which chip it applies to. Grouping by attribution is display-only — see
            `groupChips`; the state array and its order are untouched. */}
        {chipGroups.map((chipGroup) => <div className="compose-chip-group" key={chipGroup.key}
          data-group={chipGroup.key} role="group"
          aria-label={chipGroup.label ? `${chipGroup.label} 선택 항목` : "선택 항목"}>
          {chipGroup.label && <h4 className="compose-chip-group__heading">
            {chipGroup.label}
            <span className="compose-chip-group__count">{chipGroup.chips.length}개</span>
          </h4>}
          {chipGroup.chips.map((chip) => <div className="compose-chip" key={chip.id}
            data-source={chip.source} data-pinned={chip.pinned || undefined}>
            <span className="compose-chip__head">
              <span className="compose-chip__label">{chip.labelKo}</span>
              {chip.badges.map((badge) =>
                <span className="compose-chip__badge" key={badge}>{badge}</span>)}
              {chip.entityLabel && <span className="compose-chip__entity">{chip.entityLabel}</span>}
              {chip.unmapped && <span className="compose-chip__unmapped">이 모델 미변환</span>}
            </span>
            <span className="compose-chip__actions" role="group"
              aria-label={`${chip.labelKo} 조작`}>
              {chip.source === "manual" && <button type="button" className="quiet"
                aria-label={`${chip.labelKo} 직접 선택을 AI 선택으로 되돌리기`}
                onClick={() => toAuto(chip.id)}>AI에게 맡기기</button>}
              <button type="button" id={`compose-chip-${chip.id}`}
                aria-pressed={chip.pinned}
                aria-label={`${chip.labelKo} ${chip.pinned ? "고정 해제" : "고정"}`}
                onClick={() => togglePin(chip.id, !chip.pinned)}>고정</button>
              <button type="button" aria-label={`${chip.labelKo} 제거`}
                onClick={() => dropChip(chip.id)}>×</button>
              {/* Attribution is a select, not a toggle: with three people a toggle cannot say
                  which one, and "someone else" would silently move a dress to the wrong body. */}
              {entities.length > 0 && <label className="compose-chip__attribute">
                <span className="compose-chip__attribute-label">대상</span>
                <select value={chip.entityId ?? ""}
                  aria-label={`${chip.labelKo} 귀속 대상`}
                  onChange={(event) => attribute(chip.id, event.target.value || null)}>
                  <option value="">장면 전체</option>
                  {entities.map((entity) =>
                    <option key={entity.entityId} value={entity.entityId}>
                      {entityLabels.get(entity.entityId) ?? entity.entityId}
                    </option>)}
                </select>
              </label>}
            </span>
          </div>)}
        </div>)}
        {chips.chosen.length === 0 && <p className="compose-meta">
          사전에서 고른 항목이 없습니다. 원문만으로 후보를 만듭니다.
        </p>}
      </div>
      {/* UIX02: a veto is still a chip with a name and a source, so it reads the same way as
          a chosen one — name and badges first, the single recovery control after them. */}
      {chips.excluded.length > 0
        && <div className="compose-excluded" role="group" aria-label="제외한 항목">
          <strong>제외한 항목 {chips.excluded.length}개</strong>
          <ul>{chips.excluded.map((chip) => <li key={chip.id} data-chip-id={chip.id}>
            <span className="compose-excluded__head">
              <span className="compose-chip__label">{chip.labelKo}</span>
              {chip.badges.map((badge) =>
                <span className="compose-chip__badge" key={badge}>{badge}</span>)}
              {chip.entityLabel && <span className="compose-chip__entity">{chip.entityLabel}</span>}
            </span>
            <button type="button" className="quiet"
              aria-label={`${chip.labelKo} 제외 해제`}
              onClick={() => unexclude(chip.id)}>제외 해제</button>
          </li>)}</ul>
        </div>}
      {/* UCP06/UIX02: a veto the current brief contradicts. Both answers discard something
          the user said, so this asks instead of choosing — and it never applies on its own.
          Each row names the vetoed chip (with its source and pinned state, the same facts
          the chip card above shows) and keeps both UCP resolutions beside it, so the item
          and the fix for it are read together. */}
      {clashes.length > 0 && <div className="compose-clashes" role="group"
        aria-label="제외와 원문이 충돌합니다">
        <strong>원문과 제외 항목이 충돌합니다 · {clashes.length}건</strong>
        <p className="compose-meta">
          제외한 항목을 원문에서 다시 말했습니다. 둘 중 하나는 포기해야 하므로 선택해 주세요.
        </p>
        <ul>{clashes.map((clash) => {
          const entry = DICTIONARY.find((item) => item.id === clash.id);
          const vetoed = chips.excluded.find((chip) => chip.id === clash.id);
          return <li key={clash.id} data-chip-id={clash.id}>
            <span className="compose-clashes__target">
              <span className="compose-clashes__label">{entry?.labelKo ?? clash.id}</span>
              {vetoed && vetoed.badges.map((badge) =>
                <span className="compose-chip__badge" key={badge}>{badge}</span>)}
              <span className="compose-clashes__phrase">원문에 “{clash.phrase}”</span>
              {vetoed?.entityLabel && <span className="compose-chip__entity">{vetoed.entityLabel}</span>}
            </span>
            <span className="compose-clashes__actions">
              {CLASH_RESOLUTIONS.map((resolution) =>
                <button type="button" className="quiet" key={resolution.value}
                  aria-label={`${entry?.labelKo ?? clash.id} ${resolution.labelKo}`}
                  onClick={() => resolve(clash.id, resolution.value)}>
                  {resolution.labelKo}
                </button>)}
            </span>
          </li>;
        })}</ul>
      </div>}
      {scene.unmappedDetails.length > 0 && <div className="compose-notice" data-tone="info">
        <strong>사전에 없는 디테일</strong>
        <ul>{scene.unmappedDetails.map((detail, index) =>
          <li key={index}>{detail.textKo}</li>)}</ul>
        <span>원문 그대로 보존되며 후보에 반영됩니다.</span>
      </div>}
      {scene.entities.length > 0 && <p className="compose-meta">
        장면 대상 {scene.entities.length}개 · 관계 {scene.relations.length}개
      </p>}
      <button type="button" className="quiet" onClick={jumpToResults}>결과로 이동</button>
    </section>}

    {/* 4. Alerts, in the three categories the spec separates. */}
    {alerts.length > 0 && <ul className="compose-alerts">
      {alerts.map((alert) => <li className="compose-alert" key={alert.key}
        data-category={alert.category} data-tone={alert.tone}>
        <strong>{alert.title}</strong>
        <span>{alert.message}</span>
      </li>)}
    </ul>}

    {/* 5. Clarification: applying stays blocked until an answer is sent. */}
    {questions.length > 0
      && <section className="compose-clarify" id="compose-clarify"
        aria-labelledby="compose-clarify-heading">
        <h3 className="compose-heading" id="compose-clarify-heading">확인이 필요합니다</h3>
        <p className="compose-meta">답하기 전에는 후보를 적용할 수 없습니다.</p>
        {questions.map((question) =>
          <fieldset className="compose-question" key={question.questionId}>
            <legend>{question.questionKo}
              <span className="compose-question__why">
                {WHY_LABEL[question.why] ?? question.why}
              </span>
            </legend>
            {question.options.map((option) => <button type="button" className="quiet"
              key={option.optionId} onClick={() => answer(question.questionId, option.optionId)}>
              {option.labelKo}
            </button>)}
          </fieldset>)}
      </section>}

    {/* 6. Candidates. Bodies are expanded by default (§3); apply is a separate press. */}
    <div className="compose-results" ref={resultRef} tabIndex={-1}
      aria-label="영어 후보" aria-live="polite">
      {stale && candidates.length > 0 && <p className="compose-notice" data-tone="caution">
        입력이나 선택이 바뀌었습니다. 표시된 후보는 이전 장면 기준이므로 적용할 수 없습니다.
        다시 생성하세요.
      </p>}
      {candidates.map((candidate, index) => {
        const diff = applyDiff(candidate, { currentPrompt: prompt,
          currentNegative: negative, negativeSupported });
        const isApplied = visible.applied?.candidateId === candidate.candidateId;
        const open = bodyOpen(candidate.candidateId, index);
        const bodyId = `compose-candidate-body-${candidate.candidateId}`;
        // UIX03: the headline answers "which candidate is this and does it change my text"
        // before any long English body is read. The toggle is the header, so the open state
        // and the title are one control and the keyboard has a single stop per card.
        return <article className="compose-candidate" key={candidate.candidateId}
          tabIndex={-1} data-applied={isApplied || undefined} data-open={open || undefined}>
          <h4>
            <button type="button" className="compose-candidate__toggle"
              aria-expanded={open} aria-controls={bodyId}
              onClick={() => toggleBody(candidate.candidateId, index)}>
              <span className="compose-candidate__title">
                {index === 0 ? "원문 충실" : `대안 ${index}`} · {candidate.titleKo}
              </span>
              <span className="compose-candidate__impact">
                {diff.positive === "same" ? "최종 프롬프트 같음" : "최종 프롬프트 교체"}
                {diff.negative === "replace" ? " · negative 교체"
                  : diff.negative === "blocked" ? " · negative 빠짐" : " · negative 유지"}
              </span>
              {isApplied && <span className="compose-candidate__applied" role="status">적용됨</span>}
              <span className="compose-candidate__chevron" aria-hidden="true">
                {open ? "접기" : "펼치기"}
              </span>
            </button>
          </h4>
          <p className="compose-candidate__difference">{candidate.differenceKo}</p>
          <div className="compose-candidate__body" id={bodyId} hidden={!open}>
            <p className="compose-candidate__prompt">{candidate.positivePrompt}</p>
            {candidate.negativePrompt !== null && <p className="compose-candidate__negative">
              negative: {candidate.negativePrompt}
              {diff.negative === "blocked" && <span className="compose-candidate__block">
                {" "}· 이 모델은 negative prompt를 지원하지 않아 적용 시 빠집니다
              </span>}
            </p>}
            {candidate.preservedKo.length > 0 && <ul className="compose-candidate__preserved">
              {candidate.preservedKo.map((item) => <li key={item}>{item}</li>)}
            </ul>}
            {/* The diff names the field it will *touch*: a candidate with no negative leaves
                the user's own negative alone, so "negative 유지" is a fact, not a placeholder. */}
            <p className="compose-candidate__diff">
              최종 프롬프트: {diff.positive === "same" ? "같음" : "교체"}
              {diff.negative === "replace" ? " · negative 교체"
                : diff.negative === "blocked" ? " · negative 빠짐" : " · negative 유지"}
            </p>
          </div>
          <button type="button" className="compose-apply"
            onClick={() => apply(candidate.candidateId)}>
            {armed === candidate.candidateId ? "negative 없이 적용" : "이 프롬프트 사용"}
          </button>
        </article>;
      })}
      {/* UCP06: one-step undo, next to the result it undoes. The warning is text, not a
          disabled button: undo still works, it just tells the user what it supersedes.
          `undoTarget`, not `undoable`, decides whether the row exists — a step captured for
          another model is still undoable (the text is the user's), it just cannot bring its
          applied record back, and `undo` says so in its notice. */}
      {undoTarget !== null && onRestore && <div className="compose-undo">
        <button type="button" className="quiet" onClick={undo}>적용 되돌리기</button>
        {undoLossy && <p className="compose-meta" data-tone="caution">
          적용 후 직접 수정한 내용이 있습니다. 되돌리면 그 수정이 적용 전 상태로 바뀝니다.
        </p>}
      </div>}
    </div>
  </section>;
}
