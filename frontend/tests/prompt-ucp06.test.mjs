/**
 * UCP06: two-way editing and user-decision protection.
 *
 * Every test here fixes one of the ten scenarios the instruction lists, plus the rules that
 * make them checkable: a reply may not demote a manual chip, may not remove a pinned one,
 * and may not re-add an excluded one. The wire tests go through `parseComposeReply` rather
 * than hand-built objects, because UCP05 shipped a parser that dropped `selections`
 * entirely — asserting on the parser is what would have caught it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY, DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import {
  EMPTY_EDIT, EMPTY_SCENE, addManual, attributeTo, excludedIds, makeAuto,
  parseScene, removeSelection, resolveClash, sceneEntityIds, setPinned,
} from '../src/prompt/structuredScene.ts';
import {
  IDLE_COMPOSE, appliedForRestoredPrompt, applyCandidate, composeRevisions, draftIsStale,
  invalidateForTarget,
  mergeSelections, settleComposition, startComposition, undoApply,
  withAnswer, withBrief, withEdit, withSelections,
} from '../src/prompt/composeSession.ts';
import { buildComposeBody, parseComposeReply, wireSelection } from '../src/prompt/composeRequest.ts';
import {
  APPLY_BLOCK_COPY, NEGATIVE_LOSS_NOTE, applyDiff, planApply,
} from '../src/prompt/composeApply.ts';
import { warningAlerts } from '../src/prompt/composeAlerts.ts';

const TARGET = { modelId: 'pornmaster-klein-9b', family: 'flux2',
  profileVersion: 1, dictionaryVersion: DICTIONARY_VERSION };
const OTHER_FAMILY = { ...TARGET, modelId: 'z-image-turbo', family: 'z-image' };
const REQUEST_ID = 'cmp-0123456789ab';

const edit = (changes = {}) => ({ ...structuredClone(EMPTY_EDIT),
  targetModelId: TARGET.modelId, targetFamily: TARGET.family,
  profileVersion: TARGET.profileVersion, dictionaryVersion: TARGET.dictionaryVersion,
  ...changes });

const chip = (id, source = 'auto', over = {}) => ({ id, source, pinned: false,
  entityId: null, ...over });

const candidate = (id, over = {}) => ({ candidateId: id, titleKo: `후보 ${id}`,
  differenceKo: '차이', positivePrompt: `prompt ${id}`, negativePrompt: null,
  preservedKo: [], ...over });

/** A `ready` wire reply, with `selections` exactly as the route sends them. */
const wireReply = (over = {}) => ({
  status: 'ready', result_id: 'res-1', request_id: REQUEST_ID, input_revision: 'sha256:0',
  target_model_id: TARGET.modelId, target_family: TARGET.family, profile_version: 1,
  dictionary_version: DICTIONARY_VERSION, summary_ko: '요약',
  scene: { entities: [], relations: [], environment: {},
    unmapped_details: [], ambiguities: [] },
  selections: [], candidates: [{ candidate_id: 'c1', title_ko: '제목',
    difference_ko: '차이', positive_prompt: 'a prompt' }],
  clarifications: [], warnings: [], snapshot_trim: [],
  ...over,
});

/**
 * Drive the real path: build a body, then parse the reply the server would send for it.
 *
 * `selections` in the reply are what the server *reconciled*, so the tests state them the
 * way `reconcile_selections` would — the client's job is only to not undo that work.
 */
function sessionFor(startEdit, replyOver = {}) {
  const built = buildComposeBody({ edit: startEdit, target: TARGET,
    requestId: REQUEST_ID, candidateCount: 3 });
  assert.equal(built.ok, true, built.ok ? '' : built.message);
  const started = startComposition(IDLE_COMPOSE(startEdit),
    { requestId: REQUEST_ID, target: TARGET });
  const parsed = parseComposeReply(wireReply(replyOver), {
    requestId: REQUEST_ID, revisions: started.revisions });
  assert.equal(parsed.ok, true, parsed.ok ? '' : `${parsed.failure}: ${parsed.detail}`);
  return settleComposition(started, {
    outcome: { kind: 'reply', result: parsed.result },
    currentRevisions: started.revisions, currentTarget: TARGET,
  });
}

