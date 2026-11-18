import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY } from '../src/prompt/dictionary.ts';
import { compileScene } from '../src/prompt/compiler.ts';
import {
  PARTIAL_KIND, PROPOSAL_KIND, parseReply, proposalBody, revisionsFor, startProposal, IDLE, settleProposal,
} from '../src/prompt/llmProposals.ts';
import { blockReason, proposalCards } from '../src/prompt/proposalCards.ts';
import { describeScope, partialDiff, partialScope, scopeIsActive, LOCK_NOTE } from '../src/prompt/partialChange.ts';
import { recordAcceptance, undoScene, undoStatus } from '../src/prompt/proposalUndo.ts';
import { selectEntry, removeEntry } from '../src/prompt/scene.ts';

const scene = (changes = {}) => ({
  schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '장소만 바꿔줘', ...changes,
});

const selection = (id, category) => ({
  id, category, labelKo: id, dictionaryVersion: '1.2.0', mapping: { status: 'unavailable' },
});

const suggestion = (id, over = {}) => ({
  id, matched_phrase: '조명', basis: 'quote', polarity: 'affirmed',
  actor: null, confidence: 0.8, reason_ko: '', ...over,
});

const replyOf = (over = {}) => parseReply({
  proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: PARTIAL_KIND,
  provider: null, suggestions: [], unresolved_spans: [], ambiguities: [], rejected: [],
  truncated: false, ...over,
});

const entry = (id) => DICTIONARY.find((item) => item.id === id);


test('a partial scope locks every selection outside the chosen groups', () => {
  const base = scene({
    selections: [
      selection('subject.person', 'subject'),
      selection('clothing.white_shirt', 'clothing'),
      selection('lighting.neon', 'lighting'),
    ],
  });
  const scope = partialScope(base, ['setting']);
  assert.deepEqual(scope.targetGroups, ['setting']);
  // Every selection outside `setting` is locked: the subject, the clothing and the
  // lighting all have to survive a setting-only request.
  assert.deepEqual(scope.lockedIds, ['subject.person', 'clothing.white_shirt', 'lighting.neon']);

  // A legacy category maps to its display group, so `location` counts as `setting`
  // and must not be locked by a setting-only request.
  const legacy = scene({ selections: [selection('location.street', 'location')] });
  assert.deepEqual(partialScope(legacy, ['setting']).lockedIds, []);

  // Groups are stored in display order, so two equal scopes compare equal by value.
  assert.deepEqual(partialScope(base, ['lighting', 'subject']).targetGroups, ['subject', 'lighting']);
  // An unknown group cannot silently turn into "nothing is locked".
  assert.deepEqual(partialScope(base, ['nonsense']), { targetGroups: [], lockedIds: [] });
  assert.equal(scopeIsActive(partialScope(base, [])), false);
  assert.equal(scopeIsActive(scope), true);
});

