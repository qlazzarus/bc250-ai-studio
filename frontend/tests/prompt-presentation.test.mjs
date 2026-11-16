import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY } from '../src/prompt/dictionary.ts';
import { compileScene } from '../src/prompt/compiler.ts';
import { initialBuilderState, withGeneratedDraft, withAppliedDraft, restoreComposition } from '../src/prompt/builderState.ts';
import { selectEntry } from '../src/prompt/scene.ts';
import {
  activeGroups, filterOptions, groupOf, selectionCounts, recoveryActions,
  previewControls, inclusionNotice, appliedStatus, GROUP_ORDER,
} from '../src/prompt/presentation.ts';

const entry = (id) => DICTIONARY.find((e) => e.id === id);
const sceneWith = (ids, family = 'sd15', freeTextKo = '') => ({
  schemaVersion: 1, targetFamily: family, freeTextKo,
  selections: ids.map((id) => ({ id, category: entry(id).category, labelKo: entry(id).labelKo,
    dictionaryVersion: '1.2.0', mapping: entry(id).mappings[family] })),
});
const snapshot = (overrides = {}) => ({ schema_version: 1, compiler_version: '1.2.0', target_family: 'sd15',
  selections: [], free_text_ko: '', draft_prompt: 'draft', unresolved: [], ...overrides });

test('legacy categories keep their display alias without changing stored values', () => {
  assert.equal(groupOf('action'), 'pose');
  assert.equal(groupOf('location'), 'setting');
  assert.equal(groupOf('composition'), 'camera');
  assert.equal(groupOf('lighting'), 'lighting');
  assert.ok(DICTIONARY.some((item) => item.category === 'action'));
  assert.ok(activeGroups(DICTIONARY).every((group) => GROUP_ORDER.includes(group)));
});

test('search stays inside a category and never mutates the dictionary', () => {
  const before = JSON.stringify(DICTIONARY);
  const all = filterOptions(DICTIONARY, '', '');
  assert.equal(all.length, DICTIONARY.filter((item) => item.active).length);
  const pose = filterOptions(DICTIONARY, '', 'pose');
  assert.ok(pose.length > 0 && pose.every((item) => groupOf(item.category) === 'pose'));
  assert.deepEqual(filterOptions(DICTIONARY, '인물', 'lighting'), []);
  assert.ok(filterOptions(DICTIONARY, '인물', '').some((item) => item.id === 'subject.person'));
  assert.equal(JSON.stringify(DICTIONARY), before);
});

test('zero-result recovery keeps the other filter axis', () => {
  const both = recoveryActions('인물', 'lighting');
  assert.deepEqual(both.map((action) => action.kind), ['widen', 'clearQuery']);
  assert.deepEqual({ category: both[0].nextCategory, query: both[0].nextQuery }, { category: '', query: '인물' });
  assert.deepEqual({ category: both[1].nextCategory, query: both[1].nextQuery }, { category: 'lighting', query: '' });
  assert.deepEqual(recoveryActions('', 'lighting').map((action) => action.kind), ['widen']);
  assert.deepEqual(recoveryActions('인물', '').map((action) => action.kind), ['clearQuery']);
});

test('category counts use display groups', () => {
  const counts = selectionCounts([{ category: 'action' }, { category: 'pose' }, { category: 'action' }]);
  assert.equal(counts.pose, 3);
  assert.equal(counts.subject, undefined);
});

test('a fresh edit shows the preview with no manual regenerate button', () => {
  const scene = sceneWith(['subject.person']);
  const state = withGeneratedDraft({ ...structuredClone(initialBuilderState), freeTextMode: 'separate', scene }, compileScene(scene));
  const controls = previewControls(state, 'sd15', { blocked: false, separateOnly: false, prompt: '', dirty: false });
  assert.equal(controls.showGenerate, false);
  assert.equal(controls.autoPreview, true);
  assert.equal(controls.canApply, true);
});

