import type { Job, JobStatus, JobStatusCounts } from '../types';

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * An error carrying everything the UI needs to react intelligently.
 *
 * `code` and `currentStatus` come from the API's 409 responses, which lets the
 * dashboard tell the difference between "you cannot do that" and "someone beat
 * you to it" — and, in the latter case, show the status the job actually holds
 * now.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly currentStatus?: JobStatus;

  constructor(status: number, message: string, code?: string, currentStatus?: JobStatus) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.currentStatus = currentStatus;
  }

  /** True when the server rejected this because the UI was out of date. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** True when the API could not be reached at all. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

interface ApiErrorBody {
  message?: string | string[];
  error?: string;
  code?: string;
  currentStatus?: JobStatus;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    // fetch only rejects for transport-level problems: the API is down, DNS
    // failed, CORS blocked it, the user is offline.
    throw new ApiError(
      0,
      `Could not reach the API at ${BASE_URL}. Check that the server is running.`,
    );
  }

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A non-JSON error body (a proxy's HTML 502 page, for instance).
    }

    // Nest returns an array of messages for validation failures.
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : (body.message ?? `Request failed with status ${response.status}.`);

    throw new ApiError(response.status, message, body.code, body.currentStatus);
  }

  // 204 No Content, as returned by DELETE.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function listJobs(status?: JobStatus | 'all'): Promise<Job[]> {
  const query = status && status !== 'all' ? `?status=${status}` : '';
  return request<Job[]>(`/jobs${query}`);
}

export function fetchStats(): Promise<JobStatusCounts> {
  return request<JobStatusCounts>('/jobs/stats');
}

export function createJob(input: { title: string; type: string }): Promise<Job> {
  return request<Job>('/jobs', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * `expectedStatus` is the status this browser was displaying when the user
 * clicked. Sending it lets the server reject the change if the job has moved on
 * since, instead of applying an update the user never actually intended.
 */
export function updateJobStatus(
  id: string,
  status: JobStatus,
  expectedStatus: JobStatus,
): Promise<Job> {
  return request<Job>(`/jobs/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, expectedStatus }),
  });
}

export function deleteJob(id: string): Promise<void> {
  return request<void>(`/jobs/${id}`, { method: 'DELETE' });
}

export const apiBaseUrl = BASE_URL;
