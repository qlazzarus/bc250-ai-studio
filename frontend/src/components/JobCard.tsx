import { type Job, StudioApi } from "./../api";
import date from "./../lib/date";

function JobCard({ job, api, refresh }: { job: Job; api: StudioApi; refresh(): Promise<void> }) {
  const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(job.status);
  const action = async (kind: "cancel" | "retry") => {
    try {
      if (kind === "cancel") await api.cancel(job.job_id);
      else await api.retry(job.job_id);
    } finally {
      await refresh();
    }
  };
  return (
    <article className="job">
        <div>
            <span className={`badge ${job.status}`}>{job.status}</span>
            <strong>{job.model_id}</strong>
            <p>{job.prompt}</p>
            <small>{job.items.map((item) => `${item.index + 1}: ${item.status}`).join(" · ")} · {date(job.created_at)}</small>
        </div>
        <div className="job-actions">
            {!terminal && <button onClick={() => void action("cancel")}>취소</button>}
            {["failed", "cancelled", "interrupted"].includes(job.status) && <button onClick={() => void action("retry")}>재시도</button>}
        </div>
    </article>
 );
}

export default JobCard;