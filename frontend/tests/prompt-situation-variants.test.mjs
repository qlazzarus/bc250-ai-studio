import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DICTIONARY } from '../src/prompt/dictionary.ts';
import {
  IDLE, MAX_VARIANTS, VARIANT_KIND, parseReply, parseVariants, proposalBody, proposalNotice,
  revisionsFor, settleProposal, startProposal,
} from '../src/prompt/llmProposals.ts';
import { variantBlockReason, variantCards, variantHeadline } from '../src/prompt/situationVariants.ts';
import { selectEntry } from '../src/prompt/scene.ts';

const scene = (changes = {}) => ({
  schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '같은 인물과 의상으로 다른 상황 3개', ...changes,
});

const entry = (id) => DICTIONARY.find((item) => item.id === id);

const withCast = () => {
  let next = selectEntry(scene(), entry('subject.person'), '1.2.0');
  next = selectEntry(next, entry('location.street'), '1.2.0');
  return selectEntry(next, entry('action.standing'), '1.2.0');
};

const variant = (over = {}) => ({
  variant_id: 'v1', label_ko: '공원에서 걷기', prompt_ko: '같은 인물이 공원을 걷는다',
  changed_ids: ['setting.park', 'action.walking'], removed_ids: ['location.street', 'action.standing'],
  unresolved_ko: [], actor: null, ...over,
});

const variantReply = (over = {}) => parseReply({
  proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: VARIANT_KIND,
  provider: { model: 'qwen', version: '1', latency_ms: 5, finish_reason: 'stop' },
  suggestions: [], variants: [variant()], unresolved_spans: [], ambiguities: [],
  rejected: [], truncated: false, ...over,
});

const build = (over = {}, context = {}) => variantCards({
  reply: variantReply(over), scene: withCast(), dictionary: DICTIONARY, family: 'sd15', ...context,
});