test('the request becomes partial_change only when a group was chosen', () => {
  const base = scene({ selections: [selection('subject.person', 'subject')] });
  const built = proposalBody({
    scene: base, family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-abc',
    scope: partialScope(base, ['setting']),
  });
  assert.equal(built.body.kind, PARTIAL_KIND);
  assert.deepEqual(built.body.target_groups, ['setting']);
  assert.deepEqual(built.body.locked_ids, ['subject.person']);

  // With no scope the I04 request stays byte-identical: no lock fields at all.
  const full = proposalBody({ scene: base, family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-abc' });
  assert.equal(full.body.kind, PROPOSAL_KIND);
  assert.equal('locked_ids' in full.body, false);
  assert.equal('target_groups' in full.body, false);

  // An empty target list behaves like no scope rather than sending a hollow partial.
  const empty = proposalBody({
    scene: base, family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-abc',
    scope: { targetGroups: [], lockedIds: ['subject.person'] },
  });
  assert.equal(empty.body.kind, PROPOSAL_KIND);
});

test('the scope label reads as the request the button will send', () => {
  const base = scene({
    selections: [selection('subject.person', 'subject'), selection('clothing.coat', 'clothing')],
  });
  const labels = { setting: '배경', lighting: '조명' };
  assert.equal(describeScope(partialScope(base, ['setting']), (group) => labels[group]),
    '배경만 변경 · 고정 2개');
  assert.equal(describeScope(partialScope(base, []), (group) => labels[group]), '전체 장면');
  assert.equal(describeScope(partialScope(base, ['lighting', 'setting']), (group) => labels[group]),
    '배경·조명만 변경 · 고정 2개');
});

test('a reply that answers the other kind is refused instead of shown', () => {
  const sent = revisionsFor(scene());
  const partial = startProposal(IDLE, {
    requestId: 'req-1', revisions: sent, kind: PARTIAL_KIND,
    scope: { targetGroups: ['setting'], lockedIds: [] },
  });
  assert.equal(partial.phase, 'loading');
  assert.equal(partial.kind, PARTIAL_KIND);

  const mismatched = settleProposal(partial, {
    requestId: 'req-1', currentRevisions: sent,
    outcome: { kind: 'reply', reply: replyOf({ request_id: 'req-1', kind: PROPOSAL_KIND }) },
  });
  assert.equal(mismatched.phase, 'error');

  const settled = settleProposal(partial, {
    requestId: 'req-1', currentRevisions: sent,
    outcome: { kind: 'reply', reply: replyOf({ request_id: 'req-1', kind: PARTIAL_KIND }) },
  });
  assert.equal(settled.phase, 'ready');
  // The scope travels with the answer, so the cards judge the same rules as the server.
  assert.deepEqual(settled.scope, { targetGroups: ['setting'], lockedIds: [] });
  // A reply without a kind (older server) is still adopted.
  const legacy = settleProposal(startProposal(IDLE, { requestId: 'req-2', revisions: sent }), {
    requestId: 'req-2', currentRevisions: sent,
    outcome: { kind: 'reply', reply: replyOf({ request_id: 'req-2', kind: null }) },
  });
  assert.equal(legacy.phase, 'ready');
});

test('locked and out-of-scope suggestions are blocked, with the server wording', () => {
  const base = scene({ selections: [selection('subject.person', 'subject')] });
  const summary = proposalCards({
    reply: replyOf({
      suggestions: [
        suggestion('subject.person', { matched_phrase: '인물' }),
        suggestion('lighting.neon'),
        suggestion('setting.plain_background', { matched_phrase: '장소' }),
      ],
    }),
    scene: base, dictionary: DICTIONARY, family: 'sd15',
    scope: { targetGroups: ['setting'], lockedIds: ['subject.person'] },
  });
  // The subject is already chosen, the lighting is outside the scope, the setting is
  // the one thing this request may change.
  assert.deepEqual(summary.cards.map((card) => card.blocks[0]),
    ['already_selected', 'out_of_scope', undefined]);
  assert.deepEqual(summary.batchIds, ['setting.plain_background']);
  assert.deepEqual(summary.excluded.map((item) => item.why),
    ['이번 요청의 변경 대상이 아닙니다']);

  // A locked id is blocked even when it is in the target group, exactly like the
  // server's `locked` branch (C01-4).
  const lockedInScope = proposalCards({
    reply: replyOf({ suggestions: [suggestion('setting.plain_background')] }),
    scene: base, dictionary: DICTIONARY, family: 'sd15',
    scope: { targetGroups: ['setting'], lockedIds: ['setting.plain_background'] },
  });
  assert.deepEqual(lockedInScope.cards[0].blocks, ['locked']);
  assert.equal(lockedInScope.cards[0].batchEligible, false);
  assert.equal(blockReason('locked'), '이번 요청에서 고정한 값입니다');
});

test('the diff separates what stays, what is added and what cannot be taken', () => {
  const base = scene({ selections: [selection('subject.person', 'subject')] });
  const scope = { targetGroups: ['setting'], lockedIds: ['subject.person'] };
  const cards = proposalCards({
    reply: replyOf({
      suggestions: [
        suggestion('setting.plain_background'),
        suggestion('lighting.neon'),
        suggestion('subject.dog', { basis: 'inferred' }),
      ],
      unresolved_spans: [{ text: '골목에 선', why: 'no_dictionary_entry', polarity: 'affirmed' }],
    }),
    scene: base, dictionary: DICTIONARY, family: 'sd15', scope,
  });
  const diff = partialDiff({ cards, scene: base, scope });
  assert.equal(diff.kept, 1);
  assert.equal(diff.changes, 1);
  assert.equal(diff.blocked, 2);
  assert.equal(diff.noChange, false);
  // Kept first: the locked value is what the user is protecting, so it leads the list.
  assert.deepEqual(diff.rows.map((row) => row.kind), ['kept', 'change', 'blocked', 'blocked']);
  assert.deepEqual(diff.rows.map((row) => row.labelKo),
    ['subject.person', '단색 배경', '네온 조명', '개']);
  // A span with no dictionary id is not listed: `선택에 추가` cannot exist for it, so it
  // is not part of what accepting this reply would change.
  assert.equal(diff.rows.some((row) => row.labelKo === '골목에 선'), false);
  // The lock note is the honest sentence: a setting lock, not a likeness guarantee.
  assert.equal(diff.note, LOCK_NOTE);
  assert.match(diff.note, /동일 인물을 보장하지 않습니다/);

  // A reply that changes nothing says so instead of asking for a pointless click.
  const noop = partialDiff({
    cards: proposalCards({
      reply: replyOf({ suggestions: [] }), scene: base, dictionary: DICTIONARY, family: 'sd15', scope,
    }),
    scene: base, scope,
  });
  assert.equal(noop.noChange, true);
  assert.equal(noop.changes, 0);
});

test('one-step undo removes only what the acceptance added, while the scene is unchanged', () => {
  const before = scene({ selections: [selection('subject.person', 'subject')] });
  let after = selectEntry(before, entry('setting.plain_background'), '1.2.0');
  after = selectEntry(after, entry('lighting.neon'), '1.2.0');
  const record = recordAcceptance({
    ids: ['setting.plain_background', 'lighting.neon'], labels: ['단색 배경', '네온 조명'],
    previousIds: ['subject.person'], revisions: revisionsFor(after),
  });
  assert.deepEqual(record.ids, ['setting.plain_background', 'lighting.neon']);

  const allowed = undoStatus(record, after, revisionsFor(after));
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.ids, ['setting.plain_background', 'lighting.neon']);
  assert.equal(allowed.label, '방금 추가한 2개 되돌리기');

  // A single card names itself, so the button says what it will take away.
  const one = recordAcceptance({
    ids: ['lighting.neon'], labels: ['네온 조명'], previousIds: ['subject.person'],
    revisions: revisionsFor(after),
  });
  assert.equal(undoStatus(one, after, revisionsFor(after)).label, '“네온 조명” 추가 되돌리기');

  assert.deepEqual(undoScene(after, record).selections.map((item) => item.id), ['subject.person']);

  // A later hand pick is not part of the record and survives the undo.
  const later = selectEntry(after, entry('mood.calm'), '1.2.0');
  const changed = undoStatus(record, later, revisionsFor(later));
  assert.equal(changed.allowed, false);
  assert.equal(changed.why, 'scene_changed');
  assert.match(changed.text, /되돌릴 수 없습니다/);
  // Even if forced, the undo only removes the recorded ids.
  assert.deepEqual(undoScene(later, record).selections.map((item) => item.id),
    ['subject.person', 'mood.calm']);

  // Removing every accepted chip by hand already undid it: nothing is left to remove.
  let cleared = removeEntry(after, 'lighting.neon');
  cleared = removeEntry(cleared, 'setting.plain_background');
  assert.equal(undoStatus(record, cleared, revisionsFor(cleared)).why, 'already_undone');
  assert.equal(undoStatus(null, after, revisionsFor(after)).why, 'no_record');
  // An acceptance that added nothing (the item was already chosen) has nothing to undo.
  const nothing = recordAcceptance({
    ids: ['subject.person'], labels: ['인물'], previousIds: ['subject.person'],
    revisions: revisionsFor(before),
  });
  assert.deepEqual(nothing.ids, []);
  assert.equal(undoStatus(nothing, before, revisionsFor(before)).why, 'no_record');
});

test('undoing produces the same draft as removing the chips by hand', () => {
  const before = scene({ selections: [selection('subject.person', 'subject')] });
  const after = selectEntry(before, entry('setting.plain_background'), '1.2.0');
  const record = recordAcceptance({
    ids: ['setting.plain_background'], labels: ['단색 배경'],
    previousIds: ['subject.person'], revisions: revisionsFor(after),
  });
  const undone = undoScene(after, record);
  assert.deepEqual(undone, before);
  assert.deepEqual(compileScene(undone).draft, compileScene(before).draft);
  assert.deepEqual(compileScene(undone).unresolved, compileScene(before).unresolved);
});



