/**
 * UIX03: comparing long candidates, and the projection the folded strip reads.
 *
 * The task makes three kinds of claim, so the evidence is in three kinds:
 *
 * 1. **View state, not session state** — which bodies are open. This is a pure function of
 *    the reply's `resultId` and two id lists, so it is tested directly, including the hazard
 *    the task names: reply #2 must not inherit reply #1's open set even when the candidate
 *    ids are identical.
 * 2. **The projection is a projection** — `composeStripView` only renders what the panel
 *    reported. Its precedence rules (staleness outranks the phase) are the contract, so they
 *    are asserted against plain objects rather than through the DOM.
 * 3. **Structure** — the header carries title/difference/impact/applied, the body and the
 *    apply button share one card, and the toggle is the card's own button.
 *
 * Nothing here re-tests the UCP apply machine (`prompt-ucp05`/`ucp08` own it); it only
 * asserts that this layer sits on top of it without moving it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import { planApply, applyDiff } from '../src/prompt/composeApply.ts';
import {
  candidateBodyOpen, composeStripView, expansionFor, toggledView,
} from '../src/prompt/composeView.ts';

const here = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(here, 'src');
const panelSource = readFileSync(join(SRC, 'components/ComposePanel.tsx'), 'utf8');
const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const stylesSource = readFileSync(join(SRC, 'styles.css'), 'utf8');

const TARGET = { modelId: 'fake-sd15', family: 'sd15',
  profileVersion: 2, dictionaryVersion: DICTIONARY_VERSION };

/** A view with no decisions recorded yet, for one reply. */
const fresh = (key) => ({ key, expanded: [], collapsed: [] });


// ── 1. Expansion is view state, keyed by the reply ───────────────────────────────

test('the first body starts open and the alternatives start closed', () => {
  const view = fresh('reply-1');
  assert.equal(candidateBodyOpen(view, 'cand-a', 0), true);
  assert.equal(candidateBodyOpen(view, 'cand-b', 1), false);
  assert.equal(candidateBodyOpen(view, 'cand-c', 2), false);
});

test('alternatives open independently, so several can be compared at once', () => {
  let view = fresh('reply-1');
  view = { ...view, expanded: [...view.expanded, 'cand-b'] };
  assert.equal(candidateBodyOpen(view, 'cand-b', 1), true);
  // Opening the second must not close the first: comparison needs both.
  assert.equal(candidateBodyOpen(view, 'cand-a', 0), true);
  view = { ...view, expanded: [...view.expanded, 'cand-c'] };
  assert.deepEqual([0, 1, 2].map((i) => candidateBodyOpen(view, `cand-${'abc'[i]}`, i)),
    [true, true, true]);
  // And closing one leaves the rest alone.
  view = { ...view, expanded: view.expanded.filter((id) => id !== 'cand-b') };
  assert.deepEqual([0, 1, 2].map((i) => candidateBodyOpen(view, `cand-${'abc'[i]}`, i)),
    [true, false, true]);
});

test('the default-open first body can be closed and does not spring back', () => {
  let view = fresh('reply-1');
  view = { ...view, collapsed: [...view.collapsed, 'cand-a'] };
  assert.equal(candidateBodyOpen(view, 'cand-a', 0), false);
  // Re-reading it at the same key must stay closed: `collapsed` is a remembered decision,
  // not the absence of one. This is exactly what a bare `expanded` list could not express.
  assert.equal(candidateBodyOpen(view, 'cand-a', 0), false);
  assert.equal(expansionFor(view, 'reply-1'), view);
});

test('a new reply never inherits the previous reply\'s open bodies', () => {
  // The hazard the task names: reply #2 may reuse the very same candidate ids.
  const previous = { key: 'reply-1', expanded: ['cand-b', 'cand-c'], collapsed: ['cand-a'] };
  const next = expansionFor(previous, 'reply-2');
  assert.equal(next.key, 'reply-2');
  assert.deepEqual(next.expanded, []);
  assert.deepEqual(next.collapsed, []);
  // With the same ids, the defaults apply instead of reply #1's choices.
  assert.deepEqual([0, 1, 2].map((i) => candidateBodyOpen(next, `cand-${'abc'[i]}`, i)),
    [true, false, false]);
});

test('the same reply keeps its expansion, so re-rendering is not a reset', () => {
  const view = { key: 'reply-1', expanded: ['cand-b'], collapsed: [] };
  assert.equal(expansionFor(view, 'reply-1'), view);
  assert.equal(candidateBodyOpen(expansionFor(view, 'reply-1'), 'cand-b', 1), true);
});

