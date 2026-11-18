import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/prompt/digest.ts';
import {
  CANCELLED_MESSAGES, ERROR_MESSAGES, IDLE, MAX_REQUEST_BYTES, cancelProposal,
  invalidateProposal, isPending, newRequestId, parseReply, proposalBody, proposalNotice,
  revisionsFor, runProposal, sameRevisions, settleProposal, startProposal, utf8Bytes,
} from '../src/prompt/llmProposals.ts';
import {
  DEFAULT_TIMEOUT_MS, TIMEOUT_SLACK_MS, UNSUPPORTED, proposalActionLabel,
  proposalFallbackNotice, readProposalCapability,
} from '../src/prompt/proposalCapability.ts';

const scene = (changes = {}) => ({
  schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: '네온 아래 사람', ...changes,
});

const selection = (id, category = 'subject') => ({
  id, category, labelKo: '인물', dictionaryVersion: '1.2.0', mapping: { status: 'mapped', text: 'a person' },
});

const reply = (over = {}) => ({
  proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: 'selection_hint',
  provider: { model: 'qwen', version: '1', latency_ms: 5, finish_reason: 'stop' },
  suggestions: [{ id: 'lighting.neon', matched_phrase: '네온', basis: 'quote', polarity: 'affirmed',
    actor: null, confidence: 0.9, reason_ko: '' }],
  unresolved_spans: [], ambiguities: [], rejected: [], truncated: false, ...over,
});

/** A controllable send: each call exposes its resolve/reject and its signal. */
function sender() {
  const calls = [];
  const send = (body, signal) => new Promise((resolve, reject) => {
    calls.push({ body, signal, resolve, reject });
  });
  return { send, calls };
}

const settle = (state, currentRevisions, over = {}) => settleProposal(state, {
  requestId: state.phase === 'loading' ? state.requestId : 'none',
  outcome: { kind: 'reply', reply: parseReply(reply(over)) },
  currentRevisions,
});

test('the revision fingerprint uses sha256 and changes with text, family and selection', () => {
  const base = revisionsFor(scene());
  assert.match(base.scene, /^sha256:[0-9a-f]{64}$/);
  assert.match(base.text, /^sha256:[0-9a-f]{64}$/);
  // The digest must be the real thing: the server echoes it and the client compares.
  assert.equal(base.text, `sha256:${createHash('sha256').update('네온 아래 사람', 'utf8').digest('hex')}`);
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const text = revisionsFor(scene({ freeTextKo: '네온 아래 사람 ' }));
  assert.notEqual(text.text, base.text);
  assert.notEqual(text.scene, base.scene);
  assert.equal(text.selection, base.selection, 'text must not move the selection fingerprint');

  const family = revisionsFor(scene({ targetFamily: 'flux2' }));
  assert.ok(!sameRevisions(family, base));

  const selected = revisionsFor(scene({ selections: [selection('subject.person')] }));
  assert.notEqual(selected.selection, base.selection);
  assert.notEqual(selected.scene, base.scene);

  // Order is visible in the UI, so a reorder is a different state.
  const forward = revisionsFor(scene({ selections: [selection('a'), selection('b')] }));
  const reversed = revisionsFor(scene({ selections: [selection('b'), selection('a')] }));
  assert.notEqual(forward.selection, reversed.selection);
});

