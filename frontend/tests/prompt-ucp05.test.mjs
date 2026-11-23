import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARY, DICTIONARY_VERSION } from '../src/prompt/dictionary.ts';
import {
  EMPTY_EDIT, EMPTY_SCENE, MAX_BRIEF_CHARS, MAX_CHOICES,
  addManual, setPinned,
} from '../src/prompt/structuredScene.ts';
import {
  COMPOSE_SCHEMA_VERSION, COMPOSE_UNSUPPORTED, DEFAULT_COMPOSE_TIMEOUT_MS,
  composeFallbackNotice, readComposeCapability,
} from '../src/prompt/composeCapability.ts';
import {
  REDUCING_CODES, failureAlert, isKnownDetail, warningAlert, warningAlerts,
} from '../src/prompt/composeAlerts.ts';
import {
  APPLY_BLOCK_COPY, appliedNegative, applyDiff, needsOverwriteConfirm, planApply,
} from '../src/prompt/composeApply.ts';
import { chipList, chipView, entityLabels } from '../src/prompt/composeChips.ts';
import {
  buildComposeBody, failureFromBody, parseComposeReply, wireSelection,
} from '../src/prompt/composeRequest.ts';
import {
  IDLE_COMPOSE, applyCandidate, composeRevisions, invalidateForTarget, settleComposition,
  startComposition,
} from '../src/prompt/composeSession.ts';

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

const BRIEF_EDIT = edit({ briefKo: '비 오는 거리' });
const REVISIONS = composeRevisions(BRIEF_EDIT, TARGET);

const result = (over = {}) => ({
  resultId: 'cmp-aaaaaaaaaaaa', requestId: REQUEST_ID,
  revisions: REVISIONS, summaryKo: '요약', scene: structuredClone(EMPTY_SCENE),
  selections: [], candidates: [candidate('c1')], questions: [], warnings: [],
  snapshotTrim: [], providerModel: 'qwen3-test',
  tokens: { promptTokens: 10, reasoningTokens: 0, outputTokens: 40, truncated: false },
  ...over,
});

/** A session driven to `ready` by one accepted reply. */
function readySession(editValue = BRIEF_EDIT, over = {}) {
  const started = startComposition(IDLE_COMPOSE(editValue), { requestId: REQUEST_ID, target: TARGET });
  return settleComposition(started, {
    outcome: { kind: 'reply', result: result({ revisions: started.revisions, ...over }) },
    currentRevisions: started.revisions,
    currentTarget: TARGET,
  });
}

/** A session that ends in `needs_clarification`. */
function clarifyingSession() {
  return readySession(BRIEF_EDIT, {
    candidates: [],
    questions: [{ questionId: 'q1', questionKo: '인물은 몇 명인가요?', why: 'actor_unknown',
      options: [{ optionId: 'o1', labelKo: '한 명' }] }],
  });
}


/** The wire reply the compose route sends for a successful request. */
const ready = { status: 'ready', result_id: 'res-1', request_id: REQUEST_ID,
  summary_ko: '요약', scene: { entities: [], relations: [], environment: {},
    unmapped_details: [], ambiguities: [] },
  candidates: [{ candidate_id: 'c1', title_ko: '제목', difference_ko: '차이',
    positive_prompt: 'a prompt' }], clarifications: [], warnings: [], snapshot_trim: [] };

/* ------------------------------------------------------------------ capability */

test('compose support is read from prompt_compose alone and never inferred', () => {
  // The gate is the `prompt_compose` block. A server that advertises proposals only must
  // not be treated as compose-capable, which is why the block is the whole input.
  assert.deepEqual(readComposeCapability(null, DICTIONARY_VERSION, 'flux2'), COMPOSE_UNSUPPORTED);
  assert.equal(readComposeCapability(undefined, DICTIONARY_VERSION, 'flux2').supported, false);
  assert.equal(readComposeCapability({}, DICTIONARY_VERSION, 'flux2').support, 'unsupported_schema');
});

test('a schema the client does not speak is refused instead of guessed at', () => {
  const older = readComposeCapability({ schema_versions: [0], dictionary_version: DICTIONARY_VERSION,
    output_profile_versions: { flux2: 1 } }, DICTIONARY_VERSION, 'flux2');
  assert.equal(older.support, 'unsupported_schema');
  assert.equal(older.supported, false);
  // A later schema is also refused: v2 may add fields whose absence would change meaning.
  const newer = readComposeCapability({ schema_versions: [2], dictionary_version: DICTIONARY_VERSION,
    output_profile_versions: { flux2: 1 } }, DICTIONARY_VERSION, 'flux2');
  assert.equal(newer.support, 'unsupported_schema');
});

