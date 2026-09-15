import type { JobStatus } from '../types';

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge badge--${status}`}>{status}</span>;
}
