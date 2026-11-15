import type { DictionaryEntry } from "./dictionary";

/**
 * Deterministic, offline proposal engine. It only points at entries that already
 * exist in the operator dictionary; it never invents an ID, phrase, or translation.
 * A future LLM provider must return the same shape through the server contract.
 */

export type SelectionHint = {
  id: string;
  labelKo: string;
  category: string;
  /** The exact substring of the user's text that matched, for transparency. */
  matchedPhrase: string;
  /** 0.05–0.98, rounded. Deterministic from phrase length and match kind. */
  confidence: number;
  /** False when the target family has no curated expression for this entry. */
  available: boolean;
};

export type ProposalRequest = {
  freeTextKo: string;
  family: string;
  dictionary: DictionaryEntry[];
  selectedIds?: Iterable<string>;
  maxSuggestions?: number;
};

const MIN_PHRASE = 2;

/** Longer, exact label matches score higher; unmapped families score lower. */
function score(phrase: string, isLabel: boolean, available: boolean): number {
  const length = Array.from(phrase).length;
  let value = 0.45 + 0.06 * (length - MIN_PHRASE);
  if (isLabel) value += 0.08;
  if (!available) value -= 0.15;
  return Math.round(Math.min(0.98, Math.max(0.05, value)) * 100) / 100;
}

/** Free text stays untouched; this only reads it. Empty text yields no hints. */
export function suggestSelections(request: ProposalRequest): SelectionHint[] {
  const text = request.freeTextKo.toLocaleLowerCase("ko");
  const limit = request.maxSuggestions ?? 8;
  if (!text.trim() || limit <= 0) return [];
  const selected = new Set(request.selectedIds ?? []);
  const hints: SelectionHint[] = [];
  for (const entry of request.dictionary) {
    if (!entry.active || selected.has(entry.id)) continue;
    const mapping = entry.mappings[request.family as keyof typeof entry.mappings];
    const available = mapping?.status === "mapped" && Boolean(mapping.text.trim());
    const label = entry.labelKo.toLocaleLowerCase("ko");
    let best: { phrase: string; isLabel: boolean } | null = null;
    if (label.length >= MIN_PHRASE && text.includes(label)) best = { phrase: entry.labelKo, isLabel: true };
    for (const alias of entry.aliases) {
      const value = alias.toLocaleLowerCase("ko");
      if (value.length < MIN_PHRASE || !text.includes(value)) continue;
      if (!best || Array.from(value).length > Array.from(best.phrase).length) {
        best = { phrase: alias, isLabel: value === label };
      }
    }
    if (!best) continue;
    hints.push({
      id: entry.id, labelKo: entry.labelKo, category: entry.category,
      matchedPhrase: best.phrase, confidence: score(best.phrase, best.isLabel, available), available,
    });
  }
  return hints
    .sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}

export type WarningExplanation = {
  message: string;
  /** Only populated when removal is unambiguous. Conflicts are never auto-resolved. */
  removeIds: string[];
};

/**
 * Turns a compiler warning into one Korean sentence plus, where it is safe, the
 * redundant IDs the user can drop. Ambiguous conflicts intentionally suggest nothing.
 */
export function explainWarning(
  warning: { code: string; ids?: string[]; detail?: string },
  labelOf: (id: string) => string,
  draftLimit: number,
): WarningExplanation {
  const ids = warning.ids ?? [];
  const names = ids.map(labelOf).join(" / ");
  switch (warning.code) {
    case "conflict":
      return { message: `함께 쓰기 어려운 조합입니다: ${names}. 둘 중 하나를 해제하세요.`, removeIds: [] };
    case "unsupported_family":
      return { message: "이 모델 계열의 사전 변환은 아직 제공되지 않습니다.", removeIds: [] };
    case "duplicate":
      return { message: `중복된 항목입니다: ${ids.join(", ")}. 뒤쪽 중복만 해제할 수 있습니다.`, removeIds: ids.slice(1) };
    case "duplicate_phrase":
      return { message: `같은 표현이 겹쳐 한 번만 사용했습니다: ${names}. 뒤쪽 중복만 해제할 수 있습니다.`, removeIds: ids.slice(1) };
    case "over_limit":
      return warning.detail?.includes("selection")
        ? { message: `선택 항목이 서버 한도를 넘었습니다 (${warning.detail}).`, removeIds: [] }
        : { message: `초안이 서버 저장 한도(${draftLimit}자)를 넘었습니다 (${warning.detail}). 일부를 줄이세요.`, removeIds: [] };
    case "token_budget":
      return { message: `프롬프트가 SD 1.5 텍스트 창을 넘을 수 있습니다 (${warning.detail}). 뒤쪽 항목이 반영되지 않을 수 있습니다.`, removeIds: [] };
    default:
      return { message: "", removeIds: [] };
  }
}