test('a dictionary mismatch blocks composition but keeps the profile it read', () => {
  const stale = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
    dictionary_version: '0.9.0', output_profile_versions: { flux2: 7 } },
    DICTIONARY_VERSION, 'flux2');
  assert.equal(stale.support, 'stale_dictionary');
  assert.equal(stale.supported, false);
  assert.equal(stale.dictionaryVersion, '0.9.0');
  assert.equal(stale.profileVersion, 7);
  // A missing version is a mismatch, not a wildcard.
  const missing = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
    output_profile_versions: { flux2: 7 } }, DICTIONARY_VERSION, 'flux2');
  assert.equal(missing.support, 'stale_dictionary');
  assert.equal(missing.dictionaryVersion, null);
});

test('a family without an output profile is refused by name, not by omission', () => {
  const unknown = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
    dictionary_version: DICTIONARY_VERSION, output_profile_versions: { sd15: 1 } },
    DICTIONARY_VERSION, 'flux2');
  assert.equal(unknown.support, 'unknown_family');
  assert.equal(unknown.profileVersion, null);
  // A profile version must be a positive integer; these are not versions.
  for (const bad of [0, -1, '1', 1.5, null]) {
    const read = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
      dictionary_version: DICTIONARY_VERSION, output_profile_versions: { flux2: bad } },
      DICTIONARY_VERSION, 'flux2');
    assert.equal(read.support, 'unknown_family', `profile ${String(bad)} must be refused`);
  }
});

test('the abort budget is the advertised timeout plus slack, clamped to the default', () => {
  const supported = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
    dictionary_version: DICTIONARY_VERSION, output_profile_versions: { flux2: 1 },
    timeout_ms: 60_000 }, DICTIONARY_VERSION, 'flux2');
  assert.equal(supported.supported, true);
  assert.equal(supported.timeoutMs, 65_000);
  // Nonsense or out-of-range budgets fall back rather than aborting a healthy request.
  for (const bad of [999, 120_001, '60000', null, 0]) {
    const read = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
      dictionary_version: DICTIONARY_VERSION, output_profile_versions: { flux2: 1 },
      timeout_ms: bad }, DICTIONARY_VERSION, 'flux2');
    assert.equal(read.timeoutMs, DEFAULT_COMPOSE_TIMEOUT_MS, `timeout ${String(bad)}`);
  }
});

test('candidate count is clamped to the advertised maximum', () => {
  const read = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
    dictionary_version: DICTIONARY_VERSION, output_profile_versions: { flux2: 1 },
    max_candidates: 2 }, DICTIONARY_VERSION, 'flux2');
  assert.equal(read.maxCandidates, 2);
  const bad = readComposeCapability({ schema_versions: [COMPOSE_SCHEMA_VERSION],
    dictionary_version: DICTIONARY_VERSION, output_profile_versions: { flux2: 1 },
    max_candidates: 0 }, DICTIONARY_VERSION, 'flux2');
  assert.equal(bad.maxCandidates, 3);
});

test('every unsupported state explains what the user can still do', () => {
  // A dead panel is not an acceptable answer: each state names the fallback path.
  for (const support of ['absent', 'unsupported_schema', 'stale_dictionary', 'unknown_family']) {
    const notice = composeFallbackNotice({ ...COMPOSE_UNSUPPORTED, support });
    assert.ok(notice && notice.length > 10, `${support} needs a notice`);
    assert.match(notice, /사전|새로고침/);
  }
  assert.equal(composeFallbackNotice({ ...COMPOSE_UNSUPPORTED, support: 'supported' }), null);
});

/* ------------------------------------------------------------- request building */

const build = (over = {}) => buildComposeBody({ edit: BRIEF_EDIT, target: TARGET,
  requestId: REQUEST_ID, candidateCount: 3, ...over });

test('an excluded chip is sent as a veto and nothing else', () => {
  // The server rejects an `excluded` row that also carries `pinned`/`entity_id`
  // (`check_source`), so the veto shape is normalised here and nowhere else.
  assert.deepEqual(wireSelection(chip('lighting.neon', 'excluded', { pinned: true, entityId: 'e1' })),
    { id: 'lighting.neon', source: 'excluded' });
  assert.deepEqual(wireSelection(chip('lighting.neon', 'auto', { pinned: true, entityId: 'e1' })),
    { id: 'lighting.neon', source: 'auto', pinned: true, entity_id: 'e1' });
  // An auto chip with no entity omits the key instead of sending null.
  assert.deepEqual(wireSelection(chip('lighting.neon')), { id: 'lighting.neon', source: 'auto', pinned: false });
});