test('no result, saved draft and family mismatch each keep a regenerate path', () => {
  const empty = { ...structuredClone(initialBuilderState), scene: sceneWith([]) };
  assert.equal(previewControls(empty, 'sd15', { blocked: false, separateOnly: false, prompt: '', dirty: false }).showGenerate, true);

  const saved = restoreComposition(snapshot());
  const savedControls = previewControls(saved, 'sd15', { blocked: false, separateOnly: false, prompt: '', dirty: false });
  assert.equal(savedControls.showGenerate, true);
  assert.equal(savedControls.generateLabel, '현재 컴파일러로 초안 다시 만들기');

  const mismatch = previewControls(saved, 'flux2', { blocked: false, separateOnly: false, prompt: '', dirty: false });
  assert.equal(mismatch.showGenerate, true);
  assert.equal(mismatch.canApply, false);
});

test('a stale or blocked draft cannot be applied before regeneration', () => {
  const scene = sceneWith(['subject.person']);
  const state = withGeneratedDraft({ ...structuredClone(initialBuilderState), freeTextMode: 'separate', scene }, compileScene(scene));
  assert.equal(previewControls({ ...state, scene: { ...state.scene, freeTextKo: '추가' } }, 'sd15',
    { blocked: false, separateOnly: false, prompt: '', dirty: true }).canApply, false);
  assert.equal(previewControls(state, 'sd15', { blocked: true, separateOnly: false, prompt: '', dirty: false }).canApply, false);
});

test('separate-only explanation stays applicable while an unchanged prompt is kept', () => {
  const scene = sceneWith([], 'sd15', '비 오는 거리');
  const state = withGeneratedDraft({ ...structuredClone(initialBuilderState), freeTextMode: 'separate', scene }, compileScene(scene));
  const controls = previewControls(state, 'sd15', { blocked: false, separateOnly: true, prompt: '직접 쓴 프롬프트', dirty: false });
  assert.equal(controls.canApply, true);
  assert.match(controls.applyLabel, /설명만 이력에 적용/);
});

test('free text inclusion is reported from the mode, never inferred from strings', () => {
  const scene = sceneWith(['subject.person'], 'sd15', '비 오는 거리');
  const base = { ...structuredClone(initialBuilderState), scene };
  const verbatim = withGeneratedDraft({ ...base, freeTextMode: 'verbatim' }, compileScene(scene));
  assert.deepEqual(inclusionNotice(verbatim, verbatim.result), { included: true, unknown: false,
    text: '원문 포함 · 번역하지 않고 미리보기에 그대로 넣습니다.' });
  const separate = withGeneratedDraft({ ...base, freeTextMode: 'separate' }, compileScene(scene));
  assert.equal(inclusionNotice(separate, separate.result).included, false);
  assert.equal(inclusionNotice(separate, separate.result).unknown, false);
  assert.equal(inclusionNotice({ ...separate, scene: { ...scene, freeTextKo: '' } }, separate.result), null);
});

test('restored drafts report the unknown application method instead of guessing', () => {
  const restored = restoreComposition(snapshot({ free_text_ko: '비 오는 거리' }));
  assert.equal(inclusionNotice(restored, restored.result).unknown, true);
  assert.match(inclusionNotice(restored, restored.result).text, /기록에 없습니다/);
});

test('applied status distinguishes edited, unchanged, selected and unknown history', () => {
  const scene = sceneWith(['subject.person']);
  const state = withGeneratedDraft({ ...structuredClone(initialBuilderState), freeTextMode: 'separate', scene }, compileScene(scene));
  assert.equal(appliedStatus(state, ''), 'none');
  const applied = withAppliedDraft(state);
  assert.equal(appliedStatus(applied, applied.result.draft), 'applied');
  assert.equal(appliedStatus(applied, applied.result.draft + '!'), 'modified');
  assert.equal(appliedStatus({ ...applied, scene: { ...applied.scene, freeTextKo: '추가' } }, applied.result.draft), 'selectionChanged');
  assert.equal(appliedStatus(restoreComposition(snapshot()), 'draft'), 'unknown');
});

test('selecting entries through the shared path still yields sorted compiler output', () => {
  const scene = ['mood.calm', 'subject.person'].reduce((acc, id) => selectEntry(acc, entry(id), '1.2.0'),
    { schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '' });
  assert.deepEqual(scene.selections.map((item) => item.id), ['mood.calm', 'subject.person']);
  assert.equal(compileScene(scene).draft, 'a person, calm mood');
});
