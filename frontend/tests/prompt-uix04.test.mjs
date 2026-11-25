/**
 * UIX04: the folded generation settings, and the move to a blocked field.
 *
 * Three claims, three kinds of evidence:
 *
 * 1. **The summary is the request's values, not the preset's.** `detailSummary` is a pure
 *    function of `settings`, so "a manual edit after a preset press survives a fold" is asserted
 *    directly: same input object, same line, whatever the fold state — and the App's markup is
 *    checked to derive it from `settings` and to keep the folded region mounted.
 * 2. **One list decides what blocks.** The seed check is `seedIssue`, appended to
 *    `validateSubmission`'s output; `firstIssue` picks the topmost one. No second validator is
 *    introduced, which is asserted structurally.
 * 3. **A folded field opens before it is focused.** Both halves are checked: `moveToField` sets
 *    the fold, and focus is applied from an effect after the commit (a control in a `hidden`
 *    subtree cannot take focus, so doing it inline would move nothing).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detailSummary, FIELD_IN_DETAILS, FIELD_ORDER, FIELD_SELECTOR, firstIssue, seedIssue,
} from '../src/lib/generate.ts';

const here = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(here, 'src');
const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const stylesSource = readFileSync(join(SRC, 'styles.css'), 'utf8');

const base = { steps: 4, cfgScale: 1, seed: '7', sampling: null, scheduler: null,
  cfgEditable: true, samplingEditable: false, schedulerEditable: false };

// ── 1. The summary describes the current settings ───────────────────────────────

test('the summary states the values the next request will use', () => {
  assert.equal(detailSummary(base).text, 'Steps 4 · CFG 1 · Seed 7');
});

test('a manually edited value replaces the preset default in the summary', () => {
  // The preset pressed `balanced` (steps 4, cfg 1); the user then typed over both.
  const afterPreset = detailSummary({ ...base, steps: 4, cfgScale: 1 });
  const afterEdit = detailSummary({ ...base, steps: 28, cfgScale: 6.5 });
  assert.equal(afterPreset.text, 'Steps 4 · CFG 1 · Seed 7');
  assert.equal(afterEdit.text, 'Steps 28 · CFG 6.5 · Seed 7');
  // The same settings always render the same line — there is no stored copy to go stale.
  assert.deepEqual(detailSummary({ ...base, steps: 28, cfgScale: 6.5 }), afterEdit);
});

test('a fixed CFG is reported as fixed rather than as a number the body omits', () => {
  // `buildRequest` only sends `cfg_scale` when the model lets it be edited, so a summary
  // claiming a value would describe a key that is not in the request.
  assert.equal(detailSummary({ ...base, cfgEditable: false }).text,
    'Steps 4 · CFG 모델 고정 · Seed 7');
});

test('sampler and scheduler appear only when they are actually sent', () => {
  assert.deepEqual(detailSummary({ ...base, sampling: 'euler', scheduler: 'karras' }).parts,
    ['Steps 4', 'CFG 1', 'Seed 7']);
  // Editable options are part of the request, so they belong in the summary.
  assert.deepEqual(detailSummary({ ...base, sampling: 'euler', samplingEditable: true }).parts,
    ['Steps 4', 'CFG 1', 'Seed 7', 'Sampler euler']);
  // Editable but unset (the model's default is null) still sends nothing.
  assert.deepEqual(detailSummary({ ...base, samplingEditable: true }).parts,
    ['Steps 4', 'CFG 1', 'Seed 7']);
});

test('an empty seed box reads as the 0 it will send, not as random', () => {
  // `Number("")` is 0, and the submit path has always used it, so the summary must not imply
  // a random seed the request does not ask for.
  assert.equal(detailSummary({ ...base, seed: '' }).parts[2], 'Seed 0');
  assert.equal(detailSummary({ ...base, seed: ' -1 ' }).parts[2], 'Seed -1');
});


test('the summary is derived in App from settings, never from the selected preset', () => {
  assert.match(appSource, /const detail = detailSummary\(\{[\s\S]*?steps: settings\.steps, cfgScale: settings\.cfgScale, seed: settings\.seed,/);
  // A preset lookup here would describe the button instead of the request.
  assert.doesNotMatch(appSource, /detailSummary\(\{[\s\S]{0,200}presets\[/);
});

test('the folded region is hidden, never unmounted, so folds cannot reset values', () => {
  assert.match(appSource, /<div id="prompt-settings" className="prompt-settings" hidden=\{!settingsOpen\}>/);
  // The values live in `settings` and are read back from it, so a fold has nothing to clear.
  assert.match(appSource, /value=\{settings\.steps\}/);
  assert.match(appSource, /value=\{settings\.cfgScale\}/);
  assert.match(appSource, /value=\{settings\.seed\}/);
  // And the fold is its own state, not part of the request body.
  assert.match(appSource, /const \[settingsOpen, setSettingsOpen\] = useState\(false\)/);
  assert.doesNotMatch(appSource, /settings\.settingsOpen/);
});

test('the fold is a button, not a summary, so it carries an explicit expanded state', () => {
  assert.match(appSource, /className="quiet prompt-settings__toggle" aria-expanded=\{settingsOpen\}/);
  assert.match(appSource, /aria-controls="prompt-settings"/);
  assert.match(stylesSource, /\.prompt-settings\[hidden\] \{ display: none; \}/);
  assert.match(stylesSource, /\.prompt-settings__toggle \{[^}]*min-height: 44px;/);
  assert.match(stylesSource, /\.generate-blocker \.quiet \{[^}]*min-height: 44px;/);
  // The presets are on the basic path too, so they get the same touch target. Without this the
  // shared `.chips button` rule left them at 31px — the one control a phone user presses most.
  assert.match(stylesSource, /\.chips button \{ min-height: 44px; \}/);
});

// ── 2. One list decides what blocks ─────────────────────────────────────────────

test('the seed accepts -1 (random) and rejects everything below it', () => {
  assert.equal(seedIssue('-1'), null);
  assert.equal(seedIssue('0'), null);
  assert.equal(seedIssue('12345'), null);
  // `Number('')` is 0, which has always been legal here; keeping it avoids a new contract.
  assert.equal(seedIssue(''), null);
  assert.equal(seedIssue('-2')?.field, 'seed');
  assert.equal(seedIssue('1.5')?.field, 'seed');
  assert.equal(seedIssue('abc')?.field, 'seed');
  // Whitespace behaves like an empty box: `Number(' ')` is 0. Same pre-existing contract.
  assert.equal(seedIssue(' '), null);
});

test('the seed check is the one the submit path runs, not a second copy', () => {
  // One definition, two call sites: the render-time list and the submit guard.
  const calls = appSource.match(/seedIssue\(settings\.seed\)/g) ?? [];
  assert.equal(calls.length, 2);
  // The old inline check is gone, so there is no second verdict to disagree with.
  assert.doesNotMatch(appSource, /Number\.isInteger\(seed\)/);
});

test('the first issue is the topmost field on screen, not the first pushed', () => {
  // `validateSubmission` pushes the byte error last but it is the vaguest thing to report, and
  // it ranks after every named field on purpose.
  const issues = [
    { field: 'request', message: 'too big' },
    { field: 'prompt', message: 'empty' },
    { field: 'seed', message: 'bad' },
  ];
  assert.equal(firstIssue(issues)?.field, 'prompt');
  assert.equal(firstIssue([{ field: 'seed', message: 'bad' },
    { field: 'negative_prompt', message: 'long' }])?.field, 'negative_prompt');
  // Ties keep the validator's own order, so the answer is stable.
  assert.equal(firstIssue([{ field: 'seed', message: 'a' }, { field: 'seed', message: 'b' }])?.message, 'a');
  assert.equal(firstIssue([]), null);
  // Every movable field must rank before the body-wide ones.
  const rank = (field) => FIELD_ORDER.indexOf(field);
  assert.ok(rank('seed') < rank('request'));
  assert.ok(rank('prompt') < rank('seed'));
});


test('the blocking line and the button read the same list', () => {
  assert.match(appSource, /const allIssues: ValidationIssue\[\] = seedProblem \? \[\.\.\.submissionIssues, seedProblem\] : submissionIssues;/);
  assert.match(appSource, /disabled=\{submitting \|\| !activeModel\?\.execution_enabled \|\| allIssues\.length > 0\}/);
  assert.match(appSource, /const blocker = firstIssue\(allIssues\)/);
});

test('the blocker names the field and offers the move, not a second validator', () => {
  assert.match(appSource, /className="generate-blocker" data-field=\{blocker\.field\}/);
  assert.match(appSource, /onClick=\{\(\) => moveToField\(blocker\.field\)\}/);
  // No independent validation logic in the blocker's own derivation.
  const at = appSource.indexOf('const blocker = firstIssue(allIssues)');
  const chunk = appSource.slice(at, at + 700);
  assert.doesNotMatch(chunk, /validateSubmission|seedIssue|length > 8000|Number\(/);
});

test('a blank untouched prompt does not greet the first visit with an error', () => {
  // The button is disabled, but the *reason* line waits until the field was engaged with —
  // the same rule the field's own message uses.
  assert.match(appSource, /const blockerVisible = blocker !== null[\s\S]{0,160}!\(blocker\.field === "prompt" && !promptTouched && settings\.prompt\.length === 0\)/);
});

test('the seed message is shown where the field is, and only there', () => {
  // The folded region repeats the seed's own message; it must not invent verdicts about the
  // CFG or Steps limits, which the fields' min/max and the server already own.
  assert.match(appSource, /<div id="settings-errors" role="status">\{seedProblem && <p className="prompt-error">\{seedProblem\.message\}<\/p>\}<\/div>/);
  assert.match(appSource, /aria-invalid=\{seedProblem !== null\} aria-describedby="settings-errors"/);
});

// ── 3. A folded field opens before it is focused ────────────────────────────────

test('moving to a folded field opens the fold first', () => {
  assert.deepEqual([...FIELD_IN_DETAILS].sort(), ['cfg_scale', 'seed', 'steps']);
  assert.match(appSource, /if \(FIELD_IN_DETAILS\.includes\(field\) && !settingsOpen\) setSettingsOpen\(true\)/);
  // Focus must never be attempted in the same commit that removes `hidden`.
  const at = appSource.indexOf('function moveToField');
  const body = appSource.slice(at, at + 500);
  assert.doesNotMatch(body, /\.focus\(\)/);
  assert.match(body, /setSettingsFocusTick\(\(tick\) => tick \+ 1\)/);
  // Focus is read in an effect keyed on the tick, i.e. after the commit that removes `hidden`.
  const effectAt = appSource.indexOf('if (!settingsFocusTick) return;');
  assert.ok(effectAt > 0, 'the focus effect must exist');
  assert.match(appSource.slice(effectAt, effectAt + 900), /\.focus\(\)/);
});

test('every movable field has a selector the effect resolves at focus time', () => {
  assert.equal(FIELD_SELECTOR.prompt, '#prompt-final');
  assert.equal(FIELD_SELECTOR.negative_prompt, '#prompt-negative');
  assert.equal(FIELD_SELECTOR.steps, '#prompt-steps');
  assert.equal(FIELD_SELECTOR.cfg_scale, '#prompt-cfg');
  assert.equal(FIELD_SELECTOR.seed, '#prompt-seed');
  // Each of those ids exists in the markup, or the effect would focus nothing.
  for (const id of Object.values(FIELD_SELECTOR)) {
    assert.match(appSource, new RegExp(`id="${id.slice(1)}"`), `${id} must exist in the markup`);
  }
});

test('a disabled target falls back to the region that explains the limit', () => {
  // The CFG box is disabled on a fixed-CFG model and the negative field is disabled when the
  // model forbids it; `focus()` on either is a no-op, so silence would be the bug.
  assert.match(appSource, /if \(node && !\(node as HTMLInputElement\)\.disabled\) \{ node\.focus\(\); return; \}/);
  assert.match(appSource, /#prompt-settings"\)\?\.scrollIntoView/);
});

test('a server refusal stays in the error box, apart from input errors', () => {
  // The catch branch reports the server's own message; only the pre-submit branch names fields.
  const submitAt = appSource.indexOf('async function submit(event: FormEvent)');
  const body = appSource.slice(submitAt, submitAt + 1400);
  assert.match(body, /catch \(reason\) \{[\s\S]{0,300}setError\(reason instanceof Error \? reason\.message/);
  assert.match(body, /if \(blocking\.length\) \{/);
});

test('submit keeps its duplicate-request guard: no job is created while submitting', () => {
  // `submitting` disables the button, and the handler itself has no path that awaits twice.
  assert.match(appSource, /setSubmitting\(true\); setError\(""\);/);
  assert.match(appSource, /finally \{ submittingRef\.current = false; setSubmitting\(false\); \}/);
  // UIX04: the ref is what makes the guard hold for clicks dispatched in the same turn, where
  // `submitting` is still false. Both the check and the reset must be present.
  assert.match(appSource, /if \(submittingRef\.current\) return;/);
  assert.match(appSource, /submittingRef\.current = true;/);
  // The guard must sit before the body is built, or a rejected duplicate would still validate.
  const guardAt = appSource.indexOf('if (submittingRef.current) return;');
  const bodyAt = appSource.indexOf('const body = buildRequest();', appSource.indexOf('async function submit'));
  assert.ok(guardAt > 0 && bodyAt > guardAt, 'the re-entry guard must precede buildRequest');
});