test('a valid edit becomes exactly the wire body the contract names', () => {
  const built = build({
    edit: edit({ briefKo: '  비 오는 거리  ', choices: [{ questionId: 'q1', optionId: 'o1' }],
      selections: [chip('lighting.neon', 'excluded'), chip('subject.person', 'manual', { pinned: true, entityId: 'e1' })] }),
  });
  assert.equal(built.ok, true);
  assert.deepEqual(built.body, {
    schema_version: 1,
    request_id: REQUEST_ID,
    input_revision: built.body.input_revision,
    dictionary_version: TARGET.dictionaryVersion,
    target_model_id: TARGET.modelId,
    target_family: TARGET.family,
    profile_version: TARGET.profileVersion,
    candidate_count: 3,
    // The text is sent as typed; only the *empty* check trims.
    brief_ko: '  비 오는 거리  ',
    selections: [{ id: 'lighting.neon', source: 'excluded' },
      { id: 'subject.person', source: 'manual', pinned: true, entity_id: 'e1' }],
    clarification_choices: [{ question_id: 'q1', option_id: 'o1' }],
  });
  // The fingerprint is `sha256:<hex>` on both sides — `fingerprint()` in
  // `prompt_compose.py` and `composeRevisions` here must produce the same shape.
  assert.match(built.body.input_revision, /^sha256:[0-9a-f]{64}$/);
});

test('each unusable request names its own field instead of "invalid input"', () => {
  const cases = [
    [{ target: { ...TARGET, modelId: '' } }, 'target', '대상 모델'],
    [{ target: { ...TARGET, family: '' } }, 'target', '대상 모델'],
    [{ target: { ...TARGET, profileVersion: 0 } }, 'profile', '출력 프로필'],
    [{ edit: edit({ briefKo: '   ', selections: [] }) }, 'empty', '한글 장면'],
    [{ edit: edit({ briefKo: 'x'.repeat(MAX_BRIEF_CHARS + 1) }) }, 'brief_ko', '4,000자'],
    [{ edit: edit({ briefKo: 'ok', selections: Array.from({ length: 101 },
      (_, index) => chip(`a.${index}`)) }) }, 'selections', '100개'],
    [{ edit: edit({ briefKo: 'ok', choices: Array.from({ length: MAX_CHOICES + 1 },
      (_, index) => ({ questionId: `q${index}`, optionId: 'o1' })) }) }, 'choices', '확인 응답'],
  ];
  for (const [over, detail, phrase] of cases) {
    const built = build(over);
    assert.equal(built.ok, false, `${detail} must be refused`);
    assert.equal(built.failure, 'build_failed');
    assert.equal(built.detail, detail);
    // The message must name the field, because it is the only thing the alert shows.
    assert.ok(built.message.includes(phrase), `${detail}: ${built.message}`);
  }
});

test('an empty brief with a chosen chip is a valid request', () => {
  // §4: `brief_ko` is optional as long as something was chosen.
  const built = build({ edit: edit({ briefKo: '', selections: [chip('subject.person')] }) });
  assert.equal(built.ok, true);
  assert.equal(built.body.brief_ko, '');
});

test('the candidate count is clamped to the server field range 1..3', () => {
  // `ComposeRequest.candidate_count` is `Field(default=3, ge=1, le=3)`, so the client
  // clamps before sending: 0 and NaN mean "unset" → 3, and 9 → 3, 2.7 → 2.
  for (const [input, expected] of [[0, 3], [1, 1], [2, 2], [3, 3], [9, 3], [2.7, 2], [NaN, 3]]) {
    const built = build({ candidateCount: input });
    assert.equal(built.ok, true);
    assert.equal(built.body.candidate_count, expected, `count ${input}`);
    assert.ok(built.body.candidate_count >= 1 && built.body.candidate_count <= 3,
      `count ${input} must satisfy the server's ge=1/le=3`);
  }
});


/* ---------------------------------------------------------------- reply parsing */

const parse = (over = {}) => parseComposeReply({ ...ready, ...over },
  { requestId: REQUEST_ID, revisions: REVISIONS });

const reject = (over = {}, detail) => {
  const parsed = parse(over);
  assert.equal(parsed.ok, false, `must be refused: ${detail}`);
  assert.equal(parsed.failure, 'invalid_reply');
  assert.equal(parsed.detail, detail);
  return parsed;
};

test('a well-formed ready reply becomes a ComposeResult', () => {
  const parsed = parse();
  assert.equal(parsed.ok, true);
  assert.equal(parsed.result.requestId, REQUEST_ID);
  assert.equal(parsed.result.candidates.length, 1);
  assert.equal(parsed.result.candidates[0].positivePrompt, 'a prompt');
  // Revisions come from the caller, never re-derived from the echoed body — otherwise
  // `settleComposition`'s staleness comparison would compare a value to itself.
  assert.equal(parsed.result.revisions, REVISIONS);
  assert.equal(parsed.result.selections.length, 0);
});

