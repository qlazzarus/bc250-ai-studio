import assert from 'node:assert/strict';
import test from 'node:test';
import { explainWarning, suggestSelections, suggestSelectionsDetailed } from '../src/prompt/proposals.ts';
import { countAround, matchOccurrences, polarityAt } from '../src/prompt/matching.ts';
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

test('a negated phrase is not proposed, and a mixed clause keeps its positive half', () => {
  // RULE01, EVAL-UX01 사례 1–2: "사람은 없다" must not propose 인물.
  const emptyBeach = suggestSelections({
    freeTextKo: '텅 빈 해변, 파도만 보인다. 사람이나 동물은 전혀 없다.',
    family: 'sd15', dictionary: DICTIONARY,
  });
  assert.deepEqual(emptyBeach.map((hint) => hint.id), ['setting.beach']);

  const lake = suggestSelections({
    freeTextKo: '해 질 무렵 넓은 호수와 낮은 산, 잔잔한 수면. 사람은 없다.',
    family: 'sd15', dictionary: DICTIONARY,
  });
  assert.ok(!lake.some((hint) => hint.id === 'subject.person'));

  // The negation belongs to one occurrence, not to the sentence: the cat stays.
  const mixed = suggestSelections({
    freeTextKo: '사람은 없고 고양이는 있다', family: 'sd15', dictionary: DICTIONARY,
  });
  assert.deepEqual(mixed.map((hint) => hint.id), ['subject.cat']);

  // A negation *before* a later phrase does not reach it either.
  const catOnly = suggestSelections({
    freeTextKo: '사람이 없는 해변의 고양이', family: 'sd15', dictionary: DICTIONARY,
  });
  assert.deepEqual(catOnly.map((hint) => hint.id).sort(), ['setting.beach', 'subject.cat']);

  // "안경 없이 웃는 사람" negates the glasses only; the person is still affirmed.
  const glasses = suggestSelections({
    freeTextKo: '안경 없이 웃는 사람', family: 'sd15', dictionary: DICTIONARY,
  });
  assert.ok(!glasses.some((hint) => hint.id === 'appearance.glasses'));
  assert.ok(glasses.some((hint) => hint.id === 'subject.person'));
});

test('a plural or counted subject never collapses into the singular person', () => {
  // 사례 3: "사람들" is the dictionary's own plural entry.
  const group = suggestSelections({ freeTextKo: '사람들', family: 'sd15', dictionary: DICTIONARY });
  assert.deepEqual(group.map((hint) => hint.id), ['subject.group']);

  const many = suggestSelections({ freeTextKo: '여러 사람', family: 'sd15', dictionary: DICTIONARY });
  assert.deepEqual(many.map((hint) => hint.id), ['subject.group']);

  // "사람 둘" / "두 사람" / "사람 2명" are two people, and the reported phrase keeps
  // the count verbatim so the panel can show what it read.
  for (const [text, phrase] of [['사람 둘이 걷는다', '사람 둘'], ['두 사람', '두 사람'], ['사람 2명', '사람 2명']]) {
    const hints = suggestSelections({ freeTextKo: text, family: 'sd15', dictionary: DICTIONARY });
    const subject = hints.filter((hint) => hint.category === 'subject');
    assert.deepEqual(subject.map((hint) => hint.id), ['subject.two_people'], text);
    assert.equal(subject[0].matchedPhrase, phrase);
    assert.ok(text.includes(subject[0].matchedPhrase));
  }

  // A numeral that is the tail of another word ("모두") is not a count.
  const everyOne = suggestSelections({ freeTextKo: '모두 사람', family: 'sd15', dictionary: DICTIONARY });
  assert.deepEqual(everyOne.map((hint) => hint.id), ['subject.person']);
});

