import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compileScene, DRAFT_LIMIT } from "../prompt/compiler";
import { type PromptBuilderState, isDraftStale, withGeneratedDraft, withAppliedDraft, draftComposition } from "../prompt/builderState";
import { DICTIONARY, DICTIONARY_VERSION, familyCoverage, type DictionaryEntry } from "../prompt/dictionary";
import { changeSceneFamily, removeEntry, selectEntry, type SceneSpecification } from "../prompt/scene";
import { explainWarning, suggestSelections } from "../prompt/proposals";
import {
  type ProposalCapability, UNSUPPORTED, proposalActionLabel, proposalFallbackNotice,
} from "../prompt/proposalCapability";
import {
  ERROR_MESSAGES, IDLE, VARIANT_KIND, cancelProposal, dismissProposal,
  invalidateProposal, isPending, newRequestId, proposalBody, proposalNotice, reapplyProposal,
  revisionsFor, runProposal, settleProposal, startProposal, unapplyProposal,
  VARIANT_GROUPS,
  type ProposalRevisions, type ProposalState,
} from "../prompt/llmProposals";
import {
  blockReason, cardConfidence, proposalCards, type ProposalCard,
} from "../prompt/proposalCards";
import {
  LOCK_NOTE, describeScope, partialDiff, partialScope, scopeIsActive,
} from "../prompt/partialChange";
import {
  variantBlockReason, variantCards, variantHeadline, type VariantCard,
} from "../prompt/situationVariants";
import {
  applyVariantScene, recordVariantApply, undoVariantScene, variantUndoStatus,
  type VariantApplyRecord,
} from "../prompt/variantApply";
import {
  recordAcceptance, undoScene, undoStatus, type AcceptRecord,
} from "../prompt/proposalUndo";
import {
  DISPLAY_GROUP as displayGroup, activeGroups, filterOptions, nextFocusAfterRemoval,
  selectionCounts, recoveryActions, previewControls, inclusionNotice, appliedStatus,
  advisoryWarnings, unresolvedSelections, sceneSummary, summaryIsEmpty,
} from "../prompt/presentation";
import { SCENE_EXAMPLES, applyExample, type SceneExample } from "../prompt/examples";
import { characterCount, validateComposition, validateText } from "../prompt/validation";

const labels: Record<string, string> = {
  subject: "대상", appearance: "외형", clothing: "의상", expression: "표정", action: "동작", pose: "포즈",
  location: "장소", setting: "배경", composition: "구도", camera: "카메라", lighting: "조명", style: "스타일", mood: "분위기",
};

type Props = {
  family: string;
  compositionSupported: boolean;
  value: string;
  onChange: (value: string) => void;
  state: PromptBuilderState;
  setState: (update: (state: PromptBuilderState) => PromptBuilderState) => void;
  /** LLM-I04: server capability. Absent/false keeps the rule-based panel only. */
  proposalCapability?: ProposalCapability;
  /** Sends one proposal request. `undefined` on an unsupported server. */
  sendProposal?: (body: unknown, signal: AbortSignal) => Promise<unknown>;
};

/**
 * Background guidance stays collapsed by default: at 1440px these paragraphs cost
 * 112px and at 360px 162px of the composer, and the U11 measurement showed that
 * cost pushed the apply control further away. State and contract text (inclusion,
 * warnings, errors, counts) is never placed here.
 */
