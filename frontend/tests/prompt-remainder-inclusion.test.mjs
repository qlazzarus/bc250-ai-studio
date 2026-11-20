import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  acceptedAt, activeInclusions, EMPTY_INCLUSIONS, excludeRemainder, finalPrompt, includedEnglish,
  includeRemainder, isIncluded, pruneRemainder, remainderEntry, tokenPreview, translationCards,
} from '../src/prompt/remainderInclusion.ts';
import {
  appliedForFamily, appliedInclusions, draftComposition, initialBuilderState, restartBuilder, restoreComposition,
  v1OnlyWhenUnsupported, withAppliedDraft, withGeneratedDraft, withReboundFamily,
} from '../src/prompt/builderState.ts';
import { compileScene, SD15_TOKEN_WINDOW } from '../src/prompt/compiler.ts';
import { validateComposition, compositionBytes } from '../src/prompt/validation.ts';
import { MAX_REMAINDER_ITEMS, TRANSLATION_KIND, parseReply } from '../src/prompt/llmProposals.ts';

const TEXT = '비 오는 밤 편의점 앞에서 젖은 바닥에 반사된다';
const NOW = new Date('2026-11-19T04:05:06.789Z');

const scene = (changes = {}) => ({
  schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: TEXT, ...changes,
});

const translationReply = (over = {}) => parseReply({
  proposal_id: 'prop-abc123', request_id: 'req-1', status: 'ready', kind: TRANSLATION_KIND,
  provider: { model: 'qwen', version: '1', latency_ms: 5, finish_reason: 'stop' },
  suggestions: [], translations: [
    { source_ko: '비 오는 밤', suggested_en: 'a rainy night', confidence: 0.9 },
    { source_ko: '편의점', suggested_en: 'a convenience store', confidence: 0.8 },
    { source_ko: '젖은 바닥에 반사된다', suggested_en: 'reflecting off the wet ground', confidence: 0.6 },
  ],
  unresolved_spans: [], ambiguities: [], rejected: [], truncated: false, ...over,
});

/** The cards exactly as the composer builds them for `includeTranslation`. */
const cards = () => translationCards(translationReply()).cards;

const accepted = (card, over = {}) => remainderEntry({
  card, proposalId: 'prop-abc123', proposalModel: 'qwen', now: NOW, ...over,
});

/** The state after a compile, which is what `applyDraft` operates on. */
const compiled = (target = scene()) => withGeneratedDraft(
  { ...initialBuilderState, scene: target }, compileScene(target),
);

// ---------------------------------------------------------------------------- TRANS04

test('cards keep the reply order and exclude everything by default', () => {
  const built = translationCards(translationReply());
  assert.deepEqual(built.cards.map((card) => card.sourceKo), ['비 오는 밤', '편의점', '젖은 바닥에 반사된다']);
  assert.deepEqual(built.cards.map((card) => card.suggestedEn),
    ['a rainy night', 'a convenience store', 'reflecting off the wet ground']);
  // The composer starts from an empty list, so "not included" is the default state.
  assert.equal(isIncluded([], '비 오는 밤'), false);
  // The identity is the phrase, because the server never repeats one in a reply.
  assert.deepEqual(built.cards.map((card) => card.key), built.cards.map((card) => card.sourceKo));
  assert.equal(built.truncated, false);
});

test('an inclusion is recorded with its own proposal, not the newest one', () => {
  const [rainy, store] = cards();
  const first = accepted(rainy, { proposalId: 'prop-first1', proposalModel: 'qwen' });
  // A second reply (another request) is what the panel would show now; the entry from
  // the first request must still name the model that wrote it.
  const second = accepted(store, { proposalId: 'prop-second', proposalModel: 'llama' });
  const list = includeRemainder(includeRemainder([], first), second);
  assert.deepEqual(list.map((item) => item.source_ko), ['비 오는 밤', '편의점']);
  assert.deepEqual(list.map((item) => item.proposal_id), ['prop-first1', 'prop-second']);
  assert.deepEqual(list.map((item) => item.proposal_model), ['qwen', 'llama']);
  // `accepted_at` is the server's second-precision shape, not `toISOString()`.
  assert.equal(list[0].accepted_at, '2026-11-19T04:05:06Z');
  assert.equal(acceptedAt(NOW), '2026-11-19T04:05:06Z');
});

