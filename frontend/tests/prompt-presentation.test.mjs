import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DICTIONARY } from '../src/prompt/dictionary.ts';
import { compileScene } from '../src/prompt/compiler.ts';
import { initialBuilderState, withGeneratedDraft, withAppliedDraft, restoreComposition } from '../src/prompt/builderState.ts';
import { selectEntry } from '../src/prompt/scene.ts';
import {
  activeGroups, filterOptions, groupOf, selectionCounts, recoveryActions,
  previewControls, inclusionNotice, appliedStatus, GROUP_ORDER,
  nextFocusAfterRemoval, unresolvedSelections, advisoryWarnings,
  SUMMARY_ROWS, sceneSummary, summaryIsEmpty,
} from '../src/prompt/presentation.ts';
import { SCENE_EXAMPLES, applyExample, exampleNeedsConfirm } from '../src/prompt/examples.ts';
import { queueCounts, queueDefaultExpanded, queueExpanded, queueSummary } from '../src/lib/queue.ts';

const entry = (id) => DICTIONARY.find((e) => e.id === id);
const sceneWith = (ids, family = 'sd15', freeTextKo = '') => ({
  schemaVersion: 1, targetFamily: family, freeTextKo,
  selections: ids.map((id) => ({ id, category: entry(id).category, labelKo: entry(id).labelKo,
    dictionaryVersion: '1.2.0', mapping: entry(id).mappings[family] })),
});
const snapshot = (overrides = {}) => ({ schema_version: 1, compiler_version: '1.2.0', target_family: 'sd15',
  selections: [], free_text_ko: '', draft_prompt: 'draft', unresolved: [], ...overrides });

test('chip render order and focus order share one summary row list', () => {
  const selections = [
    { category: 'lighting' }, { category: 'action' }, { category: 'subject' },
    { category: 'action' }, { category: 'custom' },
  ];
  const rows = sceneSummary(selections);
  // Rows are fixed display groups plus one fallback row for unknown stored values.
  assert.deepEqual(rows.map((row) => row.key), [...SUMMARY_ROWS.map((row) => row.key), 'other']);
  assert.deepEqual(rows.map((row) => row.label).slice(-1), ['기타']);
  assert.equal(rows.find((row) => row.key === 'pose').items.length, 2);
  // Flat row order is the DOM order the remove buttons appear in.
  assert.deepEqual(rows.flatMap((row) => row.items), [
    selections[2], selections[1], selections[3], selections[0], selections[4],
  ]);
  assert.deepEqual(sceneSummary([]).flatMap((row) => row.items), []);
  assert.equal(sceneSummary([]).length, SUMMARY_ROWS.length);
});

test('merged display groups keep their rows contiguous and the order stable', () => {
  const selections = [
    { category: 'clothing' }, { category: 'appearance' }, { category: 'style' }, { category: 'lighting' },
  ];
  const rows = sceneSummary(selections).filter((row) => row.items.length > 0);
  assert.deepEqual(rows.map((row) => row.label), ['외형·의상', '조명·스타일']);
  // Within a merged row the stored selection order is preserved, never re-sorted.
  assert.deepEqual(rows[0].items, [selections[0], selections[1]]);
  assert.deepEqual(rows[1].items, [selections[2], selections[3]]);
  // Legacy category aliases land in the row that owns their display group.
  const legacy = sceneSummary([{ category: 'action' }, { category: 'location' }, { category: 'composition' }]);
  assert.deepEqual(legacy.filter((row) => row.items.length).map((row) => row.label), ['표정·행동', '장소·시간', '구도']);
});

test('an empty summary is reported without inventing content from the free text', () => {
  const rows = sceneSummary([]);
  assert.equal(summaryIsEmpty(rows), true);
  assert.ok(rows.every((row) => row.items.length === 0));
  assert.equal(summaryIsEmpty(sceneSummary([{ category: 'mood' }])), false);
  // The helper only reads selections; a free text argument is never consulted.
  assert.equal(sceneSummary.length, 1);
});