function HelpNote({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="prompt-help"><summary>{summary}</summary><p className="prompt-hint">{children}</p></details>;
}

export default function PromptBuilder({
  family, compositionSupported, value, onChange, state, setState, proposalCapability, sendProposal,
}: Props) {
  const [open, setOpen] = useState(false);
  /** UX02: the dictionary picker is the detail step, so it starts folded. */
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [notice, setNotice] = useState("");
  /** Incremented whenever focus should land in the search input after the commit. */
  const [focusTick, setFocusTick] = useState(0);
  /** Hints stay hidden until the user asks; nothing is proposed while typing. */
  const [hintsOpen, setHintsOpen] = useState(false);
  /** Set before the render that removes a chip; consumed after that render. */
  const pendingFocusRef = useRef<{ target: string | null } | null>(null);
  /**
   * LLM-I05: accepting a card removes the buttons inside it, including the one that
   * had focus. The tick runs the restore after the commit, like the chip removal.
   */
  const [cardFocusTick, setCardFocusTick] = useState(0);
  const batchRef = useRef<HTMLButtonElement | null>(null);
  const aiRef = useRef<HTMLButtonElement | null>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchRef = useRef<HTMLInputElement | null>(null);
  /**
   * LLM-I04 state. Kept local to the composer: App's builder state, the final prompt
   * and the accepted draft are untouched by a proposal request, in any outcome.
   */
  const [proposal, setProposal] = useState<ProposalState>(IDLE);
  const proposalAbortRef = useRef<AbortController | null>(null);
  /**
   * LLM-I06 partial change: the groups the user wants changed, and the one-step undo
   * record. Both are local to the composer — no scene or server field is added.
   */
  const [targetGroups, setTargetGroups] = useState<string[]>([]);
  const [acceptRecord, setAcceptRecord] = useState<AcceptRecord | null>(null);
  /**
   * VAR02: the scene a chosen situation was applied to, and the fingerprint it
   * produced. Both live here, next to `acceptRecord`: a candidate is a scene edit, so
   * it gets the same one-step undo, decided by the fingerprint rather than a timer.
   */
  const [variantRecord, setVariantRecord] = useState<VariantApplyRecord | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const capability = proposalCapability ?? UNSUPPORTED;
  const aiEnabled = capability.supported && Boolean(sendProposal);
  const revisions = useMemo(() => revisionsFor(state.scene), [state.scene]);
  /** Read inside async settle so the guard sees the state at reply time, not at send. */
  const revisionsRef = useRef<ProposalRevisions>(revisions);
  /**
   * LLM-I04: `settleProposal` runs after an await, so it cannot read the render
   * closure. The ref is the *current* fingerprint, written by an effect rather than
   * during render (a ref write in render is a React violation). The effect flushes
   * on commit, long before a reply can arrive, so a reply always compares against the
   * fingerprint of the screen the user is looking at.
   */
  useEffect(() => { revisionsRef.current = revisions; }, [revisions]);
  /**
   * The visible state is derived, never written by an effect: as soon as the text,
   * the model family or the selection changes, an in-flight request reads as
   * cancelled ("stale") and its reply is discarded at settle time. That keeps the
   * screen honest while typing without a setState per keystroke.
   */
  const visibleProposal = invalidateProposal(proposal, revisions);
  const loading = isPending(visibleProposal) ? visibleProposal : null;
  const pending = loading !== null;
  /** VAR02: a variant request in flight has its own cancel label in its own button. */
  const pendingVariant = loading !== null && loading.kind === VARIANT_KIND;
  const statusNotice = proposalNotice(visibleProposal);
  /**
   * LLM-I05 cards. Recomputed from the dictionary and the current selection on every
   * render, so `already_selected`/`unmapped` follow the screen instead of the reply.
   * LLM-I06 adds the request scope, so a locked or out-of-scope ID is blocked here as
   * well as on the server.
   */
  const cards = useMemo(
    () => (visibleProposal.phase === "ready" || visibleProposal.phase === "empty"
      ? proposalCards({
        reply: visibleProposal.reply, scene: state.scene, dictionary: DICTIONARY, family,
        scope: visibleProposal.scope,
      })
      : null),
    [visibleProposal, state.scene, family],
  );
  /** The scope a *fresh* request would carry: what the button label and panel show. */
  const scope = partialScope(state.scene, targetGroups);
  const scopeActive = scopeIsActive(scope);
  /** The diff is only meaningful for a reply that arrived for a scope. */
  const diff = useMemo(() => {
    if (!cards) return null;
    const settled = visibleProposal;
    if (settled.phase !== "ready" && settled.phase !== "empty") return null;
    if (!settled.scope) return null;
    return partialDiff({ cards, scene: state.scene, scope: settled.scope });
  }, [cards, visibleProposal, state.scene]);
  const undo = undoStatus(acceptRecord, state.scene, revisions);
  /**
   * VAR02: the one-step undo of a chosen situation. `variantUndoStatus` compares the
   * fingerprint of the scene the candidate produced with the current one, so a chip the
   * user removed after applying refuses the undo instead of overwriting that removal.
   */
  const variantUndo = variantUndoStatus(variantRecord, revisions);
  /** The card that produced the current selection, if the scene still matches it. */
  const appliedVariantKey = variantRecord !== null && variantUndo.allowed ? variantRecord.key : null;
  /**
   * VAR02: the status line above says "아직 선택에 반영하지 않았습니다" until a card is
   * accepted. Applying a situation is an explicit acceptance, so the same line has to
   * say so; a candidate is not a suggestion, so `acceptedIds` cannot carry that fact.
   */
  const proposalStatus = statusNotice !== null && appliedVariantKey !== null && variantRecord !== null
    && visibleProposal.phase === "ready" && visibleProposal.kind === VARIANT_KIND
    ? { tone: statusNotice.tone,
        text: `“${variantRecord.labelKo}” 상황을 적용했습니다. 다른 후보와 비교하거나 바로 되돌릴 수 있습니다.` }
    : statusNotice;
  /**
   * The scene the candidates are judged against.
   *
   * While one candidate is applied and nothing else has moved, that is the scene *before*
   * the apply: the candidates were written for it, so taking the second one must not be
   * blocked as "지금 선택에 없는 항목입니다" just because the first was taken. Any other
   * edit withdraws the reply anyway (`invalidateProposal`), so this is the only case
   * where the two differ.
   */
  const variantBase = appliedVariantKey !== null && variantRecord !== null ? variantRecord.before : state.scene;
  /**
   * VAR01: candidates are rendered from the reply and the *current* selection, like the
   * suggestion cards, so a chip the user removes after the reply changes the diff
   * instead of leaving a stale one. VAR02 adds the explicit per-card apply.
   */
  const variants = useMemo(() => {
    const settled = visibleProposal;
    if (settled.phase !== "ready" && settled.phase !== "empty") return null;
    if (settled.kind !== VARIANT_KIND) return null;
    return variantCards({
      reply: settled.reply, scene: variantBase, dictionary: DICTIONARY, family, scope: settled.scope,
    });
  }, [visibleProposal, variantBase, family]);
  const selected = new Set(state.scene.selections.map((item) => item.id));
  const categories = activeGroups(DICTIONARY);
  const counts = selectionCounts(state.scene.selections);
  const options = useMemo(() => filterOptions(DICTIONARY, query, category), [query, category]);
  const coverage = useMemo(() => (family ? familyCoverage(DICTIONARY, family) : null), [family]);
  const dirty = isDraftStale(state);
  const candidate = draftComposition(state);
  const separateOnly = state.result?.draft === "" && state.freeTextMode === "separate" && state.scene.freeTextKo.length > 0;
  const draftIssues = state.result ? validateText(separateOnly ? value : state.result.draft, separateOnly ? "prompt" : "draft_prompt", 8000, true) : [];
  const compositionIssues = candidate ? validateComposition(candidate, family) : [];
  const issues = compositionSupported ? [...draftIssues, ...compositionIssues] : draftIssues;
  const freeIssues = validateText(state.scene.freeTextKo, "free_text_ko", 4000);
  const blocked = issues.length > 0;
  const selectedKey = state.scene.selections.map((item) => item.id).join("\u0000");
  const controls = previewControls(state, family, { blocked, separateOnly, prompt: value, dirty });
  const inclusion = inclusionNotice(state, state.result);
  const status = appliedStatus(state, value);
  /**
   * UX04: the Korean summary and the chips read the same rows, so the flat DOM order
   * of the remove buttons (and therefore focus restoration) cannot drift. Summary rows
   * are contiguous over display groups, which keeps that promise across the merge of
   * 외형/의상, 표정/행동 and 조명/스타일.
   */
  const summaries = sceneSummary(state.scene.selections);
  const chipOrder = summaries.flatMap((row) => row.items.map((item) => item.id));
  const empty = summaryIsEmpty(summaries);
  const unresolved = unresolvedSelections(state.result);
  const advisories = advisoryWarnings(state.result);
  // Recomputed from the immutable free text only when the user opens the panel.
  const hints = useMemo(() => (hintsOpen && family
    ? suggestSelections({ freeTextKo: state.scene.freeTextKo, family, dictionary: DICTIONARY, selectedIds: selectedKey.split("\u0000") })
    : []), [hintsOpen, family, state.scene.freeTextKo, selectedKey]);

  /**
   * Focus that must wait for the commit runs here, not in the click handler: the
   * disclosure is a prop-driven `details`, so the search input is only reachable
   * once React has written `open`. A rAF flushed before the commit focuses a hidden
   * element and the entry-point regression looks like a keyboard trap.
   */
  useEffect(() => {
    if (!focusTick) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusTick]);

  /**
   * Removing a chip unmounts the button that had focus. Restore it to the next
   * rendered chip, then the previous one, and finally the search input. The search
   * input lives inside the folded detail step, so the disclosure is opened first
   * (UX02: focus never lands on a hidden control).
   *
   * The dependency is the chip count: every caller of `pendingFocusRef` changes it
   * by removing at least one chip, so the effect runs exactly once per removal and
   * never in a loop.
   */
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const target = pending.target !== null ? removeRefs.current.get(pending.target) : undefined;
    if (target) { target.focus(); return; }
    if (!pending.target && chipOrder.length === 0) {
      setAdjustOpen(true);
      setFocusTick((tick) => tick + 1);
    }
  }, [chipOrder.length]);

  /**
   * Accepting a card unmounts the button that had focus (the item is no longer a
   * suggestion). Focus moves to the first still-actionable card, then the batch
   * action, then the AI button: never to a hidden control and never to `document.body`.
   *
   * The target is found in the committed DOM, not in a ref map: the accepted card's
   * ref is detached in the same commit, so a map lookup can miss the survivor.
   */
  useEffect(() => {
    if (!cardFocusTick) return;
    // VAR02 adds two more places a button can vanish from: the applied card's "적용" and
    // the situation undo line. Both are in the same panel, so they join the same chain
    // instead of dropping focus to `document.body`.
    const next = document.querySelector<HTMLButtonElement>(
      "#prompt-cards .prompt-card button:not(:disabled), #prompt-variants .prompt-variant button:not(:disabled),"
      + " .prompt-variant-undo button:not(:disabled), .prompt-undo button:not(:disabled)",
    );
    (next ?? batchRef.current ?? aiRef.current)?.focus();
  }, [cardFocusTick]);

  function setScene(update: (scene: SceneSpecification) => SceneSpecification) {
    setState((current) => {
      const scene = current.scene.targetFamily === family ? current.scene : changeSceneFamily(current.scene, family, DICTIONARY, DICTIONARY_VERSION);
      const next = { ...current, scene: update(scene) };
      return family ? withGeneratedDraft(next, compileScene(next.scene)) : next;
    });
  }

  /** The scene a click is about to edit, rebound to the current family when needed. */
  function boundScene(scene: SceneSpecification): SceneSpecification {
    return scene.targetFamily === family
      ? scene
      : changeSceneFamily(scene, family, DICTIONARY, DICTIONARY_VERSION);
  }

  function setFreeText(freeTextKo: string) {
    setScene((scene) => ({ ...scene, freeTextKo }));
  }

  /**
   * UX05: an example only replaces the free text. The final prompt is untouched and
   * the regular stale/apply policy decides whether the draft may still be applied.
   * Cancelling leaves every field, including the draft, exactly as it was.
   */
  function insertExample(example: SceneExample) {
    const next = applyExample(state.scene.freeTextKo, example,
      () => window.confirm("입력한 설명을 예시로 바꿉니다. 최종 프롬프트는 그대로입니다. 계속할까요?"));
    if (next === null) { setNotice("예시 적용을 취소했습니다. 입력한 설명은 그대로입니다."); return; }
    setFreeText(next);
    setNotice(`“${example.title}” 예시를 넣었습니다. 필요한 부분을 고쳐 쓰세요.`);
  }

  /** Decides the focus target before the removal so the render can restore it. */
  function removeChip(id: string) {
    pendingFocusRef.current = { target: nextFocusAfterRemoval(chipOrder, id) };
    setScene((scene) => removeEntry(scene, id));
  }

  function generate() {
    if (!family) { setNotice("먼저 모델을 선택하세요."); return; }
    const scene = state.scene.targetFamily === family ? state.scene : changeSceneFamily(state.scene, family, DICTIONARY, DICTIONARY_VERSION);
    setState((current) => withGeneratedDraft({ ...current, scene }, compileScene(scene)));
    setNotice("초안을 만들었습니다. 확인한 뒤 최종 프롬프트에 적용하세요.");
  }

  function applyDraft() {
    if (!state.result || (!state.result.draft && !separateOnly) || dirty || blocked || state.result.targetFamily !== family) return;
    if (separateOnly) {
      setState((current) => withAppliedDraft(current, value));
      setNotice("추가 설명을 구성 이력에 적용했습니다. 최종 프롬프트는 유지됩니다.");
      return;
    }
    if (value && value !== state.result.draft && !window.confirm("현재 프롬프트를 초안으로 바꿉니다. 직접 수정한 내용도 덮어씁니다. 계속할까요?")) return;
    setState((current) => withAppliedDraft(current));
    onChange(state.result.draft);
    setNotice("초안을 최종 프롬프트에 적용했습니다. 필요하면 직접 수정하세요.");
  }

  function clearScene() {
    if (state.scene.selections.length && !window.confirm("선택한 사전 항목을 모두 해제합니다. 추가 설명과 최종 프롬프트는 유지됩니다. 계속할까요?")) return;
    pendingFocusRef.current = { target: null };
    setScene((scene) => ({ ...scene, selections: [] }));
    setNotice("선택을 비웠습니다. 미리보기를 확인하세요.");
  }

  /** Only ever removes duplicates the explanation explicitly marked as redundant. */
  function removeRedundant(ids: string[]) {
    if (!ids.length) return;
    const remaining = chipOrder.filter((id) => !ids.includes(id));
    pendingFocusRef.current = { target: remaining[0] ?? null };
    setScene((scene) => ids.reduce((next, id) => removeEntry(next, id), scene));
    setNotice("중복 항목을 해제했습니다. 미리보기를 확인하세요.");
  }

  function acceptHint(id: string) {
    const entry = DICTIONARY.find((item) => item.id === id && item.active);
    if (!entry) return;
    setScene((scene) => selectEntry(scene, entry, DICTIONARY_VERSION));
    setNotice(`"${entry.labelKo}"을(를) 선택에 추가했습니다. 원문은 그대로 유지됩니다.`);
  }

  /**
   * LLM-I05: accepting a card uses the same `selectEntry`/`compileScene` path as a
   * checkbox, so a proposal cannot produce a scene the picker could not. The reply is
   * re-based on the new fingerprint (`reapplyProposal`) so the remaining cards survive
   * the click; editing the text still withdraws all of them.
   */
  function acceptCards(entries: { id: string; entry: DictionaryEntry; labelKo: string }[]) {
    if (!entries.length) return;
    const previousIds = state.scene.selections.map((item) => item.id);
    const next = entries.reduce(
      (scene, item) => selectEntry(scene, item.entry, DICTIONARY_VERSION), boundScene(state.scene),
    );
    setState((current) => {
      const updated = { ...current, scene: next };
      return family ? withGeneratedDraft(updated, compileScene(next)) : updated;
    });
    // LLM-I06: what this click added, and the fingerprint it produced. The undo button
    // reads the current revisions, so a later edit refuses the undo instead of
    // reverting a scene the record no longer describes.
    const record = recordAcceptance({
      ids: entries.map((item) => item.id), labels: entries.map((item) => item.labelKo),
      previousIds, revisions: revisionsFor(next),
    });
    if (record.ids.length > 0) setAcceptRecord(record);
    // VAR02: one undo slot. An acceptance and a chosen situation are both "the last
    // scene edit", so taking a card replaces the situation record instead of leaving two
    // undo lines that each describe a different scene.
    setVariantRecord(null);
    // Re-base the reply on the selection the click just produced, so the remaining
    // cards stay usable. A text edit still invalidates everything (see the module).
    setProposal((current) => reapplyProposal(
      current, revisionsFor(next), entries.map((item) => item.id),
    ));
    setCardFocusTick((tick) => tick + 1);
    setNotice(entries.length === 1
      ? `"${entries[0].labelKo}"을(를) 선택에 추가했습니다. 원문과 최종 프롬프트는 그대로입니다.`
      : `제안 ${entries.length}개를 선택에 추가했습니다. 원문과 최종 프롬프트는 그대로입니다.`);
  }

  function acceptCard(card: ProposalCard) {
    if (!card.entry || card.id === null || card.blocks.length > 0) return;
    acceptCards([{ id: card.id, entry: card.entry, labelKo: card.labelKo }]);
  }

  /** Batch acceptance: quoted, unblocked cards only (C01-3). Nothing is guessed. */
  function acceptBatch() {
    if (!cards) return;
    const ids = new Set(cards.batchIds);
    const entries = cards.cards
      .filter((card) => card.id !== null && ids.has(card.id) && card.entry !== null)
      .map((card) => ({ id: card.id as string, entry: card.entry as DictionaryEntry, labelKo: card.labelKo }));
    acceptCards(entries);
  }

  /**
   * LLM-I06 one-step undo. It removes only the IDs the acceptance added, and only while
   * `undoStatus` says the scene still matches that acceptance: a later hand edit or a
   * text change refuses it rather than overwriting the user's work.
   */
  function undoCards() {
    if (!acceptRecord || !undo.allowed) return;
    const next = undoScene(boundScene(state.scene), acceptRecord);
    setState((current) => {
      const updated = { ...current, scene: next };
      return family ? withGeneratedDraft(updated, compileScene(next)) : updated;
    });
    setProposal((current) => unapplyProposal(current, revisionsFor(next), undo.ids));
    setAcceptRecord(null);
    setNotice(undo.ids.length === 1
      ? `방금 추가한 "${acceptRecord.labels[acceptRecord.ids.indexOf(undo.ids[0])] ?? undo.ids[0]}"을(를) 되돌렸습니다. 원문과 최종 프롬프트는 그대로입니다.`
      : `방금 추가한 ${undo.ids.length}개를 되돌렸습니다. 원문과 최종 프롬프트는 그대로입니다.`);
    // The chip's × button disappears with the chip, so focus goes to the next control
    // that still exists instead of `document.body`.
    setCardFocusTick((tick) => tick + 1);
  }

  /**
   * VAR02: turning one candidate into a selection.
   *
   * The candidate is applied through the same `selectEntry`/`removeEntry` path a chip
   * uses, then the draft is regenerated like any other selection edit. The final prompt
   * is not touched: applying it stays the explicit "적용" step, exactly as before.
   *
   * The record keeps the *whole* pre-apply scene because a candidate can also remove a
   * place or action, and re-adding it by id would lose the expression it was selected
   * with. A blocked card is refused here too, in case a click races a render.
   *
   * `variantBase` is the scene the cards were judged against. Applying a second
   * candidate therefore swaps from the same starting scene the first one used, instead
   * of stacking two situations, and the undo always lands on that one scene.
   */
  function applyVariant(card: VariantCard) {
    if (card.blocks.length > 0) return;
    // Recorded exactly as applied, so the undo restores the scene the user was looking
    // at even after a family rebind, like `undoCards` does.
    const before = boundScene(variantBase);
    const applied = applyVariantScene({
      scene: before, card, dictionary: DICTIONARY, dictionaryVersion: DICTIONARY_VERSION,
    });
    if (applied === null) {
      setNotice("이 상황은 지금 선택에 반영할 수 없습니다. 상황 후보를 다시 요청하세요.");
      return;
    }
    const next = applied.scene;
    setState((current) => {
      const updated = { ...current, scene: next };
      return family ? withGeneratedDraft(updated, compileScene(next)) : updated;
    });
    setVariantRecord(recordVariantApply({
      key: card.key, variantId: card.variantId, labelKo: card.labelKo, before, after: next,
    }));
    // The mirror image: a chosen situation is now the last scene edit, so the card
    // acceptance's undo is replaced rather than shown next to a different one.
    setAcceptRecord(null);
    // The cards are rebuilt from the new selection anyway; re-basing keeps the reply
    // alive for a second look instead of withdrawing it as stale after one click.
    setProposal((current) => reapplyProposal(current, revisionsFor(next)));
    setCardFocusTick((tick) => tick + 1);
    // A candidate may carry Korean the dictionary cannot express. Those words are not
    // applied, and the sentence says so instead of leaving the user to notice.
    const missed = card.unresolvedKo.length
      ? ` 사전에 없는 표현 “${card.unresolvedKo.join("”, “")}”은(는) 반영되지 않았습니다.`
      : "";
    setNotice(`“${card.labelKo}” 상황을 선택에 반영했습니다.${missed} 원문과 최종 프롬프트는 그대로입니다.`);
  }

  /**
   * VAR02 undo: restores the scene the candidate was applied to, in one step. The
   * fingerprint gate is `variantUndoStatus`; a chip removed after the apply refuses the
   * undo instead of re-adding everything the candidate touched.
   */
  function undoVariant() {
    if (!variantRecord || !variantUndo.allowed) return;
    const next = undoVariantScene(variantRecord);
    setState((current) => {
      const updated = { ...current, scene: next };
      return family ? withGeneratedDraft(updated, compileScene(next)) : updated;
    });
    setProposal((current) => unapplyProposal(current, revisionsFor(next)));
    setVariantRecord(null);
    setCardFocusTick((tick) => tick + 1);
    setNotice(`“${variantRecord.labelKo}” 상황 적용을 되돌렸습니다. 원문과 최종 프롬프트는 그대로입니다.`);
  }

  /** Refusal: closes the cards and leaves the selection exactly as it was. */
  function dismissCards() {
    setProposal((current) => dismissProposal(current));
    setNotice("AI 제안을 닫았습니다. 원문과 선택은 그대로입니다.");
  }

  /**
   * LLM-I04: one explicit attempt, never on typing. The request is built from an
   * immutable snapshot, and the reply is only adopted when both its `request_id` and
   * its revisions still describe this screen. A cancel or a stale answer leaves the
   * text, the selections and the final prompt exactly as they were.
   */
  async function requestProposal(mode: "scene" | "variant" = "scene") {
    if (!aiEnabled || !sendProposal) return;
    if (pending) {
      cancelProposalRequest();
      return;
    }
    // `random` and the clock are avoided: an id only needs to be unique per screen.
    const requestId = newRequestId();
    // LLM-I06: an open partial scope turns the same button into "조명만 변경". The
    // locked IDs are derived from the scene on screen, so the user never types them.
    // VAR02: a situation request is always place/action only, so its scope is derived
    // from `VARIANT_GROUPS` and never from the picker above — the cast stays locked
    // even when the user happens to have "대상" selected as a partial target.
    const scope = partialScope(state.scene, mode === "variant" ? [...VARIANT_GROUPS] : targetGroups);
    const built = proposalBody({
      scene: state.scene, family, dictionaryVersion: DICTIONARY_VERSION, requestId, scope,
      variant: mode === "variant",
    });
    if ("code" in built) {
      setProposal({ phase: "error", message: ERROR_MESSAGES[built.code] });
      return;
    }
    // Abort whatever was still open, then register the new controller before any await
    // so a cancel click during the send always finds something to abort.
    const controller = new AbortController();
    proposalAbortRef.current?.abort();
    proposalAbortRef.current = controller;
    setProposal((current) => startProposal(current, {
      requestId, revisions: built.body.revisions,
      kind: built.body.kind,
      // VAR01: candidates keep their scope on the state too, so the client can block a
      // locked or out-of-scope candidate without trusting the reply (VAR02 sends it).
      scope: built.body.target_groups
        ? { targetGroups: built.body.target_groups, lockedIds: built.body.locked_ids ?? [] }
        : null,
    }));
    const outcome = await runProposal({
      body: built.body, send: sendProposal, signal: controller.signal, timeoutMs: capability.timeoutMs,
    });
    if (proposalAbortRef.current === controller) proposalAbortRef.current = null;
    // `revisionsRef`, not `built.body.revisions`: the user may have edited since.
    setProposal((current) => settleProposal(current, {
      requestId, outcome, currentRevisions: revisionsRef.current,
    }));
  }

  function cancelProposalRequest() {
    proposalAbortRef.current?.abort();
    proposalAbortRef.current = null;
    setProposal((current) => cancelProposal(current));
  }

  /**
   * GAP03 decision: the picker opens on the whole dictionary. The narrowing step is
   * offered only where it is needed (empty scene) and only as one click, so a
   * subject-first start never hides the other groups or adds an entry screen.
   * UX02: the picker now lives behind a disclosure, so the disclosure opens first;
   * focusing a control inside a closed `details` would be a no-op. The focus itself
   * runs in the `focusTick` effect, after the open state is committed.
   */
  function startWithSubject() {
    setAdjustOpen(true);
    setCategory("subject");
    setQuery("");
    setFocusTick((tick) => tick + 1);
  }

  return <div className="prompt-builder">
    <button type="button" className="quiet" aria-expanded={open} aria-controls="prompt-builder-panel" onClick={() => setOpen(!open)}>
      {open ? "프롬프트 구성 닫기" : "프롬프트 구성 열기"}
    </button>
    <HelpNote summary="저장 범위 안내">초안을 적용하면 서버 지원 여부에 따라 선택 사항과 초안이 생성 결과에 함께 저장됩니다. 새로고침 전 입력은 저장되지 않습니다.</HelpNote>
    {state.applied && <div role="status" className="prompt-status">
      <strong>{status === "unknown" ? "과거 복원 · 적용 정보 기록 없음"
        : status === "modified" ? "적용 후 수정됨"
        : status === "selectionChanged" ? "적용 후 선택 변경됨"
        : "적용됨"}</strong>
      <details className="prompt-status__detail">
        <summary>자세히</summary>
        <p>{status === "unknown" ? "과거 구성 복원: 적용 당시 문자열과 반영 방식은 별도 기록되지 않았습니다."
          : status === "modified" ? "적용 후 최종 프롬프트를 직접 수정했습니다. 구성 이력은 마지막 적용 상태로 저장되며 의미 일치를 보장하지 않습니다."
          : status === "selectionChanged" ? "선택 또는 설명을 편집 중입니다. 다시 적용하기 전에는 마지막 적용 구성이 저장됩니다."
          : "마지막 적용 문자열과 최종 프롬프트가 같습니다. 문자열 일치만 확인하며 의미 일치를 보장하지 않습니다."}</p>
        <p>구성 이력은 마지막 적용 시점의 선택으로 저장됩니다. 적용 후에는 최종 프롬프트를 직접 수정할 수 있습니다.</p>
      </details>
    </div>}
    <div id="prompt-builder-panel" hidden={!open}>
      {coverage && coverage.mapped < coverage.total && <p className="prompt-notice" data-tone="info">
        현재 모델 계열에서 사전 표현 {coverage.mapped}/{coverage.total}개를 변환할 수 있습니다. 나머지는 선택해도 미변환으로 표시됩니다.
      </p>}
      <div className="prompt-stage">

      {/* UX01: the description is the first thing in the composer. One field only;
          the dictionary below is an optional way to refine it. */}
      <section className="prompt-brief" aria-label="장면 설명">
      <h3 className="prompt-section-heading">어떤 장면을 만들까요?</h3>
      <label className="prompt-brief__field">한국어 설명
        <textarea id="free-text-ko" aria-invalid={compositionSupported && freeIssues.length > 0} aria-describedby="free-text-help" rows={4}
          value={state.scene.freeTextKo} onChange={(event) => setFreeText(event.target.value)}
          placeholder="예: 비 오는 밤, 편의점 앞에서 우산을 접으며 친구를 기다리는 사람" />
      </label>
      <div id="free-text-help">
        {/* When composition support is on, `validateComposition` already reports the
            same limit in `#draft-errors`; showing it twice would make one problem
            look like two. Without composition support this is the only report. */}
        {!compositionSupported && freeIssues.map((issue, index) => <p className="prompt-error" key={index}>{issue.message} 구성 이력 미저장: 직접 생성은 계속 가능합니다.</p>)}
        <HelpNote summary={`${characterCount(state.scene.freeTextKo)}/4000자`}>원문은 그대로 보존하며 자동 번역하지 않습니다.</HelpNote>
      </div>

      {/* UX05: project-authored examples. Filling the field calls nothing. */}
      <div className="prompt-examples" role="group" aria-label="설명 예시">
        {SCENE_EXAMPLES.map((example) => <button type="button" key={example.id} className="quiet"
          onClick={() => insertExample(example)}>{example.title}</button>)}
      </div>
      <p className="prompt-hint">예시는 입력을 채울 뿐이며 생성하지 않습니다. 이미 입력한 내용이 있으면 바꾸기 전에 확인합니다.</p>

      <div className="prompt-proposals">
        <button type="button" className="quiet" aria-expanded={hintsOpen} aria-controls="prompt-proposals"
          disabled={!family || !state.scene.freeTextKo.trim()}
          onClick={() => setHintsOpen(!hintsOpen)}>
          {hintsOpen ? "제안 닫기" : "원문에서 사전 항목 찾기"}
        </button>
        {/*
          LLM-I04: the AI action exists only when the server advertises the capability.
          An unsupported server gets one plain sentence instead of a disabled button,
          and the rule-based list above stays the only proposal path.
        */}
        {aiEnabled
          ? <button type="button" className="quiet prompt-proposals__ai" ref={aiRef}
              onClick={() => void requestProposal()}
              // While the situation request is in flight this button would silently
              // cancel it and send nothing, so it waits for that request to settle.
              disabled={!family || !state.scene.freeTextKo.trim() || pendingVariant}>
              {pending && !pendingVariant ? "정리 취소"
                : scopeActive ? "선택한 그룹만 정리" : proposalActionLabel(capability)}
            </button>
          : null}
        {/*
          VAR02: an explicit, separate request. Picking a situation is a comparison, so
          it never reuses the "장면 정리하기" button: the two answers mean different
          things and would overwrite each other's panel.
        */}
        {aiEnabled
          ? <button type="button" className="quiet prompt-proposals__variants"
              onClick={() => void requestProposal("variant")}
              disabled={!family || !state.scene.freeTextKo.trim() || (pending && !pendingVariant)}>
              {pendingVariant ? "상황 후보 취소" : "장소와 행동만 바꾼 상황 3개"}
            </button>
          : (proposalFallbackNotice(capability)
            ? <p className="prompt-hint">{proposalFallbackNotice(capability)}</p>
            : null)}
        {/* LLM-I06: the AI button above is either "전체 장면" or "선택한 그룹만". The
            scope is built from the selection, so the locked IDs never have to be typed. */}
        {aiEnabled && <details className="prompt-scope" open={scopeActive || undefined}>
          <summary>부분 변경 범위 <span className="prompt-scope__hint">{describeScope(scope, (group) => labels[group] ?? group)}</span></summary>
          <div className="prompt-scope__groups" role="group" aria-label="변경할 그룹">
            {categories.map((group) => <button type="button" key={group} aria-pressed={targetGroups.includes(group)}
              className="quiet" onClick={() => setTargetGroups((current) => current.includes(group)
                ? current.filter((item) => item !== group) : [...current, group])}>
              {labels[group] ?? group}
              <span className="prompt-scope__count">{counts[group] ?? 0}</span>
            </button>)}
          </div>
          <p className="prompt-hint">
            고른 그룹만 바꾸는 제안을 요청합니다. 나머지 선택 {scope.lockedIds.length}개는 잠금으로 보내고,
            잠긴 값을 바꾸는 제안은 표시하지 않습니다. {LOCK_NOTE}
          </p>
          {scopeActive && <div className="prompt-scope__actions">
            <button type="button" className="quiet" onClick={() => setTargetGroups([])}>범위 지우기</button>
          </div>}
        </details>}
        <HelpNote summary="제안 동작 안내">입력한 원문에서 사전 항목을 찾아 제안합니다. 원문은 바뀌지 않고, 추가는 직접 눌러야 반영됩니다.{aiEnabled ? " AI 정리는 한 번만 요청하며 입력 중에는 자동으로 호출하지 않습니다." : ""}</HelpNote>
        {proposalStatus && <p className="prompt-notice prompt-proposals__status" data-tone={proposalStatus.tone} role="status">
          {proposalStatus.text}
        </p>}
        {cards && cards.cards.length > 0 && <section className="prompt-cards" id="prompt-cards" aria-label="AI 제안 카드">
          <div className="prompt-cards__head">
            <strong>{diff ? "부분 변경 제안" : "장면 정리 제안"} {cards.cards.length}개</strong>
            <span className="prompt-cards__counts">
              원문 근거 {cards.counts.quoted} · AI 추가 {cards.counts.inferred}
              {" · "}미표현 {cards.counts.unresolved} · 모호 {cards.counts.ambiguous}
            </span>
          </div>
          {diff && <section className="prompt-diff" aria-label="수락 전 변경 내용">
            <div className="prompt-diff__head">
              <strong>수락하면 이렇게 바뀝니다</strong>
              <span className="prompt-diff__counts">
                고정 {diff.kept} · 추가 {diff.changes} · 적용 불가 {diff.blocked}
              </span>
            </div>
            <ul className="prompt-diff__rows">
              {diff.rows.map((row) => <li key={row.key} data-diff={row.kind}>
                <strong>{row.labelKo}</strong> <small>· {row.note}</small>
              </li>)}
            </ul>
            {diff.noChange && <p className="prompt-notice" data-tone="caution">
              지금 수락해도 선택이 바뀌지 않습니다. 다른 그룹을 대상으로 다시 요청하거나 직접 고르세요.
            </p>}
            <p className="prompt-hint">{diff.note}</p>
          </section>}
          <p className="prompt-hint">수락해도 원문과 최종 프롬프트는 바뀌지 않고 장면 구성만 갱신됩니다. 최종 프롬프트 반영은 초안 적용 단계에서 따로 합니다.</p>
          <ul className="prompt-cards__list">
            {cards.cards.map((card) => {
              const score = cardConfidence(card);
              const block = card.blocks[0];
              return <li className="prompt-card" key={card.key} data-kind={card.kind}
                data-blocked={block !== undefined || undefined}>
                <div className="prompt-card__body">
                  <strong>{card.labelKo}</strong>
                  <small className="prompt-card__meta">
                    {card.kind === "unresolved" ? " 미표현 구절"
                      : card.kind === "ambiguous" ? " 모호한 표현"
                      : ` ${labels[displayGroup[card.category] ?? card.category] ?? card.category}`}
                    {card.kind === "quoted" || card.kind === "inferred"
                      ? <> · “{card.text}”</> : null}
                  </small>
                  {card.reasonKo && <small className="prompt-card__reason"> · {card.reasonKo}</small>}
                  {score !== null && card.kind !== "unresolved" && <small className="prompt-card__score"> · 신뢰도 {score}%</small>}
                  {block !== undefined && <small className="prompt-card__block"> · {blockReason(block)}</small>}
                </div>
                {card.entry !== null && card.blocks.length === 0
                  ? <button type="button" className="quiet"
                      onClick={() => acceptCard(card)}>선택에 추가</button>
                  : null}
              </li>;
            })}
          </ul>
          {cards.excluded.length > 0 && <details className="prompt-cards__excluded">
            <summary>일괄 수락에서 빠진 항목 {cards.excluded.length}개</summary>
            <ul>{cards.excluded.map((item) => <li key={item.key}>“{item.labelKo}” · {item.why}</li>)}</ul>
          </details>}
          {cards.truncated && <p className="prompt-notice" data-tone="caution">제안 일부를 표시하지 못했습니다. 남은 카드만 수락할 수 있습니다.</p>}
          <div className="prompt-cards__actions">
            <button type="button" className="quiet" disabled={cards.batchIds.length === 0} ref={batchRef}
              onClick={acceptBatch}>원문 근거 {cards.batchIds.length}개 선택에 추가</button>
            <button type="button" className="quiet" onClick={dismissCards}>제안 닫기</button>
          </div>
          <p className="prompt-hint">일괄 추가는 원문에 근거 문구가 있는 항목만 포함합니다. AI가 덧붙인 항목과 함께 쓸 수 없는 항목은 개별로 확인하세요.</p>
        </section>}
        {/*
          VAR01/VAR02: situation candidates, and the one explicit button that turns one
          into a selection. Each card states the place/action it would swap; "적용" is
          per card, never automatic, and the final prompt is still only changed by the
          "적용" step in the result panel. A blocked card keeps its reason and has no
          button. Nothing here is stored with the job.
        */}
        {variants && variants.cards.length > 0 && <section className="prompt-variants" id="prompt-variants" aria-label="상황 후보">
          <div className="prompt-variants__head">
            <strong>{variantHeadline(variants)}</strong>
            <span className="prompt-variants__scope">장소·행동만 바뀐 후보 · 인물과 의상은 그대로</span>
          </div>
          <p className="prompt-hint">하나를 골라 “적용”을 누르면 선택만 바뀝니다. 원문과 최종 프롬프트는 그대로이고, 마음에 들지 않으면 바로 되돌릴 수 있습니다.</p>
          <ul className="prompt-variants__list">
            {variants.cards.map((card) => {
              // The card that produced the current selection is stated as such: its own
              // blocks ("이미 선택했습니다", "지금 선택에 없는 항목입니다") describe this
              // very scene and would read like two contradicting sentences.
              const applied = appliedVariantKey === card.key;
              return <li className="prompt-variant" key={card.key}
                data-blocked={card.blocks.length > 0 || undefined}
                data-applied={applied || undefined}>
                <div className="prompt-variant__body">
                  <strong>{card.labelKo}</strong>
                  {applied && <small className="prompt-variant__applied"> · 지금 선택에 반영됨</small>}
                  <p className="prompt-variant__prompt">{card.promptKo}</p>
                  <ul className="prompt-variant__changes">
                    {card.changes.map((change) => <li key={`${card.key}:${change.direction}:${change.id}`}
                      data-direction={change.direction}>
                      {labels[change.group] ?? change.group} · {change.labelKo}
                      {change.direction === "add" ? " 추가" : " 제거"}
                    </li>)}
                  </ul>
                  {card.unresolvedKo.length > 0 && <p className="prompt-variant__unresolved">
                    사전 밖 표현: {card.unresolvedKo.join(", ")}
                  </p>}
                  {card.unmappedFamily && <p className="prompt-variant__warn">이 모델 계열은 일부 항목을 변환하지 못합니다.</p>}
                  {!applied && card.blocks.map((block) => <p className="prompt-variant__block" key={block}>
                    사용할 수 없음 · {variantBlockReason(block)}
                  </p>)}
                </div>
                {!applied && card.blocks.length === 0
                  ? <button type="button" className="quiet"
                      aria-label={`“${card.labelKo}” 상황을 선택에 적용`}
                      onClick={() => applyVariant(card)}>적용</button>
                  : null}
              </li>;
            })}
          </ul>
          {variants.truncated && <p className="prompt-notice" data-tone="caution">
            후보 일부를 표시하지 못했습니다. 표시된 후보만 비교할 수 있습니다.
          </p>}
          <p className="prompt-hint">후보는 저장되지 않습니다. 새 이미지를 만드는 요청도 나가지 않으므로, 마음에 드는 상황을 고른 뒤 초안을 적용하세요.</p>
        </section>}

        {/*
          LLM-I06: the undo sits outside the card panel on purpose. Accepting every card
          empties the panel, and a control that disappears with what it undoes is not an
          undo. It stays a single step: taking another card records that click instead.
        */}
        {acceptRecord !== null && <div className="prompt-undo" role="group" aria-label="제안 수락 되돌리기">
          <button type="button" className="quiet" ref={undoRef} disabled={!undo.allowed} onClick={undoCards}
            title={undo.allowed ? undefined : undo.text}>
            {undo.allowed ? undo.label : "되돌리기 사용 불가"}
          </button>
          <small>{undo.allowed
            ? "방금 수락한 항목만 해제합니다. 원문과 최종 프롬프트는 그대로입니다."
            : `${undo.text}. 직접 바꾼 선택은 덮어쓰지 않습니다.`}</small>
        </div>}
        {/*
          VAR02 undo. Outside the variant panel for the same reason: the panel vanishes
          when the reply is withdrawn, and a control that disappears with what it undoes
          is not an undo. Its own class keeps it apart from the card acceptance's undo,
          and it stays one step: applying another candidate replaces the record.
        */}
        {variantRecord !== null && <div className="prompt-variant-undo" role="group" aria-label="상황 적용 되돌리기">
          <button type="button" className="quiet" disabled={!variantUndo.allowed} onClick={undoVariant}
            title={variantUndo.allowed ? undefined : variantUndo.text}>
            {variantUndo.allowed ? variantUndo.label : "상황 되돌리기 사용 불가"}
          </button>
          <small>{variantUndo.allowed
            ? "적용 전 선택으로 한 번에 돌립니다. 원문과 최종 프롬프트는 그대로입니다."
            : `${variantUndo.text}. 지금 선택은 덮어쓰지 않습니다.`}</small>
        </div>}
        {hintsOpen && <div id="prompt-proposals" className="prompt-proposal-list" role="group" aria-label="사전 항목 제안">
          {hints.length === 0
            ? <p className="prompt-hint">원문에서 사전 항목을 찾지 못했습니다. 직접 선택하거나 원문을 그대로 사용하세요.</p>
            : hints.map((hint) => <div className="prompt-proposal" key={hint.id}>
              <div>
                <strong>{hint.labelKo}</strong>
                <small> · {labels[displayGroup[hint.category] ?? hint.category] ?? hint.category} · 일치 “{hint.matchedPhrase}”</small>
                {!hint.available && <small className="prompt-proposal__warn"> · 이 모델은 미변환</small>}
              </div>
              <span className="prompt-proposal__score" title="규칙 일치 점수이며 모델 확률이 아닙니다."
                aria-label={`일치 표현 ${hint.matchedPhrase}, 규칙 점수 ${Math.round(hint.confidence * 100)}점`}>일치</span>
              <button type="button" className="quiet" onClick={() => acceptHint(hint.id)}>선택에 추가</button>
            </div>)}
        </div>}
      </div>
      <label>추가 설명 반영 방식<select id="free-text-mode" value={state.freeTextMode} onChange={(event) => setState((current) => { const next = { ...current, freeTextMode: event.target.value as "separate" | "verbatim" }; return family && next.scene.targetFamily === family ? withGeneratedDraft(next, compileScene(next.scene)) : next; })}>
        <option value="separate">별도 보관 · 최종 프롬프트는 직접 편집</option>
        <option value="verbatim">원문 그대로 초안과 최종 프롬프트에 반영</option>
      </select></label>
      <HelpNote summary="반영 방식 저장 안내">방식은 이 화면에서만 관리됩니다. 저장 이력에는 원문과 실제 적용 초안을 남기며, 방식 자체는 별도로 기록하지 않습니다.</HelpNote>
      </section>

      {/* UX04: Korean summary of the selected labels only. A row without a
          selection reads "지정 안 함" so an empty summary never suggests the free
          text was understood. The original text sits next to it, unchanged. */}
      <section className="prompt-scene" aria-label="장면 구성과 미리보기">
      <h3 className="prompt-section-heading">장면 구성</h3>
      <section className="prompt-groups" aria-label="선택한 장면 구성">
        <div className="prompt-group-heading">
          <strong>장면 요약</strong>
          <span className="prompt-summary-count">선택 {selected.size}개</span>
          {state.scene.selections.length > 0 && <button type="button" className="quiet" onClick={clearScene}>선택 비우기</button>}
        </div>
        {summaries.map((row) => <div className="prompt-group" key={row.key} data-empty={row.items.length === 0 || undefined}>
          <strong>{row.label}</strong>
          {row.items.length
            ? <div className="prompt-selected">{row.items.map((item) => {
              const mapped = item.mapping.status === "mapped";
              const text = item.mapping.status === "mapped" ? item.mapping.text : null;
              return <div className="prompt-chip" key={item.id} data-unmapped={!mapped || undefined}>
                <span className="prompt-chip__label">{item.labelKo}</span>
                {text !== null ? <details className="prompt-chip__detail">
                  <summary aria-label={`${item.labelKo} 표현 보기`}>표현</summary>
                  <span>{text}</span>
                </details> : <span className="prompt-chip__unmapped">미변환</span>}
                <button type="button" aria-label={`${item.labelKo} 선택 해제`}
                  ref={(node) => { if (node) removeRefs.current.set(item.id, node); else removeRefs.current.delete(item.id); }}
                  onClick={() => removeChip(item.id)}>×</button>
              </div>;
            })}</div>
            : <p className="prompt-summary-empty">지정 안 함</p>}
        </div>)}
        <HelpNote summary="칩 표현 안내">선택할 때 저장한 {state.scene.targetFamily} 계열 표현입니다. 칩의 “표현”을 열면 영어 대응을 볼 수 있습니다.</HelpNote>
      </section>

      <div className="prompt-origin" aria-label="원문">
        <strong>원문</strong>
        {state.scene.freeTextKo.trim()
          ? <p className="prompt-origin__text">{state.scene.freeTextKo}</p>
          : <p className="prompt-summary-empty">입력한 설명 없음</p>}
        <small>요약은 선택한 항목의 한국어 라벨만 모읍니다. 설명에만 있는 내용은 번역하지 않고 이 원문에 그대로 남습니다.</small>
      </div>

      {empty && <div className="prompt-empty">
        <p className="prompt-hint">선택한 항목이 없습니다. 사전에서 대상부터 골라 보세요. 사전을 쓰지 않고 원문만으로 구성할 수도 있습니다.</p>
        <div className="prompt-empty__actions"><button type="button" className="quiet" onClick={startWithSubject}>대상부터 고르기</button></div>
      </div>}
      </section>

      {/* UX02: search, categories and checkboxes are the refinement step, folded by
          default. Nothing required hides here: the summary above already shows what
          is selected, and generation works from the text alone. */}
      <details className="prompt-adjust" open={adjustOpen} onToggle={(event) => setAdjustOpen(event.currentTarget.open)}>
        <summary>세부 조정 <span className="prompt-adjust__hint">사전에서 항목 고르기</span></summary>
        <section className="prompt-explore" aria-label="사전 항목 탐색">
        <label>사전 검색<input ref={searchRef} id="prompt-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 인물, 조명, 전신" /></label>
        <div className="prompt-categories" role="group" aria-label="사전 분류">
          {["", ...categories].map((item) => <button type="button" key={item || "all"} aria-pressed={category === item} onClick={() => setCategory(item)}>{item ? labels[item] ?? item : "전체"}<span className="prompt-category-count">{item ? `선택 ${counts[item] ?? 0}` : `선택 ${selected.size}`}</span></button>)}
        </div>
        <HelpNote summary={`${category ? labels[category] : "전체"} 분류 · ${options.length}개 결과`}>검색은 선택한 분류 안에서만 적용됩니다. 다른 분류의 선택도 유지됩니다.</HelpNote>
        <fieldset className="prompt-choices" aria-describedby="selection-errors" aria-invalid={compositionSupported && compositionIssues.some((issue) => issue.field === "selections")}><legend>사전 항목 선택</legend>
          {options.length ? options.map((item) => {
            const mapping = family ? item.mappings[family as keyof typeof item.mappings] : undefined;
            const status = mapping && mapping.status !== "mapped" ? " · 이 모델은 미변환" : "";
            return <label className="prompt-choice" key={item.id}>
              <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => { const checked = event.target.checked; setScene((scene) => checked ? selectEntry(scene, item, DICTIONARY_VERSION) : removeEntry(scene, item.id)); }} />
              <span>{item.labelKo} <small>· {labels[displayGroup[item.category] ?? item.category] ?? item.category}{status}</small></span>
            </label>;
          }) : <div className="prompt-empty">
            <p className="prompt-hint">검색 결과가 없습니다.</p>
            <div className="prompt-empty__actions">{recoveryActions(query, category).map((action) => <button
              type="button" className="quiet" key={action.kind}
              onClick={() => { setCategory(action.nextCategory); setQuery(action.nextQuery); }}>{action.label}</button>)}</div>
          </div>}
        </fieldset>
        <div id="selection-errors">{compositionSupported && compositionIssues.filter((issue) => issue.field === "selections").map((issue, index) => <p className="prompt-error" key={index}>{issue.message}</p>)}</div>
        <p className="prompt-hint">선택 {selected.size}개{category || query ? " · 필터 밖의 선택도 유지됩니다." : ""}</p>
        </section>
      </details>

      {/* UX04: the English draft is a detail. Applying, warnings, errors and the
          inclusion state never hide behind it. */}
      <section className="prompt-result" aria-label="프롬프트 확인" data-has-draft={state.result ? "true" : undefined}>
        <h3 className="prompt-section-heading">프롬프트 확인</h3>
        {controls.showGenerate && <button type="button" className="quiet" onClick={generate}>{controls.generateLabel}</button>}
        {!state.result && <p className="prompt-hint">선택하거나 설명을 입력하면 영어 초안이 만들어집니다. 초안은 최종 프롬프트에 적용하기 전까지 그대로 남습니다.</p>}
        {state.result && <>
        {state.provenance === "saved" && <HelpNote summary="저장된 초안 안내">저장된 초안과 미변환 목록입니다. 당시 경고·출처는 기록 없음입니다. 다시 만들기는 저장된 선택 표현에 현재 컴파일 규칙을 적용합니다.</HelpNote>}
        {controls.autoPreview && !dirty && <HelpNote summary="최신 미리보기">현재 선택 기준 최신 미리보기입니다. 최종 프롬프트는 적용할 때만 바뀝니다.</HelpNote>}
        {dirty && <p className="prompt-notice" data-tone="caution">선택 또는 설명이 바뀌었습니다. 초안을 다시 만들어 주세요. 현재 최종 프롬프트는 유지됩니다.</p>}
        {inclusion && <p className="prompt-inclusion" data-included={inclusion.included || undefined} data-unknown={inclusion.unknown || undefined}>{inclusion.text}</p>}
        <details className="prompt-draft">
          <summary>영어 초안 펼치기 <span className="prompt-draft__hint">{characterCount(state.result.draft)}자</span></summary>
          <label>프롬프트 미리보기<textarea aria-invalid={blocked} aria-describedby="draft-errors" readOnly value={state.result.draft} rows={4} placeholder="표현을 만들 수 없습니다." /></label>
          <p className="prompt-hint">컴파일러 {state.result.compilerVersion} · 영어 초안은 참고용이며 그대로 쓰지 않아도 됩니다.</p>
        </details>
        {unresolved.length > 0 && <div className="prompt-notice" data-tone="caution">
          <strong>이 모델로 번역되지 않은 선택 항목</strong>
          <ul>{unresolved.map((item, index) => <li key={`${item.id ?? "selection"}-${index}`}>{item.text}</li>)}</ul>
          <span>선택한 항목의 {state.scene.targetFamily || "대상 모델"} 표현이 사전에 없어 초안에서 빠졌습니다. 다른 항목을 고르거나 최종 프롬프트에 직접 입력하세요.</span>
        </div>}
        {advisories.map((item, index) => {
          const explanation = explainWarning(item, (id) => state.scene.selections.find((entry) => entry.id === id)?.labelKo ?? id, DRAFT_LIMIT);
          return <div className="prompt-notice prompt-notice--action" data-tone="caution" key={`${item.code}-${index}`}>
            <span>{explanation.message}</span>
            {explanation.removeIds.length > 0 && <button type="button" className="quiet"
              onClick={() => removeRedundant(explanation.removeIds)}>중복 해제</button>}
          </div>;
        })}
        {state.result.warnings.some((item) => item.code === "empty") && <p className="prompt-hint">사전 항목을 선택하거나 설명을 입력하면 미리보기가 만들어집니다.</p>}
        <div id="draft-errors" role="status">{issues.map((issue, index) => <p className="prompt-error" key={index}>{issue.field}: {issue.message}</p>)}</div>
        <button type="button" className="quiet" disabled={!controls.canApply} onClick={applyDraft}>{controls.applyLabel}</button>
        </>}
      </section>
      </div>
      <p className="prompt-hint" role="status">{notice}</p>
    </div>
  </div>;
}
