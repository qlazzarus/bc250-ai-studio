/** Display-only decisions for the prompt builder. No scene or planning state lives here. */
import type { CompileResult } from "./compiler";
import type { PromptBuilderState } from "./builderState";
import type { DictionaryEntry } from "./dictionary";

/** Existing IDs keep their stored category; these are the picker's display groups. */
export const DISPLAY_GROUP: Record<string, string> = { action: "pose", location: "setting", composition: "camera" };
export const GROUP_ORDER = ["subject", "appearance", "clothing", "expression", "pose", "setting", "camera", "lighting", "style", "mood"];

export const groupOf = (category: string): string => DISPLAY_GROUP[category] ?? category;

export function activeGroups(dictionary: DictionaryEntry[]): string[] {
  return GROUP_ORDER.filter((group) => dictionary.some((item) => item.active && groupOf(item.category) === group));
}

/** Search runs inside the chosen category only; callers reset one axis at a time. */
export function filterOptions(dictionary: DictionaryEntry[], query: string, category: string): DictionaryEntry[] {
  const normalized = query.trim().toLocaleLowerCase("ko");
  return dictionary.filter((entry) => entry.active
    && (!category || groupOf(entry.category) === category)
    && (!normalized || [entry.labelKo, ...entry.aliases, entry.id]
      .some((value) => value.toLocaleLowerCase("ko").includes(normalized))));
}

export function selectionCounts(selections: { category: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of selections) {
    const group = groupOf(item.category);
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
}

/**
 * Chips render group-first, and that flat order is also the DOM/focus order.
 * Rendering and focus restoration read the same function so they cannot drift.
 */
export type ChipGroup<T> = { group: string; items: T[] };

export function chipGroups<T extends { category: string }>(selections: T[]): ChipGroup<T>[] {
  const groups = [...GROUP_ORDER,
    ...new Set(selections.map((item) => groupOf(item.category)).filter((group) => !GROUP_ORDER.includes(group)))];
  return groups
    .map((group) => ({ group, items: selections.filter((item) => groupOf(item.category) === group) }))
    .filter((entry) => entry.items.length > 0);
}

/**
 * After a removal, focus goes to the next rendered chip's remove button, then the
 * previous one. `null` means no chip is left, so the caller returns to the search input.
 */
export function nextFocusAfterRemoval(ids: string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** Zero-result recovery keeps the other axis so no filtering work is lost. */
export type RecoveryAction = { kind: "widen" | "clearQuery"; label: string; nextCategory: string; nextQuery: string };

export function recoveryActions(query: string, category: string): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  if (category) actions.push({ kind: "widen", label: "전체에서 검색", nextCategory: "", nextQuery: query });
  if (query) actions.push({ kind: "clearQuery", label: "검색 초기화", nextCategory: category, nextQuery: "" });
  return actions;
}

/** What the preview/apply area may offer, given the current builder state. */
export type PreviewControls = {
  showGenerate: boolean;
  generateLabel: string;
  showApply: boolean;
  applyLabel: string;
  canApply: boolean;
  /** Everything needed to see a current preview is already in place. */
  autoPreview: boolean;
};

export function previewControls(
  state: PromptBuilderState, family: string,
  options: { blocked: boolean; separateOnly: boolean; prompt: string; dirty: boolean },
): PreviewControls {
  const saved = state.provenance === "saved";
  const familyMismatch = state.result !== null && state.result.targetFamily !== family;
  const autoPreview = Boolean(state.result) && !saved && !familyMismatch;
  return {
    // Editing already regenerates the preview, so the manual button is only a
    // recovery path: no result yet (no family/family switch) or a saved draft.
    showGenerate: !state.result || saved || familyMismatch,
    generateLabel: saved ? "현재 컴파일러로 초안 다시 만들기" : "초안 만들기",
    showApply: Boolean(state.result),
    applyLabel: options.separateOnly ? "설명만 이력에 적용 (최종 입력 유지)" : "초안을 최종 프롬프트에 적용",
    // A stale draft must never be applied before regenerating (P5 contract).
    canApply: Boolean(state.result) && !familyMismatch && !options.blocked && !options.dirty
      && (Boolean(state.result?.draft) || options.separateOnly)
      && state.result?.targetFamily === family,
    autoPreview,
  };
}

/** Whether the current preview carries the free text. Never inferred from strings. */
export type InclusionNotice = { included: boolean; text: string; unknown: boolean };

/**
 * One tone per message class so a blocking condition never looks like a hint:
 * `info` = explanation, `caution` = advisory, `error` = this blocks applying.
 */
export type NoticeTone = "info" | "caution" | "error";

/**
 * Compiler warnings are advisory. The hard limits are re-reported by
 * `validateComposition`/`validateText` as blocking errors, so `over_limit` is
 * dropped here instead of appearing twice in two different colours.
 */
export function advisoryWarnings(result: CompileResult | null) {
  return (result?.warnings ?? []).filter((item) => item.code !== "empty" && item.code !== "over_limit");
}

/**
 * Unresolved selections are translation failures; the free text is reported once by
 * the inclusion notice, so it must not also appear as a warning.
 */
export function unresolvedSelections(result: CompileResult | null): { id: string | null; text: string }[] {
  return (result?.unresolved ?? [])
    .filter((item) => item.kind === "selection")
    .map((item) => ({ id: item.id ?? null, text: item.text }));
}


export function inclusionNotice(state: PromptBuilderState, result: CompileResult | null): InclusionNotice | null {
  if (!result) return null;
  if (state.provenance === "saved") {
    return { included: false, unknown: true, text: "과거 복원 · 미리보기 기준이 아닙니다. 당시 반영 방식은 기록에 없습니다." };
  }
  if (!state.scene.freeTextKo.trim()) return null;
  return state.freeTextMode === "verbatim"
    ? { included: true, unknown: false, text: "원문 포함 · 번역하지 않고 미리보기에 그대로 넣습니다." }
    : { included: false, unknown: false, text: "별도 보관 · 원문은 미리보기에 포함되지 않고 이력에만 남습니다." };
}

/** One short label for the applied/edited state; unknown history is not claimed as unedited. */
export type AppliedStatus = "none" | "applied" | "modified" | "unknown" | "selectionChanged";

export function appliedStatus(state: PromptBuilderState, prompt: string): AppliedStatus {
  if (!state.applied) return "none";
  if (state.appliedPrompt === null) return "unknown";
  if (state.appliedPrompt !== prompt) return "modified";
  if (state.appliedScene !== null && JSON.stringify(state.scene) !== state.appliedScene) return "selectionChanged";
  return "applied";
}
