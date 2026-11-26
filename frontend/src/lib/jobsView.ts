/**
 * UIX05: job-queue display facts.
 *
 * Three rules keep this file from becoming a second implementation of anything:
 *
 * - It never decides what a job *is*. The status vocabulary belongs to the server
 *   (`JobStatus` in `schemas.py`); this only says how each value reads in Korean. An
 *   unknown value is echoed unchanged, so a newer server state can never render blank.
 * - It never re-derives the action contract. `jobCanCancel`/`jobCanRetry` restate the two
 *   conditions the card's buttons have always used, and the tests pin them per status. If
 *   the server's rules change, both move together or the tests fail.
 * - It invents no figure. There is no progress percentage, ETA or queue position here
 *   because the API does not return one.
 *
 * No network, no React, no storage.
 */

/** Every status `JobStatus` can hold, and how it reads. Order is the server's. */
const STATUS_KO: Record<string, string> = {
  queued: "대기",
  waiting_for_gpu: "GPU 대기",
  running: "실행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
  interrupted: "중단됨",
};

/** The statuses after which a job never changes again. */
const TERMINAL = ["completed", "failed", "cancelled", "interrupted"];

/** The statuses the server accepts a retry for (`routes.py`, `POST /jobs/{id}/retry`). */
const RETRYABLE = ["failed", "cancelled", "interrupted"];

/** A Korean label for a server status; unknown values pass through as themselves. */
export function jobStatusKo(status: string): string {
  return STATUS_KO[status] ?? status;
}

export function jobTerminal(status: string): boolean {
  return TERMINAL.includes(status);
}

/**
 * The card's cancel rule, unchanged from before UIX05: any non-terminal job can be asked
 * to stop. A terminal job cannot, and the server answers `409` if one is tried anyway.
 */
export function jobCanCancel(status: string): boolean {
  return !jobTerminal(status);
}

/**
 * The card's retry rule, unchanged from before UIX05. Narrower than "terminal": a
 * completed job is done, not retryable, and the server refuses it with `409`.
 */
export function jobCanRetry(status: string): boolean {
  return RETRYABLE.includes(status);
}

/**
 * The identity line the card shows under the model name.
 *
 * Resolution and batch count are what tell two otherwise identical prompts apart in the
 * queue, and both are already on `Job` — nothing is computed beyond formatting them.
 */
export function jobIdentity(job: { width: number; height: number; batch_count: number }): string {
  return `${job.width}×${job.height} · ${job.batch_count}장`;
}

/**
 * Where a requested job is in the locating process.
 *
 * `loading` is the only phase that is not an answer: either a list read is in flight or one
 * has not started yet. `found` renders no message — the spotlighted card is the answer.
 */
export type QueueNavPhase = "loading" | "found" | "missing" | "error";

/**
 * What the queue says while a job is being located, or `null` when there is nothing to say.
 *
 * Each sentence names the next action, and none of them claims a different job was
 * selected: "not in this list" and "could not load the list" are different problems with
 * different fixes, so they read differently.
 */
export function queueNavMessage(phase: QueueNavPhase): string | null {
  if (phase === "loading") return "접수한 작업을 이 목록에서 찾는 중…";
  if (phase === "missing") {
    return "접수한 작업이 아직 이 목록에 없습니다. 목록을 다시 조회해 확인하세요. 다른 작업을 대신 선택하지 않았습니다.";
  }
  if (phase === "error") {
    return "작업 목록을 불러오지 못했습니다. 목록을 다시 조회하세요. 접수 정보는 위에 그대로 남아 있습니다.";
  }
  return null;
}

/** The receipt line: the real job id and the state the server accepted it in. */
export function receiptText(jobId: string, status: string): string {
  return `접수됨 · ${jobId} · ${jobStatusKo(status)}`;
}