test('the two settled states are mutually exclusive, in both directions', () => {
  // A reply with both leaves no defined button to press, so it is refused rather than
  // guessed at (§5).
  reject({ clarifications: [{ question_id: 'q1', question_ko: '질문', why: 'actor_unknown',
    options: [{ option_id: 'o1', label_ko: '예' }] }] }, 'ready carries questions');
  reject({ status: 'needs_clarification', clarifications: [{ question_id: 'q1',
    question_ko: '질문', why: 'actor_unknown', options: [{ option_id: 'o1', label_ko: '예' }] }] },
  'clarification carries candidates');
});

test('an empty ready has no candidates to apply and is refused', () => {
  // Only `unavailable` may mean "nothing to compose"; an empty `ready` would render a
  // screen with no way forward.
  reject({ candidates: [] }, 'ready carries no candidates');
});

test('a clarification with no options traps the user and is refused', () => {
  // Answering is the only exit from `needs_clarification`, so an option-less question is
  // unanswerable and must not be shown as one.
  reject({ status: 'needs_clarification', candidates: [],
    clarifications: [{ question_id: 'q1', question_ko: '질문', why: 'actor_unknown', options: [] }] },
  'clarification has no options');
  // A malformed option is refused rather than skipped: the surviving options would be a
  // question the server never asked.
  reject({ status: 'needs_clarification', candidates: [],
    clarifications: [{ question_id: 'q1', question_ko: '질문', why: 'actor_unknown',
      options: [{ option_id: 'o1' }] }] }, 'clarification option is malformed');
  // A clarification carrying nothing at all is not a question either.
  reject({ status: 'needs_clarification', candidates: [], clarifications: [] },
    'clarification carries nothing');
});




test('a malformed candidate rejects the whole reply', () => {
  // Keeping the parseable half would show a candidate list the server never validated.
  for (const broken of [
    { candidate_id: 'c1', title_ko: '제목', difference_ko: '차이' },
    { candidate_id: '', title_ko: '제목', difference_ko: '차이', positive_prompt: 'p' },
    { candidate_id: 'c1', title_ko: '제목', difference_ko: '차이', positive_prompt: '' },
    'not an object',
    null,
  ]) {
    const parsed = parse({ candidates: [broken] });
    assert.equal(parsed.ok, false, `candidate ${JSON.stringify(broken)}`);
    assert.equal(parsed.failure, 'invalid_reply');
  }
  // One bad candidate in a good list is still a bad list.
  assert.equal(parse({ candidates: [ready.candidates[0], { candidate_id: 'c2' }] }).ok, false);
});

test('an unknown status, missing ids or a broken scene is not a reply', () => {
  reject({ status: 'thinking' }, 'unknown status');
  reject({ status: undefined }, 'unknown status');
  reject({ result_id: '' }, 'reply has no ids');
  reject({ request_id: '' }, 'reply has no ids');
  // A scene with a dangling reference is rejected whole, not partially displayed.
  const bad = parse({ scene: { entities: [], relations: [{ from: 'e9', to: 'e8', kind: 'next_to' }],
    environment: {}, unmapped_details: [], ambiguities: [] } });
  assert.equal(bad.ok, false);
  assert.equal(bad.failure, 'invalid_reply');
});

test('a failed request maps its `why` and never trusts the server message', () => {
  for (const [why, failure] of [['gpu_unavailable', 'provider_error'],
    ['admission_paused', 'provider_error'], ['gate_unreachable', 'provider_error'],
    ['upstream_status', 'provider_error'], ['timeout', 'timed_out'],
    ['busy', 'provider_error'], ['not_configured', 'provider_error'],
    ['stale_dictionary', 'conflict'], ['stale_profile', 'conflict'],
    ['stale_clarification', 'conflict'], ['model_family_mismatch', 'conflict']]) {
    const parsed = failureFromBody({ status: 'unavailable', why, message: 'internal trace',
      detail: 'recovery_required' });
    assert.equal(parsed.failure, failure, why);
    // The server's message is operator text; 422 bodies embed pydantic field paths.
    assert.equal(parsed.message, '');

    assert.equal(parsed.detail, 'recovery_required');
  }
  // An unknown `why` is still a failure, not a crash.
  assert.equal(failureFromBody({ status: 'error', why: 'brand_new' }).failure, 'provider_error');
});

