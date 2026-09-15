import type { StatusFilter } from '../hooks/useJobs';
import { JOB_STATUSES, type JobStatusCounts } from '../types';

interface Props {
  value: StatusFilter;
  counts: JobStatusCounts;
  onChange: (next: StatusFilter) => void;
}

const OPTIONS: StatusFilter[] = ['all', ...JOB_STATUSES];

/**
 * Filtering happens server-side (`GET /jobs?status=`), so the table shows what
 * the database actually holds rather than a locally filtered snapshot.
 */
export function StatusFilterBar({ value, counts, onChange }: Props) {
  const total = JOB_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  return (
    <div className="filter-bar" role="group" aria-label="Filter jobs by status">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`filter-bar__button${value === option ? ' is-active' : ''}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
          <span className="filter-bar__count">
            {option === 'all' ? total : counts[option]}
          </span>
        </button>
      ))}
    </div>
  );
}