test('expansion is derived during render, not cleared from an effect', () => {
  // An effect would run *after* a commit that already paired the new ids with the old open
  // set — one frame of the wrong card. The keyed derivation is the fix, so it must not be
  // replaced by a `useEffect(() => setCandidateView(...))` reset.
  assert.match(panelSource, /const bodyView = expansionFor\(candidateView, viewKey\)/);
  assert.doesNotMatch(panelSource, /useEffect\(\(\) => \{[^}]*setCandidateView/);
  // `viewKey` is the reply's own id, which is what makes the reset per-reply.
  assert.match(panelSource, /const viewKey = visible\.draft\?\.resultId \?\? ""/);
});

// ── 2. The folded strip is a projection of the panel's report ──────────────────

test('an idle session renders no strip at all', () => {
  assert.equal(composeStripView(null), null);
  assert.equal(composeStripView({ phase: 'idle', candidateCount: 0,
    stale: false, failureKo: null }), null);
});

test('each phase gets one line that names the next action', () => {
  const of = (status) => composeStripView({ candidateCount: 0, stale: false,
    failureKo: null, ...status });
  assert.equal(of({ phase: 'pending' }).phase, 'pending');
  assert.match(of({ phase: 'pending' }).text, /만드는 중/);
  assert.equal(of({ phase: 'ready', candidateCount: 3 }).phase, 'ready');
  assert.match(of({ phase: 'ready', candidateCount: 3 }).text, /후보 3개/);
  assert.equal(of({ phase: 'needs_clarification' }).phase, 'clarify');
  assert.equal(of({ phase: 'failed' }).phase, 'failed');
  assert.match(of({ phase: 'failed', failureKo: '모델 호출 실패' }).text, /모델 호출 실패/);
  assert.equal(of({ phase: 'cancelled' }).phase, 'cancelled');
  // Cancelling must not read as a loss: the text says the input survived.
  assert.match(of({ phase: 'cancelled' }).text, /그대로 남아/);
});

test('staleness outranks the phase, because it is what makes a reply unusable', () => {
  // A strip saying "3 candidates ready" over an invalidated reply would promise something
  // the apply button refuses; `planApply` would return `block: "stale"`.
  const stale = composeStripView({ phase: 'ready', candidateCount: 3,
    stale: true, failureKo: null });
  assert.equal(stale.phase, 'stale');
  assert.match(stale.text, /다시 만들어야/);
  // With no candidates there is nothing to invalidate, so the phase stands.
  assert.equal(composeStripView({ phase: 'failed', candidateCount: 0,
    stale: true, failureKo: null }).phase, 'failed');
});

test('the strip never repeats the apply decision, it only reports', () => {
  // The projection must not import or call the apply machine: those decisions belong to
  // `planApply`, and a second implementation could disagree with the button.
  const stripSource = panelSource.slice(panelSource.indexOf('export function composeStripView'));
  const body = stripSource.slice(0, stripSource.indexOf('\n}\n') + 3);
  assert.doesNotMatch(body, /planApply|applyDiff|needsOverwriteConfirm/);
  assert.doesNotMatch(body, /fetch\(|api\./);
  // App renders the projection and nothing else about the session.
  assert.match(appSource, /const composeStrip = composeStripView\(composeStatus\)/);
});


// ── 3. The card structure the header-first reading depends on ────────────────

test('the header toggle carries title, impact and the applied badge', () => {
  const headerAt = panelSource.indexOf('className="compose-candidate__toggle"');
  const bodyAt = panelSource.indexOf('className="compose-candidate__body"');
  const applyAt = panelSource.indexOf('className="compose-apply"');
  assert.ok(headerAt > 0 && bodyAt > headerAt, 'the toggle must precede the body');
  // The three facts the task puts in the header, all inside the toggle's own markup.
  const header = panelSource.slice(headerAt, bodyAt);
  assert.match(header, /compose-candidate__title/);
  assert.match(header, /compose-candidate__impact/);
  assert.match(header, /compose-candidate__applied/);
  // The toggle is a real button with both ARIA facts, so it is operable and announced.
  assert.match(panelSource, /className="compose-candidate__toggle"\s*\n?\s*aria-expanded=\{open\}/);
  assert.match(panelSource, /aria-controls=\{bodyId\}/);
  // Apply stays in the same `<article>` as the body it applies.
  assert.ok(applyAt > bodyAt, 'apply must follow the body it applies');
});

test('a collapsed body stays in the DOM, so opening one is instant', () => {
  // `hidden` is the only visibility switch: nothing below `{candidates.map(` is conditionally
  // rendered, so the English text is already parsed when the user opens a card.
  assert.match(panelSource, /className="compose-candidate__body" id=\{bodyId\} hidden=\{!open\}/);
  // The style restates `display: none`, because the grid rules could otherwise win over UA.
  assert.match(stylesSource, /\.compose-candidate__body\[hidden\] \{ display: none; \}/);
  // Header and apply keep the 44px touch floor.
  assert.match(stylesSource, /\.compose-candidate__toggle \{[^}]*min-height: 44px;/);
  assert.match(stylesSource, /\.compose-apply \{[^}]*min-height: 44px;/);
});


// ── 4. The header reaches the UCP apply machine, it does not replace it ───────

const candidate = (id, over = {}) => ({ candidateId: id, titleKo: `후보 ${id}`,
  differenceKo: '차이', positivePrompt: `prompt for ${id}`, negativePrompt: null,
  preservedKo: [], ...over });

const readyState = (candidates, over = {}) => ({
  phase: 'ready',
  edit: { briefKo: '비 오는 골목', selections: [], choices: [],
    targetModelId: TARGET.modelId, targetFamily: TARGET.family,
    profileVersion: TARGET.profileVersion, dictionaryVersion: TARGET.dictionaryVersion },
  draft: { resultId: 'reply-1', requestId: 'req-1',
    revisions: { input: 'rev-in', selections: 'rev-sel' },
    summaryKo: '요약', scene: { entities: [], relations: [],
      environment: { locationKo: null, timeKo: null, lightingKo: null,
        compositionKo: null, styleKo: null, moodKo: null },
      unmappedDetails: [], ambiguities: [] },
    selections: [], candidates, questions: [], warnings: [], snapshotTrim: [],
    providerModel: 'stub', tokens: { promptTokens: null, reasoningTokens: null,
      outputTokens: null, truncated: false } },
  applied: null,
  requestId: 'req-1',
  revisions: { input: 'rev-in', selections: 'rev-sel' },
  target: TARGET,
  warnings: [],
  tokens: { promptTokens: null, reasoningTokens: null, outputTokens: null, truncated: false },
  ...over,
});

const planFor = (state, over = {}) => planApply({
  state, candidateId: 'cand-b',
  currentTarget: TARGET, currentRevisions: { input: 'rev-in', selections: 'rev-sel' },
  currentPrompt: '', appliedPrompt: null, negativeSupported: true,
  ...over,
});

test('applying the second candidate writes that candidate\'s own strings', () => {
  // The task's main scenario: three long candidates, the second one chosen by its header.
  const state = readyState([candidate('cand-a'), candidate('cand-b', {
    positivePrompt: 'rainy alley, shallow depth of field', negativePrompt: 'blurry' }),
  candidate('cand-c')]);
  const plan = planFor(state);
  assert.equal(plan.ok, true);
  assert.equal(plan.positivePrompt, 'rainy alley, shallow depth of field');
  assert.equal(plan.negativePrompt, 'blurry');
  assert.equal(plan.needsConfirm, false);
});

test('a stale reply is refused even from the card that shows it', () => {
  const state = readyState([candidate('cand-a'), candidate('cand-b')]);
  const plan = planFor(state, { currentRevisions: { input: 'edited', selections: 'rev-sel' } });
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'stale');
});

test('a reply for another model is refused before the candidate is even looked up', () => {
  const state = readyState([candidate('cand-a'), candidate('cand-b')]);
  const plan = planFor(state, { currentTarget: { ...TARGET, modelId: 'other-model' } });
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'expired');
});