test('a truncated reply says so in the token record', () => {
  const parsed = parse({ provider: { finish_reason: 'length', prompt_tokens: 5,
    output_tokens: 100 } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.result.tokens.truncated, true);
  assert.equal(parsed.result.tokens.outputTokens, 100);
  // `cut_short` from the route also marks it, even without a finish reason.
  assert.equal(parse({ cut_short: true }).result.tokens.truncated, true);
  assert.equal(parse().result.tokens.truncated, false);
});

test('warnings and snapshot_trim keep only usable strings', () => {
  const parsed = parse({ warnings: ['candidates_reduced', '', null, 7],
    snapshot_trim: ['entity_2', 3] });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.result.warnings, ['candidates_reduced']);
  assert.deepEqual(parsed.result.snapshotTrim, ['entity_2']);
  // A non-string provider block is ignored rather than throwing.
  assert.equal(parse({ provider: 'nope' }).result.providerModel, null);
  assert.equal(parse({ provider: { model: 'qwen3' } }).result.providerModel, 'qwen3');
});

/* ------------------------------------------------------------------------ alerts */

test('reducing codes are their own category, not plain advice', () => {
  // The spec separates "the answer is smaller than you asked for" from "here is a note".
  // Both of these shrink the candidate list, so both must land in `reduced`.
  for (const code of REDUCING_CODES) {
    const alert = warningAlert(code, 0);
    assert.equal(alert.category, 'reduced', code);
    assert.equal(alert.tone, 'caution');
  }
  for (const code of ['profile_token_window', 'profile_weighting_syntax',
    'unknown_ids_dropped', 'dictionary_truncated']) {
    assert.equal(warningAlert(code, 0).category, 'advisory', code);
  }
  // Negative-prompt warnings are advisory: they explain a constraint, they shrink nothing.
  for (const code of ['negative_unsupported', 'negative_requires_cfg']) {
    assert.equal(warningAlert(code, 0).category, 'advisory', code);
  }
});

test('every known warning has Korean copy and a stable key', () => {
  const codes = ['profile_token_window', 'profile_weighting_syntax', 'duplicate_candidates',
    'candidates_reduced', 'negative_unsupported', 'negative_requires_cfg',
    'unknown_ids_dropped', 'dictionary_truncated'];
  const alerts = warningAlerts(codes);
  assert.equal(alerts.length, codes.length);
  for (const alert of alerts) {
    assert.notEqual(alert.title, '알 수 없는 경고', `${alert.key} must be explained`);
    assert.ok(alert.message.length > 10);
  }
  // Repeated codes still get distinct keys, so React does not collapse two warnings.
  const twice = warningAlerts(['candidates_reduced', 'candidates_reduced']);
  assert.notEqual(twice[0].key, twice[1].key);
});

test('an unknown warning is shown with its code instead of being dropped', () => {
  // Silence would hide a fact the server reported. It is shown, labelled as unexplained.
  const alert = warningAlert('some_new_code', 3);
  assert.equal(alert.title, '알 수 없는 경고');
  assert.match(alert.message, /some_new_code/);
  assert.equal(alert.category, 'advisory');
});

test('a failure alert uses our copy and never interpolates an unknown detail', () => {
  for (const failure of ['truncated', 'partial', 'timed_out', 'provider_error',
    'invalid_reply', 'conflict', 'expired', 'build_failed']) {
    const alert = failureAlert(failure, null);
    assert.equal(alert.category, 'failure');
    assert.equal(alert.tone, 'error');
    assert.ok(alert.title.length > 0 && alert.message.length > 10, failure);
  }
  // The three user-facing details are translated...
  for (const detail of ['recovery_required', 'image_running', 'manual_approval']) {
    assert.equal(isKnownDetail(detail), true, detail);
    assert.ok(failureAlert('provider_error', detail).message.includes(
      { recovery_required: 'GPU 복구', image_running: '이미지 생성',
        manual_approval: '관리자 승인' }[detail]), detail);
  }
  // ...and anything else is acknowledged without being printed. A `detail` can carry a
  // pydantic field path or provider text, so it is never echoed into the UI.
  assert.equal(isKnownDetail('brief_ko: field required'), false);
  const opaque = failureAlert('invalid_reply', 'selections.3.id: unexpected value');
  assert.doesNotMatch(opaque.message, /selections\.3\.id/);
  assert.match(opaque.message, /표시하지 않습니다/);
  // A build failure's own field-named message is the override and must survive.
  assert.ok(failureAlert('build_failed', 'brief_ko', '한글 장면이 4,000자를 넘습니다.')
    .message.includes('4,000자'));
});


/* ------------------------------------------------------------------------- apply */

const applyInput = (over = {}) => ({
  state: readySession(), candidateId: 'c1', currentTarget: TARGET,
  currentRevisions: REVISIONS, currentPrompt: '', appliedPrompt: null,
  negativeSupported: true, ...over,
});

