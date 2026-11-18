/**
 * RULE01: occurrence-level matching for the offline rule engine.
 *
 * The previous engine was a plain `text.includes(label)`, which proposes a person for
 * "사람은 없다" and a singular person for "사람들". This module decides about **one
 * occurrence** of a phrase instead of the whole sentence, so a sentence that mixes a
 * negative and a positive statement keeps the positive half (`사람은 없고 고양이는 있다`
 * proposes the cat, never the person).
 *
 * Three decisions, each narrow enough to be checked by hand:
 *
 * - `polarityAt` — read the clause *after* the match. The first negation marker
 *   (`없`, `아니`, `않`, `빼고`, `제외`, `말고`, `금지`) makes the occurrence negative, an
 *   affirmation marker (`있`) makes it positive, and no marker at all is positive.
 *   A negation *before* the match does not reach it, so "사람이 없는 해변의 고양이"
 *   still proposes the cat.
 * - `pluralTail` — a phrase followed by `들` (`사람` in `사람들`) is a plural form. The
 *   caller only drops it when the dictionary itself has the plural entry, so nothing
 *   is guessed from the 이/가 particle alone.
 * - `countAround` — an explicit count (`둘`, `두`, `2`, `여러`) directly before or after
 *   the phrase. Used only for `subject` entries, because "사람 둘" is two people, not
 *   one, and the dictionary cannot say that any other way.
 *
 * Nothing here rewrites the text or invents an ID. It only says where a phrase occurs
 * and whether that occurrence is negated or counted.
 */

export type MatchKind = "label" | "alias";

export type PhraseOccurrence = {
  /** The dictionary phrase, as authored. */
  phrase: string;
  /** Inclusive start index in the lowercased text. */
  start: number;
  /** Exclusive end index in the lowercased text. */
  end: number;
  kind: MatchKind;
};

export type Polarity = "affirmed" | "negated";

/** Stems, not whole forms: `없다`/`없이`/`없는`/`없고` all start with `없`. */
const NEGATION_MARKERS = ["없", "아니", "않", "빼고", "제외", "말고", "금지"] as const;
const AFFIRMATION_MARKERS = ["있"] as const;

/** A reader ends a statement here; polarity never crosses this boundary. */
const CLAUSE_BREAK = /[.!?,、。·\n]/;

/**
 * Numeral words and digits that make a `subject` phrase plural.
 *
 * Kept as two explicit patterns instead of one, because the count sits on a different
 * side in `두 사람` and `사람 둘` and the matched text has to include it verbatim.
 */
const COUNT_BEFORE = /(둘|두|셋|세|넷|네|여러|여럿|많은|[2-9])\s?$/;
const COUNT_AFTER = /^\s?(둘|두|셋|세|넷|네|여러|여럿|많은|[2-9])(명|사람)?(?:\s|이|가|은|는|의|,|\.|$)/;

/** A numeral glued to the end of another word (`모두`) is not a count. */
const HANGUL = /[\uac00-\ud7a3]/;

/** Index of the first clause break at or after `from`. */
function clauseEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (CLAUSE_BREAK.test(text[index])) return index;
  }
  return text.length;
}

/**
 * Polarity of a match that ends at `from`, decided by the rest of its clause.
 *
 * The earliest marker wins, which is what makes a mixed clause work: in
 * `사람은 없고 고양이는 있다` the person sees `없` and the cat sees `있`.
 */
export function polarityAt(text: string, from: number): Polarity {
  const scope = text.slice(from, clauseEnd(text, from));
  let bestIndex = Number.POSITIVE_INFINITY;
  let negated = false;
  for (const marker of [...NEGATION_MARKERS, ...AFFIRMATION_MARKERS]) {
    const index = scope.indexOf(marker);
    if (index < 0 || index >= bestIndex) continue;
    // An affirmation and a negation can never start at the same character, but the
    // guard keeps the loop total if that ever changes.
    if (index === bestIndex && negated) continue;
    bestIndex = index;
    negated = (NEGATION_MARKERS as readonly string[]).includes(marker);
  }
  return negated ? "negated" : "affirmed";
}

/** `true` when the phrase is a plural form, judged only by a trailing `들`. */
export function pluralTail(phrase: string): boolean {
  return phrase.endsWith("들");
}

/** An explicit count directly before or after the phrase. */
export type CountMatch = {
  /** The numeral itself (`두`, `둘`, `2`), lowercase as found in the text. */
  text: string;
  where: "before" | "after";
  /** Characters the numeral and its space occupy, so the span can be widened. */
  width: number;
};

export function countAround(text: string, start: number, end: number): CountMatch | null {
  const head = text.slice(0, start);
  const before = COUNT_BEFORE.exec(head);
  // `모두`/`한두` end in a numeral but are not counts of the phrase that follows.
  if (before && !HANGUL.test(head.slice(0, before.index).slice(-1))) {
    // `\s?` is optional, so the matched width is not the numeral's width.
    const numeral = before[1];
    return { text: numeral, where: "before", width: numeral.length + (before[0].length - numeral.length) };
  }
  const after = COUNT_AFTER.exec(text.slice(end));
  if (after) {
    // `명`/`사람` belong to the count ("사람 2명"), so they stay in the reported span.
    return { text: after[1], where: "after", width: after[0].indexOf(after[1]) + after[1].length + (after[2]?.length ?? 0) };
  }
  return null;
}

/** Every occurrence of `phrase` in the already-lowercased `text`. */
export function matchOccurrences(text: string, phrase: string, kind: MatchKind): PhraseOccurrence[] {
  const needle = phrase.toLocaleLowerCase("ko");
  if (!needle) return [];
  const found: PhraseOccurrence[] = [];
  let index = text.indexOf(needle);
  while (index >= 0) {
    if (startsWord(text, index, needle)) {
      found.push({ phrase, start: index, end: index + needle.length, kind });
    }
    index = text.indexOf(needle, index + 1);
  }
  return found;
}

/**
 * `true` when a match begins at a word boundary.
 *
 * Korean is space-delimited, so a Hangul syllable glued in front of the match means the
 * match is the tail of a longer word: `모두 사람` contains the characters `두 사람`, but
 * nobody wrote "두 사람" there. Only a Hangul-to-Hangul join is rejected — a digit, a
 * space, punctuation or the start of the text all count as a boundary, so `2명` and
 * `(사람)` still match.
 */
function startsWord(text: string, start: number, needle: string): boolean {
  if (start === 0) return true;
  if (!HANGUL.test(needle[0] ?? "")) return true;
  return !HANGUL.test(text[start - 1]);
}

/**
 * Spans of the plural phrases the dictionary itself provides (`사람들`).
 *
 * `사람` inside `사람들` is dropped only when such a span starts at the same place, so
 * a word that merely ends in `들` is never trimmed on a guess.
 */
export function pluralSpans(
  text: string,
  phrases: { phrase: string; kind: MatchKind }[],
): PhraseOccurrence[] {
  return phrases
    .filter((item) => pluralTail(item.phrase))
    .flatMap((item) => matchOccurrences(text, item.phrase, item.kind));
}

/** `true` when a longer, plural phrase of the dictionary starts at the same place. */
export function shadowedByPlural(occurrence: PhraseOccurrence, spans: PhraseOccurrence[]): boolean {
  return spans.some((span) => span.start === occurrence.start && span.end === occurrence.end + 1);
}