/** A plan-apply call with the session's own revisions, so only the named axis varies. */
const planFor = (session, over = {}) => planApply({ state: session, candidateId: 'c1',
  currentTarget: TARGET, currentRevisions: session.revisions, currentPrompt: '',
  appliedPrompt: null, negativeSupported: true, ...over });

/* ------------------------------- reply chips reach the edit state (the UCP05 parser bug) */

test('reply selections are parsed, not dropped, and land in the edit state', () => {
  // UCP05 parsed `selections: []` unconditionally, which made `mergeSelections` dead code on
  // the live path: the server's chip reconciliation existed and was thrown away.
  const parsed = parseComposeReply(wireReply({ selections: [
    { id: 'lighting.neon', source: 'auto', pinned: false },
    { id: 'clothing.dress', source: 'manual', pinned: true, entity_id: 'e1' },
  ] }), { requestId: REQUEST_ID, revisions: composeRevisions(edit(), TARGET) });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.result.selections, [
    { id: 'lighting.neon', source: 'auto', pinned: false, entityId: null },
    { id: 'clothing.dress', source: 'manual', pinned: true, entityId: 'e1' },
  ]);

  // And the session adopts them, because the chip list renders `edit`, not `draft`.
  const session = sessionFor(edit({ briefKo: '네온 아래 원피스' }), { selections: [
    { id: 'lighting.neon', source: 'auto', pinned: false }] });
  assert.equal(session.phase, 'ready');
  assert.deepEqual(session.edit.selections.map((item) => item.id), ['lighting.neon']);
  assert.deepEqual(session.draft.selections, session.edit.selections);
  // The revisions follow, or the very next `draftIsStale` would call the fresh reply stale.
  assert.equal(draftIsStale(session, composeRevisions(session.edit, TARGET)), false);
});

test('a malformed selection rejects the whole reply instead of half-adopting it', () => {
  // A veto must carry neither flag; accepting it would invent a pin the spec forbids.
  for (const bad of [
    { id: 'lighting.neon', source: 'excluded', pinned: false },
    { id: 'lighting.neon', source: 'excluded', entity_id: 'e1' },
    { id: 'lighting.neon', source: 'auto' },
    { id: '', source: 'auto', pinned: false },
    { id: 'lighting.neon', source: 'invented', pinned: false },
  ]) {
    const parsed = parseComposeReply(wireReply({ selections: [bad] }),
      { requestId: REQUEST_ID, revisions: composeRevisions(edit(), TARGET) });
    assert.equal(parsed.ok, false, `a malformed selection was accepted: ${JSON.stringify(bad)}`);
    assert.equal(parsed.failure, 'invalid_reply');
  }
});

/* ------------------------------------------------ 1. brief edit vs. shown candidates */

test('1. editing the brief makes the shown candidates stale but never deletes them', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }));
  assert.equal(session.phase, 'ready');

  // The user keeps typing; the candidates describe the earlier sentence.
  const edited = withEdit(session, withBrief(session.edit, '눈 오는 거리'));
  const revisions = composeRevisions(edited.edit, TARGET);
  assert.equal(draftIsStale(edited, revisions), true);
  // Still on screen, and the apply boundary refuses it.
  assert.equal(edited.draft.candidates.length, 1);
  const plan = planFor(edited, { currentRevisions: revisions });
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'stale');

  // Going back to the original wording makes the same candidates applicable again: the
  // reply is keyed by the input, not by "was there ever an edit".
  const restored = withEdit(edited, withBrief(edited.edit, '비 오는 거리'));
  assert.equal(planFor(restored).ok, true);
});

/* ------------------------------------- 2. manual add/remove invalidates the candidates */