test('an unapplied candidate applies without asking', () => {
  const plan = planApply(applyInput());
  assert.equal(plan.ok, true);
  assert.equal(plan.positivePrompt, 'prompt c1');
  assert.equal(plan.summaryKo, '요약');
  // `null`, not `""`: the candidate has no negative prompt, so nothing is written.
  assert.equal(plan.negativePrompt, null);
  assert.equal(plan.needsConfirm, false);
  assert.equal(plan.confirmMessage, null);
});

test('a prompt the user owns asks before being overwritten', () => {
  // Overwrite protection keys off `appliedPrompt` — the last text this module wrote. Text
  // in the box that we did not write is the user's, so replacing it needs a confirm.
  const mine = planApply(applyInput({ currentPrompt: '직접 쓴 프롬프트', appliedPrompt: null }));
  assert.equal(mine.ok, true);
  assert.equal(mine.needsConfirm, true);
  assert.ok(mine.confirmMessage.includes('사라집니다'));
  // Our own last apply is not user work: a second candidate replaces it silently.
  const ours = planApply(applyInput({ currentPrompt: 'prompt c1', appliedPrompt: 'prompt c1' }));
  assert.equal(ours.ok, true);
  assert.equal(ours.needsConfirm, false);
  // An empty box has nothing to lose.
  assert.equal(planApply(applyInput({ currentPrompt: '   ' })).needsConfirm, false);
});

test('a target that moved while the reply was on screen refuses the apply', () => {
  // Checked at press time, not trusted from when the reply arrived: the model can change
  // after the candidates are already rendered.
  const plan = planApply(applyInput({ currentTarget: OTHER_TARGET }));
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'expired');
  assert.equal(plan.message, APPLY_BLOCK_COPY.expired);
});

test('an edited brief makes the shown candidates stale', () => {
  const plan = planApply(applyInput({
    currentRevisions: composeRevisions(edit({ briefKo: '다른 장면' }), TARGET) }));
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'stale');
});

test('clarification blocks the apply until it is answered', () => {
  // §4: a candidate cannot be applied while a question is outstanding, even though the
  // reply may carry candidates alongside it.
  const plan = planApply(applyInput({ state: clarifyingSession() }));
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'blocked');
});

test('an unknown candidate id and a non-settled phase both report no_candidate', () => {
  assert.equal(planApply(applyInput({ candidateId: 'gone' })).block, 'no_candidate');
  for (const state of [IDLE_COMPOSE(BRIEF_EDIT), invalidateForTarget(readySession(), OTHER_TARGET)]) {
    const plan = planApply(applyInput({ state }));
    assert.equal(plan.ok, false);
    assert.equal(plan.block, 'no_candidate');
  }
});

test('a negative prompt this model cannot take is refused, not silently dropped', () => {
  const state = readySession(BRIEF_EDIT, {
    candidates: [candidate('c1', { negativePrompt: 'blurry' })] });
  const plan = planApply(applyInput({ state, negativeSupported: false }));
  assert.equal(plan.ok, false);
  assert.equal(plan.block, 'negative_lost');
  // With support it applies, and the negative travels with the positive.
  const ok = planApply(applyInput({ state }));
  assert.equal(ok.ok, true);
  assert.equal(ok.negativePrompt, 'blurry');
});

test('a candidate without a negative leaves the user\'s negative alone', () => {
  // §5 forbids clearing a field the candidate never spoke about.
  const plain = candidate('c1');
  assert.equal(appliedNegative(plain, 'ugly, blurry'), 'ugly, blurry');
  assert.equal(appliedNegative({ ...plain, negativePrompt: 'lowres' }, 'ugly'), 'lowres');
  // An explicitly empty negative is still a value the candidate sent, so it does overwrite.
  assert.equal(appliedNegative({ ...plain, negativePrompt: '' }, 'ugly'), '');
});

test('the diff says what each field will do before the press', () => {
  const plain = candidate('c1');
  assert.deepEqual(applyDiff(plain, { currentPrompt: 'prompt c1', currentNegative: 'ugly',
    negativeSupported: true }), { positive: 'same', negative: 'keep' });
  assert.deepEqual(applyDiff(plain, { currentPrompt: 'other', currentNegative: '',
    negativeSupported: true }), { positive: 'replace', negative: 'keep' });
  const withNegative = { ...plain, negativePrompt: 'lowres' };
  assert.deepEqual(applyDiff(withNegative, { currentPrompt: '', currentNegative: 'ugly',
    negativeSupported: true }), { positive: 'replace', negative: 'replace' });
  // The candidate's negative cannot be written, so the card must not claim it will be.
  assert.equal(applyDiff(withNegative, { currentPrompt: '', currentNegative: 'ugly',
    negativeSupported: false }).negative, 'blocked');
});


