import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  JOB_STATUSES,
  JobStatus,
  allowedNextStatuses,
  isTerminal,
  isTransitionAllowed,
} from './job-status.js';

/**
 * The lifecycle, written out independently of the implementation:
 *
 *   pending -> running -> completed
 *                      -> failed
 */
const EXPECTED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  [JobStatus.PENDING]: [JobStatus.RUNNING],
  [JobStatus.RUNNING]: [JobStatus.COMPLETED, JobStatus.FAILED],
  [JobStatus.COMPLETED]: [],
  [JobStatus.FAILED]: [],
};

describe('job status lifecycle', () => {
  it('defines exactly the four statuses from the spec', () => {
    expect([...JOB_STATUSES]).toEqual(['pending', 'running', 'completed', 'failed']);
  });

  // Every from/to pair, so nothing can be added to the map unnoticed.
  describe.each(JOB_STATUSES)('from %s', (from) => {
    it.each(JOB_STATUSES)('to %s', (to) => {
      const shouldBeAllowed = EXPECTED_TRANSITIONS[from].includes(to);
      expect(isTransitionAllowed(from, to)).toBe(shouldBeAllowed);
    });
  });

  it('never allows a status to transition to itself', () => {
    // This is what makes a lost concurrent update observable rather than a
    // silent success, so it is asserted explicitly rather than left implicit
    // in the table above.
    for (const status of JOB_STATUSES) {
      expect(isTransitionAllowed(status, status)).toBe(false);
    }
  });

  it('treats completed and failed as terminal', () => {
    expect(isTerminal(JobStatus.COMPLETED)).toBe(true);
    expect(isTerminal(JobStatus.FAILED)).toBe(true);
    expect(isTerminal(JobStatus.PENDING)).toBe(false);
    expect(isTerminal(JobStatus.RUNNING)).toBe(false);
  });

  it('never lets a finished job start running again', () => {
    expect(isTransitionAllowed(JobStatus.COMPLETED, JobStatus.RUNNING)).toBe(false);
    expect(isTransitionAllowed(JobStatus.FAILED, JobStatus.RUNNING)).toBe(false);
  });

  it('reports the allowed next statuses for each state', () => {
    expect([...allowedNextStatuses(JobStatus.PENDING)]).toEqual(['running']);
    expect([...allowedNextStatuses(JobStatus.RUNNING)]).toEqual(['completed', 'failed']);
    expect([...allowedNextStatuses(JobStatus.COMPLETED)]).toEqual([]);
    expect([...allowedNextStatuses(JobStatus.FAILED)]).toEqual([]);
  });

  it('exposes the lifecycle as frozen data', () => {
    // The map is shared process-wide; a caller must not be able to edit it.
    expect(Object.isFrozen(ALLOWED_TRANSITIONS)).toBe(true);
    expect(() => {
      (ALLOWED_TRANSITIONS as Record<string, unknown>)[JobStatus.COMPLETED] = [JobStatus.RUNNING];
    }).toThrow();
  });
});