test('the request body follows the C01-2 shape and is refused locally when invalid', () => {
  const ok = proposalBody({ scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-abc' });
  assert.ok('body' in ok);
  assert.deepEqual(ok.body, {
    kind: 'selection_hint', request_id: 'req-abc', target_family: 'sd15',
    dictionary_version: '1.2.0', free_text_ko: '네온 아래 사람', selections: [],
    revisions: revisionsFor(scene()),
  });
  // The original text is sent verbatim; nothing is trimmed or normalized.
  const spaced = proposalBody({ scene: scene({ freeTextKo: '  네온\n아래 사람  ' }), family: 'sd15',
    dictionaryVersion: '1.2.0', requestId: 'req-abc' });
  assert.equal(spaced.body.free_text_ko, '  네온\n아래 사람  ');

  const noText = proposalBody({ scene: scene({ freeTextKo: '   ' }), family: 'sd15',
    dictionaryVersion: '1.2.0', requestId: 'req-abc' });
  assert.deepEqual(noText, { code: 'invalid' });
  const noFamily = proposalBody({ scene: scene(), family: '', dictionaryVersion: '1.2.0', requestId: 'r' });
  assert.deepEqual(noFamily, { code: 'invalid' });
  const long = proposalBody({ scene: scene({ freeTextKo: 'a'.repeat(4001) }), family: 'sd15',
    dictionaryVersion: '1.2.0', requestId: 'req-abc' });
  assert.deepEqual(long, { code: 'too_large' });
});

test('the request body is refused by its real UTF-8 byte size, not its character count', () => {
  // LLM-R04: Korean is 3 bytes per character, so a 2,600-character description is over
  // 7.8 KB before any selection is added. The old check counted characters only.
  const korean = (count) => '가'.repeat(count);
  const body = (text) => proposalBody({
    scene: scene({ freeTextKo: text }), family: 'sd15',
    dictionaryVersion: '1.2.0', requestId: 'req-abc',
  });

  // A long Korean text is far past 8 KiB while still under the 4,000-character cap.
  assert.deepEqual(body(korean(4000)), { code: 'too_large' });
  assert.equal(utf8Bytes(korean(4000)), 12000);

  // ASCII is one byte per character, so it is refused only near the cap.
  assert.ok('body' in body('a'.repeat(4000)));
  assert.deepEqual(body('a'.repeat(9000)), { code: 'too_large' });
});

test('a legal but crowded body is refused locally instead of coming back as a 413', () => {
  // LLM-R04: 60 selections plus 60 locked IDs consume most of the 8 KiB budget, so the
  // body can exceed the cap before the description is long. This is the case that used
  // to pass every local check and get a 413 from the server.
  const crowd = (lockCount, textLength) => ({
    scene: scene({
      freeTextKo: '가'.repeat(textLength),
      selections: Array.from({ length: lockCount }, (_, index) => selection(`subject.entry${index}`)),
    }),
    family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-abc',
    scope: { targetGroups: ['subject'], lockedIds: Array.from({ length: lockCount }, (_, index) => `subject.entry${index}`) },
  });

  // Comfortably inside: forwarded, and its bytes are known to be under the cap.
  const small = proposalBody(crowd(5, 100));
  assert.ok('body' in small);
  assert.ok(utf8Bytes(JSON.stringify(small.body)) <= MAX_REQUEST_BYTES);

  // Too crowded: refused locally with the same `too_large` wording as the other caps.
  const big = proposalBody(crowd(60, 1500));
  assert.deepEqual(big, { code: 'too_large' });
});

test('request IDs satisfy the server grammar and stay unique enough to separate two requests', () => {
  const first = newRequestId();
  const second = newRequestId();
  assert.match(first, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(first, second);
  // Deterministic alphabet: a fixed random source produces a legal, repeatable id.
  assert.equal(newRequestId(() => 0), `req-${'a'.repeat(24)}`);
  assert.equal(newRequestId(() => 0.9999), `req-${'9'.repeat(24)}`);
});
test('a second request replaces the first, so the first reply is dropped when it lands late', () => {
  const revisions = revisionsFor(scene());
  const first = startProposal(IDLE, { requestId: 'req-first', revisions });
  const second = startProposal(first, { requestId: 'req-second', revisions });
  assert.equal(second.phase, 'loading');
  assert.equal(isPending(second), true);

  // Reversed arrival: the newer answer arrives first, then the older one.
  const afterNew = settle(second, revisions, { request_id: 'req-second' });
  assert.equal(afterNew.phase, 'ready');
  const answer = { kind: 'reply', reply: parseReply(reply({ request_id: 'req-first' })) };
  const afterOld = settleProposal(afterNew, { requestId: 'req-first', outcome: answer, currentRevisions: revisions });
  assert.equal(afterOld, afterNew, 'a finished state must not be replaced by an older reply');

  // The old reply arriving while the new request is still loading is dropped too.
  const dropped = settleProposal(second, { requestId: 'req-first', outcome: answer, currentRevisions: revisions });
  assert.equal(dropped, second);
  assert.equal(dropped.phase, 'loading');
  // A request id that was never started cannot settle anything.
  assert.equal(settleProposal(second, { requestId: 'req-other', outcome: answer, currentRevisions: revisions }), second);
});

test('editing the text or switching the model while loading discards the answer', () => {
  const sent = revisionsFor(scene());
  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: sent });

  // The user typed one more character after the request left.
  const edited = revisionsFor(scene({ freeTextKo: '네온 아래 사람.' }));
  const stale = settleProposal(loading, {
    requestId: 'req-1', currentRevisions: edited,
    outcome: { kind: 'reply', reply: parseReply(reply({ request_id: 'req-1', revisions: sent })) },
  });
  assert.deepEqual(stale, { phase: 'cancelled', reason: 'stale_revision' });
  assert.equal(proposalNotice(stale).text, CANCELLED_MESSAGES.stale_revision);

  // A model switch is also a state change, and it revokes the pending request.
  const switched = revisionsFor(scene({ targetFamily: 'flux2' }));
  const loading2 = startProposal(IDLE, { requestId: 'req-2', revisions: sent });
  assert.deepEqual(invalidateProposal(loading2, switched), { phase: 'cancelled', reason: 'stale_revision' });
  assert.equal(invalidateProposal(loading2, sent), loading2, 'an unchanged state keeps the request');
  assert.equal(invalidateProposal({ phase: 'ready', reply: parseReply(reply()), revisions: sent }, switched).phase,
    'cancelled');
});

test('a reply for another request or another revision is rejected instead of shown', () => {
  const sent = revisionsFor(scene());
  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: sent });

  const foreign = settleProposal(loading, {
    requestId: 'req-1', currentRevisions: sent,
    outcome: { kind: 'reply', reply: parseReply(reply({ request_id: 'req-other' })) },
  });
  assert.deepEqual(foreign, { phase: 'error', message: ERROR_MESSAGES.mismatched });

  const otherRevisions = revisionsFor(scene({ freeTextKo: '다른 문장' }));
  const mismatched = settleProposal(loading, {
    requestId: 'req-1', currentRevisions: sent,
    outcome: { kind: 'reply', reply: parseReply(reply({ request_id: 'req-1', revisions: otherRevisions })) },
  });
  assert.deepEqual(mismatched, { phase: 'error', message: ERROR_MESSAGES.mismatched });

  // The success path echoes exactly what was sent.
  const ready = settle(loading, sent, { request_id: 'req-1', revisions: sent });
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.reply.suggestions.length, 1);
});

