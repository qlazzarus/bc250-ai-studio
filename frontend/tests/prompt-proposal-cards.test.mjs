import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY } from '../src/prompt/dictionary.ts';
import { compileScene, conflictsAmong } from '../src/prompt/compiler.ts';
import { cardConfidence, proposalCards } from '../src/prompt/proposalCards.ts';
import { dismissProposal, IDLE, invalidateProposal, parseReply, proposalNotice, reapplyProposal, revisionsFor, settleProposal, startProposal } from '../src/prompt/llmProposals.ts';
import { selectEntry } from '../src/prompt/scene.ts';

const scene = (changes = {}) => ({
  schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '네온 아래 사람', ...changes,
});

const suggestion = (id, over = {}) => ({
  id, matched_phrase: '네온', basis: 'quote', polarity: 'affirmed',
  actor: null, confidence: 0.8, reason_ko: '', ...over,
});

/** A parsed reply, so the card builder receives exactly what the client adopts. */
const replyOf = (over = {}) => parseReply({
  proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: 'selection_hint',
  provider: { model: 'qwen', version: '1', latency_ms: 5, finish_reason: 'stop' },
  suggestions: [], unresolved_spans: [], ambiguities: [], rejected: [], truncated: false, ...over,
});

const build = (over = {}, context = {}) => proposalCards({
  reply: replyOf(over), scene: scene(context.scene), dictionary: DICTIONARY, family: 'sd15', ...context,
});


test('a quoted card is acceptable, an inferred one is shown but never batched', () => {
  const summary = build({ suggestions: [
    suggestion('lighting.neon'),
    suggestion('subject.dog', { matched_phrase: '개', basis: 'inferred' }),
  ] });
  assert.equal(summary.cards.length, 2);
  assert.equal(summary.counts.quoted, 1);
  assert.equal(summary.counts.inferred, 1, 'the heading counts the two kinds separately');

  const [quoted, inferred] = summary.cards;
  assert.equal(quoted.kind, 'quoted');
  assert.deepEqual(quoted.blocks, []);
  assert.equal(quoted.batchEligible, true);
  assert.equal(inferred.kind, 'inferred');
  // Not a blocker: it is a real entry the user may still take by hand.
  assert.deepEqual(inferred.blocks, []);
  assert.equal(inferred.batchEligible, false, 'C01-3: inferred never enters the batch');

  assert.deepEqual(summary.batchIds, ['lighting.neon']);
  assert.deepEqual(summary.excluded, [
    { key: 's:subject.dog', labelKo: '개', why: '원문에 근거 문구가 없습니다' },
  ]);
});

test('a card whose id is not in the dictionary is displayed with a reason and no button', () => {
  const summary = build({ suggestions: [suggestion('lighting.ghost_wave')] });
  const [card] = summary.cards;
  assert.deepEqual(card.blocks, ['not_in_dictionary']);
  assert.equal(card.entry, null);
  assert.equal(card.labelKo, 'lighting.ghost_wave', 'the raw id is shown, not invented');
  assert.equal(card.batchEligible, false);
  assert.deepEqual(summary.batchIds, []);
});

test('an item already in the scene is not offered again and is not called a rejection', () => {
  const entry = DICTIONARY.find((item) => item.id === 'subject.person');
  const withPerson = selectEntry(scene(), entry, '1.2.0');
  const summary = build({ suggestions: [suggestion('subject.person')] }, { scene: withPerson });
  assert.deepEqual(summary.cards[0].blocks, ['already_selected']);
  assert.deepEqual(summary.batchIds, []);
  // Nothing for the user to act on: it is already in. Not listed as excluded.
  assert.deepEqual(summary.excluded, []);
});

test('a card that would collide with a choice is blocked instead of warning after the fact', () => {
  const entry = DICTIONARY.find((item) => item.id === 'composition.full_body');
  const withFull = selectEntry(scene(), entry, '1.2.0');
  const summary = build({ suggestions: [suggestion('composition.close_up')] }, { scene: withFull });
  assert.deepEqual(summary.cards[0].blocks, ['conflict']);
  assert.equal(summary.cards[0].batchEligible, false);
  assert.deepEqual(conflictsAmong(['composition.full_body', 'composition.close_up']),
    [['composition.full_body', 'composition.close_up']]);
  // The card builder must not disagree with the compiler about that pair.
  const compiled = compileScene(selectEntry(withFull, DICTIONARY.find((item) => item.id === 'composition.close_up'), '1.2.0'));
  assert.ok(compiled.warnings.some((warning) => warning.code === 'conflict'));
});


test('unresolved spans and ambiguities are listed, and neither can be accepted', () => {
  const summary = build({
    suggestions: [suggestion('lighting.neon')],
    unresolved_spans: [{ text: '우산을 접으며', why: 'no_dictionary_entry', polarity: 'affirmed' }],
    ambiguities: [{ text: '그 사람', why: 'actor_unknown', candidates: ['subject.person'] }],
  });
  assert.deepEqual(summary.counts, { quoted: 1, inferred: 0, unresolved: 1, ambiguous: 1 });
  const [, span, ambiguity] = summary.cards;
  assert.equal(span.kind, 'unresolved');
  assert.equal(span.labelKo, '우산을 접으며', 'the span is the verbatim text, not a translation');
  assert.equal(span.id, null);
  assert.equal(span.batchEligible, false);
  assert.equal(cardConfidence(span), null, 'a span has no model confidence');

  assert.equal(ambiguity.kind, 'ambiguous');
  // The candidate id is resolved to the Korean label; the raw id would be unusable.
  assert.match(ambiguity.reasonKo, /후보 인물/);
  assert.equal(ambiguity.entry, null);
  assert.deepEqual(summary.batchIds, ['lighting.neon']);
});

