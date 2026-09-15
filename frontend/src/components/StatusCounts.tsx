import { JOB_STATUSES, type JobStatusCounts } from '../types';

interface Props {
  counts: JobStatusCounts;
  loading: boolean;
}

/**
 * Counts are served by GET /jobs/stats, so they describe every job in the
 * system rather than only the ones currently passing the filter.
 */
export function StatusCounts({ counts, loading }: Props) {
  const total = JOB_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  return (
    <section className="counts" aria-label="Job counts by status">
      <div className="count-card count-card--total">
        <span className="count-card__value">{loading ? '–' : total}</span>
        <span className="count-card__label">total</span>
      </div>

      {JOB_STATUSES.map((status) => (
        <div key={status} className={`count-card count-card--${status}`}>
          <span className="count-card__value">{loading ? '–' : counts[status]}</span>
          <span className="count-card__label">{status}</span>
        </div>
      ))}
    </section>
  );
}
