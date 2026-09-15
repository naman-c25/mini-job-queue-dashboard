import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { Job } from '../src/jobs/entities/job.entity.js';
import { JobStatus } from '../src/jobs/job-status.js';

/**
 * These run against a real Postgres database, because the behaviour under test
 * *is* database behaviour — an in-memory fake would prove nothing about whether
 * the compare-and-swap actually holds under concurrency.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('Jobs API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // The same configuration every deployed entry point uses, so these tests
    // exercise production's validation rather than a copy of it.
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
  }, 60_000);

  afterAll(async () => {
    if (createdIds.length) {
      await dataSource.getRepository(Job).delete(createdIds);
    }
    await app?.close();
  }, 30_000);

  async function createJob(title = 'Test job', type = 'test'): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/jobs')
      .send({ title, type })
      .expect(201);

    createdIds.push(response.body.id);
    return response.body.id;
  }

  describe('creation', () => {
    it('creates a job in the pending state', async () => {
      const response = await request(app.getHttpServer())
        .post('/jobs')
        .send({ title: '  Padded title  ', type: '  email  ' })
        .expect(201);

      createdIds.push(response.body.id);

      expect(response.body).toMatchObject({
        title: 'Padded title', // trimmed
        type: 'email',
        status: JobStatus.PENDING,
      });
      expect(response.body.id).toBeTruthy();
      expect(response.body.createdAt).toBeTruthy();
    });

    it('refuses a client-supplied status', async () => {
      // Otherwise a caller could mint a completed job without ever passing
      // through the state machine.
      await request(app.getHttpServer())
        .post('/jobs')
        .send({ title: 'Sneaky', type: 'email', status: 'completed' })
        .expect(400);
    });

    it('rejects an empty title', async () => {
      await request(app.getHttpServer())
        .post('/jobs')
        .send({ title: '   ', type: 'email' })
        .expect(400);
    });
  });

  describe('lifecycle', () => {
    it('walks pending -> running -> completed', async () => {
      const id = await createJob();

      await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.RUNNING })
        .expect(200);

      const done = await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.COMPLETED })
        .expect(200);

      expect(done.body.status).toBe(JobStatus.COMPLETED);
    });

    it('allows running -> failed', async () => {
      const id = await createJob();
      await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.RUNNING })
        .expect(200);

      const failed = await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.FAILED })
        .expect(200);

      expect(failed.body.status).toBe(JobStatus.FAILED);
    });

    it('refuses to skip running', async () => {
      const id = await createJob();
      const response = await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.COMPLETED })
        .expect(409);

      expect(response.body.code).toBe('INVALID_TRANSITION');
    });

    it('never restarts a finished job', async () => {
      const id = await createJob();
      await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.RUNNING })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.COMPLETED })
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.RUNNING })
        .expect(409);

      expect(response.body.code).toBe('INVALID_TRANSITION');
      expect(response.body.currentStatus).toBe(JobStatus.COMPLETED);
    });

    it('rejects a status outside the four allowed values', async () => {
      const id = await createJob();
      await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: 'exploded' })
        .expect(400);
    });

    it('404s for a job that does not exist', async () => {
      await request(app.getHttpServer())
        .patch('/jobs/00000000-0000-4000-8000-000000000000/status')
        .send({ status: JobStatus.RUNNING })
        .expect(404);
    });

    it('400s for a malformed id', async () => {
      await request(app.getHttpServer())
        .patch('/jobs/not-a-uuid/status')
        .send({ status: JobStatus.RUNNING })
        .expect(400);
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of eight simultaneous starts win', async () => {
      const id = await createJob('Race target');

      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(app.getHttpServer())
            .patch(`/jobs/${id}/status`)
            .send({ status: JobStatus.RUNNING, expectedStatus: JobStatus.PENDING }),
        ),
      );

      const accepted = responses.filter((r) => r.status === 200);
      const rejected = responses.filter((r) => r.status === 409);

      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(7);

      // And the job really is running, exactly once.
      const trail = await request(app.getHttpServer()).get(`/jobs/${id}/transitions`).expect(200);
      const starts = trail.body.filter(
        (t: { fromStatus: string; toStatus: string }) =>
          t.fromStatus === JobStatus.PENDING && t.toStatus === JobStatus.RUNNING,
      );
      expect(starts).toHaveLength(1);
    }, 30_000);

    it('holds without expectedStatus, on the plain contract from the spec', async () => {
      const id = await createJob('Race target, plain contract');

      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(app.getHttpServer())
            .patch(`/jobs/${id}/status`)
            .send({ status: JobStatus.RUNNING }),
        ),
      );

      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(7);
    }, 30_000);

    it('rejects a write whose expectedStatus is already stale', async () => {
      const id = await createJob();

      // Someone else starts the job.
      await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.RUNNING })
        .expect(200);

      // This client was still looking at `pending`.
      const response = await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.RUNNING, expectedStatus: JobStatus.PENDING })
        .expect(409);

      expect(response.body.code).toBe('STALE_STATE');
      expect(response.body.currentStatus).toBe(JobStatus.RUNNING);
    });

    it('the compare-and-swap predicate itself refuses a stale write', async () => {
      // The HTTP tests above rely on real timing. This one pins the underlying
      // guarantee deterministically: an UPDATE naming a status the row no
      // longer holds must match zero rows, whatever the application layer did
      // beforehand.
      const id = await createJob();

      await request(app.getHttpServer())
        .patch(`/jobs/${id}/status`)
        .send({ status: JobStatus.RUNNING })
        .expect(200);

      const result = await dataSource
        .createQueryBuilder()
        .update(Job)
        .set({ status: JobStatus.COMPLETED })
        .where('id = :id AND status = :expected', { id, expected: JobStatus.PENDING })
        .execute();

      expect(result.affected).toBe(0);

      // And the job is untouched.
      const job = await dataSource.getRepository(Job).findOneByOrFail({ id });
      expect(job.status).toBe(JobStatus.RUNNING);
    });
  });

  describe('listing, counts and deletion', () => {
    it('filters by status', async () => {
      const id = await createJob('Filter probe', 'filter-test');
      const response = await request(app.getHttpServer())
        .get(`/jobs?status=${JobStatus.PENDING}`)
        .expect(200);

      expect(response.body.every((j: Job) => j.status === JobStatus.PENDING)).toBe(true);
      expect(response.body.some((j: Job) => j.id === id)).toBe(true);
    });

    it('rejects an unknown filter value', async () => {
      await request(app.getHttpServer()).get('/jobs?status=nonsense').expect(400);
    });

    it('reports a count for every status, including zeroes', async () => {
      const response = await request(app.getHttpServer()).get('/jobs/stats').expect(200);

      expect(Object.keys(response.body).sort()).toEqual([
        'completed',
        'failed',
        'pending',
        'running',
      ]);
      for (const value of Object.values(response.body)) {
        expect(typeof value).toBe('number');
      }
    });

    it('deletes a job and then 404s on it', async () => {
      const id = await createJob('To be deleted');

      await request(app.getHttpServer()).delete(`/jobs/${id}`).expect(204);
      await request(app.getHttpServer()).delete(`/jobs/${id}`).expect(404);
    });
  });
});
