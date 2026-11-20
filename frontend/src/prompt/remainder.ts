/**
 * TRANS02: which parts of the free text the dictionary did *not* cover.
 *
 * Today "out of dictionary" is a single `unresolved` entry holding the whole sentence,
 * so 85.7% of a measured example is shown as one opaque lump. This module returns the
 * uncovered pieces as separate phrases, each with `{start, end}` offsets into the
 * **original** text, so TRANS03 can send offsets instead of re-sending the phrase text.
 *
 * Three things this module deliberately does *not* do:
 *
 * - It does not understand the sentence. Segmentation is punctuation and a fixed
 *   particle list, checked by hand. No morphological analyser, no new dependency.
 * - It does not invent a matching rule. Coverage uses `matchOccurrences` / `polarityAt`
 *   / `pluralSpans` from `matching.ts`, the same RULE01 engine the suggestion panel
 *   uses, so a phrase is "covered" here exactly when the panel could have matched it.
 * - It does not translate. It returns offsets and text only.
 *
 * ## The offset hazard this module exists to absorb
 *
 * `suggestSelectionsDetailed` matches against `freeTextKo.toLocaleLowerCase("ko")`, so
 * its indices are **folded-string** coordinates. Folding can change length: `İ`
 * (U+0130) folds to two code units, shifting every later index by one. A span measured
 * in folded coordinates and then sliced out of the original text silently selects the
 * wrong characters. `foldForMatching` records a folded-index -> original-index map and
 * every span is translated back through it before it is returned.
 */

import {
  matchOccurrences, pluralSpans, shadowedByPlural,
} from "./matching.ts";
import type { DictionaryEntry } from "./dictionary.ts";
import { phrasesOf } from "./proposals.ts";

/** Same cap as the server's `MAX_UNRESOLVED`; one reply cannot produce more. */
export const REMAINDER_LIMIT = 8;
/** Same cap as the server's `MAX_UNRESOLVED_CHARS`. Not a new budget. */
export const REMAINDER_CHARS = 200;
/** Shorter than this is a particle remnant (`이`, `를 `), not a phrase worth translating. */
export const MIN_REMAINDER = 2;

/**
 * A clause boundary. Intentionally a separate constant from `CLAUSE_BREAK` in
 * `matching.ts`: that one bounds a polarity scope, this one bounds a translation
 * segment. Coupling them would mean a change to negation reading silently re-segments
 * the text, and the two questions are not the same one.
 */
const SEGMENT_BREAK = /[.!?,、。·\n]/;

/**
 * Particles that may survive at a segment edge once a covered phrase is removed —
 * `네온 조명이 젖은 바닥에` leaves `이 젖은 바닥에`. A fixed list, not a guess: anything
 * not listed is kept, so an unknown word is never eaten.
 */
const PARTICLES = new Set([
  "이", "가", "은", "는", "을", "를", "의", "에", "에서", "에게", "한테", "께서",
  "로", "으로", "와", "과", "도", "만", "부터", "까지", "처럼", "보다", "이랑", "랑",
  "이나", "나", "이며", "며", "이고", "고",
]);

export type RemainderSpan = { start: number; end: number };
export type RemainderPhrase = { start: number; end: number; text: string };

export type RemainderRequest = {
  freeTextKo: string;
  /** Coverage is lexical, so every active entry counts, selected or not. */
  dictionary: DictionaryEntry[];
  maxItems?: number;
  maxChars?: number;
};

export type RemainderReport = {
  /** Uncovered phrases in document order, offsets into the original text. */
  phrases: RemainderPhrase[];
  /** Phrases dropped for being too short or particle-only, so the UI can say so. */
  dropped: number;
  /** Phrases held back by `maxItems`, so a truncated list is never silent. */
  withheld: number;
};

/**
 * Fold text the way the matcher does, keeping a folded-index -> original-index map.
 *
 * The returned map has one extra entry at the end holding `text.length`, so the
 * exclusive end of a folded span maps to the exclusive end in the original.
 */
