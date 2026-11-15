import assert from 'node:assert/strict';
import test from 'node:test';
import { explainWarning, suggestSelections } from '../src/prompt/proposals.ts';
import { DICTIONARY, DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import { selectEntry } from '../src/prompt/scene.ts';
import { compileScene } from '../src/prompt/compiler.ts';

const labels = (ids) => new Map(DICTIONARY.map((entry) => [entry.id, entry.labelKo]));
const labelOf = (id) => labels().get(id) ?? id;

test('free text suggestions only reference existing dictionary IDs', () => {
  const text = '네온이 비치는 골목에 선 여자';
  const hints = suggestSelections({ freeTextKo: text, family: 'sd15', dictionary: DICTIONARY });
  assert.ok(hints.length > 0);
  const ids = new Set(DICTIONARY.map((entry) => entry.id));
  for (const hint of hints) {
    assert.ok(ids.has(hint.id), `unknown id ${hint.id}`);
    assert.equal(hint.available, true);
    assert.ok(hint.confidence > 0 && hint.confidence <= 1);
    // Every reported phrase must literally occur in the untouched original.
    assert.ok(text.includes(hint.matchedPhrase), `phrase not in text: ${hint.matchedPhrase}`);
  }
  assert.deepEqual(hints.map((hint) => hint.id), ['lighting.neon']);
  // "여자" is not a dictionary alias, so nothing is invented for the person.
  assert.ok(!hints.some((hint) => hint.id === 'subject.person'));
});

test('matches the Korean label and an alias, reporting the matched phrase', () => {
  const hints = suggestSelections({ freeTextKo: '흰색 셔츠를 입은 사람', family: 'sd15', dictionary: DICTIONARY });
  const shirt = hints.find((hint) => hint.id === 'clothing.white_shirt');
  assert.ok(shirt);
  assert.equal(shirt.matchedPhrase, '흰색 셔츠');
  assert.equal(shirt.labelKo, '흰 셔츠');
  // Label hits outrank alias hits at equal length.
  const person = hints.find((hint) => hint.id === 'subject.person');
  assert.ok(person.matchedPhrase === '사람' || person.matchedPhrase === '인물');
});

test('already selected entries and empty text produce no suggestions', () => {
  assert.deepEqual(suggestSelections({ freeTextKo: '   ', family: 'sd15', dictionary: DICTIONARY }), []);
  const hints = suggestSelections({ freeTextKo: '고양이가 앉아 있다', family: 'sd15', dictionary: DICTIONARY,
    selectedIds: ['subject.cat'] });
  assert.ok(!hints.some((hint) => hint.id === 'subject.cat'));
});

test('unmapped family lowers confidence but keeps the suggestion visible', () => {
  const mapped = suggestSelections({ freeTextKo: '고양이', family: 'sd15', dictionary: DICTIONARY });
  const unmapped = suggestSelections({ freeTextKo: '고양이', family: 'fake', dictionary: DICTIONARY });
  const a = mapped.find((hint) => hint.id === 'subject.cat');
  const b = unmapped.find((hint) => hint.id === 'subject.cat');
  assert.ok(a && b);
  assert.equal(a.available, true);
  assert.equal(b.available, false);
  assert.ok(b.confidence < a.confidence);
});

test('suggestions are deterministic, sorted, and respect the limit', () => {
  const request = { freeTextKo: '해변에서 웃는 사람, 긴 머리, 흰 셔츠, 네온 조명', family: 'sd15', dictionary: DICTIONARY };
  const first = suggestSelections(request);
  assert.deepEqual(first, suggestSelections(request));
  const confidences = first.map((hint) => hint.confidence);
  assert.deepEqual(confidences, [...confidences].sort((x, y) => y - x));
  assert.equal(suggestSelections({ ...request, maxSuggestions: 2 }).length, 2);
  assert.deepEqual(suggestSelections({ ...request, maxSuggestions: 0 }), []);
});

test('suggesting never mutates the free text or the dictionary', () => {
  const dictionary = structuredClone(DICTIONARY);
  const request = { freeTextKo: '네온 아래 사람', family: 'sd15', dictionary };
  suggestSelections(request);
  assert.equal(request.freeTextKo, '네온 아래 사람');
  assert.deepEqual(dictionary, DICTIONARY);
});

test('accepting a hint reproduces exactly what manual selection produces', () => {
  const empty = { schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '네온 아래 사람' };
  const entry = DICTIONARY.find((item) => item.id === 'lighting.neon');
  const hint = suggestSelections({ freeTextKo: empty.freeTextKo, family: 'sd15', dictionary: DICTIONARY })
    .find((item) => item.id === 'lighting.neon');
  const accepted = selectEntry(empty, entry, DICTIONARY_VERSION);
  assert.equal(hint.id, 'lighting.neon');
  assert.equal(compileScene(accepted).draft, 'neon lighting');
  assert.equal(accepted.freeTextKo, '네온 아래 사람');
});

test('duplicate warnings expose only the redundant tail, conflicts expose nothing', () => {
  const duplicate = explainWarning({ code: 'duplicate', ids: ['lighting.neon'] }, labelOf, 8000);
  assert.deepEqual(duplicate.removeIds, []);
  const duplicatePhrase = explainWarning({ code: 'duplicate_phrase', ids: ['appearance.short_hair', 'clothing.hat'] }, labelOf, 8000);
  assert.deepEqual(duplicatePhrase.removeIds, ['clothing.hat']);
  const conflict = explainWarning({ code: 'conflict', ids: ['composition.full_body', 'composition.close_up'] }, labelOf, 8000);
  assert.deepEqual(conflict.removeIds, []);
  assert.match(conflict.message, /둘 중 하나를 해제하세요/);
  // A single duplicate ID must never propose removing the only copy.
  assert.deepEqual(explainWarning({ code: 'duplicate_phrase', ids: ['subject.person'] }, labelOf, 8000).removeIds, []);
});

test('warning explanations cover limits and unsupported families without empty text', () => {
  assert.match(explainWarning({ code: 'token_budget', detail: '~90/77' }, labelOf, 8000).message, /SD 1\.5/);
  assert.match(explainWarning({ code: 'over_limit', detail: '3/2 selections' }, labelOf, 8000).message, /선택 항목/);
  assert.match(explainWarning({ code: 'over_limit', detail: '9000/8000' }, labelOf, 8000).message, /8000자/);
  assert.match(explainWarning({ code: 'unsupported_family' }, labelOf, 8000).message, /제공되지 않습니다/);
  assert.equal(explainWarning({ code: 'unknown_code' }, labelOf, 8000).message, '');
});
