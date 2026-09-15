/**
 * The four statuses a job may hold, per the spec.
 */
export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export const JOB_STATUSES: readonly JobStatus[] = Object.freeze([
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.COMPLETED,
  JobStatus.FAILED,
]);

/**
 * The job lifecycle, as a state machine:
 *
 *   pending → running → completed
 *                     ↘ failed
 *
 * `completed` and `failed` are terminal — nothing leaves them.
 *
 * This map is the single source of truth for the rule. The HTTP layer, the
 * service and the tests all read it, so there is exactly one place to change
 * if the lifecycle ever grows a new state.
 *
 * Note that a status is never allowed to transition to itself. That is
 * deliberate: it is what makes a lost concurrent update observable instead of
 * silently succeeding. See JobsService.updateStatus.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> =
  Object.freeze({
    [JobStatus.PENDING]: Object.freeze([JobStatus.RUNNING]),
    [JobStatus.RUNNING]: Object.freeze([JobStatus.COMPLETED, JobStatus.FAILED]),
    [JobStatus.COMPLETED]: Object.freeze([]),
    [JobStatus.FAILED]: Object.freeze([]),
  });

export function isTransitionAllowed(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedNextStatuses(from: JobStatus): readonly JobStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function isTerminal(status: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