test('examples fill only the free text and never replace it without consent', () => {
  assert.deepEqual(SCENE_EXAMPLES.map((item) => item.id), ['daily', 'product', 'landscape']);
  assert.deepEqual(SCENE_EXAMPLES.map((item) => item.title), ['일상', '제품', '풍경']);
  assert.ok(SCENE_EXAMPLES.every((item) => item.text.trim().length > 0));
  // No user text or log is used as an example; each one is project-authored Korean.
  assert.ok(SCENE_EXAMPLES.every((item) => /[가-힣]/.test(item.text)));

  assert.equal(exampleNeedsConfirm(''), false);
  assert.equal(exampleNeedsConfirm('   \n'), false);
  assert.equal(exampleNeedsConfirm('내가 쓴 설명'), true);

  let asked = 0;
  assert.equal(applyExample('', SCENE_EXAMPLES[0], () => { asked += 1; return true; }), SCENE_EXAMPLES[0].text);
  // An empty field is filled silently, so nobody is asked to confirm nothing.
  assert.equal(asked, 0);
  assert.equal(applyExample('내가 쓴 설명', SCENE_EXAMPLES[1], () => { asked += 1; return true; }), SCENE_EXAMPLES[1].text);
  assert.equal(asked, 1);
  // Cancelling returns null so the caller can leave every field untouched.
  assert.equal(applyExample('내가 쓴 설명', SCENE_EXAMPLES[2], () => false), null);
});

test('the queue header derives its counts and keeps a user choice across polls', () => {
  const jobs = [
    { status: 'running' }, { status: 'queued' }, { status: 'waiting_for_gpu' },
    { status: 'failed' }, { status: 'interrupted' }, { status: 'completed' }, { status: 'cancelled' },
  ];
  const counts = queueCounts(jobs);
  assert.deepEqual(counts, { running: 1, queued: 2, failed: 2, completed: 1, total: 7 });
  assert.equal(queueSummary(jobs), '진행 1 · 대기 2 · 실패 2');
  // Only non-zero facts are named, so the folded header stays one short line.
  assert.equal(queueSummary([{ status: 'completed' }]), '진행 0 · 대기 0');
  assert.equal(queueSummary([]), '최근 작업이 없습니다');

  assert.equal(queueDefaultExpanded([]), false);
  assert.equal(queueDefaultExpanded(jobs), true);
  // A stored choice wins, so a poll that adds or clears jobs cannot reopen it.
  assert.equal(queueExpanded(null, []), false);
  assert.equal(queueExpanded(null, jobs), true);
  assert.equal(queueExpanded(false, jobs), false);
  assert.equal(queueExpanded(true, []), true);
  // The input list is never mutated.
  const before = JSON.stringify(jobs);
  queueCounts(jobs); queueSummary(jobs);
  assert.equal(JSON.stringify(jobs), before);
});

test('focus after removal walks forward, then backward, then leaves the chips', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(nextFocusAfterRemoval(ids, 'b'), 'c');
  assert.equal(nextFocusAfterRemoval(ids, 'c'), 'b');
  assert.equal(nextFocusAfterRemoval(ids, 'a'), 'b');
  // Last remaining chip: null means the caller returns to the search input.
  assert.equal(nextFocusAfterRemoval(['a'], 'a'), null);
  assert.equal(nextFocusAfterRemoval([], 'a'), null);
  assert.equal(nextFocusAfterRemoval(ids, 'missing'), 'a');
});

test('unresolved free text is reported once, by the inclusion notice', () => {
  // Only the unsupported family leaves selections untranslated, so it is the case
  // where both a selection and the free text appear in `unresolved`.
  const scene = sceneWith(['subject.person'], 'fake', '비 오는 거리');
  const state = withGeneratedDraft({ ...structuredClone(initialBuilderState), freeTextMode: 'separate', scene }, compileScene(scene));
  assert.deepEqual(unresolvedSelections(state.result).map((item) => item.id), ['subject.person']);
  // The compilation still holds the free-text entry; it is only hidden from the warning list.
  assert.ok(state.result.unresolved.some((item) => item.kind === 'free_text'));
  assert.deepEqual(unresolvedSelections(null), []);
});

test('compiler warnings split into advisory and blocking classes', () => {
  const warnings = [
    { code: 'empty', ids: [] }, { code: 'over_limit', ids: [] },
    { code: 'token_budget', ids: [], detail: '~90/77' }, { code: 'duplicate', ids: ['a', 'b'] },
  ];
  // Hard limits are re-reported as blocking errors elsewhere, so they are not repeated here.
  assert.deepEqual(advisoryWarnings({ warnings }).map((item) => item.code), ['token_budget', 'duplicate']);
  assert.deepEqual(advisoryWarnings(null), []);
});

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
  assert.equal(appliedStatus(state, '', scene.targetFamily), 'none');
  const applied = withAppliedDraft(state);
  assert.equal(appliedStatus(applied, applied.result.draft, scene.targetFamily), 'applied');
  assert.equal(appliedStatus(applied, applied.result.draft + '!', scene.targetFamily), 'modified');
  assert.equal(appliedStatus({ ...applied, scene: { ...applied.scene, freeTextKo: '추가' } },
    applied.result.draft, scene.targetFamily), 'selectionChanged');
  assert.equal(appliedStatus(restoreComposition(snapshot()), 'draft', 'sd15'), 'unknown');
  // TRANS06: a rebind keeps the record, so its status must not keep claiming the record
  // would be stored — `appliedForFamily` refuses to send it for another family.
  assert.equal(appliedStatus(applied, applied.result.draft, 'flux2'), 'familyChanged');
});

