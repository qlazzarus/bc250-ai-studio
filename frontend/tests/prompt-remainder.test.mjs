import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REMAINDER_CHARS, REMAINDER_LIMIT, coveredRanges, extractRemainder, foldForMatching,
  isValidRemainderSpan, staleSpans, toCodePointSpan,
} from '../src/prompt/remainder.ts';
import { DICTIONARY } from '../src/prompt/dictionary.ts';
import { suggestSelections } from '../src/prompt/proposals.ts';
import { compileScene } from '../src/prompt/compiler.ts';

const MEASURED = '비 오는 밤, 편의점 앞에서 비를 맞으며 기다리는 30살 유럽 여성 금발. 네온 조명이 젖은 바닥에 반사된다';

test('the measured sentence yields the uncovered phrases and excludes covered words', () => {
  const report = extractRemainder({ freeTextKo: MEASURED, dictionary: DICTIONARY });
  assert.deepEqual(report.phrases.map((phrase) => phrase.text), [
    '비 오는 밤',
    '편의점 앞에서 비를 맞으며 기다리는 30살 유럽 여성',
    '젖은 바닥에 반사된다',
  ]);
  // The two dictionary words are covered, so neither appears as remainder.
  const joined = report.phrases.map((phrase) => phrase.text).join('|');
  assert.ok(!joined.includes('금발'));
  assert.ok(!joined.includes('네온 조명'));
  const covered = coveredRanges(MEASURED, DICTIONARY).map((span) => MEASURED.slice(span.start, span.end));
  assert.deepEqual(covered, ['금발', '네온 조명']);
});

test('every returned offset addresses the original text', () => {
  for (const text of [MEASURED, '해변에서 웃는 사람', '카페 창가, 어두운 조명']) {
    for (const phrase of extractRemainder({ freeTextKo: text, dictionary: DICTIONARY }).phrases) {
      assert.equal(text.slice(phrase.start, phrase.end), phrase.text, text);
      assert.ok(isValidRemainderSpan(text, phrase));
    }
  }
});

test('a code point whose lowercase form is longer does not shift later offsets', () => {
  // U+0130 (İ) folds to two code units. Without the index map every later offset drifts
  // by one and the slice would return the wrong characters.
  const text = 'İstanbul 카페 앞';
  const fold = foldForMatching(text);
  assert.equal(text.length, 13);
  assert.equal(fold.folded.length, 14);
  const report = extractRemainder({ freeTextKo: text, dictionary: DICTIONARY });
  for (const phrase of report.phrases) {
    assert.equal(text.slice(phrase.start, phrase.end), phrase.text);
  }
  // `카페` is covered and sits after the expansion, so its original offset is not folded+1.
  const [cafe] = coveredRanges(text, DICTIONARY);
  assert.equal(text.slice(cafe.start, cafe.end), '카페');
  assert.equal(cafe.start, 9);
});

test('a negated phrase is covered, never remainder', () => {
  // RULE01: `안경` is in the vocabulary but negated, so it is absent from the image.
  // Offering it for translation would risk emitting the opposite meaning.
  const text = '안경 없이 짧은 머리의 사람';
  const covered = coveredRanges(text, DICTIONARY).map((span) => text.slice(span.start, span.end));
  assert.ok(covered.includes('안경'));
  const remainder = extractRemainder({ freeTextKo: text, dictionary: DICTIONARY })
    .phrases.map((phrase) => phrase.text);
  assert.ok(!remainder.some((phrase) => phrase.includes('안경')));
  assert.ok(!remainder.some((phrase) => phrase.includes('짧은 머리')));
});

test('a particle left at a segment edge is dropped, a particle-only fragment is not offered', () => {
  // `네온 조명이` leaves the bare particle `이` before the uncovered words.
  const text = '네온 조명이 젖은 바닥에 반사된다';
  const phrases = extractRemainder({ freeTextKo: text, dictionary: DICTIONARY }).phrases;
  assert.deepEqual(phrases.map((phrase) => phrase.text), ['젖은 바닥에 반사된다']);
  // A word that merely ends in a particle character is not trimmed.
  const tail = extractRemainder({ freeTextKo: '사람이 걷는다', dictionary: DICTIONARY }).phrases;
  assert.ok(tail.every((phrase) => phrase.text === '걷는다'));
});

