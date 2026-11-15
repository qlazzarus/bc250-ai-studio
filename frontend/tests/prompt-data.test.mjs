import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY, DICTIONARY_VERSION, MODEL_FAMILIES, familyCoverage, searchDictionary, validateDictionary } from '../src/prompt/dictionary.ts';
import { removeEntry, selectEntry } from '../src/prompt/scene.ts';
import { compileScene } from '../src/prompt/compiler.ts';

test('seed dictionary validates and supports Korean aliases and active filtering', () => {
  assert.deepEqual(validateDictionary(DICTIONARY), []);
  assert.equal(searchDictionary(DICTIONARY, '은은한 빛')[0].id, 'lighting.soft');
  assert.equal(searchDictionary([{ ...DICTIONARY[0], active: false }], '').length, 0);
  assert.ok(DICTIONARY.every((entry) => MODEL_FAMILIES.every((family) => entry.mappings[family])));
});

test('duplicate IDs and missing or empty mapped values are rejected', () => {
  const copy = structuredClone(DICTIONARY[0]);
  assert.ok(validateDictionary([copy, copy]).some((error) => error.includes('duplicate')));
  copy.mappings.sd15 = { status: 'mapped', text: ' ' };
  delete copy.mappings.flux2;
  assert.equal(validateDictionary([copy]).length, 2);
});

test('multiple selection snapshots survive dictionary edits and preserve untranslated text', () => {
  const dictionary = structuredClone(DICTIONARY);
  const initial = { schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '비 오는 거리' };
  let scene = selectEntry(initial, dictionary[0], DICTIONARY_VERSION);
  scene = selectEntry(scene, dictionary[1], DICTIONARY_VERSION);
  scene = selectEntry(scene, dictionary[0], DICTIONARY_VERSION);
  dictionary[0].labelKo = '변경됨';
  dictionary[0].mappings.sd15.text = 'changed';
  dictionary.splice(0, 1);
  assert.equal(scene.selections.length, 2);
  assert.equal(scene.selections[0].labelKo, '인물');
  assert.equal(scene.selections[0].mapping.text, 'a person');
  assert.equal(scene.freeTextKo, '비 오는 거리');
  assert.equal(removeEntry(scene, 'subject.person').selections.length, 1);
});

test('unknown model family is explicitly unavailable', () => {
  const scene = selectEntry({ schemaVersion: 1, targetFamily: 'unknown', selections: [], freeTextKo: '' }, DICTIONARY[0], DICTIONARY_VERSION);
  assert.deepEqual(scene.selections[0].mapping, { status: 'unavailable' });
});

test('version 1.2.0 preserves all twelve 1.0.0 entries and their family mappings', () => {
  const legacy = [
    ['subject.person', 'subject', '인물', ['사람'], 'a person'],
    ['subject.portrait', 'subject', '인물 초상', ['초상화', '포트레이트'], 'a portrait'],
    ['action.standing', 'action', '서 있기', ['서있는', '서다'], 'standing'],
    ['action.walking', 'action', '걷기', ['걷는', '걸어가는'], 'walking'],
    ['location.street', 'location', '거리', ['길거리', '도로'], 'on a street'],
    ['location.room', 'location', '실내', ['방', '실내 공간'], 'indoors'],
    ['composition.full_body', 'composition', '전신', ['전신샷'], 'full body'],
    ['composition.close_up', 'composition', '클로즈업', ['근접', '가까이'], 'close-up'],
    ['lighting.soft', 'lighting', '부드러운 조명', ['은은한 빛'], 'soft lighting'],
    ['lighting.neon', 'lighting', '네온 조명', ['네온', '네온사인'], 'neon lighting'],
    ['style.photographic', 'style', '사진 스타일', ['사진', '포토리얼'], 'photographic style'],
    ['style.illustration', 'style', '일러스트', ['그림', '삽화'], 'illustration style'],
  ];
  assert.equal(DICTIONARY_VERSION, '1.2.0');
  assert.equal(DICTIONARY.length, 100);
  for (const [id, category, labelKo, aliases, text] of legacy) {
    const entry = DICTIONARY.find((item) => item.id === id);
    assert.deepEqual(entry, { id, category, labelKo, aliases, active: true, mappings: {
      sd15: { status: 'mapped', text }, 'z-image': { status: 'mapped', text },
      flux2: { status: 'mapped', text }, 'moss-image': { status: 'mapped', text },
      fake: { status: 'unavailable' },
    } });
  }
  assert.equal(DICTIONARY.filter((item) => item.mappings['moss-image'].status === 'unavailable').length, 0);
  assert.ok(DICTIONARY.every((item) => item.mappings.fake.status === 'unavailable'));
});

test('expanded entries provide family-specific phrases and remain searchable by aliases', () => {
  const entry = searchDictionary(DICTIONARY, '흑발').find((item) => item.id === 'appearance.black_hair');
  assert.equal(entry.mappings.sd15.text, 'black hair');
  assert.equal(entry.mappings['z-image'].text, 'with black hair');
  assert.equal(entry.mappings.flux2.text, 'with black hair');
  assert.equal(entry.mappings['moss-image'].text, 'with black hair');
  const oldScene = { schemaVersion: 1, targetFamily: 'sd15', freeTextKo: '', selections: [{
    id: 'lighting.soft', category: 'lighting', labelKo: '부드러운 조명', dictionaryVersion: '1.0.0',
    mapping: { status: 'mapped', text: 'soft lighting' },
  }] };
  const restored = compileScene(oldScene);
  assert.equal(restored.draft, 'soft lighting');
  assert.equal(restored.sources[0].dictionaryVersion, '1.0.0');
});

test('family coverage reports the renderable share without implying model support', () => {
  for (const family of ['sd15', 'z-image', 'flux2', 'moss-image']) {
    assert.deepEqual(familyCoverage(DICTIONARY, family), { mapped: 100, total: 100, family });
  }
  const fake = familyCoverage(DICTIONARY, 'fake');
  assert.equal(fake.mapped, 0);
  assert.equal(fake.total, 100);
  assert.equal(familyCoverage(DICTIONARY, 'unlisted').mapped, 0);
});
