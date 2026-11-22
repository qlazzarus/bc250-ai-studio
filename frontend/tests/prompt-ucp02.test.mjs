import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY, DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import {
  EMPTY_EDIT, MAX_SELECTIONS, addManual, attributeTo, chosenSelections, clearExclusion,
  exclusionClashes, excludedIds, hasComposeInput, parseScene, removeSelection, setPinned,
} from '../src/prompt/structuredScene.ts';
import {
  IDLE_COMPOSE, applyCandidate, cancelComposition, composeRevisions, draftIsStale,
  editAppliedPrompt, expireForTarget, invalidateComposition, isPending, mergeSelections,
  newComposeRequestId, sameRevisions, sameTarget, settleComposition, settleConflict,
  startComposition, undoApply, undoOverwritesEdits, withAnswer, withBrief, withSelections,
} from '../src/prompt/composeSession.ts';
import {
  INITIAL_VIEW, NARROW_MAX_WIDTH, isCollapsed, resize, setWidth, toggleGroup, togglePanel,
} from '../src/prompt/composeView.ts';

const TARGET = { modelId: 'pornmaster-klein-9b', family: 'flux2',
  profileVersion: 1, dictionaryVersion: DICTIONARY_VERSION };
const OTHER_TARGET = { ...TARGET, modelId: 'z-image-turbo', family: 'z-image' };
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

const result = (over = {}) => ({
  resultId: 'cmp-aaaaaaaaaaaa', requestId: REQUEST_ID,
  revisions: composeRevisions(edit(), TARGET),
  summaryKo: '요약', scene: { entities: [], relations: [],
    environment: { locationKo: null, timeKo: null, lightingKo: null,
      compositionKo: null, styleKo: null, moodKo: null },
    unmappedDetails: [], ambiguities: [] },
  selections: [], candidates: [candidate('c1')], questions: [], warnings: [],
  snapshotTrim: [], providerModel: 'qwen3-test',
  tokens: { promptTokens: 10, reasoningTokens: 0, outputTokens: 40, truncated: false },
  ...over,
});

/** Drive a session to `ready` with one accepted reply. */
function readySession(editValue = edit({ briefKo: '비 오는 거리' }), over = {}) {
  const started = startComposition(IDLE_COMPOSE(editValue), { requestId: REQUEST_ID, target: TARGET });
  return settleComposition(started, {
    outcome: { kind: 'reply', result: result({ revisions: started.revisions, ...over }) },
    currentRevisions: started.revisions,
    currentTarget: TARGET,
  });
}

test('a scene-only request is valid: empty Korean text with a chosen chip still composes', () => {
  // UCP01 fix A: `brief_ko` is optional. Only "neither text nor a chosen chip" is empty.
  const chosen = withSelections(edit(), [chip('lighting.neon', 'auto')]);
  assert.equal(chosen.briefKo, '');
  assert.equal(hasComposeInput(chosen), true);

  const empty = withSelections(edit(), [chip('lighting.neon', 'excluded')]);
  assert.equal(hasComposeInput(empty), false, 'a veto alone asks for nothing');

  // Both differ from the blank state the server rejects with 422.
  assert.equal(hasComposeInput(edit()), false);
  assert.equal(MAX_SELECTIONS, 100);
});