test('2. adding and removing a chip invalidates the candidates it was not built for', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }));
  const picked = withEdit(session, withSelections(session.edit,
    addManual(session.edit, { id: 'clothing.dress' }).selections));
  const pickedRevisions = composeRevisions(picked.edit, TARGET);
  assert.notEqual(pickedRevisions.selection, session.revisions.selection);
  assert.equal(planFor(picked, { currentRevisions: pickedRevisions }).block, 'stale');

  // Removing it again returns to the exact revisions the reply was made for. That is the
  // point of fingerprinting the selection set rather than counting edits.
  const removed = withEdit(session, withSelections(picked.edit, []));
  assert.deepEqual(composeRevisions(removed.edit, TARGET), session.revisions);
  assert.equal(draftIsStale(removed, composeRevisions(removed.edit, TARGET)), false);
});

/* -------------------------------- 3. an exclusion added after the reply blocks the apply */

test('3. vetoing a chip after the reply blocks the older candidate', () => {
  const session = sessionFor(edit({ briefKo: '네온 아래 사람' }), { selections: [
    { id: 'lighting.neon', source: 'auto', pinned: false }] });
  const vetoed = withEdit(session,
    withSelections(session.edit, removeSelection(session.edit, 'lighting.neon').selections));
  assert.deepEqual(excludedIds(vetoed.edit), ['lighting.neon']);

  const plan = planFor(vetoed, { currentRevisions: composeRevisions(vetoed.edit, TARGET) });
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'stale');
  // And the veto itself is on the wire as a veto — no `pinned`, no `entity_id`.
  assert.deepEqual(wireSelection(chip('lighting.neon', 'excluded')),
    { id: 'lighting.neon', source: 'excluded' });
});

/* ----------------------------------------------- 4. pinned chip vs. automatic recommendation */

test('4. a pinned chip survives a reply that recommends otherwise', () => {
  const base = edit({ briefKo: '네온 아래 사람',
    selections: [chip('lighting.neon', 'auto', { pinned: true })] });
  // The server re-derives the scene without it; the pin must hold.
  const merged = mergeSelections(base.selections, [chip('subject.person')]);
  assert.deepEqual(merged.map((item) => [item.id, item.source, item.pinned]), [
    ['subject.person', 'auto', false],
    ['lighting.neon', 'auto', true],
  ]);
  // Unpinning is what lets the next reply drop it.
  const unpinned = { ...base, selections: setPinned(base, 'lighting.neon', false).selections };
  assert.deepEqual(mergeSelections(unpinned.selections, [chip('subject.person')])
    .map((item) => item.id), ['subject.person']);
});

test('4b. a reply can never demote a manual chip, and only the user can release it', () => {
  const mine = addManual(edit(), { id: 'clothing.dress', pinned: true });
  // The server claims `auto`: the manual fact wins, and its pin is the user's own.
  const merged = mergeSelections(mine.selections,
    [chip('clothing.dress', 'auto', { pinned: false })]);
  assert.equal(merged[0].source, 'manual');
  assert.equal(merged[0].pinned, true);

  // "AI에게 맡기기" is the one explicit release.
  const released = makeAuto(mine, 'clothing.dress');
  assert.deepEqual(released.selections, [chip('clothing.dress', 'auto')]);
  // A reply may now replace it, which is the whole point of releasing it.
  assert.deepEqual(mergeSelections(released.selections, [chip('subject.person')])
    .map((item) => item.id), ['subject.person']);
  // Releasing is a no-op on a row that is already automatic, so a double press is safe.
  assert.equal(makeAuto(released, 'clothing.dress'), released);
  // An excluded row is not the user's pick to release: the veto has its own undo.
  const vetoed = removeSelection(withSelections(edit(), [chip('lighting.neon')]),
    'lighting.neon');
  assert.equal(makeAuto(vetoed, 'lighting.neon'), vetoed);
});

/* ------------------------------------ 5. rewriting the English prompt, then re-applying */

test('5. a hand-written prompt is protected, and re-applying the same candidate is not', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }));
  const plan = (currentPrompt, appliedPrompt) => planFor(session, {
    currentPrompt, appliedPrompt });

  // Nothing typed: no confirmation, nothing to lose.
  assert.equal(plan('', null).needsConfirm, false);
  // The panel's own text: still panel-written, so replacing it needs no confirm.
  assert.equal(plan('a prompt', 'a prompt').needsConfirm, false);
  // Anything else is the user's, and the confirmation names what disappears.
  const owned = plan('my own prompt', 'a prompt');
  assert.equal(owned.needsConfirm, true);
  assert.match(owned.confirmMessage, /사라집니다/);
  // A prompt that was never applied over is user text too.
  assert.equal(plan('hand written', null).needsConfirm, true);
});

