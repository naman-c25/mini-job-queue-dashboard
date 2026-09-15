export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  id: string;
  title: string;
  type: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export type JobStatusCounts = Record<JobStatus, number>;

/**
 * The job lifecycle, mirrored from the backend.
 *
 * This copy exists purely so the UI can show the right buttons — it is a
 * convenience, never an authority. The server enforces the same map on every
 * request and will reject anything this file gets wrong, which is exactly what
 * happens when two tabs disagree about a job's current state.
 */
export const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export function allowedNextStatuses(status: JobStatus): readonly JobStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function isTerminal(status: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
