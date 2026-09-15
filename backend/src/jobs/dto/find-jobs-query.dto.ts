import { IsEnum, IsOptional } from 'class-validator';
import { JOB_STATUSES, JobStatus } from '../job-status.js';

export class FindJobsQueryDto {
  /** Optional server-side filter; omitted means "all jobs". */
  @IsOptional()
  @IsEnum(JobStatus, { message: `status must be one of: ${JOB_STATUSES.join(', ')}` })
  status?: JobStatus;
}
