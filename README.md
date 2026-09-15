# Mini Job Queue Dashboard

A small job queue management dashboard: **React + TypeScript** on the front, **NestJS + PostgreSQL** behind it.

Jobs move through a fixed lifecycle, and the interesting part of this project is what happens when two people try to move the same job at the same time.

| | |
|---|---|
| **Live dashboard** | _(deploying)_ |
| **Live API** | _(deploying)_ |
| **Repository** | <https://github.com/naman-c25/mini-job-queue-dashboard> |

---

## The lifecycle

```
pending → running → completed
                  ↘ failed
```

`completed` and `failed` are terminal. Nothing leaves them, and nothing re-enters `running`.

A job also may not transition to the status it already holds. That sounds like a detail, but it is what makes a lost concurrent update visible instead of silently succeeding — see [Concurrency](#the-concurrency-problem).

---

## What it does

**Backend**

- `POST /jobs` — create a job (always starts `pending`)
- `GET /jobs` — list all jobs, optionally `?status=pending`
- `GET /jobs/stats` — counts per status
- `PATCH /jobs/:id/status` — move a job through the lifecycle
- `DELETE /jobs/:id` — delete a job
- `GET /jobs/:id/transitions` — audit trail for one job
- `GET /health` — liveness plus a database round-trip

**Frontend**

- Lists all jobs, filters by status, shows counts for each status
- Creates jobs, advances their status, deletes them
- Distinguishes loading, empty, API-error and action-rejected states
- Quietly re-syncs every 5 seconds so a second tab's changes appear on their own

---

## Tech choices

| Choice | Why |
|---|---|
| **NestJS + TypeORM** | The assignment asks for NestJS. TypeORM is its first-party ORM and gives direct access to the query builder, which the concurrency-safe update needs. |
| **PostgreSQL (Neon)** | Chosen over SQLite because the app has to be *deployed*, and most free hosts give you an ephemeral filesystem — a SQLite file would quietly vanish on every redeploy. Postgres also enforces the status domain as a real `ENUM` type. |
| **Migrations, not `synchronize`** | `synchronize: true` is convenient but will drop a column in production to match an entity. A single hand-written migration runs on boot instead, so dev and production converge on an identical schema. |
| **Plain React hooks, no data library** | React Query would do the caching for me. The assignment is explicitly evaluating React fundamentals, so the loading/error/refetch logic is written out in [`useJobs.ts`](frontend/src/hooks/useJobs.ts) where it can be read. |

---

## Running it locally

**Prerequisites:** Node.js 20+ and a PostgreSQL database (a free [Neon](https://neon.tech) project works well).

### Backend

```bash
cd backend
npm install
cp .env.example .env      # then set DATABASE_URL
npm run start:dev
```

The API comes up on <http://localhost:3000>. Migrations run automatically at boot, so the schema is created on first start — there is no separate migration step.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:3000
npm run dev
```

The dashboard comes up on <http://localhost:5173>.

### Environment variables

**backend/.env**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. The app refuses to boot without it. |
| `PORT` | no | Defaults to `3000`. |
| `CORS_ORIGIN` | no | Comma-separated allowed origins. Unset reflects any origin (development). |
| `DB_LOGGING` | no | `true` logs every SQL statement. |

**frontend/.env**

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | Base URL of the API, no trailing slash. |

---

## The concurrency problem

> Two browser tabs both see a job as `pending`. Both click "Start" at almost the same moment.

### Where should the rule be enforced?

**In the database transaction, which is the only place that can actually guarantee it.**

The rule appears in three places, and it is worth being precise about what each one is *for*:

1. **The React UI** only renders buttons for transitions that are currently legal. This is a convenience — it stops users making obvious mistakes. It guarantees nothing.
2. **The NestJS service** checks the transition against the lifecycle map. This catches bad requests from any client, but on its own it is still racy: two requests can both pass the check before either one writes.
3. **The `UPDATE` statement itself** carries the precondition in its `WHERE` clause. This is the only check that cannot be raced, because the database evaluates it at write time while holding a row lock.

Layers 1 and 2 exist for good error messages. Layer 3 is what makes the invariant true.

### What if someone bypasses React and calls the API directly?

Nothing changes — they hit exactly the same path. `curl` gets the same `409`:

```bash
curl -X PATCH $API/jobs/$ID/status -H 'Content-Type: application/json' -d '{"status":"running"}'
# {"message":"A completed job is finished and cannot move to running.",
#  "code":"INVALID_TRANSITION","currentStatus":"completed", ...}
```

The client-side transition map is a copy for rendering, never an authority. Two further guards back this up:

- `POST /jobs` **refuses a `status` field entirely** (`400`). Otherwise a caller could mint a `completed` job without ever passing through the state machine.
- `status` is a Postgres `ENUM`, so even a direct `psql` session cannot write a fifth status.

### What happens when two requests arrive at nearly the same time?

Exactly one wins. The other gets `409 Conflict` and its write is discarded.

The mechanism is a **compare-and-swap**: the update names the status it expects to replace.

```ts
const result = await manager
  .createQueryBuilder()
  .update(Job)
  .set({ status: nextStatus })
  .where('id = :id AND status = :currentStatus', { id, currentStatus })
  .execute();

if (result.affected === 0) {
  // Someone moved this job between our read and our write. They won.
  throw new ConflictException({ code: 'CONCURRENT_UPDATE', ... });
}
```

Why this is safe, concretely. Both requests read `pending`. Both try to update. Postgres lets the first `UPDATE` take the row lock; the second blocks. When the first commits, the second wakes up, **re-evaluates its `WHERE` clause against the newly committed row**, finds `status` is now `running` rather than `pending`, and matches zero rows. `affected === 0` is the signal that this request lost the race.

The whole thing runs inside one transaction, so the status change and its audit row commit together or not at all.

Clients can also send the status they were *looking at*:

```jsonc
{ "status": "running", "expectedStatus": "pending" }
```

The dashboard always sends this. It turns "apply this change" into "apply this change **if** the world still looks the way I was shown", which is the honest description of what a user clicking a button actually means.

**This is tested, not assumed.** [`jobs.e2e-spec.ts`](backend/test/jobs.e2e-spec.ts) fires eight simultaneous `pending → running` requests at one job against real Postgres and asserts the outcome:

```ts
expect(accepted).toHaveLength(1);   // exactly one 200
expect(rejected).toHaveLength(7);   // seven 409s
expect(starts).toHaveLength(1);     // and exactly one audit row
```

The same race is covered without `expectedStatus` too, on the plain contract from the spec. A fourth test pins the compare-and-swap predicate directly, so the guarantee is not left resting on request timing.

### How do you prevent an invalid or inconsistent state?

Four layers, each catching what the one above it cannot:

| Layer | Catches |
|---|---|
| Postgres `ENUM` + `NOT NULL` | Any status outside the four, from any client at all |
| Single transaction | Half-applied writes: a status change without its audit row |
| Compare-and-swap `WHERE` | Two concurrent writers, the case no application-level check can catch |
| DTO validation (`whitelist`, `forbidNonWhitelisted`) | Malformed and unexpected input before it reaches the service |

And on the client: every `409` triggers an immediate re-sync, so a tab that lost a race corrects itself instead of continuing to display a job state that is no longer real.

---

## Bonus: a status transition audit trail

**The improvement I chose:** every status change is recorded in an append-only `job_status_transitions` table, written inside the same transaction as the change itself.

**Why this one.** A job queue's most common production question is *"what happened to this job?"* — why did it fail, when did it start, did it get stuck. A bare `status` column answers none of that: it only ever shows the latest value, and overwrites its own history. One small table turns the queue from a thing you look at into a thing you can debug.

It also does real work for correctness here. Because the audit row is written in the same transaction as the compare-and-swap, the trail is a genuine record of what committed, which is exactly how the race test above proves only one request won — six requests, one audit row.

```bash
curl $API/jobs/$ID/transitions
```

```json
[
  { "fromStatus": null,      "toStatus": "pending",   "createdAt": "..." },
  { "fromStatus": "pending", "toStatus": "running",   "createdAt": "..." },
  { "fromStatus": "running", "toStatus": "completed", "createdAt": "..." }
]
```

The table deliberately has **no foreign key** onto `jobs`. An audit record has to outlive the thing it describes; if deleting a job erased its history, the log would be worth very little precisely when you need it.

---

## Design decisions

**Jobs always start `pending`.** `POST /jobs` rejects a `status` field outright. Accepting one would be a way to create a `completed` job without passing through the state machine, which defeats the point of having one.

**A job cannot transition to its own status.** `running → running` is a `409`, not a no-op success. If same-status writes succeeded silently, the two-tab race would return `200` to both tabs and the conflict would be invisible — the exact bug this project is about.

**Counts come from the database, not the array.** `GET /jobs/stats` runs a `GROUP BY`. Counting `jobs.length` in the browser would report the wrong totals as soon as a filter is applied, and would break outright under pagination.

**Filtering is server-side.** `GET /jobs?status=running` is a validated query parameter, so the table reflects what the database holds rather than a locally filtered snapshot.

**Errors carry a machine-readable `code`.** `INVALID_TRANSITION`, `STALE_STATE` and `CONCURRENT_UPDATE` are all `409`s, but they mean different things. The code lets the UI react differently (a stale write triggers a re-sync) without parsing prose.

**UUID primary keys.** Sequential integers would let anyone enumerate every job by walking `/jobs/1`, `/jobs/2`.

---

## Assumptions

- **`type` is a free-form string.** The brief lists `type` as a field but never enumerates the allowed values, so the API validates shape (non-empty, ≤100 characters) rather than inventing a closed set. The UI offers common ones as suggestions without restricting input.
- **`pending → failed` is not allowed.** The diagram routes `failed` only from `running`, so that is what is implemented. A real queue would probably want a job to be able to fail before it starts; that is a one-line change to the transition map if the rule is meant to be read differently.
- **Deleting a `running` job is allowed.** The brief asks for delete with no restriction. In a system with real workers I would block it (or make it a cancellation), since deleting a row does not stop the work already in flight.
- **No authentication.** Nothing in the brief calls for users or ownership, so the API is open. This is the first thing that would have to change for real use.
- **Single API instance.** The correctness argument rests on Postgres row locks, not on process-local state, so this holds across any number of instances — but it has only been exercised against one.

---

## Trade-offs

- **Polling, not WebSockets.** A 5-second poll (paused while the tab is hidden) is a handful of lines and makes the two-tab scenario visible. Live push would be nicer, and is the natural next step, but it is a lot of infrastructure for a dashboard this size.
- **Compare-and-swap over `SELECT … FOR UPDATE`.** Pessimistic locking would also be correct. CAS was chosen because it takes no lock while the request is thinking, and because `affected === 0` is a clean, explicit signal that a race occurred rather than something inferred.
- **The transition map is duplicated in the frontend.** A small amount of drift risk in exchange for a UI that never renders a button it knows will fail. The server is authoritative, so drift degrades the UX and never the data. The API exposes the map at `GET /` if the UI should later derive it instead.
- **The e2e tests need a real database.** They run against actual Postgres rather than a mock, because the behaviour under test *is* database behaviour — a fake would prove nothing about whether the compare-and-swap holds. The cost is that `npm run test:e2e` needs `DATABASE_URL` set (it skips cleanly without one) and takes ~17s rather than milliseconds.

---

## Tests

```bash
cd backend
npm test          # 22 unit tests, no database needed
npm run test:e2e  # 18 API tests, needs DATABASE_URL
```

**Unit** ([`job-status.spec.ts`](backend/src/jobs/job-status.spec.ts)) — every one of the 16 from/to status pairs is asserted against an independently written copy of the lifecycle, so a change to the transition map cannot pass unnoticed. Self-transitions and terminal states get their own explicit assertions.

**End-to-end** ([`jobs.e2e-spec.ts`](backend/test/jobs.e2e-spec.ts)) — the full API against real Postgres, including:

- eight simultaneous `pending → running` requests, asserting exactly one `200`, seven `409`s, and exactly one audit row
- the same race on the plain contract, without `expectedStatus`
- a stale `expectedStatus` rejected as `STALE_STATE`
- a deterministic proof that the compare-and-swap predicate itself matches zero rows on a stale write — the HTTP tests above depend on real timing, this one does not

---

## With more time

1. **A database-level transition guard.** A `BEFORE UPDATE` trigger rejecting illegal transitions would put the rule beyond the reach of *any* client, including a future service that talks to this database without going through the API.
2. **Actual workers.** Right now a human drives the state machine. Real jobs would be picked up by a worker using `SELECT … FOR UPDATE SKIP LOCKED`, with heartbeats and a timeout to recover jobs whose worker died mid-run.
3. **Retries and a `failed → pending` path.** With an attempt counter and a reason recorded on failure.
4. **Pagination and sorting** on `GET /jobs`. The current endpoint returns everything, which is fine for a dashboard and not fine for a real queue.
5. **Live updates over WebSockets**, replacing the poll.
6. **Structured request logging** with correlation IDs, and rate limiting on the write endpoints.

---

## Project layout

```
backend/
  src/
    jobs/
      job-status.ts                  # the lifecycle, in one place
      jobs.service.ts                # transactional CAS update lives here
      jobs.controller.ts
      dto/                           # validation
      entities/
    migrations/                      # hand-written, run on boot
    app.controller.ts                # API index + health check
frontend/
  src/
    api/client.ts                    # typed fetch wrapper, ApiError
    hooks/useJobs.ts                 # all dashboard state
    components/
    types.ts                         # mirrored lifecycle (UX only)
```