test('an entry without usable provenance is refused instead of recorded empty', () => {
  const [rainy] = cards();
  // The server's `proposal_id` minimum is 8 characters; a shorter id would 422 at submit.
  assert.equal(accepted(rainy, { proposalId: 'short' }), null);
  assert.equal(accepted(rainy, { proposalId: null }), null);
  assert.equal(accepted(rainy, { proposalId: '' }), null);
  // A missing model becomes `unknown` rather than "", which the server rejects.
  assert.equal(accepted(rainy, { proposalModel: null }).proposal_model, 'unknown');
  assert.equal(accepted(rainy, { proposalModel: '' }).proposal_model, 'unknown');
  // A phrase the server sent blank cannot become a card at all.
  assert.equal(accepted({ ...rainy, sourceKo: '   ' }), null);
  assert.equal(accepted({ ...rainy, suggestedEn: '' }), null);
});

test('duplicate and cap refusals keep the list unchanged', () => {
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  assert.equal(list.length, 3);
  // The same phrase cannot be included twice: it would appear twice in the prompt.
  assert.equal(includeRemainder(list, accepted(cards()[0])), list);
  // The cap is the server's `max_length`; the 9th entry is dropped rather than sent.
  const full = Array.from({ length: MAX_REMAINDER_ITEMS }, (_, index) => ({
    source_ko: `구절 ${index}`, suggested_en: `phrase ${index}`, proposal_id: 'prop-abc123',
    proposal_model: 'qwen', accepted_at: '2026-11-19T04:05:06Z',
  })).reduce((current, item) => includeRemainder(current, item), []);
  assert.equal(full.length, MAX_REMAINDER_ITEMS);
  assert.equal(includeRemainder(full, accepted(cards()[0])), full);
});

test('include then exclude restores the exact list', () => {
  const [rainy, store] = cards();
  const both = includeRemainder(includeRemainder([], accepted(rainy)), accepted(store));
  const onlyStore = excludeRemainder(both, '비 오는 밤');
  assert.deepEqual(onlyStore.map((item) => item.source_ko), ['편의점']);
  assert.deepEqual(excludeRemainder(onlyStore, '없는 구절'), onlyStore);
  assert.deepEqual(excludeRemainder(onlyStore, '편의점'), []);
});


test('the final prompt appends the included English after the draft, in acceptance order', () => {
  const draft = 'a person, white shirt, neon lights';
  const [, store, ground] = cards();
  const list = includeRemainder(includeRemainder([], accepted(ground)), accepted(store));
  // Click order, not reply order: the user picked the last card first.
  assert.deepEqual(includedEnglish(list), ['reflecting off the wet ground', 'a convenience store']);
  assert.equal(finalPrompt(draft, includedEnglish(list)),
    `${draft}\nreflecting off the wet ground\na convenience store`);
  // No inclusion is byte-for-byte the draft: TRANS01's v1 behaviour is unchanged.
  assert.equal(finalPrompt(draft, []), draft);
  // A draft that is empty (어휘 미선택) is just the translations, with no leading newline.
  assert.equal(finalPrompt('', ['a convenience store']), 'a convenience store');
  // Blank translations never contribute an empty line.
  assert.equal(finalPrompt(draft, ['  ', 'a convenience store']), `${draft}\na convenience store`);
});

test('the sd15 warning fires only when the inclusion is what crosses the window', () => {
  // `estimateTokens` counts 1.3 tokens per whitespace-separated word, rounded up.
  const words = (count) => Array.from({ length: count }, () => 'word').join(' ');
  // 60 words: ~78 tokens, already over before this card. The card is not the cause,
  // so it is not blamed for it.
  const over = words(60);
  assert.equal(tokenPreview(over, [], 'a convenience store', 'sd15').newlyOverBudget, false);
  assert.ok(tokenPreview(over, [], 'a convenience store', 'sd15').tokens > SD15_TOKEN_WINDOW);
  // 55 words: ~72 tokens. Three words (~4 tokens) still fit under 77.
  const roomy = words(55);
  assert.equal(tokenPreview(roomy, [], 'a convenience store', 'sd15').newlyOverBudget, false);
  // 58 words: ~76 tokens. A three-word card (~4 tokens) crosses 77.
  const edge = words(58);
  const preview = tokenPreview(edge, [], 'reflecting off the wet ground', 'sd15');
  assert.equal(preview.limit, SD15_TOKEN_WINDOW);
  assert.ok(preview.tokens > SD15_TOKEN_WINDOW);
  assert.equal(preview.newlyOverBudget, true);
  // The baseline with no candidate is never a new warning.
  assert.equal(tokenPreview(edge, [], null, 'sd15').newlyOverBudget, false);
  // No warning for a family with no token window.
  assert.equal(tokenPreview(edge, [], 'a convenience store', 'sdxl'), null);
});


