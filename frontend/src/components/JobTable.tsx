import { allowedNextStatuses, isTerminal, type Job, type JobStatus } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props {
  jobs: Job[];
  busyIds: ReadonlySet<string>;
  onChangeStatus: (job: Job, next: JobStatus) => void;
  onDelete: (job: Job) => void;
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const ACTION_LABELS: Record<JobStatus, string> = {
  pending: 'Reset to pending',
  running: 'Start',
  completed: 'Complete',
  failed: 'Fail',
};

export function JobTable({ jobs, busyIds, onChangeStatus, onDelete }: Props) {
  return (
    <div className="table-wrapper">
      <table className="job-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Status</th>
            <th>Created</th>
            <th className="job-table__actions-header">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const busy = busyIds.has(job.id);
            // The buttons offered come from the same lifecycle map the server
            // enforces, so the UI never invites a click it knows will fail.
            const nextStatuses = allowedNextStatuses(job.status);

            return (
              <tr key={job.id} className={busy ? 'is-busy' : undefined}>
                <td className="job-table__title">{job.title}</td>
                <td>
                  <span className="type-chip">{job.type}</span>
                </td>
                <td>
                  <StatusBadge status={job.status} />
                </td>
                <td className="job-table__time">
                  <time dateTime={job.createdAt}>{formatTime(job.createdAt)}</time>
                </td>
                <td className="job-table__actions">
                  {nextStatuses.map((next) => (
                    <button
                      key={next}
                      type="button"
                      className={`button button--${next}`}
                      disabled={busy}
                      onClick={() => onChangeStatus(job, next)}
                    >
                      {ACTION_LABELS[next]}
                    </button>
                  ))}

                  {isTerminal(job.status) && (
                    <span className="job-table__finished">finished</span>
                  )}

                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy}
                    onClick={() => onDelete(job)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
