import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDLE, MAX_REMAINDER_ITEMS, MAX_TRANSLATION_CHARS, TRANSLATION_KIND,
  parseReply, parseTranslations, proposalBody, proposalNotice, revisionsFor,
  settleProposal, startProposal,
} from '../src/prompt/llmProposals.ts';

// The measured TRANS02 sentence: `금발`/`네온 조명` are covered, these are not.
const TEXT = '비 오는 밤 편의점 앞에서 젖은 바닥에 반사된다';
const PHRASES = ['비 오는 밤', '편의점', '젖은 바닥에 반사된다'];

/** UTF-16 spans, exactly what `extractRemainder` hands to the composer. */
const spansOf = (text, phrases) => phrases.map((phrase) => {
  const start = text.indexOf(phrase);
  return { start, end: start + phrase.length };
});

const scene = (changes = {}) => ({
  schemaVersion: 1, targetFamily: 'sd15', selections: [], freeTextKo: TEXT, ...changes,
});

const build = (over = {}, context = {}) => proposalBody({
  scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1',
  translate: spansOf(TEXT, PHRASES), ...context, ...over,
});

const translationReply = (over = {}) => parseReply({
  proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: TRANSLATION_KIND,
  provider: { model: 'qwen', version: '1', latency_ms: 5, finish_reason: 'stop' },
  suggestions: [], translations: [
    { source_ko: '비 오는 밤', suggested_en: 'a rainy night', confidence: 0.9 },
    { source_ko: '편의점', suggested_en: 'a convenience store', confidence: 0.8 },
  ],
  unresolved_spans: [], ambiguities: [], rejected: [], truncated: false, ...over,
});

test('a translation request names offsets, never the phrase text', () => {
  const built = build();
  assert.ok('body' in built);
  assert.equal(built.body.kind, TRANSLATION_KIND);
  // TRANS01 §3.2: the phrase is already inside `free_text_ko`; only offsets are added.
  assert.deepEqual(built.body.remainder_spans, spansOf(TEXT, PHRASES));
  const encoded = JSON.stringify(built.body);
  for (const phrase of PHRASES) {
    assert.equal(encoded.split(phrase).length - 1, 1, `${phrase} must appear once`);
  }
});

test('a translation request sends no dictionary selections', () => {
  // A translation cannot depend on the vocabulary, and 100 IDs would eat the 8 KiB.
  const built = proposalBody({
    scene: scene({ selections: [{ id: 'subject.person', category: 'subject',
      labelKo: '인물', dictionaryVersion: '1.2.0', mapping: { status: 'mapped', text: 'a person' } }] }),
    family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1',
    translate: spansOf(TEXT, ['편의점']),
  });
  assert.ok('body' in built);
  assert.deepEqual(built.body.selections, []);
  // The revisions still describe the whole scene, so an edit still invalidates it.
  assert.deepEqual(built.body.revisions, revisionsFor(scene({
    selections: [{ id: 'subject.person', category: 'subject',
      labelKo: '인물', dictionaryVersion: '1.2.0', mapping: { status: 'mapped', text: 'a person' } }] })));
});

test('offsets are converted to Python code points before they are sent', () => {
  // `İstanbul 😀 카페`: the emoji is 2 UTF-16 units but 1 code point, so the JS
  // offset for 카페 is one higher than the Python index the server slices with.
  const text = 'İstanbul 😀 카페';
  const plain = text.indexOf('카페');
  const built = proposalBody({
    scene: scene({ freeTextKo: text }), family: 'sd15', dictionaryVersion: '1.2.0',
    requestId: 'req-1', translate: [{ start: plain, end: plain + 2 }],
  });
  assert.ok('body' in built);
  assert.deepEqual(built.body.remainder_spans, [{ start: plain - 1, end: plain + 1 }]);
  // Proof the conversion is necessary: the JS offsets are not the Python ones.
  assert.equal(Array.from(text.slice(0, plain)).length, plain - 1);
});

test('a span that no longer fits the text is refused, not sent', () => {
  // The user edited the text between extraction and the request.
  const stale = spansOf(TEXT, PHRASES).map((span) => ({ start: span.start, end: TEXT.length + 5 }));
  assert.deepEqual(build({}, { translate: [stale[0]] }), { code: 'invalid' });
  // A shorter text makes a formerly valid span point past the end.
  assert.deepEqual(proposalBody({
    scene: scene({ freeTextKo: '비 오는 밤' }), family: 'sd15', dictionaryVersion: '1.2.0',
    requestId: 'req-1', translate: [{ start: 0, end: 40 }],
  }), { code: 'invalid' });
});

test('an empty, oversized, or duplicated span list is refused', () => {
  assert.deepEqual(build({}, { translate: [] }), { code: 'invalid' });
  const many = Array.from({ length: MAX_REMAINDER_ITEMS + 1 }, (_, index) => ({ start: index, end: index + 2 }));
  assert.deepEqual(build({}, { translate: many.slice(0, MAX_REMAINDER_ITEMS + 1) }), { code: 'invalid' });
  // The same phrase twice would make two cards the user cannot tell apart.
  const one = spansOf(TEXT, ['편의점'])[0];
  assert.deepEqual(build({}, { translate: [one, { ...one }] }), { code: 'invalid' });
});

test('a blank span is refused', () => {
  const blank = TEXT.indexOf(' ');
  assert.deepEqual(build({}, { translate: [{ start: blank, end: blank + 1 }] }), { code: 'invalid' });
});

