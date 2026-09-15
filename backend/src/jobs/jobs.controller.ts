import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateJobDto } from './dto/create-job.dto.js';
import { FindJobsQueryDto } from './dto/find-jobs-query.dto.js';
import { UpdateJobStatusDto } from './dto/update-job-status.dto.js';
import { JobStatusTransition } from './entities/job-status-transition.entity.js';
import { Job } from './entities/job.entity.js';
import { JobStatusCounts, JobsService } from './jobs.service.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateJobDto): Promise<Job> {
    return this.jobs.create(dto);
  }

  /** `GET /jobs` for everything, `GET /jobs?status=pending` to filter. */
  @Get()
  findAll(@Query() query: FindJobsQueryDto): Promise<Job[]> {
    return this.jobs.findAll(query.status);
  }

  /**
   * Counts per status, for the dashboard summary.
   *
   * Declared before any `:id` route so that "stats" is never parsed as an id.
   */
  @Get('stats')
  stats(): Promise<JobStatusCounts> {
    return this.jobs.countByStatus();
  }

  /**
   * The lifecycle is enforced here and only here — see JobsService.updateStatus.
   * A client that skips the React app and calls this endpoint directly is held
   * to exactly the same rules.
   */
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobStatusDto,
  ): Promise<Job> {
    return this.jobs.updateStatus(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.jobs.remove(id);
  }

  /** Audit trail for one job (see README, Bonus). */
  @Get(':id/transitions')
  transitions(@Param('id', ParseUUIDPipe) id: string): Promise<JobStatusTransition[]> {
    return this.jobs.findTransitions(id);
  }
}