// ---------------------------------------------------------------------------- TRANS05

test('applying with inclusions records v2 and keeps draft_prompt as the compiler output', () => {
  const state = compiled();
  const [rainy, store] = cards();
  const list = includeRemainder(includeRemainder([], accepted(rainy)), accepted(store));
  const applied = withAppliedDraft(state, undefined, list);

  assert.equal(applied.applied.schema_version, 2);
  assert.equal(applied.applied.remainder.length, 2);
  // TRANS01 §5.1: the draft is the compiler's output, never the assembled prompt.
  assert.equal(applied.applied.draft_prompt, state.result.draft);
  assert.equal(applied.applied.compiler_version, state.result.compilerVersion);
  assert.ok(!applied.applied.draft_prompt.includes('a rainy night'));
  // The final prompt is the assembled one, and that is what was recorded as applied.
  assert.equal(applied.appliedPrompt, finalPrompt(state.result.draft, includedEnglish(list)));
  assert.equal(applied.appliedScene, state.generatedFrom);
});

test('the separate-only route records v2 without assembling the final prompt', () => {
  // With no selections the compiler's draft is empty, which is the `separateOnly` shape:
  // `applyDraft` passes the current prompt explicitly so the final text is not touched.
  const state = compiled();
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  const typed = '직접 쓴 최종 프롬프트';
  const applied = withAppliedDraft(state, typed, list);
  assert.equal(state.result.draft, '');
  assert.equal(applied.applied.schema_version, 2);
  assert.equal(applied.applied.remainder.length, 3);
  // The typed prompt is not replaced by the assembled translations.
  assert.equal(applied.appliedPrompt, typed);
  assert.equal(finalPrompt(state.result.draft, includedEnglish(list)), 'a rainy night\na convenience store\nreflecting off the wet ground');
  // The draft itself is still the compiler's output.
  assert.equal(applied.applied.draft_prompt, state.result.draft);
});

test('applying without inclusions stays v1 and byte-identical to the pre-TRANS05 record', () => {
  const state = compiled();
  const applied = withAppliedDraft(state);
  assert.equal(applied.applied.schema_version, 1);
  assert.equal('remainder' in applied.applied, false);
  assert.equal(applied.appliedPrompt, state.result.draft);
  // The v1 body the old path produced is unchanged, including the byte count.
  assert.equal(compositionBytes(applied.applied), compositionBytes(draftComposition(state)));
  assert.deepEqual(validateComposition(applied.applied, 'sd15'), []);
});

test('a v2 snapshot round-trips and validates against the server rules', () => {
  const state = compiled();
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  const applied = withAppliedDraft(state, undefined, list);

  // The client accepts a v2 body it just built, so submit is not blocked locally.
  assert.deepEqual(validateComposition(applied.applied, 'sd15'), []);
  // Unknown keys are not invented: the shape is exactly the wire type.
  assert.deepEqual(Object.keys(applied.applied).sort(),
    ['compiler_version', 'draft_prompt', 'free_text_ko', 'remainder', 'schema_version',
      'selections', 'target_family', 'unresolved']);

  // Restoring keeps the recorded facts and starts the composer from its inclusions.
  const restored = restoreComposition(applied.applied);
  assert.equal(restored.applied.schema_version, 2);
  assert.deepEqual(restored.applied.remainder, list);
  assert.equal(restored.scene.freeTextKo, TEXT);
  assert.equal(restored.result.draft, applied.applied.draft_prompt);
});

test('a restored v1 snapshot never gains a remainder key', () => {
  const state = compiled();
  const v1 = withAppliedDraft(state).applied;
  const restored = restoreComposition(v1);
  assert.equal(restored.applied.schema_version, 1);
  assert.equal('remainder' in restored.applied, false);
  // Re-applying the restored draft without an inclusion keeps it v1 and invents nothing.
  const reapplied = withAppliedDraft(restored);
  assert.equal(reapplied.applied.schema_version, 1);
  assert.equal('remainder' in reapplied.applied, false);
  // And the byte count of the restored v1 body matches the recorded one.
  assert.equal(compositionBytes(restored.applied), compositionBytes(v1));
});