test('a translation request cannot double as a variant request', () => {
  assert.deepEqual(build({}, { variant: true }), { code: 'invalid' });
});

test('the two older kinds keep their exact shape', () => {
  const plain = proposalBody({ scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0', requestId: 'req-1' });
  assert.ok('body' in plain);
  assert.equal(plain.body.kind, 'selection_hint');
  assert.equal('remainder_spans' in plain.body, false);

  const partial = proposalBody({ scene: scene(), family: 'sd15', dictionaryVersion: '1.2.0',
    requestId: 'req-1', scope: { targetGroups: ['lighting'], lockedIds: [] } });
  assert.ok('body' in partial);
  assert.equal(partial.body.kind, 'partial_change');
  assert.equal('remainder_spans' in partial.body, false);
});

test('a translation reply yields pairs and no suggestions', () => {
  const reply = translationReply();
  assert.deepEqual(reply.translations.map((item) => item.source_ko), ['비 오는 밤', '편의점']);
  assert.deepEqual(reply.translations.map((item) => item.suggested_en),
    ['a rainy night', 'a convenience store']);
  // TRANS03/TRANS04: a translation is never a selection suggestion.
  assert.deepEqual(reply.suggestions, []);
  assert.deepEqual(reply.variants, []);
});

test('a translation pair is dropped rather than repaired', () => {
  const parsed = parseTranslations([
    { source_ko: '편의점', suggested_en: 'a convenience store', confidence: 0.9 },
    { source_ko: '편의점', suggested_en: 'a corner shop' },          // duplicate phrase
    { source_ko: '', suggested_en: 'nothing' },                      // no Korean
    { source_ko: '비 오는 밤' },                                      // no English
    { source_ko: '한'.repeat(MAX_TRANSLATION_CHARS + 1), suggested_en: 'too long' },
    null,
  ]);
  assert.deepEqual(parsed.translations.map((item) => item.suggested_en), ['a convenience store']);
  // Every drop is reported, so the banner is not silent.
  assert.equal(parsed.truncated, true);
});

test('the translation list is cut to the shared cap', () => {
  const items = Array.from({ length: MAX_REMAINDER_ITEMS + 2 }, (_, index) => ({
    source_ko: `구절${index}`, suggested_en: `phrase ${index}`, confidence: 0.5,
  }));
  const parsed = parseTranslations(items);
  assert.equal(parsed.translations.length, MAX_REMAINDER_ITEMS);
  assert.equal(parsed.truncated, true);
});

test('an out-of-range confidence is clamped, never rendered as a raw number', () => {
  const parsed = parseTranslations([
    { source_ko: '편의점', suggested_en: 'a convenience store', confidence: 4 },
    { source_ko: '비 오는 밤', suggested_en: 'a rainy night', confidence: 'high' },
  ]);
  assert.deepEqual(parsed.translations.map((item) => item.confidence), [1, 0]);
});

test('translations from another kind are ignored, not shown as cards', () => {
  // A `selection_hint` reply that carried `translations` would mean something else
  // on screen, so it is read as no translations at all (same rule as `variants`).
  const reply = parseReply({
    proposal_id: 'prop-1', request_id: 'req-1', status: 'ready', kind: 'selection_hint',
    suggestions: [], translations: [{ source_ko: '편의점', suggested_en: 'a store' }],
    unresolved_spans: [], ambiguities: [], rejected: [], truncated: false,
  });
  assert.deepEqual(reply.translations, []);
});

test('a translation reply says how many cards arrived and that none were applied', () => {
  const state = settleProposal(
    startProposal(IDLE, { requestId: 'req-1', revisions: revisionsFor(scene()), kind: TRANSLATION_KIND }),
    { requestId: 'req-1', outcome: { kind: 'reply', reply: translationReply() },
      currentRevisions: revisionsFor(scene()) },
  );
  assert.equal(state.phase, 'ready');
  assert.equal(state.kind, TRANSLATION_KIND);
  const notice = proposalNotice(state);
  assert.match(notice.text, /번역 제안 2개/);
  // The wording must not say the cards went into the selection.
  assert.match(notice.text, /최종 프롬프트에 넣지 않았습니다/);
});

test('an empty translation reply has its own sentence', () => {
  const state = settleProposal(
    startProposal(IDLE, { requestId: 'req-1', revisions: revisionsFor(scene()), kind: TRANSLATION_KIND }),
    { requestId: 'req-1',
      outcome: { kind: 'reply', reply: translationReply({ status: 'empty', translations: [] }) },
      currentRevisions: revisionsFor(scene()) },
  );
  assert.equal(state.phase, 'empty');
  const notice = proposalNotice(state);
  assert.match(notice.text, /번역 제안을 만들지 못했습니다/);
  assert.match(notice.text, /원문은 그대로 남습니다/);
});

test('a reply to edited text is still discarded for translations', () => {
  // The revisions guard is kind-independent: a translation of stale text must not land.
  const state = settleProposal(
    startProposal(IDLE, { requestId: 'req-1', revisions: revisionsFor(scene()), kind: TRANSLATION_KIND }),
    { requestId: 'req-1', outcome: { kind: 'reply', reply: translationReply() },
      currentRevisions: revisionsFor(scene({ freeTextKo: `${TEXT} 그리고` })) },
  );
  assert.equal(state.phase, 'cancelled');
  assert.equal(state.reason, 'stale_revision');
  assert.match(proposalNotice(state).text, /원문과 최종 프롬프트는 그대로입니다/);
});
