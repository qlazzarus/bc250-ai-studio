import type { DictionaryEntry } from "./dictionary";
import { groupOf } from "./presentation.ts";
import {
  countAround, matchOccurrences, pluralSpans, polarityAt, shadowedByPlural,
} from "./matching.ts";

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
  /**
   * RULE02: display groups a partial change may touch. Absent or empty means "whole
   * scene", which is the behaviour every caller had before this field existed.
   *
   * When a group is named, a match outside it is dropped instead of proposed: in the
   * `조명만` flow the word `카페` is in the text, but adding a place is exactly what the
   * request promised not to do. `lockedIds` need no separate handling — a locked ID is
   * by definition already selected, and selected IDs are never proposed.
   */
  targetGroups?: string[];
};

export type SuggestionReport = {
  /** What the panel may offer, already limited by `maxSuggestions`. */
  hints: SelectionHint[];
  /** Matches the scope dropped, so the UI can say why they are missing. */
  outOfScope: SelectionHint[];
  /** `true` when the request carried a usable scope. */
  scoped: boolean;
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

/** Every phrase one entry authorises, longest-form attribution kept separate. */
export function phrasesOf(entry: DictionaryEntry): { phrase: string; isLabel: boolean }[] {
  return [
    { phrase: entry.labelKo, isLabel: true },
    ...entry.aliases.map((phrase) => ({ phrase, isLabel: phrase === entry.labelKo })),
  ];
}

/**
 * RULE01: the generic person entry, and the two entries that already mean "more than
 * one person". These are the only IDs this module knows by name.
 *
 * "사람 둘" is two people and "사람들" is a group; the dictionary says so with its own
 * entries, so the rule points at them instead of proposing a singular. Nothing is
 * invented: when an ID is missing or inactive the count rule is skipped and the plain
 * match stands.
 */
const GENERIC_PERSON = "subject.person";
const COUNT_TARGETS = { two: "subject.two_people", many: "subject.group" } as const;
const TWO_NUMERALS = new Set(["둘", "두", "2"]);

/** The ID an explicit count around the generic person should point at. */
function countTargetId(count: string): string {
  return TWO_NUMERALS.has(count) ? COUNT_TARGETS.two : COUNT_TARGETS.many;
}

type Occurrence = {
  entry: DictionaryEntry;
  /** The phrase as authored. */
  phrase: string;
  isLabel: boolean;
  /** Inclusive/exclusive bounds of the phrase itself. */
  start: number;
  end: number;
  /** Widened to include a count word, so the reported phrase is still literal text. */
  spanStart: number;
  spanEnd: number;
};

/** Label beats alias, then the longer phrase, then the earlier one: deterministic. */
function isBetter(next: Occurrence, current: Occurrence | undefined): boolean {
  if (!current) return true;
  if (next.isLabel !== current.isLabel) return next.isLabel;
  const nextLength = Array.from(next.phrase).length;
  const currentLength = Array.from(current.phrase).length;
  if (nextLength !== currentLength) return nextLength > currentLength;
  return next.start < current.start;
}

/**
 * Free text stays untouched; this only reads it. Empty text yields no hints.
 *
 * RULE01: matching happens per *occurrence*, not per sentence, so
 * `사람은 없고 고양이는 있다` proposes the cat and not the person, while
 * `사람이 없는 해변의 고양이` still proposes the cat. A negated occurrence of one
 * phrase never suppresses a different entry, and an ambiguous sentence is never
 * cleared as a whole.
 *
 * RULE02: with `targetGroups` set, an occurrence whose display group is outside them
 * is returned in `outOfScope` instead of `hints`. The caller shows the count, so a
 * partial request never looks like it understood less than it did.
 */
export function suggestSelectionsDetailed(request: ProposalRequest): SuggestionReport {
  const text = request.freeTextKo.toLocaleLowerCase("ko");
  const limit = request.maxSuggestions ?? 8;
  const scoped = (request.targetGroups ?? []).length > 0;
  const allowed = new Set(request.targetGroups ?? []);
  if (!text.trim() || limit <= 0) return { hints: [], outOfScope: [], scoped };
  const selected = new Set(request.selectedIds ?? []);
  // Phrase matching only considers entries that can still be added, but the two helpers
  // that redirect a match must see the whole active dictionary: if `두 사람` or `사람들`
  // is already selected, the singular still has to stay silent instead of reappearing as
  // an "인물" suggestion.
  const active = request.dictionary.filter((entry) => entry.active);
  const usable = active.filter((entry) => !selected.has(entry.id));
  const byId = new Map(active.map((entry) => [entry.id, entry]));
  // Plural forms the dictionary itself provides (`사람들`), used only to drop the
  // singular inside them. A word that merely ends in `들` creates no span.
  const plural = pluralSpans(
    text,
    active.flatMap((entry) => phrasesOf(entry).map((item) => ({
      phrase: item.phrase, kind: item.isLabel ? "label" as const : "alias" as const,
    }))),
  );

  const best = new Map<string, Occurrence>();
  for (const entry of usable) {
    for (const { phrase, isLabel } of phrasesOf(entry)) {
      if (Array.from(phrase).length < MIN_PHRASE) continue;
      for (const occurrence of matchOccurrences(text, phrase, isLabel ? "label" : "alias")) {
        // A negated occurrence says the thing is absent, so it is not a suggestion.
        if (polarityAt(text, occurrence.end) === "negated") continue;
        if (shadowedByPlural(occurrence, plural)) continue;
        let next: Occurrence = {
          entry, phrase, isLabel,
          start: occurrence.start, end: occurrence.end,
          spanStart: occurrence.start, spanEnd: occurrence.end,
        };
        if (entry.id === GENERIC_PERSON) {
          const count = countAround(text, occurrence.start, occurrence.end);
          const target = count === null ? undefined : byId.get(countTargetId(count.text));
          // If the plural entry is already selected, the count is still not a singular:
          // say nothing rather than re-offering `인물`.
          if (target && selected.has(target.id)) continue;
          if (count !== null && target) {
            const spanStart = count.where === "before" ? occurrence.start - count.width : occurrence.start;
            const spanEnd = count.where === "after" ? occurrence.end + count.width : occurrence.end;
            next = {
              entry: target, phrase: text.slice(spanStart, spanEnd), isLabel: false,
              start: occurrence.start, end: occurrence.end, spanStart, spanEnd,
            };
          }
        }
        if (isBetter(next, best.get(next.entry.id))) best.set(next.entry.id, next);
      }
    }
  }

  const sorted = [...best.values()]
    .map((occurrence) => {
      const mapping = occurrence.entry.mappings[request.family as keyof typeof occurrence.entry.mappings];
      const available = mapping?.status === "mapped" && Boolean(mapping.text.trim());
      const phrase = text.slice(occurrence.spanStart, occurrence.spanEnd);
      return {
        id: occurrence.entry.id,
        labelKo: occurrence.entry.labelKo,
        category: occurrence.entry.category,
        matchedPhrase: phrase,
        confidence: score(phrase, occurrence.isLabel, available),
        available,
      };
    })
    .sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (!scoped) return { hints: sorted.slice(0, limit), outOfScope: [], scoped };
  const outside = sorted.filter((hint) => !allowed.has(groupOf(hint.category)));
  const inside = sorted.filter((hint) => allowed.has(groupOf(hint.category)));
  return { hints: inside.slice(0, limit), outOfScope: outside, scoped };
}

/** The hint list only. Callers that never send a scope keep this signature. */
export function suggestSelections(request: ProposalRequest): SelectionHint[] {
  return suggestSelectionsDetailed(request).hints;
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
