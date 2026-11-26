/**
 * UIX05: one job in the queue.
 *
 * The card owns exactly three pieces of state, and all three are its own:
 *
 * - `busy` — which operation this card is running (`cancel`/`retry`), so the label can say
 *   "취소 중…" and the *matching* button disables while the other stays usable.
 * - `failure` — the server's reason for the last failed operation, shown on this card.
 * - `lockRef` — a synchronous twin of `busy`, for the same reason `submittingRef` exists in
 *   App: `busy` is React state and is still `false` inside the turn that sets it, so two
 *   clicks dispatched together would both send a cancel.
 *
 * The lock is per card because the ref lives in the card. A second job's cancel is a second
 * component and never waits on this one — the task's "do not block unrelated cards" falls
 * out of where the state lives rather than out of a scheduling decision.
 *
 * The action contract is untouched: cancel for non-terminal, retry for
 * failed/cancelled/interrupted, `refresh()` after either, and retry's new job identity is
 * the server's (`POST /jobs/{id}/retry` returns `{ job_id }` for a *copy*).
 */
import { useRef, useState } from "react";
import { type Job, StudioApi } from "./../api";
import date from "./../lib/date";
import { jobCanCancel, jobCanRetry, jobIdentity, jobStatusKo } from "./../lib/jobsView";

type Operation = "cancel" | "retry";

function JobCard({ job, api, refresh, spotlight = false }: {
  job: Job; api: StudioApi; refresh(): Promise<void>; spotlight?: boolean;
}) {
  const [busy, setBusy] = useState<Operation | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * The synchronous guard. One ref covers both operations on purpose: the two buttons sit
   * side by side and a user who clicks 취소 then 재시도 should not get two requests either.
   */
  const lockRef = useRef(false);

  const action = async (kind: Operation) => {
    // Re-entry check before anything else, and before any state is read.
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(kind);
    setFailure(null);
    try {
      if (kind === "cancel") await api.cancel(job.job_id);
      else await api.retry(job.job_id);
      // The list is the truth about what happened; a failed refresh is not a failed action,
      // so it must not be reported as one.
      await refresh().catch(() => undefined);
    } catch (reason) {
      // The card's own line, not `.errorbox`: this failure belongs to one job, and the
      // other cards keep working.
      setFailure(`${kind === "cancel" ? "취소" : "재시도"} 실패 · ${reason instanceof Error ? reason.message : "요청에 실패했습니다."}`);
    } finally {
      lockRef.current = false;
      setBusy(null);
    }
  };

  return (
    <article className="job" data-job-id={job.job_id} data-spotlight={spotlight ? "true" : undefined}
      data-busy={busy ?? undefined}>
        <div>
            {spotlight && <span className="job-spotlight">접수한 작업</span>}
            {/* The class keeps the server value for the colour rules and `data-status` keeps
                it queryable; the visible word is Korean. The two never disagree. */}
            <span className={`badge ${job.status}`} data-status={job.status}>{jobStatusKo(job.status)}</span>
            <strong>{job.model_id}</strong>
            <small className="job-id">{job.job_id}</small>
            <p>{job.prompt}</p>
            <small>{jobIdentity(job)} · {job.items.map((item) => `${item.index + 1}: ${jobStatusKo(item.status)}`).join(" · ")} · {date(job.created_at)}</small>
            {job.error_message && <small className="job-error">{job.error_message}</small>}
        </div>
        <div className="job-actions">
            {jobCanCancel(job.status) && <button onClick={() => void action("cancel")}
              disabled={busy !== null} aria-busy={busy === "cancel"}>
              {busy === "cancel" ? "취소 중…" : "취소"}
            </button>}
            {jobCanRetry(job.status) && <button onClick={() => void action("retry")}
              disabled={busy !== null} aria-busy={busy === "retry"}>
              {busy === "retry" ? "재시도 중…" : "재시도"}
            </button>}
        </div>
        {failure && <p className="job-failure" role="status">{failure}</p>}
    </article>
 );
}

export default JobCard;