test('a v1-only server gets a v1 body with the translations dropped', () => {
  const state = compiled();
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  const v2 = withAppliedDraft(state, undefined, list).applied;
  assert.equal(v2.schema_version, 2);

  const downgraded = v1OnlyWhenUnsupported(v2, false);
  assert.equal(downgraded.schema_version, 1);
  assert.equal('remainder' in downgraded, false);
  // Everything else is the recorded fact, unchanged.
  assert.equal(downgraded.draft_prompt, v2.draft_prompt);
  assert.equal(downgraded.compiler_version, v2.compiler_version);
  assert.deepEqual(validateComposition(downgraded, 'sd15'), []);
  // The original object is not mutated: the panel still shows what the user built.
  assert.equal(v2.schema_version, 2);
  assert.equal(v2.remainder.length, 3);

  // A v2-aware server receives the composition untouched.
  assert.equal(v1OnlyWhenUnsupported(v2, true), v2);
  // A v1 snapshot is unaffected either way, so no useless copy is made.
  const v1 = withAppliedDraft(state).applied;
  assert.equal(v1OnlyWhenUnsupported(v1, false), v1);
});

test('an edited sentence prunes the inclusions that described it', () => {
  const [rainy, store] = cards();
  const list = includeRemainder(includeRemainder([], accepted(rainy)), accepted(store));
  assert.equal(pruneRemainder(list, TEXT).length, 2);
  // `비 오는 밤` was rewritten: its translation would append English for a phrase the
  // model was never given, so it drops out of the live list.
  const edited = '맑은 낮 편의점 앞에서 젖은 바닥에 반사된다';
  assert.deepEqual(pruneRemainder(list, edited).map((item) => item.source_ko), ['편의점']);
  // The recorded list is untouched: retyping the phrase brings the entry back.
  assert.equal(list.length, 2);
  assert.equal(pruneRemainder(list, TEXT).length, 2);
  assert.deepEqual(pruneRemainder(list, ''), []);
});

test('a restored snapshot supplies its own inclusions, and only when it is v2', () => {
  const state = compiled();
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  const applied = withAppliedDraft(state, undefined, list);
  const restored = restoreComposition(applied.applied);

  // A fresh composer (empty list, no owner) reads the restored record verbatim: that is
  // what makes "적용" on a restored draft re-record the same translations.
  assert.deepEqual(activeInclusions(EMPTY_INCLUSIONS, restored.applied, restored.compositionEpoch), list);
  // A local list that names the applied snapshot is the truth, even when pruning hides
  // part of it: the hidden entry has to survive until the phrase is retyped.
  const local = { owner: restored.applied, epoch: restored.compositionEpoch, items: list.slice(0, 2) };
  assert.deepEqual(activeInclusions(local, restored.applied, restored.compositionEpoch), list.slice(0, 2));

  // A different snapshot takes over: inclusions do not follow the user across records.
  const other = withAppliedDraft(compiled(scene({ freeTextKo: '맑은 낮' }))).applied;
  assert.deepEqual(activeInclusions(local, other, restored.compositionEpoch), []);
  // A v1 snapshot has no `remainder` to inherit, and none is invented.
  assert.deepEqual(activeInclusions(local, withAppliedDraft(state).applied, restored.compositionEpoch), []);
  assert.deepEqual(activeInclusions(EMPTY_INCLUSIONS, null, 0), []);
});

// ---------------------------------------------------------------------------- TRANS06

