import { IsEnum, IsOptional } from 'class-validator';
import { JOB_STATUSES, JobStatus } from '../job-status.js';

const statusList = JOB_STATUSES.join(', ');

export class UpdateJobStatusDto {
  @IsEnum(JobStatus, { message: `status must be one of: ${statusList}` })
  status: JobStatus;

  /**
   * Optional optimistic-concurrency guard.
   *
   * When supplied, the update only applies if the job is still in this status —
   * the state the client was looking at when the user clicked. Two tabs that
   * both see `pending` and both send `expectedStatus: "pending"` will race, and
   * exactly one gets a 409 telling it its view was stale.
   *
   * Omitting it keeps the plain contract from the spec working unchanged; the
   * server then guards against the status it read a moment earlier instead.
   */
  @IsOptional()
  @IsEnum(JobStatus, { message: `expectedStatus must be one of: ${statusList}` })
  expectedStatus?: JobStatus;
}