/* ------------------------------------------ 6. a model change and undo in quick succession */

test('6. a model change expires the candidates and undo does not revive them', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }));
  const applied = applyCandidate(session, { candidateId: 'c1',
    providerModel: 'qwen3-test', appliedAt: '2026-11-22T00:00:00Z', resultId: 'cmp-a' });
  assert.equal(applied.applied.candidateId, 'c1');

  // The model changes: the draft is kept for context but is no longer applicable.
  const moved = invalidateForTarget(applied, OTHER_FAMILY);
  assert.equal(moved.phase, 'failed');
  assert.equal(moved.failure, 'expired');
  assert.equal(moved.applied?.candidateId, 'c1', 'the applied record is not model-bound');
  // `planApply` refuses it, and the phase guard answers first: the contract checks "is
  // there a reply at all" before "is it for this model", so the block is `no_candidate`
  // rather than `expired`. Either way the old candidate never becomes applicable.
  assert.equal(planApply({ state: moved, candidateId: 'c1', currentTarget: OTHER_FAMILY,
    currentRevisions: composeRevisions(moved.edit, OTHER_FAMILY), currentPrompt: '',
    appliedPrompt: null, negativeSupported: true }).ok, false);
  // A draft still in `ready` for the old family is refused by the target check itself.
  const switched = planApply({ state: session, candidateId: 'c1',
    currentTarget: OTHER_FAMILY, currentRevisions: composeRevisions(session.edit, OTHER_FAMILY),
    currentPrompt: '', appliedPrompt: null, negativeSupported: true });
  assert.equal(switched.block, 'expired');

  // Undo after the change restores the applied record and nothing else: the expired draft
  // stays expired, so an old candidate cannot become applicable again through undo.
  const undone = undoApply(moved, null);
  assert.equal(undone.applied, null);
  assert.equal(undone.phase, 'failed');
  assert.equal(undone.draft, moved.draft);
});

/* ------------------------ 6b. undo restores a record only when the text is still its own */

test('6b. undo keeps an applied record only when it describes the restored text', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }));
  const first = applyCandidate(session, { candidateId: 'c1',
    providerModel: 'qwen3-test', appliedAt: '2026-11-22T00:00:00Z', resultId: 'cmp-a' });
  assert.equal(first.applied?.candidateId, 'c1');

  // Applying a candidate then undoing puts panel-written text back, so the record it
  // replaced belongs with it and the card may still say 적용됨.
  const previous = appliedForRestoredPrompt(first.applied, { positive: 'a prompt', negative: null });
  assert.equal(previous?.candidateId, 'c1');

  // Undoing the *first* apply puts the user's own typing back. There is no applied record
  // for it, and keeping one would make the card claim text it never produced — and
  // `toSnapshot` would store an `applied.positive_prompt` disagreeing with `prompt`.
  assert.equal(appliedForRestoredPrompt(first.applied,
    { positive: 'my own carefully written prompt', negative: null }), null);
  assert.equal(appliedForRestoredPrompt(null, { positive: 'anything', negative: null }), null);
});

/**
 * The negative field is part of what was executed, so matching only the positive is not
 * enough. This is the defect that a positive-only comparison hides: the user applies a
 * candidate, then edits *only* the negative field, then undoes. The positive comes back
 * identical, so a positive-only check keeps the record — and the record's own
 * `negative_prompt` then contradicts the field, which `toSnapshot` writes verbatim into v3.
 */
