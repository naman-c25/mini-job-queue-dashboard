import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createJob, deleteJob, fetchStats, listJobs, updateJobStatus } from '../api/client';
import type { Job, JobStatus, JobStatusCounts } from '../types';

export type StatusFilter = JobStatus | 'all';

const EMPTY_COUNTS: JobStatusCounts = { pending: 0, running: 0, completed: 0, failed: 0 };

/** How often to quietly re-sync with the server, in milliseconds. */
const POLL_INTERVAL_MS = 5000;

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/**
 * All dashboard state in one place.
 *
 * Three ideas drive the shape of this hook:
 *
 *  - Loading a list and failing to mutate a row are different kinds of problem,
 *    so `error` (the list could not be loaded) and `actionError` (this click
 *    was rejected) are separate. One blanks the table; the other does not.
 *  - Whenever the server rejects a write as stale, the local view is by
 *    definition out of date, so every conflict triggers an immediate re-sync.
 *  - Counts come from the server rather than from `jobs.length`, so they stay
 *    truthful while a status filter is applied.
 */
export function useJobs() {
  const [filter, setFilterState] = useState<StatusFilter>('all');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [counts, setCounts] = useState<JobStatusCounts>(EMPTY_COUNTS);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Guards against a slow response from an earlier filter overwriting a fresh
  // one. Only the most recent request is allowed to commit its result.
  const latestRequest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const requestId = ++latestRequest.current;

      try {
        const [nextJobs, nextCounts] = await Promise.all([listJobs(filter), fetchStats()]);
        if (!mounted.current || requestId !== latestRequest.current) return;

        setJobs(nextJobs);
        setCounts(nextCounts);
        setError(null);
        setLastSyncedAt(new Date());
      } catch (caught) {
        if (!mounted.current || requestId !== latestRequest.current) return;
        // A failed background poll must not wipe a table the user is reading.
        if (!silent) setError(toMessage(caught));
      } finally {
        if (mounted.current && requestId === latestRequest.current && !silent) {
          setLoading(false);
        }
      }
    },
    [filter],
  );

  /**
   * Raising `loading` happens here, at the click that causes the reload, rather
   * than inside the fetching effect. `loading` starts `true` for the first
   * load, so the effect below never has to set it synchronously.
   */
  const setFilter = useCallback((next: StatusFilter) => {
    setLoading(true);
    setFilterState(next);
  }, []);

  /** Re-run a load that failed, from the error state's retry button. */
  const retry = useCallback(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Initial load, and a reload whenever the filter changes.
  useEffect(() => {
    // The lint rule cannot see across the `await` inside `refresh`: every
    // setState it performs happens after the request resolves, so none of them
    // run synchronously during this effect. The flag that *would* have been
    // synchronous is raised in `setFilter` and `retry` instead.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
  }, [refresh]);

  /**
   * Quietly re-sync on a timer so a second tab's changes show up without a
   * manual refresh. Paused while the tab is hidden — polling a backgrounded tab
   * just burns the user's battery and the API's quota.
   */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh({ silent: true });
    };

    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const create = useCallback(
    async (input: { title: string; type: string }): Promise<boolean> => {
      setActionError(null);
      setCreating(true);
      try {
        await createJob(input);
        await refresh({ silent: true });
        return true;
      } catch (caught) {
        if (mounted.current) setActionError(toMessage(caught));
        return false;
      } finally {
        if (mounted.current) setCreating(false);
      }
    },
    [refresh],
  );

  /**
   * Sends the status the user was looking at along with the one they want, so
   * the server can reject the change if the job has moved on in the meantime.
   */
  const changeStatus = useCallback(
    async (job: Job, next: JobStatus) => {
      setActionError(null);
      setBusy(job.id, true);
      try {
        await updateJobStatus(job.id, next, job.status);
        await refresh({ silent: true });
      } catch (caught) {
        if (!mounted.current) return;
        setActionError(toMessage(caught));

        // A 409 means this tab was showing a stale job. Pull the real state
        // immediately rather than leaving a wrong row on screen.
        if (caught instanceof ApiError && caught.isConflict) {
          await refresh({ silent: true });
        }
      } finally {
        if (mounted.current) setBusy(job.id, false);
      }
    },
    [refresh, setBusy],
  );

  const remove = useCallback(
    async (job: Job) => {
      setActionError(null);
      setBusy(job.id, true);
      try {
        await deleteJob(job.id);
        await refresh({ silent: true });
      } catch (caught) {
        if (!mounted.current) return;
        setActionError(toMessage(caught));

        // Already gone (404) — someone else deleted it. Re-sync so the row
        // disappears here too.
        if (caught instanceof ApiError && caught.status === 404) {
          await refresh({ silent: true });
        }
      } finally {
        if (mounted.current) setBusy(job.id, false);
      }
    },
    [refresh, setBusy],
  );

  return {
    jobs,
    counts,
    filter,
    setFilter,
    loading,
    error,
    actionError,
    dismissActionError: useCallback(() => setActionError(null), []),
    busyIds,
    creating,
    lastSyncedAt,
    create,
    changeStatus,
    remove,
    refresh,
    retry,
  };
}