test('background guidance stays collapsed and state text stays visible', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  // U11 showed these paragraphs pushed the apply control 63-81px further away.
  const collapsed = [
    '초안을 적용하면 서버 지원 여부',
    '입력한 원문에서 사전 항목을 찾아 제안합니다',
    '방식은 이 화면에서만 관리됩니다',
    '선택할 때 저장한',
    '원문은 그대로 보존하며 자동 번역하지 않습니다',
    '검색은 선택한 분류 안에서만 적용됩니다',
    '현재 선택 기준 최신 미리보기입니다',
  ];
  for (const phrase of collapsed) {
    const line = source.split('\n').find((text) => text.includes(phrase));
    assert.ok(line, `missing guidance: ${phrase}`);
    assert.match(line, /<HelpNote/, `guidance must collapse: ${phrase}`);
  }
  // Contract and safety text must never hide behind a disclosure.
  assert.ok(!/<HelpNote[^>]*>\{inclusion/.test(source) && !/inclusion\.text\}<\/HelpNote>/.test(source));
  assert.ok(source.includes('<p className="prompt-inclusion"'));
  // Free-text translation is reported by the inclusion notice only, and the three
  // message classes stay visible instead of sharing one warning style.
  assert.ok(source.includes('unresolvedSelections(state.result)'));
  assert.ok(!source.includes('state.result.unresolved.length > 0 &&'));
  // The counter itself is always on screen; only its explanation collapses.
  assert.match(source, /<HelpNote summary=\{`\$\{characterCount\(state\.scene\.freeTextKo\)\}\/4000자`\}>/);
  assert.ok(source.includes('id="free-text-help"'));
});

test('the three message classes are rendered and stay outside disclosures', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');
  // Explanation (coverage), advisory (duplicate/conflict/stale) and blocking
  // (validation) must be visually distinguishable, not one shared color.
  assert.ok(source.includes('className="prompt-notice" data-tone="info"'));
  assert.ok(source.includes('className="prompt-notice" data-tone="caution"'));
  assert.ok(source.includes('className="prompt-error"'));
  assert.ok(css.includes('.prompt-notice[data-tone="caution"]') && css.includes('.prompt-notice[data-tone="error"]'));
  // No advisory or blocking row may sit inside a collapsed disclosure.
  for (const line of source.split('\n')) {
    if (!/prompt-notice|prompt-error/.test(line)) continue;
    assert.ok(!/<HelpNote/.test(line), `message must stay visible: ${line.trim()}`);
  }
});

test('each chip remove button restores focus instead of dropping it', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  // The target is chosen before removal and applied after the render that unmounts
  // the button, so the removed element is never the focus target.
  assert.match(source, /pendingFocusRef\.current = \{ target: nextFocusAfterRemoval/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?removeRefs\.current\.get\(pending\.target\)/);
  assert.ok(source.includes('searchRef.current?.focus()'));
  // Clearing or bulk-removing every chip also lands on the search input.
  assert.match(source, /function clearScene\(\)[\s\S]*?pendingFocusRef\.current = \{ target: null \}/);
  // Chip render order and focus order read the same summary rows.
  assert.ok(source.includes('const summaries = sceneSummary(state.scene.selections);'));
  assert.ok(source.includes('const chipOrder = summaries.flatMap((row) => row.items.map((item) => item.id));'));
  assert.ok(!source.includes('groupOrder'));
});

test('selecting entries through the shared path still yields sorted compiler output', () => {
  const scene = ['mood.calm', 'subject.person'].reduce((acc, id) => selectEntry(acc, entry(id), '1.2.0'),
    { schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '' });
  assert.deepEqual(scene.selections.map((item) => item.id), ['mood.calm', 'subject.person']);
  assert.equal(compileScene(scene).draft, 'a person, calm mood');
});
