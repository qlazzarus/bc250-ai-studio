import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY, DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import { changeSceneFamily, selectEntry } from '../src/prompt/scene.ts';
import { compileScene } from '../src/prompt/compiler.ts';

const sceneFor = (family, ids, freeTextKo = '') => ids.reduce((scene, id) =>
  selectEntry(scene, DICTIONARY.find((item) => item.id === id), DICTIONARY_VERSION),
  { schemaVersion: 1, targetFamily: family, selections: [], freeTextKo });

test('model formats, deterministic order, and frozen source attribution', () => {
  const ids = ['lighting.soft', 'action.standing', 'subject.person'];
  const sd = sceneFor('sd15', ids);
  const result = compileScene(sd);
  assert.equal(result.draft, 'a person, standing, soft lighting');
  assert.deepEqual(result.sources.map((item) => item.id), ['subject.person', 'action.standing', 'lighting.soft']);
  assert.deepEqual(result, compileScene(sceneFor('sd15', ids.reverse())));
  assert.equal(compileScene(sceneFor('z-image', ids)).draft, 'a person; standing; soft lighting');
  assert.equal(compileScene(sceneFor('flux2', ids)).draft, 'a person; standing; soft lighting');
  assert.equal(result.sources[0].dictionaryVersion, DICTIONARY_VERSION);
});

test('untranslated free text and missing mappings are retained without additions', () => {
  const scene = sceneFor('fake', ['subject.person'], '  비 오는 거리  ');
  const result = compileScene(scene);
  assert.equal(result.draft, '');
  assert.deepEqual(result.unresolved, [
    { kind: 'selection', id: 'subject.person', text: '인물' },
    { kind: 'free_text', text: '  비 오는 거리  ' },
  ]);
  assert.ok(result.warnings.some((w) => w.code === 'unsupported_family'));
});

test('conflicts and duplicate IDs warn without deleting distinct choices', () => {
  const scene = sceneFor('sd15', ['composition.close_up', 'composition.full_body']);
  scene.selections.push(structuredClone(scene.selections[0]));
  const result = compileScene(scene);
  assert.equal(result.sources.length, 2);
  assert.ok(result.warnings.some((w) => w.code === 'duplicate'));
  assert.ok(result.warnings.some((w) => w.code === 'conflict'));
});

test('empty scene and explicit family change do not reuse old mapping', () => {
  assert.ok(compileScene(sceneFor('sd15', [])).warnings.some((w) => w.code === 'empty'));
  const original = sceneFor('sd15', ['subject.person'], '원문');
  const unknown = changeSceneFamily(original, 'unknown', DICTIONARY, DICTIONARY_VERSION);
  assert.equal(compileScene(unknown).draft, '');
  assert.equal(unknown.freeTextKo, '원문');
  const missing = changeSceneFamily(original, 'flux2', [], DICTIONARY_VERSION);
  assert.deepEqual(missing.selections[0].mapping, { status: 'unavailable' });
  assert.equal(original.selections[0].mapping.status, 'mapped');
});

test('expanded ten-category selection has stable golden output for each family', () => {
  const ids = ['mood.calm', 'lighting.soft', 'composition.full_body', 'location.street',
    'action.standing', 'expression.smile', 'clothing.white_shirt', 'appearance.short_hair',
    'subject.person', 'style.photographic'];
  const sd = compileScene(sceneFor('sd15', ids, '원문 유지'));
  assert.equal(sd.draft, 'a person, short hair, white shirt, smile, standing, on a street, full body, soft lighting, photographic style, calm mood');
  const natural = 'a person; with short hair; wearing a white shirt; smiling; standing; on a street; full body; soft lighting; photographic style; with a calm mood';
  for (const family of ['z-image', 'flux2']) {
    const output = compileScene(sceneFor(family, ids, '원문 유지'));
    assert.equal(output.draft, natural);
    assert.deepEqual(output.unresolved, [{ kind: 'free_text', text: '원문 유지' }]);
    assert.deepEqual(output, compileScene(sceneFor(family, [...ids].reverse(), '원문 유지')));
  }
  assert.deepEqual(sd.unresolved, [{ kind: 'free_text', text: '원문 유지' }]);
  assert.equal(sd.sources.length, 10);
});

test('expanded conflict candidates warn but preserve all choices', () => {
  const pairs = [
    ['appearance.short_hair', 'appearance.long_hair'],
    ['appearance.black_hair', 'appearance.blonde_hair'],
    ['appearance.curly_hair', 'appearance.straight_hair'],
    ['expression.laughing', 'expression.sad'],
    ['action.standing', 'pose.sitting'],
    ['location.room', 'location.street'],
    ['camera.front_view', 'camera.back_view'],
    ['camera.high_angle', 'camera.low_angle'],
    ['composition.full_body', 'composition.close_up'],
  ];
  for (const ids of pairs) {
    const output = compileScene(sceneFor('sd15', ids));
    assert.equal(output.sources.length, 2, ids.join(','));
    assert.ok(output.warnings.some((w) => w.code === 'conflict' && ids.every((id) => w.ids.includes(id))), ids.join(','));
  }
});

test('compatible combinations do not produce conflict warnings', () => {
  for (const ids of [
    ['appearance.long_hair', 'appearance.ponytail'],
    ['clothing.white_shirt', 'clothing.jacket'],
    ['style.photographic', 'style.black_and_white'],
  ]) assert.ok(!compileScene(sceneFor('sd15', ids)).warnings.some((w) => w.code === 'conflict'));
});