test('an ambiguity whose candidates are unknown keeps only the machine reason', () => {
  const summary = build({ ambiguities: [{ text: '그 사람', why: 'actor_unknown', candidates: ['nope.id'] }] });
  assert.equal(summary.cards[0].reasonKo, 'actor_unknown');
});

test('the same id twice is a duplicate card, and only the first may be accepted', () => {
  const summary = build({ suggestions: [suggestion('lighting.neon'), suggestion('lighting.neon')] });
  assert.deepEqual(summary.cards[0].blocks, []);
  assert.deepEqual(summary.cards[1].blocks, ['duplicate']);
  assert.deepEqual(summary.batchIds, ['lighting.neon'], 'an id enters the batch once');
});

test('two different quoted ids both enter the batch, in reply order', () => {
  const summary = build({ suggestions: [suggestion('lighting.neon'), suggestion('lighting.soft')] });
  assert.deepEqual(summary.batchIds, ['lighting.neon', 'lighting.soft']);
});

test('a family without a mapping blocks acceptance and says which family failed', () => {
  const summary = proposalCards({
    reply: replyOf({ suggestions: [suggestion('lighting.neon')] }),
    scene: scene({ targetFamily: 'fake' }), dictionary: DICTIONARY, family: 'fake',
  });
  assert.deepEqual(summary.cards[0].blocks, ['unmapped']);
  assert.equal(summary.cards[0].entry?.id, 'lighting.neon', 'the entry is known; only its text is not');
  assert.deepEqual(summary.batchIds, []);
});

test('an inferred card keeps its accept button and only loses batch membership', () => {
  const summary = build({ suggestions: [suggestion('subject.dog', { matched_phrase: '개', basis: 'inferred' })] });
  const [card] = summary.cards;
  assert.equal(card.kind, 'inferred');
  assert.deepEqual(card.blocks, [], 'nothing prevents a deliberate single accept');
  assert.equal(card.entry?.id, 'subject.dog');
  assert.deepEqual(summary.batchIds, [], 'but the batch never takes it');
  assert.deepEqual(summary.excluded, [
    { key: 's:subject.dog', labelKo: '개', why: '원문에 근거 문구가 없습니다' },
  ]);
});

test('truncation and rejected items are surfaced instead of dropping silently', () => {
  const summary = build({
    suggestions: [suggestion('lighting.neon')], truncated: true,
    rejected: [{ raw_id: 'lighting.glow', why: 'not_in_dictionary' }],
  });
  assert.equal(summary.truncated, true);
  assert.equal(summary.rejectedCount, 1);
  // Truncation does not invalidate what survived.
  assert.deepEqual(summary.batchIds, ['lighting.neon']);
});

test('a card with a confidence outside 0..1 is clamped for display only', () => {
  const summary = build({ suggestions: [suggestion('lighting.neon', { confidence: 1.4 })] });
  assert.equal(cardConfidence(summary.cards[0]), 100);
  assert.equal(summary.cards[0].confidence, 1.4, 'the model value is kept unchanged');
});


test('accepting a card re-bases the reply on the new selection and counts what was taken', () => {
  const sent = revisionsFor(scene());
  const ready = settleProposal(startProposal(IDLE, { requestId: 'req-1', revisions: sent }), {
    requestId: 'req-1', currentRevisions: sent,
    outcome: { kind: 'reply', reply: replyOf({ suggestions: [suggestion('lighting.neon'), suggestion('lighting.soft')] }) },
  });
  assert.equal(ready.phase, 'ready');
  assert.deepEqual(ready.acceptedIds, []);

  const next = selectEntry(scene(), DICTIONARY.find((item) => item.id === 'lighting.neon'), '1.2.0');
  const after = reapplyProposal(ready, revisionsFor(next), ['lighting.neon']);
  assert.equal(after.phase, 'ready');
  // The card list must survive the click: only the text withdraws a reply.
  assert.notDeepEqual(after.revisions, sent);
  assert.deepEqual(after.revisions, revisionsFor(next));
  assert.deepEqual(after.acceptedIds, ['lighting.neon']);
  // The status line stops claiming nothing was applied.
  assert.match(proposalNotice(after).text, /제안 1개를 선택에 반영했습니다/);

  // A repeated accept of the same id does not duplicate the count.
  assert.deepEqual(reapplyProposal(after, revisionsFor(next), ['lighting.neon']).acceptedIds, ['lighting.neon']);
});

test('editing the text still withdraws a re-based reply, and dismissing clears it', () => {
  const sent = revisionsFor(scene());
  const ready = settleProposal(startProposal(IDLE, { requestId: 'req-1', revisions: sent }), {
    requestId: 'req-1', currentRevisions: sent,
    outcome: { kind: 'reply', reply: replyOf({ suggestions: [suggestion('lighting.neon')] }) },
  });
  const edited = revisionsFor(scene({ freeTextKo: '네온 아래 사람, 그리고 개' }));
  // The re-base may not outlive the text it describes.
  assert.equal(reapplyProposal(ready, edited, ['lighting.neon']), ready);
  assert.deepEqual(invalidateProposal(ready, edited), { phase: 'cancelled', reason: 'stale_revision' });

  assert.deepEqual(dismissProposal(ready), IDLE);
  // Dismiss is not a silent edit: it never touches a request in flight.
  const loading = startProposal(IDLE, { requestId: 'req-2', revisions: sent });
  assert.equal(dismissProposal(loading), loading);
});