test('200 failures become their own state, not an error the user must retry', () => {
  const sent = revisionsFor(scene());
  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: sent });
  const empty = settle(loading, sent, { status: 'empty', suggestions: [], request_id: 'req-1', revisions: sent });
  assert.equal(empty.phase, 'empty');
  assert.equal(proposalNotice(empty).tone, 'info');

  const unavailable = settle(loading, sent, {
    status: 'unavailable', suggestions: [], why: 'gpu_unavailable',
    message: '지금은 LLM을 사용할 수 없습니다', request_id: 'req-1', revisions: sent,
  });
  assert.equal(unavailable.phase, 'unavailable');
  assert.equal(proposalNotice(unavailable).tone, 'caution');
  assert.match(proposalNotice(unavailable).text, /지금은 LLM을 사용할 수 없습니다/);

  // A server-authored message is used as-is; the client never invents wording.
  const bare = settle(loading, sent, { status: 'unavailable', suggestions: [], message: null,
    request_id: 'req-1', revisions: sent });
  assert.equal(bare.phase, 'unavailable');
  assert.match(proposalNotice(bare).text, /AI 제안을 지금 사용할 수 없습니다/);
});

test('a timeout is reported as a timeout and never as a cancel', async () => {
  const built = proposalBody({ scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1' });
  const outcome = await runProposal({
    body: built.body, timeoutMs: 5,
    send: (_body, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  assert.deepEqual(outcome, { kind: 'error', code: 'timeout' });

  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: built.body.revisions });
  const settled = settleProposal(loading, { requestId: 'req-1', outcome,
    currentRevisions: built.body.revisions });
  assert.deepEqual(settled, { phase: 'error', message: ERROR_MESSAGES.timeout });
  assert.match(settled.message, /초과/);
  assert.equal(proposalNotice(settled).tone, 'error');
});

test('an explicit cancel ends the request with the cancel wording, not an error', async () => {
  const built = proposalBody({ scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1' });
  const controller = new AbortController();
  const pending = runProposal({
    body: built.body, signal: controller.signal,
    send: (_body, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  controller.abort();
  assert.deepEqual(await pending, { kind: 'cancelled', reason: 'user' });

  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: built.body.revisions });
  assert.deepEqual(cancelProposal(loading), { phase: 'cancelled', reason: 'user' });
  // Cancelling an already-finished state changes nothing.
  assert.equal(cancelProposal({ phase: 'ready', reply: parseReply(reply()),
    revisions: built.body.revisions }).phase, 'ready');
  // An already-aborted signal never reaches the transport at all.
  const neverCalled = await runProposal({
    body: built.body, signal: controller.signal,
    send: () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(neverCalled, { kind: 'cancelled', reason: 'user' });
});

test('transport failures are separated so each one gets its own sentence', async () => {
  const built = proposalBody({ scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1' });
  const fail = (status) => () => { throw Object.assign(new Error('http'), { status }); };
  const codes = await Promise.all([401, 413, 422, 500].map(async (status) =>
    (await runProposal({ body: built.body, send: fail(status) })).code));
  assert.deepEqual(codes, ['unauthorized', 'too_large', 'invalid', 'network']);

  const offline = await runProposal({ body: built.body, send: () => Promise.reject(new TypeError('offline')) });
  assert.deepEqual(offline, { kind: 'error', code: 'network' });
  // A malformed 200 body is a protocol problem, not a network one.
  const malformed = await runProposal({ body: built.body, send: () => Promise.resolve({ foo: 'bar' }) });
  assert.deepEqual(malformed, { kind: 'error', code: 'malformed' });

  for (const code of ['unauthorized', 'too_large', 'invalid', 'network', 'malformed']) {
    assert.ok(ERROR_MESSAGES[code].length > 0 && !/undefined/.test(ERROR_MESSAGES[code]));
  }
});

test('a reply without a v1 status is never adopted', () => {
  assert.equal(parseReply(null), null);
  assert.equal(parseReply('ready'), null);
  assert.equal(parseReply({ status: 'done' }), null);
  const parsed = parseReply(reply({ status: 'empty', suggestions: [{ nope: true }] }));
  assert.equal(parsed.status, 'empty');
  assert.deepEqual(parsed.suggestions, [], 'an item without an id is not a suggestion');
  assert.equal(parseReply(reply()).provider.model, 'qwen');
  assert.equal(parseReply({ status: 'unsupported_v1' }).status, 'unsupported_v1');
});




test('the capability gate keeps the rule-based fallback and never fakes AI support', () => {
  const missing = readProposalCapability(undefined, '1.2.0');
  assert.deepEqual(missing, UNSUPPORTED);
  assert.equal(proposalActionLabel(missing), '사전 항목 제안');
  assert.match(proposalFallbackNotice(missing), /AI 제안을 사용할 수 없습니다/);

  const older = readProposalCapability({ schema_versions: [2], dictionary_version: '1.2.0' }, '1.2.0');
  assert.equal(older.support, 'unsupported_schema');
  assert.equal(older.supported, false);
  assert.match(proposalFallbackNotice(older), /형식이 화면과 다릅니다/);

  const stale = readProposalCapability({ schema_versions: [1], dictionary_version: '1.1.0' }, '1.2.0');
  assert.equal(stale.support, 'stale_dictionary');
  assert.equal(stale.dictionaryVersion, '1.1.0');
  // Calling anyway would earn a `stale_dictionary` failure the user cannot act on.
  assert.match(proposalFallbackNotice(stale), /새로고침/);

  const ok = readProposalCapability({ schema_versions: [1], dictionary_version: '1.2.0', timeout_ms: 20000,
    max_response_bytes: 16384 }, '1.2.0');
  assert.equal(ok.supported, true);
  assert.equal(proposalActionLabel(ok), '장면 정리하기');
  assert.equal(proposalFallbackNotice(ok), null);
  // The browser waits past the server's own budget so the server's timeout wins.
  assert.equal(ok.timeoutMs, 20000 + TIMEOUT_SLACK_MS);
  assert.equal(readProposalCapability({ schema_versions: [1], dictionary_version: '1.2.0' }, '1.2.0').timeoutMs,
    DEFAULT_TIMEOUT_MS + TIMEOUT_SLACK_MS);
  // An implausible advertised timeout is not trusted as a client budget.
  assert.equal(readProposalCapability({ schema_versions: [1], dictionary_version: '1.2.0', timeout_ms: 999999 },
    '1.2.0').timeoutMs, DEFAULT_TIMEOUT_MS + TIMEOUT_SLACK_MS);
});

test('no outcome changes the original text, the selections or the final prompt', async () => {
  // The module is pure, so the strongest statement is that a frozen scene and a
  // frozen prompt survive a full request cycle untouched.
  const original = Object.freeze(scene({ selections: Object.freeze([Object.freeze(selection('subject.person'))]) }));
  const finalPrompt = 'neon lighting, a person';
  const built = proposalBody({ scene: original, family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1' });
  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: built.body.revisions });

  const outcomes = [
    await runProposal({ body: built.body, send: () => Promise.resolve(
      reply({ request_id: 'req-1', revisions: built.body.revisions })) }),
    await runProposal({ body: built.body, send: () => { throw Object.assign(new Error('x'), { status: 401 }); } }),
    await runProposal({ body: built.body, timeoutMs: 1, send: (_body, signal) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new Error('aborted')));
    }) }),
  ];
  const phases = [];
  for (const outcome of outcomes) {
    const next = settleProposal(loading, { requestId: 'req-1', outcome, currentRevisions: built.body.revisions });
    phases.push(next.phase);
  }
  assert.deepEqual(phases, ['ready', 'error', 'error']);
  assert.deepEqual(original, scene({ selections: [selection('subject.person')] }));
  assert.equal(original.freeTextKo, '네온 아래 사람');
  assert.equal(original.targetFamily, 'sd15');
  assert.equal(finalPrompt, 'neon lighting, a person');
});


test('two requests in flight: only the newest answer reaches the screen, in either arrival order', async () => {
  const { send, calls } = sender();
  const revisions = revisionsFor(scene());
  const body = (requestId) => proposalBody({ scene: scene(), family: 'sd15',
    dictionaryVersion: '1.2.0', requestId }).body;

  let state = startProposal(IDLE, { requestId: 'req-old', revisions });
  const older = runProposal({ body: body('req-old'), send });
  state = startProposal(state, { requestId: 'req-new', revisions });
  const newer = runProposal({ body: body('req-new'), send });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.request_id, 'req-old');
  assert.equal(calls[1].body.request_id, 'req-new');

  // Reverse order: the newer request answers first, the older one afterwards.
  calls[1].resolve(reply({ request_id: 'req-new', status: 'empty', suggestions: [] }));
  const firstSettled = settleProposal(state, { requestId: 'req-new', outcome: await newer,
    currentRevisions: revisions });
  assert.equal(firstSettled.phase, 'empty');

  calls[0].resolve(reply({ request_id: 'req-old' }));
  const late = settleProposal(firstSettled, { requestId: 'req-old', outcome: await older,
    currentRevisions: revisions });
  assert.equal(late, firstSettled, 'the late older answer must not replace the newer one');
  assert.equal(late.phase, 'empty');
});

test('a reply that loses the race because the user edited is reported as stale, not as an error', async () => {
  const { send, calls } = sender();
  const body = proposalBody({ scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0',
    requestId: 'req-1' }).body;
  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: body.revisions });
  const pending = runProposal({ body, send });
  calls[0].resolve(reply({ request_id: 'req-1', revisions: body.revisions }));

  // Between send and settle the user replaced the model family.
  const switched = revisionsFor(scene({ targetFamily: 'flux2' }));
  const settled = settleProposal(invalidateProposal(loading, switched), {
    requestId: 'req-1', outcome: await pending, currentRevisions: switched,
  });
  assert.deepEqual(settled, { phase: 'cancelled', reason: 'stale_revision' });
  assert.match(proposalNotice(settled).text, /원문이나 선택이 바뀌어/);
});

test('a suggestion computed for an older text is withdrawn, a past failure is not', () => {
  const sent = revisionsFor(scene());
  const loading = startProposal(IDLE, { requestId: 'req-1', revisions: sent });
  const ready = settle(loading, sent, { request_id: 'req-1', revisions: sent });
  assert.equal(ready.phase, 'ready');
  // The result remembers what it describes, so LLM-I05 cards cannot be shown for a
  // state the user has already left.
  assert.deepEqual(ready.revisions, sent);

  const edited = revisionsFor(scene({ freeTextKo: '네온 아래 사람입니다' }));
  assert.deepEqual(invalidateProposal(ready, edited), { phase: 'cancelled', reason: 'stale_revision' });
  assert.equal(invalidateProposal(ready, sent), ready);

  // A past failure is a status line about a moment, so typing must not rewrite it.
  const failed = { phase: 'error', message: ERROR_MESSAGES.timeout };
  assert.equal(invalidateProposal(failed, edited), failed);
  const unavailable = settle(loading, sent, { status: 'unavailable', suggestions: [],
    message: '지금은 LLM을 사용할 수 없습니다', request_id: 'req-1', revisions: sent });
  assert.equal(invalidateProposal(unavailable, edited), unavailable);
  assert.match(proposalNotice(unavailable).text, /지금은 LLM을 사용할 수 없습니다/);
});

test('the composer asks for a proposal only from the AI action, and never while typing', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/PromptBuilder.tsx', import.meta.url)), 'utf8');
  // Exactly one call site: the explicit "장면 정리하기" button. No effect and no
  // onChange path may fire it, which is the "no auto-call while typing" rule.
  const calls = source.match(/void requestProposal\(\)/g) ?? [];
  assert.equal(calls.length, 1);
  assert.ok(source.includes('onClick={() => void requestProposal()}'));
  assert.ok(!/useEffect\([\s\S]{0,400}?requestProposal/.test(source));
  assert.ok(!/function setFreeText[\s\S]{0,300}?requestProposal/.test(source));

  // The AI control is gated on the capability, and its label is the capability's.
  assert.ok(source.includes('{aiEnabled\n'));
  assert.ok(source.includes('proposalActionLabel(capability)'));
  assert.ok(source.includes('proposalFallbackNotice(capability)'));
  // The request carries the derived timeout, not a constant the component invented.
  assert.ok(source.includes('timeoutMs: capability.timeoutMs'));
  // The status line is contract text, so it is not folded into a HelpNote.
  for (const line of source.split('\n')) {
    if (!/proposalStatus/.test(line)) continue;
    assert.ok(!/<HelpNote/.test(line), `proposal status must stay visible: ${line.trim()}`);
  }
  assert.ok(source.includes('role="status"'));
});

test('the capability is read from the server payload, not assumed from a build flag', () => {
  const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
  const api = readFileSync(fileURLToPath(new URL('../src/api.ts', import.meta.url)), 'utf8');
  // Absent capability is the default, so a failed or older server never shows AI.
  assert.ok(app.includes('useState<ProposalCapability>(UNSUPPORTED)'));
  assert.ok(app.includes('readProposalCapability(data.prompt_proposals, DICTIONARY_VERSION)'));
  assert.ok(app.includes('setProposalCapability(UNSUPPORTED)'));
  // The transport is wired only when the capability says so.
  assert.ok(app.includes('proposalCapability.supported ? (body, signal) => api.proposals(body, signal) : undefined'));
  // The endpoint path and its 200-on-failure nature are documented at the client.
  assert.ok(api.includes('"/prompt/proposals"'));
  assert.ok(api.includes('prompt_proposals?:'));
});

