import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobStatusDto } from './dto/update-job-status.dto.js';
import { JobStatusTransition } from './entities/job-status-transition.entity.js';
import { Job } from './entities/job.entity.js';
import {
  JOB_STATUSES,
  JobStatus,
  allowedNextStatuses,
  isTerminal,
  isTransitionAllowed,
} from './job-status.js';

export type JobStatusCounts = Record<JobStatus, number>;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Jobs always enter the world as `pending`.
   *
   * The API deliberately does not accept a status on creation: allowing it
   * would be a way to mint a `completed` job without ever passing through the
   * state machine, which is exactly the invariant this service exists to
   * protect.
   */
  async create(dto: CreateJobDto): Promise<Job> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.save(
        manager.create(Job, {
          title: dto.title,
          type: dto.type,
          status: JobStatus.PENDING,
        }),
      );

      await this.recordTransition(manager, job.id, null, JobStatus.PENDING);
      return job;
    });
  }

  findAll(status?: JobStatus): Promise<Job[]> {
    return this.jobs.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Counts every status in one grouped query rather than counting in the
   * client, so the totals stay correct no matter what filter the UI has
   * applied (and would stay correct under pagination).
   */
  async countByStatus(): Promise<JobStatusCounts> {
    const rows = await this.jobs
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('job.status')
      .getRawMany<{ status: JobStatus; count: string }>();

    // Statuses with no jobs are absent from a GROUP BY, so start from zero for
    // all four and let the query fill in whatever it found.
    const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as JobStatusCounts;
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  /**
   * Move a job to a new status, enforcing the lifecycle.
   *
   * This is the method the "two browser tabs" scenario is about. Three things
   * have to hold at once:
   *
   *  1. The transition must be legal (pending to running, running to completed
   *     or failed, and nothing out of a terminal state).
   *  2. The check and the write must not be separable. If we validated against
   *     a status we read a moment ago and then wrote unconditionally, two
   *     concurrent requests could both pass step 1 and both write.
   *  3. The audit row and the status change must land together or not at all.
   *
   * (2) is handled by making the write a compare-and-swap: the UPDATE carries
   * its own `WHERE status = <what we read>`. Postgres evaluates that predicate
   * against the committed row at write time, so if a concurrent transaction
   * changed the row first, this UPDATE matches zero rows and we fail loudly
   * instead of silently overwriting. (3) is why it all runs in one transaction.
   */
  async updateStatus(id: string, dto: UpdateJobStatusDto): Promise<Job> {
    const { status: nextStatus, expectedStatus } = dto;

    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(Job, { where: { id } });
      if (!job) {
        throw new NotFoundException(`Job ${id} does not exist.`);
      }

      const currentStatus = job.status;

      // If the client told us what it was looking at, and that was already
      // stale before we tried anything, report it as staleness rather than as
      // an illegal transition. It describes what actually went wrong.
      if (expectedStatus !== undefined && currentStatus !== expectedStatus) {
        throw new ConflictException({
          message:
            `This job is no longer ${expectedStatus}; it is now ${currentStatus}. ` +
            'Someone else changed it first, so nothing was applied.',
          error: 'Stale write',
          code: 'STALE_STATE',
          currentStatus,
          expectedStatus,
        });
      }

      if (!isTransitionAllowed(currentStatus, nextStatus)) {
        throw new ConflictException(this.describeIllegalTransition(currentStatus, nextStatus));
      }

      const result = await manager
        .createQueryBuilder()
        .update(Job)
        .set({ status: nextStatus })
        .where('id = :id AND status = :currentStatus', { id, currentStatus })
        .execute();

      // Zero rows matched: between our read and our write, a concurrent request
      // moved this job out of `currentStatus`. That request won, and this one
      // must not silently clobber it.
      if (result.affected === 0) {
        const latest = await manager.findOne(Job, { where: { id } });
        if (!latest) {
          throw new NotFoundException(`Job ${id} was deleted while this update was in flight.`);
        }

        this.logger.warn(
          `Lost update race on job ${id}: expected ${currentStatus}, found ${latest.status}.`,
        );

        throw new ConflictException({
          message:
            `This job moved to ${latest.status} while your change was being applied. ` +
            'Your update was not applied.',
          error: 'Concurrent update',
          code: 'CONCURRENT_UPDATE',
          currentStatus: latest.status,
          attemptedStatus: nextStatus,
        });
      }

      await this.recordTransition(manager, id, currentStatus, nextStatus);

      // Re-read so the response carries the database's own `updatedAt` rather
      // than a value reconstructed in application code.
      return manager.findOneOrFail(Job, { where: { id } });
    });
  }

  async remove(id: string): Promise<void> {
    const result = await this.jobs.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Job ${id} does not exist.`);
    }
    // The job's audit rows are intentionally left behind. See
    // JobStatusTransition for why.
  }

  /** History for one job, oldest first. */
  findTransitions(jobId: string): Promise<JobStatusTransition[]> {
    return this.dataSource.getRepository(JobStatusTransition).find({
      where: { jobId },
      order: { createdAt: 'ASC' },
    });
  }

  private recordTransition(
    manager: EntityManager,
    jobId: string,
    fromStatus: JobStatus | null,
    toStatus: JobStatus,
  ): Promise<JobStatusTransition> {
    return manager.save(manager.create(JobStatusTransition, { jobId, fromStatus, toStatus }));
  }

  /** Turns a rejected transition into an error a human can act on. */
  private describeIllegalTransition(from: JobStatus, to: JobStatus) {
    const allowed = allowedNextStatuses(from);

    const message =
      from === to
        ? `This job is already ${from}.`
        : isTerminal(from)
          ? `A ${from} job is finished and cannot move to ${to}.`
          : `A job cannot go from ${from} to ${to}. Allowed from ${from}: ${allowed.join(', ')}.`;

    return {
      message,
      error: 'Invalid transition',
      code: 'INVALID_TRANSITION',
      currentStatus: from,
      attemptedStatus: to,
      allowedTransitions: allowed,
    };
  }
}
