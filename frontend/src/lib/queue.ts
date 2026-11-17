/**
 * Queue header facts only. The answer is derived from the polled list every render,
 * never stored, so a poll cannot overwrite the user's own expand/collapse choice.
 */
export type QueueCounts = { running: number; queued: number; failed: number; completed: number; total: number };

const QUEUED = ["queued", "waiting_for_gpu"];
const FAILED = ["failed", "interrupted"];

export function queueCounts(jobs: { status: string }[]): QueueCounts {
  const counts: QueueCounts = { running: 0, queued: 0, failed: 0, completed: 0, total: jobs.length };
  for (const job of jobs) {
    if (job.status === "running") counts.running += 1;
    else if (QUEUED.includes(job.status)) counts.queued += 1;
    else if (FAILED.includes(job.status)) counts.failed += 1;
    else if (job.status === "completed") counts.completed += 1;
  }
  return counts;
}

/** Only non-zero facts are named, so the collapsed header stays one short line. */
export function queueSummary(jobs: { status: string }[]): string {
  const counts = queueCounts(jobs);
  if (!counts.total) return "최근 작업이 없습니다";
  const parts = [`진행 ${counts.running}`, `대기 ${counts.queued}`];
  if (counts.failed) parts.push(`실패 ${counts.failed}`);
  return parts.join(" · ");
}

/** An empty queue starts collapsed; the first job makes it visible without a click. */
export function queueDefaultExpanded(jobs: { status: string }[]): boolean {
  return jobs.length > 0;
}

/** A stored user choice wins; the default is only used until the user decides. */
export function queueExpanded(choice: boolean | null, jobs: { status: string }[]): boolean {
  return choice ?? queueDefaultExpanded(jobs);
}