test('6c. an undone record whose negative disagrees with the field is not restored', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }), {
    candidates: [{ candidate_id: 'c1', title_ko: '제목', difference_ko: '차이',
      positive_prompt: 'a prompt', negative_prompt: 'blurry, text' }] });
  const applied = applyCandidate(session, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-22T00:00:00Z', resultId: 'cmp-a' });
  assert.equal(applied.applied.negativePrompt, 'blurry, text');

  // Same positive, different negative: the record no longer describes the fields.
  assert.equal(appliedForRestoredPrompt(applied.applied,
    { positive: 'a prompt', negative: 'blurry' }), null);
  // The exact fields still match, so the same record is restorable.
  assert.equal(appliedForRestoredPrompt(applied.applied,
    { positive: 'a prompt', negative: 'blurry, text' })?.candidateId, 'c1');
  // An absent negative and an empty field are the same fact, not a mismatch.
  const noNegative = sessionFor(edit({ briefKo: '비 오는 거리' }));
  const plain = applyCandidate(noNegative, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-22T00:00:00Z', resultId: 'cmp-a' });
  assert.equal(appliedForRestoredPrompt(plain.applied,
    { positive: 'a prompt', negative: '' })?.candidateId, 'c1');
});

/**
 * A model that cannot take a negative prompt applies positive-only after a confirming press.
 * The record must hold what was *written*, not what the candidate offered — otherwise a v3
 * restore shows a negative prompt the image was never generated with.
 */
