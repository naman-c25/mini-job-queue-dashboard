import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobStatusTransition } from './entities/job-status-transition.entity.js';
import { Job } from './entities/job.entity.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Job, JobStatusTransition])],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