/* ------------------------------------------------------------------------ chips */

const scene = (entities = []) => ({ ...structuredClone(EMPTY_SCENE), entities });

const person = (id, over = {}) => ({ entityId: id, kind: 'person', count: 1,
  attributesKo: [], evidenceKo: null, ...over });

const chipsOf = (selections, family = 'flux2', sceneValue = EMPTY_SCENE) =>
  chipList({ selections }, DICTIONARY, family, sceneValue);

test('every chip carries a state word, so colour is never the only signal', () => {
  const list = chipsOf([chip('location.street'), chip('lighting.neon', 'manual'),
    chip('subject.person', 'auto', { pinned: true }), chip('style.illustration', 'excluded')]);
  const byId = new Map(list.chosen.concat(list.excluded).map((item) => [item.id, item]));
  assert.deepEqual(byId.get('location.street').badges, ['자동']);
  assert.deepEqual(byId.get('lighting.neon').badges, ['직접']);
  // Pin is a second, independent word — a pinned chip says both where it came from and
  // that it must survive.
  assert.deepEqual(byId.get('subject.person').badges, ['자동', '고정']);
  assert.deepEqual(byId.get('style.illustration').badges, ['제외']);
  // The label is the Korean word, not the ID.
  assert.equal(byId.get('location.street').labelKo, '거리');
  assert.equal(byId.get('location.street').group, 'location');
});

test('an excluded chip is listed apart and never carries a pin', () => {
  const list = chipsOf([chip('subject.person'), chip('style.illustration', 'excluded',
    { pinned: true })]);
  assert.equal(list.excluded.length, 1);
  assert.equal(list.chosen.length, 1);
  // `setPinned` refuses excluded rows; the view must not claim a pin it cannot hold.
  assert.equal(list.excluded[0].pinned, false);
  assert.deepEqual(list.excluded[0].badges, ['제외']);
  // Counters describe only the chosen chips: an exclusion is not a selection.
  assert.deepEqual([list.auto, list.manual, list.pinned], [1, 0, 0]);
});

test('an unknown chip id still renders, by id, instead of disappearing', () => {
  // The dictionary and the server can disagree. Dropping the row would hide a chip the
  // server thinks is in the scene, so it is shown using its id and flagged unmapped.
  const item = chipView(chip('brand_new.thing'), DICTIONARY, 'flux2', new Map());
  assert.equal(item.labelKo, 'brand_new.thing');
  assert.equal(item.group, 'other');
  assert.equal(item.rendering, null);
  assert.equal(item.unmapped, true);
  assert.deepEqual(item.badges, ['자동']);
});

test('a family without a mapping is flagged unmapped rather than rendered empty', () => {
  // `fake` has no usable mappings, which is how a missing family shows up: the chip is
  // still a chip, but the UI can say it will not be rendered.
  const fake = chipView(chip('location.street'), DICTIONARY, 'fake', new Map());
  assert.equal(fake.unmapped, true);
  assert.equal(fake.rendering, null);
  // A mapped family renders the English text.
  const flux = chipView(chip('location.street'), DICTIONARY, 'flux2', new Map());
  assert.equal(flux.unmapped, false);
  assert.equal(flux.rendering, 'on a street');
});

test('entity labels are numbered per kind, in scene order', () => {
  const labels = entityLabels(scene([person('e1'), person('e2'),
    person('e3', { kind: 'object' })]));
  assert.equal(labels.get('e1'), '인물 1');
  assert.equal(labels.get('e2'), '인물 2');
  // Numbering restarts per kind: the first object is 1, not 3.
  assert.equal(labels.get('e3'), '사물 1');
  // An entity the scene does not list yields no label; the ID is never shown.
  assert.equal(chipView(chip('location.street', 'auto', { entityId: 'e9' }),
    DICTIONARY, 'flux2', labels).entityLabel, null);
  assert.equal(chipView(chip('location.street', 'auto', { entityId: 'e2' }),
    DICTIONARY, 'flux2', labels).entityLabel, '인물 2');
  // A whole-scene chip has no entity at all.
  assert.equal(chipView(chip('location.street'), DICTIONARY, 'flux2', labels).entityLabel, null);
});


/* ------------------------------------------------------------- session lifecycle */

test('a model change keeps the candidates but makes them unusable', () => {
  // `invalidateForTarget` is a derivation, not a write: the previous draft stays on screen
  // so the page does not go blank under the user, and `planApply` is what refuses it.
  const next = invalidateForTarget(readySession(), OTHER_TARGET);
  assert.equal(next.phase, 'failed');
  assert.equal(next.failure, 'expired');
  assert.notEqual(next.draft, null);
  assert.equal(next.draft.candidates.length, 1);
  // The target recorded in the edit follows the selector, so the next request is correct.
  assert.equal(next.edit.targetModelId, OTHER_TARGET.modelId);
  assert.equal(next.edit.targetFamily, OTHER_TARGET.family);
  // The brief the user typed is untouched by a model change.
  assert.equal(next.edit.briefKo, BRIEF_EDIT.briefKo);
});

