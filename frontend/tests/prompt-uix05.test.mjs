/**
 * UIX05: the job queue's display layer, and the two contracts that must not drift.
 *
 * Three kinds of claim, three kinds of evidence:
 *
 * 1. **Status wording** — the Korean label is a table over the server's own vocabulary, and an
 *    unknown value is echoed rather than blanked. Checked value by value against the statuses
 *    in `backend/app/models/schemas.py`.
 * 2. **The action contract is unchanged** — `jobCanCancel`/`jobCanRetry` are asserted per status,
 *    so the card's buttons cannot quietly gain or lose a state. The server's own rules are
 *    restated here as the expectation, not imported from the app.
 * 3. **The receipt is separate from the list** — asserted structurally on `App.tsx`: the receipt
 *    is set from the POST reply inside the `createJob` success branch, and no list-failure path
 *    can clear it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  jobCanCancel, jobCanRetry, jobIdentity, jobStatusKo, jobTerminal,
  queueNavMessage, receiptText,
} from '../src/lib/jobsView.ts';

const here = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(here, 'src');
const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const cardSource = readFileSync(join(SRC, 'components/JobCard.tsx'), 'utf8');

/** Exactly the members of `JobStatus` in the backend schema, in the server's order. */
const SERVER_STATUSES = [
  'queued', 'waiting_for_gpu', 'running', 'completed', 'failed', 'cancelled', 'interrupted',
];


// ── 1. Status wording ─────────────────────────────────────────────────────────

test('every server status has a Korean label and an unknown one is not blanked', () => {
  const expected = {
    queued: '대기', waiting_for_gpu: 'GPU 대기', running: '실행 중', completed: '완료',
    failed: '실패', cancelled: '취소됨', interrupted: '중단됨',
  };
  for (const status of SERVER_STATUSES) {
    assert.equal(jobStatusKo(status), expected[status], `${status} label`);
    // No label may just repeat the raw token: that would be an untranslated state on screen.
    assert.notEqual(jobStatusKo(status), status, `${status} must be translated`);
  }
  // A status a newer server adds renders as itself rather than as an empty badge.
  assert.equal(jobStatusKo('preempted'), 'preempted');
});