test('a manual chip stays manual when unpinned, and the server cannot demote it', () => {
  // UCP01 fix D: `pinned` and `source` are different facts. Unpinning a hand-picked chip
  // means "AI may replace it next time", not "I did not pick it".
  const picked = addManual(edit(), { id: 'clothing.dress', pinned: true });
  const unpinned = setPinned(picked, 'clothing.dress', false);
  assert.deepEqual(unpinned.selections,
    [{ id: 'clothing.dress', source: 'manual', pinned: false, entityId: null }]);

  // A reply claiming `auto` must not overwrite the manual attribution.
  const merged = mergeSelections(unpinned.selections, [chip('clothing.dress', 'auto', { pinned: true })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'manual', 'the server never demotes a manual pick');
  assert.equal(merged[0].pinned, false, 'unpinning is the user\'s own choice');
});

test('deleting an automatic chip leaves a veto that survives the next reply', () => {
  const withAuto = withSelections(edit({ briefKo: '네온 아래 서 있는 사람' }),
    [chip('lighting.neon'), chip('subject.person')]);
  const afterDelete = removeSelection(withAuto, 'lighting.neon');
  // An auto chip becomes an exclusion; a manual one would leave nothing behind.
  assert.deepEqual(excludedIds(afterDelete), ['lighting.neon']);
  assert.deepEqual(chosenSelections(afterDelete).map((item) => item.id), ['subject.person']);
  assert.deepEqual(removeSelection(addManual(edit(), { id: 'style.illustration' }),
    'style.illustration').selections, [], 'a manual removal leaves no veto');

  // The next reply re-derives `lighting.neon`; the veto must still win.
  const merged = mergeSelections(afterDelete.selections,
    [chip('lighting.neon'), chip('subject.person')]);
  assert.equal(merged.find((item) => item.id === 'lighting.neon').source, 'excluded');
  assert.equal(chosenSelections({ ...afterDelete, selections: merged }).length, 1);
  assert.deepEqual(clearExclusion(afterDelete, 'lighting.neon').selections,
    [chip('subject.person')], 'clearing the veto lets the next reply choose it again');
});

test('an exclusion contradicted by the new brief is reported, not silently applied', () => {
  // UCP02 required case 4: the user wrote the concept again after vetoing it.
  const vetoed = removeSelection(withSelections(edit({ briefKo: '사람' }), [chip('lighting.neon')]),
    'lighting.neon');
  const clash = exclusionClashes({ ...vetoed, briefKo: '네온 아래 서 있는 사람' }, DICTIONARY);
  assert.deepEqual(clash.map((item) => item.id), ['lighting.neon']);
  assert.ok(clash[0].phrase.length > 0);

  // Restating the veto is not a clash, and neither is a brief that never mentions it.
  assert.deepEqual(exclusionClashes({ ...vetoed, briefKo: '네온 없이 조용한 방' }, DICTIONARY), []);
  assert.deepEqual(exclusionClashes({ ...vetoed, briefKo: '조용한 방' }, DICTIONARY), []);
});

test('two people keep their own attributes: attribution is per entity, not global', () => {
  const parsed = parseScene({
    entities: [
      { entity_id: 'entity-1', kind: 'person', count: 1, attributes_ko: ['붉은 원피스', '긴 머리'] },
      { entity_id: 'entity-2', kind: 'person', count: 1, attributes_ko: ['검은 정장'] },
    ],
    relations: [{ subject_entity_id: 'entity-1', predicate_ko: '서 있다',
      object_entity_id: 'entity-2' }],
    environment: {}, unmapped_details: [], ambiguities: [],
  });
  assert.ok('scene' in parsed);
  assert.deepEqual(parsed.scene.entities.map((item) => item.attributesKo),
    [['붉은 원피스', '긴 머리'], ['검은 정장']]);

  // The same dictionary chip attributed to two people is two rows, not a conflict.
  const twoChips = withSelections(edit(), [
    chip('appearance.long_hair', 'manual', { entityId: 'entity-1' }),
    chip('appearance.short_hair', 'manual', { entityId: 'entity-2' }),
  ]);
  assert.deepEqual(twoChips.selections.map((item) => item.entityId), ['entity-1', 'entity-2']);
  assert.equal(attributeTo(twoChips, 'appearance.long_hair', 'entity-2')
    .selections[0].entityId, 'entity-2');
});

test('editing the brief mid-clarification drops the stale answers and the questions', () => {
  const base = edit({ briefKo: '두 사람이 서 있다' });
  const started = startComposition(IDLE_COMPOSE(base), { requestId: REQUEST_ID, target: TARGET });
  const asked = settleComposition(started, {
    outcome: { kind: 'reply', result: result({ revisions: started.revisions,
      questions: [{ questionId: 'clar-01', questionKo: '누가 서 있나요?',
        why: 'actor_unknown', options: [{ optionId: 'opt-01', labelKo: '여성' }] }] }) },
    currentRevisions: started.revisions, currentTarget: TARGET,
  });
  assert.equal(asked.phase, 'needs_clarification');
  const answered = { ...asked, edit: withAnswer(asked.edit, 'clar-01', 'opt-01') };
  // Answering moves only the choice fingerprint (UCP01 §4 revision table).
  const before = composeRevisions(answered.edit, TARGET);
  assert.notEqual(before.choice, asked.revisions.choice);
  assert.equal(before.brief, asked.revisions.brief);
  assert.equal(before.selection, asked.revisions.selection);

  // A brief edit meanwhile is a different session: the answers cannot survive it.
  const edited = withBrief(answered.edit, '두 사람이 걷고 있다');
  assert.deepEqual(edited.choices, []);
  const after = composeRevisions(edited, TARGET);
  assert.notEqual(after.brief, before.brief);
  assert.notEqual(after.choice, before.choice, 'a new brief re-opens the choice slot');
  assert.equal(draftIsStale(answered, after), true);

  // A chip change also clears the answers but keeps the brief.
  const chipped = withSelections(answered.edit, [chip('subject.two_people')]);
  assert.deepEqual(chipped.choices, []);
  assert.equal(chipped.briefKo, answered.edit.briefKo);
});

test('a model change expires candidates but keeps the brief, chips and applied record', () => {
  const session = readySession();
  assert.equal(session.phase, 'ready');
  const applied = applyCandidate(session, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-21T00:00:00Z', resultId: 'cmp-bbbbbbbbbbbb' });
  assert.equal(applied.applied.candidateId, 'c1');

  const expired = expireForTarget(applied, OTHER_TARGET);
  assert.equal(expired.phase, 'idle');
  assert.equal(expired.draft, null, 'candidates for another model are gone');
  assert.equal(expired.applied.candidateId, 'c1', 'the applied record is history, not a draft');
  assert.equal(expired.edit.briefKo, '비 오는 거리');
  assert.equal(expired.edit.selections.length, applied.edit.selections.length);
  assert.equal(expired.edit.targetModelId, OTHER_TARGET.modelId);
  assert.equal(sameTarget({ ...TARGET, modelId: OTHER_TARGET.modelId }, OTHER_TARGET), false);
});

test('a late reply after cancel or a new request never reaches the screen', () => {
  const base = edit({ briefKo: '비 오는 거리' });
  const started = startComposition(IDLE_COMPOSE(base), { requestId: REQUEST_ID, target: TARGET });
  assert.equal(isPending(started), true);

  // Explicit cancel: the state settles, and the aborted reply is refused by request id.
  const cancelled = cancelComposition(started);
  assert.equal(cancelled.phase, 'cancelled');
  assert.deepEqual(cancelled.edit, base, 'the input survives a cancel');
  const late = settleComposition(cancelled, {
    outcome: { kind: 'reply', result: result({ revisions: started.revisions }) },
    currentRevisions: started.revisions, currentTarget: TARGET,
  });
  assert.equal(late, cancelled, 'a settled session ignores a late reply outright');

  // A second request supersedes the first: the older reply is dropped with no change.
  const second = startComposition(IDLE_COMPOSE(base), { requestId: 'cmp-ffffffffffff', target: TARGET });
  const older = settleComposition(second, {
    outcome: { kind: 'reply', result: result({ revisions: second.revisions }) },
    currentRevisions: second.revisions, currentTarget: TARGET,
  });
  assert.equal(older, second, 'only the newest request id may settle');
});

test('an in-flight request is voided when the edit moves under it', () => {
  const base = edit({ briefKo: '비 오는 거리' });
  const started = startComposition(IDLE_COMPOSE(base), { requestId: REQUEST_ID, target: TARGET });
  const edited = withBrief(base, '맑은 거리');
  const moved = invalidateComposition(started, composeRevisions(edited, TARGET));
  assert.equal(moved.phase, 'cancelled');
  assert.deepEqual(moved.edit, base, 'invalidation does not rewrite what the user typed');

  // No change means no transition, so a resize-like no-op cannot cancel a request.
  assert.equal(invalidateComposition(started, started.revisions), started);
});

test('the English prompt can be edited after applying without pretending to re-apply', () => {
  const session = readySession();
  const applied = applyCandidate(session, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-21T00:00:00Z', resultId: 'cmp-bbbbbbbbbbbb' });
  const edited = editAppliedPrompt(applied, { positivePrompt: 'hand written prompt',
    negativePrompt: 'blurry' });
  assert.equal(edited.applied.positivePrompt, 'hand written prompt');
  assert.equal(edited.applied.negativePrompt, 'blurry');
  assert.equal(edited.applied.appliedAt, applied.applied.appliedAt,
    'a rewrite is not a second apply');
  assert.equal(edited.applied.resultId, applied.applied.resultId);

  // With no apply yet there is nothing to rewrite.
  assert.equal(editAppliedPrompt(session, { positivePrompt: 'x', negativePrompt: null }), session);
});

test('rotation, width and panel collapse never touch the request state', () => {
  const session = readySession();
  // The view object is a different type from the edit, so it cannot enter a revision.
  const view = resize(INITIAL_VIEW, { pixels: 360, orientation: 'portrait' });
  assert.equal(view.width, 'narrow');
  assert.equal(setWidth(view, NARROW_MAX_WIDTH + 1).width, 'wide');

  const collapsed = toggleGroup(togglePanel(view), 'lighting');
  assert.equal(isCollapsed(collapsed, 'lighting'), true);
  assert.equal(collapsed.panelOpen, false);

  // Nothing above is an input to the session: the state is byte-identical afterwards.
  assert.deepEqual(session.revisions, composeRevisions(session.edit, TARGET));
  assert.equal(session.phase, 'ready');
  assert.equal(draftIsStale(session, composeRevisions(session.edit, TARGET)), false);
  // A resize within the same class is a no-op object, so React can skip the render.
  assert.equal(setWidth(view, 400), view);
});

test('one undo restores the previous applied value, and warns when edits would be lost', () => {
  const session = readySession();
  const first = applyCandidate(session, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-21T01:00:00Z', resultId: 'cmp-bbbbbbbbbbbb' });
  const twoCandidates = { ...first, draft: { ...first.draft,
    candidates: [...first.draft.candidates, candidate('c2')] } };
  const second = applyCandidate(twoCandidates, { candidateId: 'c2', providerModel: 'qwen3-test',
    appliedAt: '2026-11-21T02:00:00Z', resultId: 'cmp-cccccccccccc' });
  assert.equal(second.applied.candidateId, 'c2');

  // Undo goes back exactly one step, to the value that was applied before.
  const undone = undoApply(second, first.applied);
  assert.equal(undone.applied.candidateId, 'c1');
  assert.equal(undone.edit.briefKo, second.edit.briefKo, 'undo never rewrites the brief');

  // Typing after the apply makes the undo lossy, and that is reported.
  const typed = { ...second, edit: withBrief(second.edit, '다른 장면') };
  assert.equal(undoOverwritesEdits(typed, second.revisions,
    composeRevisions(typed.edit, TARGET)), true);
  assert.equal(undoOverwritesEdits(typed, second.revisions, second.revisions), false);
});

test('a 409 names which fingerprint disagreed so the retry is specific', () => {
  const session = readySession();
  const choice = settleConflict(session, { code: 'stale_clarification', staleField: 'choice' });
  const selection = settleConflict(session, { code: 'stale_clarification', staleField: 'selection' });
  assert.equal(choice.phase, 'failed');
  assert.equal(choice.failure, 'conflict');
  assert.match(choice.message, /질문/);
  assert.match(selection.message, /칩/);
  assert.equal(choice.detail, 'stale_clarification');
  // A conflict keeps the letters, so retrying needs no retyping.
  assert.deepEqual(choice.edit, session.edit);
});

test('a manual chip keeps its attribution when the server drops entity_id on failure', () => {
  // The server omits `entity_id` when an `unavailable` reply has no scene to attribute to
  // (`fallback_selections` refuses a dangling reference). The client must not treat that
  // absence as "the user's attribution is gone": a manual chip keeps its own entity, and
  // the merge only adopts a server entity when one actually arrived.
  const mine = chip('clothing.dress', 'manual', { pinned: true, entityId: 'e1' });
  const base = edit({ briefKo: '비 오는 거리', selections: [mine] });
  const started = startComposition(IDLE_COMPOSE(base), { requestId: REQUEST_ID, target: TARGET });
  const failed = settleComposition(started, {
    outcome: { kind: 'failed', failure: 'provider_error', message: '실패', detail: null },
    currentRevisions: started.revisions, currentTarget: TARGET,
  });
  // A failure never writes the edit, so the attribution is untouched.
  assert.deepEqual(failed.edit.selections, [mine]);
  assert.equal(failed.edit.selections[0].entityId, 'e1');

  // And when a reply *is* adopted with the field omitted, the merge keeps the manual chip's
  // own entity rather than nulling it.
  const merged = mergeSelections([mine], [{ ...mine, source: 'auto', entityId: null }]);
  assert.equal(merged[0].source, 'manual');
  assert.equal(merged[0].entityId, 'e1');
});

test('an unavailable reply does not erase the edit it was asked about', () => {
  // The backend preserves the request's chips in an `unavailable` body so the client can
  // match the reply to its revision. Even so, the client's authority is its own `edit`:
  // a reply — of any status — never becomes the edit.
  const selections = [
    chip('clothing.dress', 'manual', { pinned: true, entityId: 'e1' }),
    chip('style.illustration', 'excluded'),
  ];
  const base = edit({ briefKo: '비 오는 거리', selections });
  const started = startComposition(IDLE_COMPOSE(base), { requestId: REQUEST_ID, target: TARGET });
  const failed = settleComposition(started, {
    outcome: { kind: 'failed', failure: 'invalid_reply', message: '형식 오류', detail: null },
    currentRevisions: started.revisions, currentTarget: TARGET,
  });
  assert.deepEqual(failed.edit, base);
  // The exclusion — the only record of "I deleted this" — survives verbatim.
  const veto = failed.edit.selections.find((item) => item.id === 'style.illustration');
  assert.equal(veto.source, 'excluded');
  // And the veto still blocks a re-add if the user tries to pick it again.
  assert.deepEqual(excludedIds(failed.edit), ['style.illustration']);
});

test('request IDs match the only shape the server accepts', () => {
  assert.match(newComposeRequestId(), /^cmp-[0-9a-f]{12}$/);
  assert.match(newComposeRequestId(() => 0), /^cmp-0{12}$/);
  assert.match(newComposeRequestId(() => 0.999), /^cmp-f{12}$/);
});

test('each failure keeps its own reason and never discards what the user typed', () => {
  const base = edit({ briefKo: '비 오는 거리', selections: [chip('subject.person')] });
  const started = startComposition(IDLE_COMPOSE(base), { requestId: REQUEST_ID, target: TARGET });
  const failures = ['truncated', 'partial', 'timed_out', 'provider_error',
    'invalid_reply', 'conflict', 'expired'];
  const messages = new Set();
  for (const failure of failures) {
    const failed = settleComposition(started, {
      outcome: { kind: 'failed', failure, message: `실패: ${failure}`, detail: null },
      currentRevisions: started.revisions, currentTarget: TARGET,
    });
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.failure, failure, `${failure} must not collapse into a generic error`);
    // The brief, the chips and the applied history all survive every failure path.
    assert.deepEqual(failed.edit, base);
    messages.add(failed.message);
  }
  assert.equal(messages.size, failures.length, 'one message per distinct outcome');

  // A cancel is not a failure: nothing went wrong, so it is a separate phase.
  assert.equal(cancelComposition(started).phase, 'cancelled');
  // A failure carries the last good draft so the screen does not go blank.
  const ready = readySession(base);
  const broken = settleComposition(
    startComposition(ready, { requestId: 'cmp-ffffffffffff', target: TARGET }),
    { outcome: { kind: 'failed', failure: 'timed_out', message: '시간 초과', detail: null },
      currentRevisions: ready.revisions, currentTarget: TARGET });
  assert.equal(broken.draft.candidates.length, 1);
});

test('a partially usable reply keeps its candidates and says one was dropped', () => {
  // §5 line 307: a dropped candidate is reported as `candidates_reduced`, never silently.
  // "Partial" is not a failure phase — the usable candidates stay applicable.
  const session = readySession(edit({ briefKo: '비 오는 거리' }), {
    warnings: ['candidates_reduced'],
    tokens: { promptTokens: 100, reasoningTokens: 800, outputTokens: 40, truncated: true },
  });
  assert.equal(session.phase, 'ready');
  assert.equal(session.draft.candidates.length, 1);
  assert.deepEqual(session.warnings, ['candidates_reduced']);
  // A reply that spent its budget on reasoning is visible as such, not as a plain cut.
  assert.equal(session.tokens.reasoningTokens, 800);
  assert.equal(session.tokens.outputTokens, 40);
  assert.equal(session.tokens.truncated, true);
  // The usable candidate is still applicable.
  assert.equal(applyCandidate(session, { candidateId: 'c1', providerModel: 'qwen3-test',
    appliedAt: '2026-11-21T00:00:00Z', resultId: 'cmp-bbbbbbbbbbbb' }).applied.candidateId, 'c1');
});

test('a malformed scene is rejected whole, including a dangling reference', () => {
  const base = { entities: [{ entity_id: 'entity-1', kind: 'person', count: 1,
    attributes_ko: [] }], relations: [], environment: {},
    unmapped_details: [], ambiguities: [] };
  assert.ok('scene' in parseScene(base));

  const broken = [
    // A relation naming an entity that is not in the scene.
    { ...base, relations: [{ subject_entity_id: 'entity-1', predicate_ko: '서 있다',
      object_entity_id: 'entity-9' }] },
    { ...base, relations: [{ subject_entity_id: 'entity-9', predicate_ko: '서 있다' }] },
    // An unmapped detail or ambiguity option pointing at nothing.
    { ...base, unmapped_details: [{ text_ko: '반사', entity_id: 'entity-9' }] },
    { ...base, ambiguities: [{ text_ko: '누가?', why: 'actor_unknown', options: ['entity-9'] }] },
    // A duplicate entity ID would make attribution ambiguous.
    { ...base, entities: [...base.entities, { entity_id: 'entity-1', kind: 'person' }] },
    // Missing IDs, empty text and a non-object are all unusable.
    { ...base, entities: [{ kind: 'person' }] },
    { ...base, unmapped_details: [{ text_ko: '' }] },
    'not a scene',
    null,
  ];
  for (const value of broken) {
    const parsed = parseScene(value);
    assert.ok('error' in parsed, `expected a rejection for ${JSON.stringify(value)}`);
    assert.ok(parsed.error.length > 0);
  }

  // Absent optional evidence and unknown enum values degrade instead of rejecting.
  const lenient = parseScene({ ...base,
    entities: [{ entity_id: 'entity-1', kind: 'spaceship', count: 0 }] });
  assert.equal(lenient.scene.entities[0].kind, 'person');
  assert.equal(lenient.scene.entities[0].count, 1);
  assert.equal(lenient.scene.entities[0].evidenceKo, null, 'absent, not empty (fix B)');
});