test('an already selected plural entry keeps the singular silent after reopening', () => {
  // Selecting 두 사람 must not make the list offer 인물 on the same sentence: the count
  // is still a count, and the entry that would have carried it is already in.
  const counted = suggestSelections({
    freeTextKo: '두 사람이 걷는다', family: 'sd15', dictionary: DICTIONARY,
    selectedIds: ['subject.two_people'],
  });
  assert.ok(!counted.some((hint) => hint.id === 'subject.person'), JSON.stringify(counted));

  const plural = suggestSelections({
    freeTextKo: '사람들이 걷는다', family: 'sd15', dictionary: DICTIONARY,
    selectedIds: ['subject.group'],
  });
  assert.ok(!plural.some((hint) => hint.id === 'subject.person'), JSON.stringify(plural));

  // The same text without the selection still reaches the plural entry, so the guard is
  // about the selection and not about the phrase.
  assert.deepEqual(
    suggestSelections({ freeTextKo: '두 사람이 걷는다', family: 'sd15', dictionary: DICTIONARY })
      .filter((hint) => hint.category === 'subject').map((hint) => hint.id),
    ['subject.two_people'],
  );
});

test('matching helpers decide one occurrence at a time and stay boundary-aware', () => {
  assert.equal(polarityAt('은 없다', 0), 'negated');
  assert.equal(polarityAt('은 있다', 0), 'affirmed');
  assert.equal(polarityAt('은 없고 고양이는 있다', 0), 'negated');
  // A clause break ends the polarity scope.
  assert.equal(polarityAt('. 사람은 있다', 0), 'affirmed');

  // Word-boundary rule: a Hangul tail is not a match, punctuation and digits are.
  assert.equal(matchOccurrences('모두 사람', '두 사람', 'label').length, 0);
  assert.equal(matchOccurrences('두 사람', '두 사람', 'label').length, 1);
  assert.equal(matchOccurrences('(사람)', '사람', 'alias').length, 1);

  // The width includes the separating space, so the widened span reads "사람 둘".
  assert.deepEqual(countAround('사람 둘이', 0, 2), { text: '둘', where: 'after', width: 2 });
  assert.deepEqual(countAround('두 사람', 2, 4), { text: '두', where: 'before', width: 2 });
  assert.equal(countAround('모두 사람', 2, 4), null);
  assert.equal(countAround('사람 하나', 0, 2), null);
});

test('a partial scope withholds out-of-scope proposals instead of dropping them silently', () => {
  const text = '같은 인물, 같은 옷. 카페 창가, 어두운 조명. 조명만 바꿔 본다.';
  const selectedIds = ['subject.person', 'clothing.white_shirt'];
  const open = suggestSelectionsDetailed({ freeTextKo: text, family: 'sd15', dictionary: DICTIONARY, selectedIds });
  assert.equal(open.scoped, false);
  assert.deepEqual(open.outOfScope, []);
  assert.deepEqual(open.hints.map((hint) => hint.id), ['lighting.low_key', 'setting.cafe']);

  // RULE02: 조명만 means the place stays out, and is reported as withheld.
  const lighting = suggestSelectionsDetailed({
    freeTextKo: text, family: 'sd15', dictionary: DICTIONARY, selectedIds, targetGroups: ['lighting'],
  });
  assert.equal(lighting.scoped, true);
  assert.deepEqual(lighting.hints.map((hint) => hint.id), ['lighting.low_key']);
  assert.deepEqual(lighting.outOfScope.map((hint) => hint.id), ['setting.cafe']);
  // A light-only request can only ever add lighting, which is the promise the button makes.
  for (const hint of lighting.hints) {
    assert.equal(DICTIONARY.find((entry) => entry.id === hint.id).category, 'lighting');
  }

  // Widening the scope brings the place back; nothing was lost by withholding it.
  const widened = suggestSelectionsDetailed({
    freeTextKo: text, family: 'sd15', dictionary: DICTIONARY, selectedIds, targetGroups: ['lighting', 'setting'],
  });
  assert.deepEqual(widened.hints.map((hint) => hint.id), ['lighting.low_key', 'setting.cafe']);
  assert.deepEqual(widened.outOfScope, []);

  // The scope is a filter, not a rewrite: the plain callers keep their whole answer.
  assert.deepEqual(
    suggestSelections({ freeTextKo: text, family: 'sd15', dictionary: DICTIONARY, selectedIds }),
    open.hints,
  );
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