test('the negative loss is a two-step press, and only the second one loses it', () => {
  const state = readyState([candidate('cand-a'),
    candidate('cand-b', { negativePrompt: 'blurry, text' })]);
  const first = planFor(state, { negativeSupported: false });
  assert.equal(first.ok, false);
  assert.equal(first.block, 'negative_lost');
  // The user was told; the second press proceeds positive-only and reports the loss.
  const second = planFor(state, { negativeSupported: false, acceptNegativeLoss: true });
  assert.equal(second.ok, true);
  assert.equal(second.negativePrompt, null);
  assert.match(second.lossKo, /지원되지 않아/);
});

test('a candidate without a negative leaves the user\'s own negative alone', () => {
  const state = readyState([candidate('cand-a'), candidate('cand-b')]);
  const plan = planFor(state, { currentPrompt: 'mine', appliedPrompt: null });
  // No negative on the candidate → nothing to write, so the field is untouched.
  assert.equal(plan.negativePrompt, null);
  // And the user's own text still needs a confirm, because it is not panel-written.
  assert.equal(plan.needsConfirm, true);
});

test('the impact line is the same diff the apply will perform', () => {
  const withNegative = candidate('cand-b', { positivePrompt: 'x', negativePrompt: 'y' });
  const without = candidate('cand-b', { positivePrompt: 'x' });
  assert.deepEqual(applyDiff(withNegative, { currentPrompt: 'other',
    currentNegative: '', negativeSupported: true }),
  { positive: 'replace', negative: 'replace' });
  assert.deepEqual(applyDiff(withNegative, { currentPrompt: 'other',
    currentNegative: '', negativeSupported: false }),
  { positive: 'replace', negative: 'blocked' });
  // A candidate that *is* the current prompt reads "same", which is what the header says.
  assert.deepEqual(applyDiff(without, { currentPrompt: 'x',
    currentNegative: '', negativeSupported: true }),
  { positive: 'same', negative: 'keep' });
});

test('the card key is the candidate id, so a new reply cannot reuse a card', () => {
  assert.match(panelSource, /className="compose-candidate" key=\{candidate\.candidateId\}/);
});

