import './App.css';
import { apiBaseUrl } from './api/client';
import { JobForm } from './components/JobForm';
import { JobTable } from './components/JobTable';
import { StatusCounts } from './components/StatusCounts';
import { StatusFilterBar } from './components/StatusFilterBar';
import { useJobs } from './hooks/useJobs';
import type { Job } from './types';

export default function App() {
  const {
    jobs,
    counts,
    filter,
    setFilter,
    loading,
    error,
    actionError,
    dismissActionError,
    busyIds,
    creating,
    lastSyncedAt,
    create,
    changeStatus,
    remove,
    retry,
  } = useJobs();

  function handleDelete(job: Job) {
    if (window.confirm(`Delete "${job.title}"? This cannot be undone.`)) {
      void remove(job);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Job Queue</h1>
          <p className="app__subtitle">
            Jobs move <code>pending → running → completed / failed</code>. The server enforces
            it.
          </p>
        </div>

        <div className="app__meta">
          <span className="app__api" title={apiBaseUrl}>
            API: {apiBaseUrl}
          </span>
          {lastSyncedAt && (
            <span className="app__synced">
              synced {lastSyncedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      <StatusCounts counts={counts} loading={loading} />

      <JobForm onCreate={create} creating={creating} />

      {/*
        A rejected click (usually a 409 from a stale view) is shown here rather
        than replacing the table: the list is still valid and still useful, only
        this one action failed.
      */}
      {actionError && (
        <div className="banner banner--warning" role="alert">
          <span>{actionError}</span>
          <button type="button" className="banner__dismiss" onClick={dismissActionError}>
            Dismiss
          </button>
        </div>
      )}

      <StatusFilterBar value={filter} counts={counts} onChange={setFilter} />

      <main>
        {loading ? (
          <p className="state state--loading">Loading jobs…</p>
        ) : error ? (
          <div className="state state--error" role="alert">
            <p>
              <strong>Could not load jobs.</strong>
            </p>
            <p className="state__detail">{error}</p>
            <button type="button" className="button" onClick={retry}>
              Try again
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <p className="state state--empty">
            {filter === 'all'
              ? 'No jobs yet. Create one above to get started.'
              : `No ${filter} jobs.`}
          </p>
        ) : (
          <JobTable
            jobs={jobs}
            busyIds={busyIds}
            onChangeStatus={(job, next) => void changeStatus(job, next)}
            onDelete={handleDelete}
          />
        )}
      </main>

      <footer className="app__footer">
        <p>
          Open this page in two tabs and try starting the same pending job in both — one
          wins, the other is told why.
        </p>
      </footer>
    </div>
  );
}
