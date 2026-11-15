import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileScene } from '../src/prompt/compiler.ts';
import { initialBuilderState, withGeneratedDraft, withAppliedDraft, restoreComposition, applicationStatus, isDraftStale, appliedForFamily } from '../src/prompt/builderState.ts';
import { characterCount, utf8Bytes, compositionBytes, validateComposition, validateSubmission, validateText } from '../src/prompt/validation.ts';

const snapshot = () => ({ schema_version: 1, compiler_version: '1.2.0', target_family: 'sd15',
  selections: [{ id: 'subject.person', category: 'subject', label_ko: '인물', dictionary_version: '1.2.0', mapping_status: 'mapped', rendered: 'a person' }],
  free_text_ko: '', draft_prompt: 'a person', unresolved: [] });
const stateFor = (raw, mode = 'verbatim') => ({ ...structuredClone(initialBuilderState), freeTextMode: mode,
  scene: { schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: raw } });
const generate = (state) => withGeneratedDraft(state, compileScene(state.scene));

test('Unicode counts use Python code points, not UTF-16 or graphemes', () => {
  for (const [unit, count] of [['한', 1], ['😀', 1], ['e\u0301', 2], ['👩‍💻', 3]]) {
    assert.equal(characterCount(unit), count);
    const boundary = unit.repeat(Math.floor(8000 / count));
    assert.deepEqual(validateText(boundary, 'prompt', 8000, true), []);
    assert.ok(validateText(boundary + 'x'.repeat(8001 - characterCount(boundary)), 'prompt', 8000).length);
  }
  assert.ok(validateText('\u0085', 'prompt', 8000, true).length);
  assert.deepEqual(validateText('\ufeff', 'prompt', 8000, true), []);
  assert.ok(validateText('\ud800', 'prompt', 8000).length);
  assert.ok(validateText('x\0y', 'prompt', 8000).length);
});

test('normalized JSON UTF-8 bytes match Python including default IDs and escapes', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const python = process.env.PYTHON || (existsSync(root + '.venv/bin/python') ? root + '.venv/bin/python' : 'python3');
  for (const raw of ['한😀e\u0301', '"\\\b\f\n\r\t\u0001', '\u2028\u2029/\u007f', '👩‍💻'.repeat(200)]) {
    const c = snapshot();
    c.free_text_ko = raw;
    c.unresolved = [{ kind: 'free_text', text: raw }];
    const actual = Number(execFileSync(python, ['-c', 'import json,sys; from app.models.schemas import PromptComposition; c=PromptComposition.model_validate(json.load(sys.stdin)); print(len(json.dumps(c.model_dump(),ensure_ascii=False,separators=(",",":")).encode("utf-8")))'],
      { input: JSON.stringify(c), env: { ...process.env, PYTHONPATH: root + 'backend' }, encoding: 'utf8' }));
    assert.equal(compositionBytes(c), actual);
  }
});

test('composition caps, mapping constraints, family, duplicate IDs, and NUL', () => {
  const mutations = [
    c => c.selections = Array.from({length: 101}, (_, i) => ({...c.selections[0], id: String(i)})),
    c => c.draft_prompt = '😀'.repeat(8001), c => c.free_text_ko = '한'.repeat(4001),
    c => c.unresolved = Array.from({length: 102}, () => ({kind: 'free_text', text: 'x'})),
    c => c.unresolved = [{kind: 'free_text', text: '한'.repeat(4001)}],
    c => c.selections[0].rendered = 'x'.repeat(301), c => c.selections.push({...c.selections[0]}),
    c => c.selections[0].rendered = ' ', c => c.selections[0].mapping_status = 'unavailable',
    c => c.selections[0].mapping_status = 'other', c => c.target_family = 'flux2',
    c => c.free_text_ko = '\0', c => c.compiler_version = '',
  ];
  for (const mutate of mutations) { const c = snapshot(); mutate(c); assert.ok(validateComposition(c, 'sd15').length); }
  const c = snapshot();
  c.selections[0].rendered = '😀'.repeat(300);
  c.free_text_ko = 'a'.repeat(4000); c.draft_prompt = 'a'.repeat(8000);
  assert.deepEqual(validateComposition(c, 'sd15'), []);
});

test('composition 32 KiB boundary is distinct from exact wire body limit', () => {
  const c = snapshot();
  c.unresolved = Array.from({length: 9}, () => ({kind: 'free_text', text: 'x'}));
  let remaining = 32768 - compositionBytes(c);
  for (const item of c.unresolved) { const n = Math.min(remaining, 3999); item.text += 'x'.repeat(n); remaining -= n; }
  assert.equal(remaining, 0);
  assert.equal(compositionBytes(c), 32768);
  assert.deepEqual(validateComposition(c, 'sd15'), []);
  c.draft_prompt += 'x';
  assert.ok(validateComposition(c, 'sd15').some(i => i.field === 'composition'));
  const body = {prompt: '한😀"\n', prompt_composition: snapshot()};
  const bytes = utf8Bytes(JSON.stringify(body));
  assert.deepEqual(validateSubmission(body, 'sd15', bytes), []);
  assert.ok(validateSubmission(body, 'sd15', bytes - 1).some(i => i.field === 'request'));
  assert.deepEqual(validateSubmission(body, 'sd15', null), []);
  // Unsupported capability omits composition: bad editing state cannot block direct input.
  assert.deepEqual(validateSubmission({prompt: 'direct prompt'}, 'sd15', null), []);
});