test('a model change cancels a request in flight instead of letting it land', () => {
  const started = startComposition(IDLE_COMPOSE(BRIEF_EDIT),
    { requestId: REQUEST_ID, target: TARGET });
  const next = invalidateForTarget(started, OTHER_TARGET);
  assert.equal(next.phase, 'cancelled');
  // The reply still arrives later; `settleComposition` drops it because the phase moved.
  const late = settleComposition(next, { outcome: { kind: 'reply', result: result() },
    currentRevisions: next.phase === 'cancelled' ? REVISIONS : REVISIONS,
    currentTarget: TARGET });
  assert.equal(late, next);
});

test('a model change on an idle or already-failed session changes nothing but the target', () => {
  const idle = IDLE_COMPOSE(BRIEF_EDIT);
  // Nothing was requested, so there is nothing to expire.
  assert.equal(invalidateForTarget(idle, TARGET), idle);
  const sameTargetSession = readySession();
  // Re-selecting the same target is not a change and must not blank the screen.
  assert.equal(invalidateForTarget(sameTargetSession, TARGET), sameTargetSession);
});

test('a reply for another target is refused at settle time, not trusted', () => {
  // The check runs inside `settleComposition` against the target at settle time, so a
  // model change during the call cannot slip a stale reply onto the screen.
  const started = startComposition(IDLE_COMPOSE(BRIEF_EDIT),
    { requestId: REQUEST_ID, target: TARGET });
  const settled = settleComposition(started, {
    outcome: { kind: 'reply', result: result({ revisions: started.revisions }) },
    currentRevisions: started.revisions, currentTarget: OTHER_TARGET });
  assert.equal(settled.phase, 'failed');
  assert.equal(settled.failure, 'expired');
  assert.equal(settled.draft, null);
});

test('a late reply for an older request is dropped without an error', () => {
  const newer = startComposition(IDLE_COMPOSE(BRIEF_EDIT),
    { requestId: 'cmp-bbbbbbbbbbbb', target: TARGET });
  const settled = settleComposition(newer, {
    outcome: { kind: 'reply', result: result({ requestId: REQUEST_ID,
      revisions: newer.revisions }) },
    currentRevisions: newer.revisions, currentTarget: TARGET });
  // Still pending: the newer request is the truth and nothing has failed.
  assert.equal(settled, newer);
  assert.equal(settled.phase, 'pending');
});

test('an edit during a request cancels it, and a settled draft records the difference', () => {
  const started = startComposition(IDLE_COMPOSE(BRIEF_EDIT),
    { requestId: REQUEST_ID, target: TARGET });
  const edited = composeRevisions(edit({ briefKo: '다른 장면' }), TARGET);
  // A brief edit mid-flight: the answer would be about the old sentence.
  assert.equal(invalidateForTarget(started, TARGET).phase, 'pending');
  const viaRevisions = settleComposition(started, { outcome: { kind: 'cancelled',
    why: 'stale' }, currentRevisions: edited, currentTarget: TARGET });
  assert.equal(viaRevisions.phase, 'cancelled');
  // A settled draft is kept, and `draftIsStale` is what tells the UI not to call it current.
  const ready = readySession();
  const after = invalidateForTarget(ready, TARGET);
  assert.equal(after.phase, 'ready');
});

test('applying records what was executed and leaves the draft alone', () => {
  const applied = applyCandidate(readySession(), { candidateId: 'c1',
    providerModel: 'qwen3-test', appliedAt: '2026-11-22T00:00:00Z', resultId: 'cmp-a' });
  assert.equal(applied.applied.positivePrompt, 'prompt c1');
  assert.equal(applied.applied.summaryKo, '요약');
  assert.equal(applied.applied.appliedAt, '2026-11-22T00:00:00Z');
  // The candidates are still on screen: applying is not a mode change.
  assert.equal(applied.draft.candidates.length, 1);
  // Applying an unknown id, or from an idle session, records nothing.
  assert.equal(applyCandidate(readySession(), { candidateId: 'gone',
    providerModel: 'm', appliedAt: 't', resultId: 'r' }).applied, null);
  assert.equal(applyCandidate(IDLE_COMPOSE(BRIEF_EDIT), { candidateId: 'c1',
    providerModel: 'm', appliedAt: 't', resultId: 'r' }).applied, null);
});