test('empty and whitespace-only text produce nothing', () => {
  for (const text of ['', '   ', '\n\t']) {
    assert.deepEqual(extractRemainder({ freeTextKo: text, dictionary: DICTIONARY }),
      { phrases: [], dropped: 0, withheld: 0 });
  }
});

test('caps match the server: 8 items and 200 characters, and neither is silent', () => {
  assert.equal(REMAINDER_LIMIT, 8);
  assert.equal(REMAINDER_CHARS, 200);
  const many = Array.from({ length: 12 }, (_, index) => `구절${index} 내용`).join(', ');
  const limited = extractRemainder({ freeTextKo: many, dictionary: DICTIONARY });
  assert.equal(limited.phrases.length, 8);
  assert.equal(limited.withheld, 4);
  // A long phrase is cut at a space, so no Korean word is split in half.
  const long = extractRemainder({ freeTextKo: '가나다라마 '.repeat(40).trim(), dictionary: DICTIONARY });
  for (const phrase of long.phrases) {
    assert.ok(Array.from(phrase.text).length <= 200);
    assert.equal(long.phrases[0] && phrase.text.slice(-1) === ' ', false);
  }
});

test('a span that no longer addresses the text is reported stale', () => {
  const text = '비 오는 밤, 카페';
  const phrases = extractRemainder({ freeTextKo: text, dictionary: DICTIONARY }).phrases;
  assert.deepEqual(staleSpans(text, phrases), []);
  const edited = '짧';
  assert.equal(staleSpans(edited, phrases).length, phrases.length);
  assert.equal(isValidRemainderSpan(text, { start: -1, end: 2 }), false);
  assert.equal(isValidRemainderSpan(text, { start: 3, end: 3 }), false);
  assert.equal(isValidRemainderSpan(text, { start: 0, end: text.length + 1 }), false);
});

test('a span converted for the wire counts code points, as the server slices them', () => {
  // JS counts UTF-16 code units; Python's `str` slicing counts code points. With one
  // astral character in the text the two disagree, and sending the JS offset would make
  // the server cut the wrong characters.
  const text = 'İstanbul 😀 카페';
  const span = { start: text.indexOf('카페'), end: text.indexOf('카페') + '카페'.length };
  assert.equal(span.start, 12);
  const wire = toCodePointSpan(text, span);
  assert.deepEqual(wire, { start: 11, end: 13 });
  // The distinguishing assertion: slicing by the converted offsets returns the phrase.
  assert.equal(Array.from(text).slice(wire.start, wire.end).join(''), '카페');
  assert.notEqual(text.slice(span.start, span.end), text.slice(wire.start, wire.end));

  // A span that ends inside a surrogate pair is not a real boundary; it still maps to
  // the code point that contains it rather than inventing a gap.
  const afterEmoji = toCodePointSpan(text, { start: 10, end: 12 });
  assert.deepEqual(afterEmoji, { start: 10, end: 11 });
  // ASCII-only text needs no conversion at all.
  assert.deepEqual(toCodePointSpan('abc def', { start: 4, end: 7 }), { start: 4, end: 7 });
});

test('TRANS02 does not change the rule engine or the compiler', () => {
  // Adding the module must not touch suggestion output or the single free_text entry
  // that `unresolved` carries today; TRANS04 changes the display, not this contract.
  assert.deepEqual(suggestSelections({ freeTextKo: MEASURED, family: 'sd15', dictionary: DICTIONARY })
    .map((hint) => hint.id).sort(), ['appearance.blonde_hair', 'lighting.neon']);
  const result = compileScene({
    schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: MEASURED,
  });
  assert.deepEqual(result.unresolved, [{ kind: 'free_text', text: MEASURED }]);
  assert.equal(result.draft, '');
});