test('a model-family rebind keeps the accepted translations and their provenance', () => {
  const state = compiled();
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  const applied = withAppliedDraft(state, undefined, list);
  assert.equal(applied.applied.schema_version, 2);

  // The rebind drops the draft — it was compiled for the other family — and nothing else.
  const rebound = withReboundFamily(applied, { ...applied.scene, targetFamily: 'flux2' });
  assert.equal(rebound.result, null);
  assert.equal(rebound.scene.targetFamily, 'flux2');
  // The record and therefore `owner` survive, which is what keeps the panel populated.
  assert.deepEqual(rebound.applied, applied.applied);
  assert.deepEqual(appliedInclusions(rebound), list);
  assert.deepEqual(appliedInclusions(rebound).map((item) => item.proposal_model), ['qwen', 'qwen', 'qwen']);
  assert.deepEqual(appliedInclusions(rebound).map((item) => item.accepted_at), list.map((item) => item.accepted_at));

  // The list the panel derives is unchanged across the rebind: same entries, same order.
  const local = { owner: applied.applied, epoch: applied.compositionEpoch, items: list };
  assert.deepEqual(activeInclusions(local, rebound.applied, rebound.compositionEpoch), list);

  // And it still cannot be submitted for the new family.
  assert.equal(appliedForFamily(rebound, 'flux2'), null);
  assert.equal(appliedForFamily(rebound, 'sd15'), applied.applied);
});

test('a rebind does not duplicate the appended English, and re-applying keeps v2', () => {
  const state = compiled();
  const [rainy, store] = cards();
  const list = includeRemainder(includeRemainder([], accepted(rainy)), accepted(store));
  const applied = withAppliedDraft(state, undefined, list);
  const prompt = finalPrompt(applied.result.draft, includedEnglish(list));

  // A rebind leaves the final prompt alone; the translations are not appended again.
  const rebound = withReboundFamily(applied, { ...applied.scene, targetFamily: 'flux2' });
  assert.equal(prompt, finalPrompt(applied.result.draft, includedEnglish(activeInclusions(
    { owner: applied.applied, epoch: applied.compositionEpoch, items: list }, rebound.applied, rebound.compositionEpoch))));

  // Re-applying in the new family re-records the same translations rather than a v1 body.
  const recompiled = withGeneratedDraft(rebound, compileScene(rebound.scene));
  const reApplied = withAppliedDraft(recompiled, undefined, appliedInclusions(recompiled));
  assert.equal(reApplied.applied.schema_version, 2);
  assert.deepEqual(reApplied.applied.remainder, list);
  // `draft_prompt` is still the compiler's output: translations never enter it.
  assert.equal(reApplied.applied.draft_prompt, recompiled.result.draft);
  assert.ok(!reApplied.applied.draft_prompt.includes('a rainy night'));
  // The final prompt carries each translation exactly once.
  const final = finalPrompt(reApplied.result.draft, includedEnglish(reApplied.applied.remainder));
  assert.equal(final.split('a rainy night').length - 1, 1);
  assert.equal(final.split('a convenience store').length - 1, 1);
});

test('an explicit restart is distinguished from a not-yet-applied list', () => {
  const [rainy] = cards();
  const pending = includeRemainder([], accepted(rainy));
  // Before the first apply there is no owner; the list must still reach that apply.
  const beforeAnyApply = { owner: null, epoch: 0, items: pending };
  assert.deepEqual(activeInclusions(beforeAnyApply, null, 0), pending);

  // A restart moves the epoch, so the old list no longer describes the new composition —
  // even though `applied` is `null` in both situations.
  const restarted = restartBuilder(initialBuilderState);
  assert.equal(restarted.compositionEpoch, 1);
  assert.deepEqual(activeInclusions(beforeAnyApply, restarted.applied, restarted.compositionEpoch), []);
  // A restore is also a new session, and the epoch never moves backwards.
  const restored = restoreComposition(appliedSnapshot(), restarted.compositionEpoch);
  assert.equal(restored.compositionEpoch, 2);
  assert.equal(restartBuilder(restored).compositionEpoch, 3);
});