test('6d. a lossy apply records the negative that was actually written', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }), {
    candidates: [{ candidate_id: 'c1', title_ko: '제목', difference_ko: '차이',
      positive_prompt: 'a prompt', negative_prompt: 'blurry, text' }] });
  const plan = planFor(session, { negativeSupported: false, acceptNegativeLoss: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.negativePrompt, null, 'the model cannot take it, so nothing is written');

  const applied = applyCandidate(session, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-22T00:00:00Z', resultId: 'cmp-a', negativePrompt: plan.negativePrompt });
  assert.equal(applied.applied.negativePrompt, null,
    'the record must not claim a negative the engine never received');
  // Omitting the field keeps reading the candidate, which is right for a supporting model.
  const supporting = applyCandidate(session, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-22T00:00:00Z', resultId: 'cmp-a' });
  assert.equal(supporting.applied.negativePrompt, 'blurry, text');
});

/* ----------------------------------------- 7. an edit during a request, reply arrives late */

test('7. a reply that lands after an edit is dropped as stale, not shown', () => {
  const base = edit({ briefKo: '비 오는 거리' });
  const started = startComposition(IDLE_COMPOSE(base),
    { requestId: REQUEST_ID, target: TARGET });
  // The user edits while the request is out.
  const edited = withBrief(started.edit, '눈 오는 거리');
  const late = settleComposition(started, {
    outcome: { kind: 'reply', result: {
      resultId: 'res-1', requestId: REQUEST_ID, revisions: started.revisions,
      summaryKo: '요약', scene: structuredClone(EMPTY_SCENE), selections: [],
      candidates: [candidate('c1')], questions: [], warnings: [], snapshotTrim: [],
      providerModel: 'qwen3-test',
      tokens: { promptTokens: 1, reasoningTokens: 0, outputTokens: 2, truncated: false },
    } },
    currentRevisions: composeRevisions(edited, TARGET), currentTarget: TARGET,
  });
  assert.equal(late.phase, 'cancelled');
  assert.equal(late.draft, null, 'the late reply is not shown');
  assert.equal(late.edit.briefKo, '비 오는 거리', 'and it does not rewrite the edit either');
});

/* --------------------------------------------- 8. the scene changes while a question is open */

test('8. answering after a scene edit sends the new scene, and the old answer is dropped', () => {
  const asked = sessionFor(edit({ briefKo: '사람 둘' }), {
    status: 'needs_clarification', candidates: [],
    clarifications: [{ question_id: 'q1', question_ko: '누구인가요?', why: 'actor_unknown',
      options: [{ option_id: 'o1', label_ko: '한 명' }] }],
  });
  assert.equal(asked.phase, 'needs_clarification');
  // An answer moves only `choice`, so the same questions stay answerable.
  const answered = withAnswer(asked.edit, 'q1', 'o1');
  assert.deepEqual(answered.choices, [{ questionId: 'q1', optionId: 'o1' }]);
  assert.equal(composeRevisions(answered, TARGET).brief, asked.revisions.brief);

  // A brief edit meanwhile drops the answers: they described the old sentence, and the
  // server would reject a `question_id` it no longer issued.
  const edited = withBrief(answered, '사람 셋과 개');
  assert.deepEqual(edited.choices, []);
  const built = buildComposeBody({ edit: edited, target: TARGET,
    requestId: REQUEST_ID, candidateCount: 3 });
  assert.equal(built.ok, true);
  assert.deepEqual(built.body.clarification_choices, [],
    'a stale answer is never sent alongside a new brief');
});

/* ------------------------------------------- 9. per-entity attribution in a two-person scene */

test('9. each person keeps their own attribute, and attribution cannot invent an entity', () => {
  const parsed = parseScene({ entities: [
    { entity_id: 'e1', kind: 'person', count: 1, attributes_ko: ['붉은 원피스'] },
    { entity_id: 'e2', kind: 'person', count: 1, attributes_ko: ['검은 정장'] },
  ] });
  assert.equal('scene' in parsed, true);
  const { entities } = parsed.scene;
  const allowed = sceneEntityIds(parsed.scene);
  assert.deepEqual([...allowed], ['e1', 'e2']);
  // The attributes stay with the entity they were read for; nothing blends them.
  assert.deepEqual(entities.map((entity) => entity.attributesKo),
    [['붉은 원피스'], ['검은 정장']]);

  let state = addManual(edit(), { id: 'clothing.dress' });
  state = attributeTo(state, 'clothing.dress', 'e1', allowed);
  assert.equal(state.selections[0].entityId, 'e1');

  // Moving it is explicit and per entity — never a side effect of a reply.
  assert.equal(attributeTo(state, 'clothing.dress', 'e2', allowed).selections[0].entityId, 'e2');
  // An entity the scene does not contain is refused rather than sent as a 422.
  assert.equal(attributeTo(state, 'clothing.dress', 'e9', allowed), state);
  // Clearing the attribution is allowed: it means "the whole scene".
  assert.equal(attributeTo(state, 'clothing.dress', null, allowed).selections[0].entityId, null);
  // A veto has no meaning to attribute.
  const vetoed = removeSelection(withSelections(edit(), [chip('lighting.neon')]),
    'lighting.neon');
  assert.equal(attributeTo(vetoed, 'lighting.neon', 'e1', allowed), vetoed);

  // On the wire the attribution travels with the chip, and a manual chip keeps its own
  // entity when a reply omits the field rather than losing it.
  assert.deepEqual(wireSelection(state.selections[0]),
    { id: 'clothing.dress', source: 'manual', pinned: false, entity_id: 'e1' });
  assert.equal(mergeSelections([state.selections[0]],
    [{ ...state.selections[0], source: 'auto', entityId: null }])[0].entityId, 'e1');
  // A pinned auto chip adopts the reply's attribution, because the reply read this brief.
  const pinnedAuto = [chip('clothing.dress', 'auto', { pinned: true, entityId: 'e1' })];
  assert.equal(mergeSelections(pinnedAuto,
    [chip('clothing.dress', 'auto', { entityId: 'e2' })])[0].entityId, 'e2');
});

/* ------------------------------ 10. switching to a model with no negative prompt support */

test('10. a negative prompt the new model cannot take is a two-step, recorded loss', () => {
  const session = sessionFor(edit({ briefKo: '비 오는 거리' }), {
    candidates: [{ candidate_id: 'c1', title_ko: '제목', difference_ko: '차이',
      positive_prompt: 'a prompt', negative_prompt: 'blurry' }],
  });
  const call = (over) => planFor(session, { negativeSupported: false, ...over });

  // First press: refused, with the reason and the next action.
  const first = call({});
  assert.equal(first.ok, false);
  assert.equal(first.block, 'negative_lost');
  assert.equal(first.message, APPLY_BLOCK_COPY.negative_lost);

  // Second press: the loss is performed, positive-only, and named.
  const second = call({ acceptNegativeLoss: true });
  assert.equal(second.ok, true);
  assert.equal(second.negativePrompt, null,
    'a negative must never reach a model that cannot take it');
  assert.equal(second.positivePrompt, 'a prompt');
  assert.equal(second.lossKo, NEGATIVE_LOSS_NOTE);
  // Accepting the loss must not bypass the overwrite confirmation: a stronger refusal is
  // never hidden behind a weaker one.
  assert.equal(call({ acceptNegativeLoss: true, currentPrompt: 'mine',
    appliedPrompt: null }).needsConfirm, true);

  // The diff says so before the press as well, so the card is not a dead button.
  assert.deepEqual(applyDiff(session.draft.candidates[0],
    { currentPrompt: '', currentNegative: '', negativeSupported: false }),
  { positive: 'replace', negative: 'blocked' });

  // A supported model takes the same candidate with its negative intact.
  const supported = planFor(session);
  assert.equal(supported.negativePrompt, 'blurry');
  assert.equal(supported.lossKo, null);
});

/* -------------------------------- UCP01 case 4, now actionable instead of only reported */

test('an exclusion the brief contradicts is resolvable, in both directions', () => {
  const vetoed = removeSelection(
    withSelections(edit({ briefKo: '네온 아래 서 있는 사람' }), [chip('lighting.neon')]),
    'lighting.neon');
  const clash = { id: 'lighting.neon', phrase: '네온' };

  // Dropping the veto keeps the sentence exactly as written.
  const kept = resolveClash(vetoed, clash, 'drop_exclusion', DICTIONARY);
  assert.deepEqual(excludedIds(kept), []);
  assert.equal(kept.briefKo, '네온 아래 서 있는 사람');

  // Dropping the mention keeps the veto and cuts only the affirmed phrase.
  const cut = resolveClash(vetoed, clash, 'drop_mention', DICTIONARY);
  assert.deepEqual(excludedIds(cut), ['lighting.neon']);
  assert.equal(cut.briefKo, '아래 서 있는 사람');
  assert.deepEqual(cut.choices, [], 'a new sentence re-opens the clarification slot');

  // A negated mention is the veto restated; cutting it would delete the decision itself.
  const negated = { ...vetoed, briefKo: '네온 없이 조용한 방' };
  assert.equal(resolveClash(negated, clash, 'drop_mention', DICTIONARY), negated,
    'there is nothing to cut, so nothing changes');
});

/* ------------------------- warning order is a category fact, not the server's array order */

test('reduced candidates outrank an advisory even when the server lists it first', () => {
  // The reported case: both codes can appear in one reply. Both are `reduced` facts — "the
  // list is shorter than you asked for" — so neither is demoted to `advisory`.
  assert.deepEqual(warningAlerts(['duplicate_candidates', 'candidates_reduced'])
    .map((alert) => alert.category), ['reduced', 'reduced']);
  // Inside one category the server's order survives (stable sort), because the server
  // encodes its own priority there; only cross-category order is this module's decision.
  assert.deepEqual(warningAlerts(['duplicate_candidates', 'candidates_reduced'])
    .map((alert) => alert.key), ['warn-duplicate_candidates-0', 'warn-candidates_reduced-1']);
  assert.deepEqual(warningAlerts(['candidates_reduced', 'duplicate_candidates'])
    .map((alert) => alert.key), ['warn-candidates_reduced-0', 'warn-duplicate_candidates-1']);

  // An advisory never outranks a reduced notice, even when the server lists it first —
  // that is the cross-category rule the sort exists for.
  const mixed = warningAlerts(['profile_token_window', 'candidates_reduced']);
  assert.deepEqual(mixed.map((alert) => alert.category), ['reduced', 'advisory']);
  assert.deepEqual(warningAlerts(['profile_token_window', 'duplicate_candidates'])
    .map((alert) => alert.category), ['reduced', 'advisory']);

  // All three together. This is where the client and the server's `WARNING_PRIORITY`
  // disagree on purpose: the server puts `profile_token_window` second because it is in its
  // priority tuple, and this module puts both `reduced` facts first. Documented as an
  // intended divergence in the UCP06 record, not as server order reproduced.
  assert.deepEqual(
    warningAlerts(['candidates_reduced', 'profile_token_window', 'duplicate_candidates'])
      .map((alert) => alert.category),
    ['reduced', 'reduced', 'advisory'],
  );
});