test('the server status vocabulary in this test matches the schema', () => {
  const schema = readFileSync(join(here, '..', 'backend/app/models/schemas.py'), 'utf8');
  const literal = schema.match(/JobStatus = Literal\[([\s\S]*?)\]/);
  assert.ok(literal, 'JobStatus literal must exist');
  const declared = [...literal[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(declared, SERVER_STATUSES,
    'if the server gains a status, jobsView needs a label for it');
});

// ── 2. The action contract, unchanged ─────────────────────────────────────────

test('cancel is offered for every non-terminal status and refused for terminal ones', () => {
  // `routes.py` POST /jobs/{id}/cancel rejects terminal jobs with 409, so the button must not
  // appear for them either.
  for (const status of ['queued', 'waiting_for_gpu', 'running']) {
    assert.equal(jobCanCancel(status), true, `${status} can be cancelled`);
    assert.equal(jobTerminal(status), false, `${status} is not terminal`);
  }
  for (const status of ['completed', 'failed', 'cancelled', 'interrupted']) {
    assert.equal(jobCanCancel(status), false, `${status} cannot be cancelled`);
    assert.equal(jobTerminal(status), true, `${status} is terminal`);
  }
});

test('retry is offered only for failed, cancelled and interrupted', () => {
  // `routes.py` POST /jobs/{id}/retry accepts exactly these three and 409s otherwise. A
  // completed job is done, not retryable, so it must stay out even though it is terminal.
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    assert.equal(jobCanRetry(status), true, `${status} can be retried`);
  }
  for (const status of ['queued', 'waiting_for_gpu', 'running', 'completed']) {
    assert.equal(jobCanRetry(status), false, `${status} cannot be retried`);
  }
  // Retry being available implies the job is terminal — the two rules cannot contradict.
  for (const status of SERVER_STATUSES) {
    if (jobCanRetry(status)) assert.equal(jobTerminal(status), true, `${status} retry implies terminal`);
  }
});

test('the card decides its buttons from the shared rules, not from inline status lists', () => {
  // One place decides; the card only asks. Inline arrays would let the two drift apart.
  assert.match(cardSource, /jobCanCancel\(job\.status\)/);
  assert.match(cardSource, /jobCanRetry\(job\.status\)/);
  assert.doesNotMatch(cardSource, /\["failed", "cancelled", "interrupted"\]/);
  assert.doesNotMatch(cardSource, /\["completed", "failed", "cancelled", "interrupted"\]/);
});

// ── 3. Identity line ─────────────────────────────────────────────────────────

// ── 4. Queue navigation wording ──────────────────────────────────────────────

test('the identity line states resolution and batch count from the job itself', () => {
  assert.equal(jobIdentity({ width: 512, height: 768, batch_count: 1 }), '512×768 · 1장');
  assert.equal(jobIdentity({ width: 64, height: 64, batch_count: 4 }), '64×64 · 4장');
});

test('each locating phase says something different, and found says nothing', () => {
  // `found` renders no line: the highlighted card is the answer, and a sentence on top of it
  // would be noise.
  assert.equal(queueNavMessage('found'), null);
  const loading = queueNavMessage('loading');
  const missing = queueNavMessage('missing');
  const error = queueNavMessage('error');
  assert.ok(loading && missing && error);
  // The three are distinguishable: a user must not read "not there" as "still loading".
  assert.equal(new Set([loading, missing, error]).size, 3);
  // "Not in this list" must say that no other job was chosen on the user's behalf.
  assert.match(missing, /다른 작업을 대신 선택하지 않았습니다/);
  // The read failure must not imply the acceptance failed.
  assert.match(error, /접수 정보는 위에 그대로/);
  // Only the two answers that can be acted on name the retry path.
  assert.match(missing, /다시 조회/);
  assert.match(error, /다시 조회/);
  assert.doesNotMatch(loading, /다시 조회/);
});

test('the receipt names the real job id and the status it was accepted in', () => {
  assert.equal(receiptText('job-abc123', 'queued'), '접수됨 · job-abc123 · 대기');
  assert.equal(receiptText('job-abc123', 'waiting_for_gpu'), '접수됨 · job-abc123 · GPU 대기');
});

// ── 5. The receipt is a POST fact, kept apart from the list ───────────────────

test('the receipt is set from the POST reply and from nowhere else', () => {
  const submitAt = appSource.indexOf('async function submit(event: FormEvent)');
  const body = appSource.slice(submitAt, submitAt + 2200);
  assert.match(body, /const accepted = await api\.createJob\(body\)/);
  assert.match(body, /setReceipt\(\{ jobId: accepted\.job_id, status: accepted\.status \}\)/);
  // The only writer of `receipt` is that success branch: no effect or poll clears it.
  assert.equal([...appSource.matchAll(/setReceipt\(/g)].length, 1,
    'receipt must have exactly one writer, the success branch');
});

test('no failure path can turn an accepted receipt into a generation failure', () => {
  // `refresh` is the list reader. Its catch must not touch `receipt`, or a `/jobs` failure would
  // erase a confirmation the POST already earned.
  const refreshAt = appSource.indexOf('const refresh = useCallback');
  assert.doesNotMatch(appSource.slice(refreshAt, refreshAt + 2800), /setReceipt/);
  // Likewise the queue navigation, which also reads the list.
  const navAt = appSource.indexOf('async function showInQueue');
  assert.ok(navAt > 0);
  assert.doesNotMatch(appSource.slice(navAt, navAt + 900), /setReceipt/);
  // And a failed POST must not leave a receipt: nothing is accepted, so nothing is claimed.
  assert.match(appSource, /setError\(reason instanceof Error \? reason\.message : "작업 접수 실패"\)/);
});

test('the order guard lets only the newest job-list read write', () => {
  // The token is taken when a read is issued and re-checked when it lands.
  assert.match(appSource, /jobsTokenRef\.current \+= 1;/);
  assert.match(appSource, /const token = jobsTokenRef\.current;/);
  assert.match(appSource, /if \(token !== jobsTokenRef\.current\) return;/);
  // `setJobs` appears exactly once in the component: `applyJobs` is the only writer, so no
  // second path can bypass the guard.
  assert.equal([...appSource.matchAll(/setJobs\(/g)].length, 1);
});

test('queue navigation opens the queue, goes to page 0 and does not auto-scroll or focus', () => {
  const navAt = appSource.indexOf('async function showInQueue');
  const body = appSource.slice(navAt, navAt + 1000);
  assert.match(body, /setJobsExpanded\(true\)/);
  assert.match(body, /setQueueNav\(\{ jobId, phase: "loading" \}\)/);
  assert.match(body, /navTargetRef\.current = jobId/);
  assert.match(body, /setJobPage\(0\)/);
  // Acceptance must not move the user: no scroll or focus call in the navigation, and none in
  // the submit success branch either.
  assert.doesNotMatch(body, /scrollIntoView|\.focus\(\)/);
  const submitAt = appSource.indexOf('async function submit(event: FormEvent)');
  assert.doesNotMatch(appSource.slice(submitAt, submitAt + 2200), /scrollIntoView|\.focus\(\)/);
});

test('the card locks per job and releases the lock on every outcome', () => {
  // One synchronous ref, checked before the request and cleared in `finally`, so a rejected
  // cancel cannot leave the card permanently disabled.
  assert.match(cardSource, /const lockRef = useRef\(false\)/);
  assert.match(cardSource, /if \(lockRef\.current\) return;/);
  assert.match(cardSource, /lockRef\.current = true;/);
  assert.match(cardSource, /finally \{\n\s*lockRef\.current = false;/);
  // The ref lives in the card, which is what keeps one job's operation from blocking another's.
  assert.doesNotMatch(appSource, /jobBusyRef|busyJobId/);
  // The failure is reported on the card, next to the job it belongs to.
  assert.match(cardSource, /className="job-failure" role="status"/);
});