test('the composer keeps the record on a rebind and threads the epoch', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');

  // The rebind must not clear `applied`; that was the regression (panel emptied, v1 saved).
  assert.match(app, /withReboundFamily\(old, changeSceneFamily\(/);
  assert.doesNotMatch(app, /applied: null, generatedMode: null, appliedScene: null, appliedPrompt: null/);
  // The restart path is the one that starts a new session.
  assert.match(app, /restartBuilder\(old\)/);
  assert.match(app, /restoreComposition\(item\.prompt_composition, old\.compositionEpoch\)/);
  // Every inclusion write names the session it belongs to.
  assert.match(source, /activeInclusions\(inclusions, state\.applied, state\.compositionEpoch\)/);
  assert.match(source, /setInclusions\(\{ owner: state\.applied, epoch: state\.compositionEpoch, items: next \}\)/);
});

/** A v2 snapshot as the server would return it to `restoreComposition`. */
function appliedSnapshot() {
  const state = compiled();
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  return withAppliedDraft(state, undefined, list).applied;
}

test('per-item checks reject what the server would 422', () => {
  const state = compiled();
  const list = cards().reduce((current, card) => includeRemainder(current, accepted(card)), []);
  const applied = withAppliedDraft(state, undefined, list).applied;

  const badProposal = validateComposition({
    ...applied, remainder: [{ ...applied.remainder[0], proposal_id: 'short' }],
  }, 'sd15');
  assert.ok(badProposal.some((issue) => issue.field === 'remainder' && /출처/.test(issue.message)));

  const badTime = validateComposition({
    ...applied, remainder: [{ ...applied.remainder[0], accepted_at: '2026-11-19T04:05:06.789Z' }],
  }, 'sd15');
  assert.ok(badTime.some((issue) => issue.field === 'remainder' && /시각/.test(issue.message)));

  // A v1 body carrying the key is `extra_forbidden` on the server.
  const mismatched = validateComposition({ ...applied, schema_version: 1 }, 'sd15');
  assert.ok(mismatched.some((issue) => issue.field === 'composition' && /v1/.test(issue.message)));

  const tooMany = validateComposition({
    ...applied,
    remainder: Array.from({ length: 9 }, (_, index) => ({ ...applied.remainder[0], source_ko: `구절 ${index}` })),
  }, 'sd15');
  assert.ok(tooMany.some((issue) => issue.field === 'remainder' && /9\/8/.test(issue.message)));
});

test('the composer wires inclusion to the apply path and gates the request on v2', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');

  // The request trigger exists and sends the extractor's spans.
  assert.match(source, /requestProposal\("translate"\)/);
  assert.match(source, /translate: spans/);
  // Include/exclude go through the tested module, not through ad-hoc state edits.
  assert.match(source, /includeRemainder\(baseRemainder, entry\)/);
  assert.match(source, /excludeRemainder\(baseRemainder, sourceKo\)/);
  assert.match(source, /tokenPreview\(/);
  assert.match(source, /newlyOverBudget/);
  assert.match(source, /isIncluded\(activeRemainder, card\.sourceKo\)/);
  // The card says the translation is a suggestion, and a partial reply says so too.
  assert.match(source, /번역 제안이며 원문과 다를 수 있습니다/);
  assert.match(source, /translations\.truncated && <p className="prompt-notice"/);
  // The durable list is the only control left once the reply is gone, so it is wired
  // to the same removal the cards use.
  assert.match(source, /prompt-remainder-included/);
  // Applying never happens without the phrase naming what it would add.
  assert.match(source, /포함한 번역 \{activeRemainder\.length\}개가 줄바꿈으로 붙습니다/);
  // The apply path passes the inclusions into the only assembly point.
  assert.match(source, /withAppliedDraft\(current, undefined, recordedRemainder\)/);
  assert.match(source, /finalPrompt\(state\.result\.draft, includedEnglish\(recordedRemainder\)\)/);
  // The server capability gates both the request and the panel.
  assert.match(source, /aiEnabled && remainderSupported/);
  assert.match(source, /translations && remainderSupported/);
  // App passes the capability and downgrades on submit with a visible notice.
  assert.match(app, /remainderSupported=\{remainderSupported\}/);
  assert.match(app, /v1OnlyWhenUnsupported\(applied, remainderSupported\)/);
  assert.match(app, /remainderDowngraded/);
});

test('the composer reads a translation reply with its own parser, not the suggestion one', () => {
  // A `remainder_translation` reply carries `translations`; `parseReply` must route the
  // new key through `parseTranslations` or the cards would always be empty.
  const reply = translationReply();
  assert.equal(reply.kind, TRANSLATION_KIND);
  assert.equal(reply.translations.length, 3);
  assert.equal(reply.suggestions.length, 0);
  // A reply of another kind may not smuggle translations in.
  const other = parseReply({
    proposal_id: 'prop-abc123', request_id: 'req-1', status: 'ready', kind: 'prompt_suggestions',
    suggestions: [], translations: [{ source_ko: '비 오는 밤', suggested_en: 'a rainy night', confidence: 0.9 }],
    unresolved_spans: [], ambiguities: [], rejected: [], truncated: false,
  });
  assert.deepEqual(other.translations, []);
});