test('a variant request names its kind and carries the locked cast', () => {
  const scope = { targetGroups: ['setting', 'pose'], lockedIds: ['subject.person'] };
  const built = proposalBody({ scene: withCast(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1',
    scope, variant: true });
  assert.ok('body' in built);
  assert.equal(built.body.kind, VARIANT_KIND);
  assert.deepEqual(built.body.target_groups, ['setting', 'pose']);
  assert.deepEqual(built.body.locked_ids, ['subject.person']);
  assert.equal(built.body.free_text_ko, scene().freeTextKo);

  // A variant that may change lighting is a partial change wearing the wrong kind.
  const wrongGroup = proposalBody({ scene: withCast(), family: 'sd15', dictionaryVersion: '1.2.0',
    requestId: 'req-1', scope: { targetGroups: ['lighting'], lockedIds: [] }, variant: true });
  assert.deepEqual(wrongGroup, { code: 'invalid' });
  // Without a scope there is nothing a candidate is allowed to change.
  assert.deepEqual(proposalBody({ scene: withCast(), family: 'sd15', dictionaryVersion: '1.2.0',
    requestId: 'req-1', variant: true }), { code: 'invalid' });

  // The two older kinds keep their exact shape: no variant flag, no extra fields.
  const plain = proposalBody({ scene: withCast(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1' });
  assert.equal(plain.body.kind, 'selection_hint');
  assert.equal('target_groups' in plain.body, false);
  assert.equal('locked_ids' in plain.body, false);
});

test('candidates are capped at three, deduplicated and never repaired', () => {
  const parsed = parseVariants([
    variant(), variant({ variant_id: 'v2' }), variant({ variant_id: 'v3' }), variant({ variant_id: 'v4' }),
  ]);
  assert.deepEqual(parsed.variants.map((item) => item.variant_id), ['v1', 'v2', 'v3']);
  assert.equal(parsed.truncated, true, 'a cut is reported instead of hidden');
  assert.equal(MAX_VARIANTS, 3);
  assert.equal(parseVariants([variant()]).truncated, false);

  // A repeated id keeps its first occurrence and counts as a cut, not as a card.
  const repeated = parseVariants([variant(), variant(), variant({ variant_id: 'v3' })]);
  assert.deepEqual(repeated.variants.map((item) => item.variant_id), ['v1', 'v3']);
  assert.equal(repeated.truncated, true);

  // A candidate with no sentence, no id, or an over-long text is dropped whole:
  // truncating the Korean sentence would describe a situation the model never wrote.
  assert.deepEqual(parseVariants([variant({ prompt_ko: '  ' })]).variants, []);
  assert.deepEqual(parseVariants([variant({ variant_id: '' })]).variants, []);
  assert.deepEqual(parseVariants([variant({ prompt_ko: '가'.repeat(201) })]).variants, []);
  assert.equal(parseVariants([variant({ prompt_ko: '가'.repeat(201) })]).truncated, true);
  // An over-long label is dropped too, not shortened into a different label.
  assert.deepEqual(parseVariants([variant({ label_ko: '나'.repeat(41) })]).variants, []);
});

test('candidates are read only for their own kind, and old kinds keep no variants key', () => {
  const hint = parseReply({
    proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: 'selection_hint',
    provider: { model: 'qwen' }, suggestions: [], variants: [variant()],
  });
  // A hint reply that carries candidates would mean two different things on screen,
  // so they are read as absent instead of being shown beside the suggestions.
  assert.deepEqual(hint.variants, []);

  const old = parseReply({
    proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: 'selection_hint',
    provider: { model: 'qwen' }, suggestions: [{ id: 'lighting.neon', matched_phrase: '네온', confidence: 0.9 }],
  });
  assert.deepEqual(old.variants, [], 'an older reply without the key still parses');
  assert.equal(old.suggestions.length, 1);

  // The parser's own cut is reported through the shared `truncated` flag.
  const cut = parseReply({
    proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: VARIANT_KIND,
    provider: { model: 'qwen' },
    variants: [variant(), variant({ variant_id: 'v2' }), variant({ variant_id: 'v3' }), variant({ variant_id: 'v4' })],
  });
  assert.equal(cut.variants.length, 3);
  assert.equal(cut.truncated, true);
});

test('the reply for a variant request is settled like any other, and says nothing was applied', () => {
  const revisions = revisionsFor(withCast());
  const loading = startProposal(IDLE, { requestId: 'req-1', revisions, kind: VARIANT_KIND });
  assert.equal(loading.phase, 'loading');
  assert.equal(loading.kind, VARIANT_KIND);
  const ready = settleProposal(loading, {
    requestId: 'req-1', currentRevisions: revisions,
    outcome: { kind: 'reply', reply: variantReply({ revisions }) },
  });
  assert.equal(ready.phase, 'ready');
  // Candidates are compared, never taken: the notice must not claim an acceptance.
  assert.match(proposalNotice(ready).text, /상황 후보 3개|상황 후보 1개/);
  assert.match(proposalNotice(ready).text, /아직 선택에 반영하지 않았습니다/);

  // A reply of the wrong kind is refused by the same guard as I06.
  const foreign = settleProposal(loading, {
    requestId: 'req-1', currentRevisions: revisions,
    outcome: { kind: 'reply', reply: parseReply({ proposal_id: 'prop-1', request_id: 'req-1',
      status: 'ready', kind: 'partial_change', provider: { model: 'qwen' }, revisions }) },
  });
  assert.equal(foreign.phase, 'error');
});

test('a candidate that would change the cast or a locked value is carded but not usable', () => {
  const summary = build({ variants: [variant({
    changed_ids: ['subject.dog', 'setting.park'], removed_ids: ['location.street'],
  })] }, { scope: { targetGroups: ['setting', 'pose'], lockedIds: ['subject.person'] } });
  const card = summary.cards[0];
  // The person stays on the card: the user is comparing situations, not filters.
  assert.match(variantHeadline(summary), /표시 불가 1/);
  assert.ok(card.blocks.includes('out_of_scope'), 'a subject change is not a situation');
  assert.equal(variantBlockReason('out_of_scope'), '이번 요청의 변경 대상이 아닙니다');
  assert.equal(variantBlockReason('locked'), '이번 요청에서 고정한 값입니다');
  assert.equal(variantBlockReason('not_selected'), '지금 선택에 없는 항목입니다');

  // Nothing to change at all is its own reason, not an empty diff.
  const empty = build({ variants: [variant({ changed_ids: [], removed_ids: [] })] });
  assert.deepEqual(empty.cards[0].blocks, ['no_change']);
  assert.equal(variantBlockReason('no_change'), '바뀌는 항목이 없습니다');

  // A locked id is blocked even when the group is in scope.
  const locked = build({ variants: [variant({ changed_ids: ['setting.park'], removed_ids: [] })] },
    { scope: { targetGroups: ['setting', 'pose'], lockedIds: ['setting.park'] } });
  assert.deepEqual(locked.cards[0].blocks, ['locked']);
});

test('a clean candidate shows its place/action diff in Korean and keeps unknown words verbatim', () => {
  const summary = build({
    variants: [variant({ unresolved_ko: ['우산을 접으며'] })],
  }, { scope: { targetGroups: ['setting', 'pose'], lockedIds: ['subject.person', 'location.street'] } });
  const card = summary.cards[0];
  // `subject.person` is not in the candidate, so nothing about the cast is claimed.
  assert.deepEqual(card.blocks, ['locked'], 'removing a locked value is refused');
  assert.deepEqual(card.changes.map((change) => [change.labelKo, change.direction]),
    [['공원', 'add'], ['걷기', 'add'], ['거리', 'remove'], ['서 있기', 'remove']]);
  assert.deepEqual(card.changes.map((change) => change.group), ['setting', 'pose', 'setting', 'pose']);
  assert.deepEqual(card.unresolvedKo, ['우산을 접으며'], 'an unknown phrase is not translated');
  assert.equal(card.promptKo, '같은 인물이 공원을 걷는다');
  assert.match(variantHeadline(summary), /상황 후보 1개/);
});

test('a variant panel has no acceptance path in the composer', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  const module = readFileSync(fileURLToPath(new URL('../src/prompt/situationVariants.ts', import.meta.url)), 'utf8');
  // VAR01 is display-only: the card module must not expose an accept function, and the
  // composer must not call selectEntry/compileScene from a candidate.
  assert.ok(!/export function (accept|apply)\w*Variant/.test(module));
  assert.ok(!/selectEntry|compileScene/.test(module));
  assert.ok(source.includes('variantCards('));
  assert.ok(!/function accept\w*Variant/.test(source));
});