test('family rebinding preserves input and correctly reports MOSS and unknown mappings', () => {
  const original = sceneFor('sd15', ['subject.person', 'appearance.short_hair'], '한글 원문');
  const moss = changeSceneFamily(original, 'moss-image', DICTIONARY, DICTIONARY_VERSION);
  const output = compileScene(moss);
  assert.equal(output.draft, 'a person; with short hair');
  assert.deepEqual(output.unresolved, [{ kind: 'free_text', text: '한글 원문' }]);
  const flux = changeSceneFamily(moss, 'flux2', DICTIONARY, DICTIONARY_VERSION);
  assert.equal(compileScene(flux).draft, 'a person; with short hair');
  const unknown = changeSceneFamily(flux, 'unlisted', DICTIONARY, DICTIONARY_VERSION);
  assert.equal(compileScene(unknown).draft, '');
  assert.equal(compileScene(unknown).unresolved.length, 3);
  assert.equal(original.selections[1].mapping.text, 'short hair');
  // An entry removed from the dictionary keeps its captured value but reports
  // the missing mapping instead of silently reusing another family's phrase.
  const missing = changeSceneFamily(original, 'flux2', [], DICTIONARY_VERSION);
  assert.deepEqual(missing.selections[0].mapping, { status: 'unavailable' });
  assert.equal(compileScene(missing).draft, '');
});

test('warnings distinguish conflicting selections from duplicate phrases', () => {
  const conflictOnly = compileScene(sceneFor('sd15', ['composition.full_body', 'composition.close_up']));
  assert.ok(conflictOnly.warnings.some((w) => w.code === 'conflict'));
  assert.ok(!conflictOnly.warnings.some((w) => w.code === 'duplicate_phrase'));
  // Two different IDs that freeze the same expression emit the phrase once.
  const scene = sceneFor('sd15', ['subject.person']);
  scene.selections.push({ id: 'subject.person_copy', category: 'subject', labelKo: '인물 사본',
    dictionaryVersion: DICTIONARY_VERSION, mapping: { status: 'mapped', text: 'a person' } });
  const output = compileScene(scene);
  assert.equal(output.draft, 'a person');
  assert.equal(output.sources.length, 2);
  const duplicate = output.warnings.find((w) => w.code === 'duplicate_phrase');
  assert.deepEqual(duplicate.ids, ['subject.person', 'subject.person_copy']);
});

test('over-limit and SD 1.5 token budget warnings never truncate the draft', () => {
  const scene = { schemaVersion: 1, targetFamily: 'sd15', freeTextKo: '', selections: [
    { id: 'a.one', category: 'subject', labelKo: '하나', dictionaryVersion: '1.2.0', mapping: { status: 'mapped', text: 'x'.repeat(4000) } },
    { id: 'a.two', category: 'style', labelKo: '둘', dictionaryVersion: '1.2.0', mapping: { status: 'mapped', text: 'y'.repeat(4000) } },
  ] };
  const output = compileScene(scene);
  assert.equal(output.draft.length, 8002);
  const limit = output.warnings.find((w) => w.code === 'over_limit');
  assert.equal(limit.detail, '8002/8000');
  assert.equal(output.warnings.filter((w) => w.code === 'over_limit').length, 1);
});

test('token budget only applies to the sd15 tag window', () => {
  const scene = (family) => ({ schemaVersion: 1, targetFamily: family, freeTextKo: '',
    selections: Array.from({ length: 30 }, (_, index) => ({
      id: `subject.extra_${index}`, category: 'subject', labelKo: `항목 ${index}`,
      dictionaryVersion: '1.2.0',
      mapping: { status: 'mapped', text: `a person standing outside building ${index}` },
    })) });
  const sd = compileScene(scene('sd15'));
  assert.equal(sd.warnings.filter((w) => w.code === 'token_budget').length, 1);
  assert.equal(sd.draft.split(', ').length, 30);
  for (const family of ['z-image', 'flux2', 'moss-image']) {
    assert.equal(compileScene(scene(family)).warnings.some((w) => w.code === 'token_budget'), false, family);
  }
  const short = { ...scene('sd15'), selections: scene('sd15').selections.slice(0, 2) };
  assert.equal(compileScene(short).warnings.some((w) => w.code === 'token_budget'), false);
});

test('selection count over the server cap is reported but kept', () => {
  const selections = Array.from({ length: 101 }, (_, index) => ({
    id: `subject.cap_${index}`, category: 'subject', labelKo: `항목 ${index}`,
    dictionaryVersion: '1.2.0', mapping: { status: 'mapped', text: `item ${index}` },
  }));
  const output = compileScene({ schemaVersion: 1, targetFamily: 'flux2', freeTextKo: '', selections });
  assert.equal(output.sources.length, 101);
  const limit = output.warnings.filter((w) => w.code === 'over_limit');
  assert.equal(limit.length, 1);
  assert.equal(limit[0].detail, '101/100 selections');
});



test('a 1.0.0 captured selection remains independent of current dictionary', () => {
  const saved = { schemaVersion: 1, targetFamily: 'sd15', freeTextKo: '', selections: [{
    id: 'appearance.short_hair', category: 'appearance', labelKo: '예전 이름',
    dictionaryVersion: '1.0.0', mapping: { status: 'mapped', text: 'older stored text' },
  }] };
  const output = compileScene(saved);
  assert.equal(output.draft, 'older stored text');
  assert.equal(output.sources[0].dictionaryVersion, '1.0.0');
});