export function foldForMatching(text: string): { folded: string; toOriginal: number[] } {
  const parts: string[] = [];
  const toOriginal: number[] = [];
  let originalIndex = 0;
  for (const char of text) {
    const folded = char.toLocaleLowerCase("ko");
    parts.push(folded);
    // Every code unit of an expansion maps back to the character it came from.
    for (let index = 0; index < folded.length; index += 1) toOriginal.push(originalIndex);
    originalIndex += char.length;
  }
  toOriginal.push(text.length);
  return { folded: parts.join(""), toOriginal };
}

/** Merge overlapping and adjacent spans, sorted by start. */
function mergeSpans(spans: RemainderSpan[]): RemainderSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RemainderSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Regions of the original text the dictionary covers, in original coordinates.
 *
 * A negated occurrence (`안경 없이`) is still *covered*: the word is in the vocabulary
 * and the RULE01 verdict is only that it is absent from the image. It is not remainder —
 * translating it would risk emitting the opposite meaning — so it is excluded here and
 * never offered for translation.
 */
export function coveredRanges(text: string, dictionary: DictionaryEntry[]): RemainderSpan[] {
  if (!text.trim()) return [];
  const { folded, toOriginal } = foldForMatching(text);
  const active = dictionary.filter((entry) => entry.active);
  const phrases = active.flatMap((entry) => phrasesOf(entry));
  const plural = pluralSpans(folded, phrases.map((item) => ({
    phrase: item.phrase, kind: item.isLabel ? "label" as const : "alias" as const,
  })));
  const spans: RemainderSpan[] = [];
  for (const { phrase, isLabel } of phrases) {
    if (Array.from(phrase).length < MIN_REMAINDER) continue;
    for (const occurrence of matchOccurrences(folded, phrase, isLabel ? "label" : "alias")) {
      if (shadowedByPlural(occurrence, plural)) continue;
      spans.push({ start: toOriginal[occurrence.start], end: toOriginal[occurrence.end] });
    }
  }
  return mergeSpans(spans);
}

/** Gaps of `segment` left after subtracting the already-merged `covered` spans. */
function subtract(segment: RemainderSpan, covered: RemainderSpan[]): RemainderSpan[] {
  const gaps: RemainderSpan[] = [];
  let cursor = segment.start;
  for (const span of covered) {
    if (span.end <= cursor) continue;
    if (span.start >= segment.end) break;
    if (span.start > cursor) gaps.push({ start: cursor, end: Math.min(span.start, segment.end) });
    cursor = Math.max(cursor, span.end);
    if (cursor >= segment.end) break;
  }
  if (cursor < segment.end) gaps.push({ start: cursor, end: segment.end });
  return gaps;
}

/** Trim surrounding whitespace, keeping absolute offsets. */
function trimSpan(text: string, span: RemainderSpan): RemainderSpan | null {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return start < end ? { start, end } : null;
}

/**
 * Drop standalone particles at either edge. `이 젖은 바닥에` -> `젖은 바닥에`.
 *
 * Only a whole whitespace-delimited token is removed, so a word that merely ends in a
 * particle character (`사람이`) is untouched. This is why the list is explicit rather
 * than a suffix rule.
 */
function stripParticles(text: string, span: RemainderSpan): RemainderSpan | null {
  let { start, end } = span;
  for (;;) {
    const leading = /^(\S+)(\s+)/.exec(text.slice(start, end));
    if (!leading || !PARTICLES.has(leading[1])) break;
    start += leading[1].length + leading[2].length;
  }
  for (;;) {
    const trailing = /(\s+)(\S+)$/.exec(text.slice(start, end));
    if (!trailing || !PARTICLES.has(trailing[2])) break;
    end -= trailing[2].length + trailing[1].length;
  }
  const trimmed = start < end ? trimSpan(text, { start, end }) : null;
  // A fragment that *is* only particles has no content left.
  if (trimmed && PARTICLES.has(text.slice(trimmed.start, trimmed.end))) return null;
  return trimmed;
}