test('verbatim text is lossless and repeated generation/application never appends twice', () => {
  const raw = '  한글 English <lora:token:1> (tag:1.2)\n😀  ';
  let state = generate(stateFor(raw));
  assert.equal(state.result.draft, raw);
  for (let i = 0; i < 3; i++) { state = withAppliedDraft(generate(state)); assert.equal(state.applied.draft_prompt, raw); }
  assert.equal(state.applied.free_text_ko, raw);
  assert.deepEqual(state.applied.unresolved, [{kind:'free_text', text:raw}]);
  assert.equal(applicationStatus(state, 'manual edit').promptModified, true);
  assert.equal(withAppliedDraft(state).appliedPrompt, raw);
  assert.equal(generate(stateFor(raw, 'separate')).result.draft, '');
  const changed = {...state, scene: {...state.scene, freeTextKo: 'new'}};
  assert.ok(isDraftStale(changed));
  assert.equal(withAppliedDraft(changed), changed);
  assert.ok(applicationStatus(changed, raw).selectionChanged);
  assert.equal(generate(changed).result.draft, 'new');
  assert.ok(isDraftStale({...state, freeTextMode:'separate'}));
  assert.equal(appliedForFamily(state, 'flux2'), null);
  assert.equal(appliedForFamily(state, 'sd15', false), null);
  assert.equal(appliedForFamily(state, 'sd15', true), state.applied);
});

test('restoration uses saved facts without mixing current compiler outputs', () => {
  const c = snapshot();
  c.compiler_version = 'old'; c.draft_prompt = 'historic text';
  c.unresolved = [{kind:'free_text', text:'historic unresolved'}];
  const restored = restoreComposition(c);
  assert.equal(restored.result.draft, 'historic text');
  assert.equal(restored.result.compilerVersion, 'old');
  assert.deepEqual(restored.result.unresolved, c.unresolved);
  assert.deepEqual(restored.result.warnings, []); assert.deepEqual(restored.result.sources, []);
  assert.equal(restored.applied, c); assert.equal(restored.provenance, 'saved');
  assert.equal(applicationStatus(restored, 'historic final').historicalApplicationUnknown, true);
  assert.equal(generate(restored).result.draft, 'a person');
  assert.equal(generate(restored).applied, c);
  assert.equal(withAppliedDraft(restored).applied.draft_prompt, 'historic text');
});


test('dictionary draft plus raw text remains stable across family change and reuse', () => {
  let state = restoreComposition(snapshot());
  state = {...state, freeTextMode: 'verbatim', scene: {...state.scene, freeTextKo: 'raw <token>'}};
  state = withAppliedDraft(generate(state));
  assert.equal(state.result.draft, 'a person\nraw <token>');
  assert.equal(generate(state).result.draft, state.result.draft);
  const restored = restoreComposition(state.applied);
  assert.equal(restored.result.draft, state.result.draft);
  assert.equal(withAppliedDraft(restored).applied.draft_prompt, state.result.draft);
  const other = {...state, scene: {...state.scene, targetFamily: 'flux2'}};
  assert.equal(generate(other).result.draft, 'a person\nraw <token>');
});


test('separate-only explanation can accompany an unchanged direct final prompt', () => {
  const state = withAppliedDraft(generate(stateFor('원문 보관', 'separate')), 'direct final');
  assert.equal(state.applied.draft_prompt, '');
  assert.equal(state.applied.free_text_ko, '원문 보관');
  assert.equal(state.appliedPrompt, 'direct final');
  assert.equal(applicationStatus(state, 'direct final').promptModified, false);
});

test('client and Pydantic agree on accepted/rejected Unicode and composition boundaries', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const python = process.env.PYTHON || (existsSync(root + '.venv/bin/python') ? root + '.venv/bin/python' : 'python3');
  const cases = [];
  for (const unit of ['한', '😀', 'e\u0301', '"\\\n']) {
    for (const size of [8000, 8001]) {
      const prompt = Array.from(unit.repeat(size)).slice(0, size).join('');
      cases.push({model_id:'fake', prompt});
    }
  }
  for (const count of [100, 101]) {
    const c = snapshot();
    c.selections = Array.from({length:count}, (_, i) => ({...c.selections[0], id:String(i)}));
    cases.push({model_id:'fake', prompt:'x', prompt_composition:c});
  }
  for (const count of [101, 102]) {
    const c = snapshot(); c.unresolved = Array.from({length:count}, () => ({kind:'free_text', text:'x'}));
    cases.push({model_id:'fake', prompt:'x', prompt_composition:c});
  }
  for (const limit of [4000, 4001]) {
    const c = snapshot(); c.free_text_ko = '😀'.repeat(limit);
    cases.push({model_id:'fake', prompt:'x', prompt_composition:c});
  }
  const actual = JSON.parse(execFileSync(python, ['-c', `
import json,sys
from app.models.schemas import JobRequest
results=[]
for body in json.load(sys.stdin):
    try:
        JobRequest.model_validate(body)
        results.append(True)
    except ValueError:
        results.append(False)
print(json.dumps(results))
`], {input:JSON.stringify(cases), env:{...process.env, PYTHONPATH:root+'backend'}, encoding:'utf8'}));
  assert.deepEqual(cases.map(body => validateSubmission(body, 'sd15', null).length === 0), actual);
});