/**
 * Cut to `maxChars` at the last space when possible, so a Korean word is not split in
 * half. Deterministic: the same input always yields the same cut.
 */
function clip(text: string, span: RemainderSpan, maxChars: number): RemainderSpan {
  const characters = Array.from(text.slice(span.start, span.end));
  if (characters.length <= maxChars) return span;
  const head = characters.slice(0, maxChars).join("");
  const boundary = head.lastIndexOf(" ");
  const kept = boundary > 0 ? head.slice(0, boundary) : head;
  return { start: span.start, end: span.start + kept.length };
}

/**
 * Uncovered phrases, each `{start, end}` into the original text.
 *
 * Coverage is subtracted first, then the rest is split on clause punctuation so one
 * comma-separated scene does not become a single 200-character item.
 */
export function extractRemainder(request: RemainderRequest): RemainderReport {
  const text = request.freeTextKo;
  const limit = request.maxItems ?? REMAINDER_LIMIT;
  const maxChars = request.maxChars ?? REMAINDER_CHARS;
  if (!text.trim() || limit <= 0) return { phrases: [], dropped: 0, withheld: 0 };

  const covered = coveredRanges(text, request.dictionary);
  const segments: RemainderSpan[] = [];
  let segmentStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (SEGMENT_BREAK.test(text[index])) {
      segments.push({ start: segmentStart, end: index });
      segmentStart = index + 1;
    }
  }
  segments.push({ start: segmentStart, end: text.length });

  const found: RemainderPhrase[] = [];
  let dropped = 0;
  for (const segment of segments) {
    for (const gap of subtract(segment, covered)) {
      const piece = stripParticles(text, gap);
      if (!piece) { dropped += 1; continue; }
      const clipped = clip(text, piece, maxChars);
      const value = text.slice(clipped.start, clipped.end);
      if (Array.from(value).length < MIN_REMAINDER) { dropped += 1; continue; }
      found.push({ start: clipped.start, end: clipped.end, text: value });
    }
  }
  return {
    phrases: found.slice(0, limit),
    dropped,
    withheld: Math.max(0, found.length - limit),
  };
}

/**
 * `true` when a span still addresses the given text.
 *
 * Callers must re-check this immediately before building a request: the user can edit
 * the text between extraction and an accept, and an offset that outlived its text is
 * how a translation lands on the wrong words.
 */
export function isValidRemainderSpan(text: string, span: RemainderSpan): boolean {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) return false;
  if (span.start < 0 || span.end > text.length || span.start >= span.end) return false;
  return text.slice(span.start, span.end).trim().length > 0;
}

/** Every span that no longer addresses `text`, so a caller can refuse the whole batch. */
export function staleSpans(text: string, spans: RemainderSpan[]): RemainderSpan[] {
  return spans.filter((span) => !isValidRemainderSpan(text, span));
}

/**
 * Convert a UTF-16 span (what `extractRemainder` returns) to code-point offsets.
 *
 * **Call this in exactly one place: when building a request body.** Every span in this
 * module and in `matching.ts` counts UTF-16 code units, because that is what
 * `String#indexOf` and a textarea selection use. `free_text_ko` is sliced by Python on
 * the server, and Python counts code points. The two differ as soon as the text holds a
 * surrogate pair: for `İstanbul 😀 카페` the same character starts at 12 in JS and 11 in
 * Python. Sending UTF-16 offsets would make the server cut the wrong characters, which
 * is silent — the reply would describe text the user never wrote.
 *
 * Keeping the conversion explicit and separate means the UI can keep using DOM-native
 * offsets for highlighting while the wire format is unambiguous.
 */
export function toCodePointSpan(text: string, span: RemainderSpan): { start: number; end: number } {
  let start = 0;
  let end = 0;
  let index = 0;
  for (const char of text) {
    if (index < span.start) start += 1;
    if (index < span.end) end += 1;
    index += char.length;
  }
  return { start, end };
}
