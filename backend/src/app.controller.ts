import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ALLOWED_TRANSITIONS, JOB_STATUSES } from './jobs/job-status.js';

@Controller()
export class AppController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * A human-readable index at the API root, so that opening the deployed
   * backend URL in a browser explains what this service is instead of 404ing.
   */
  @Get()
  index() {
    return {
      name: 'Mini Job Queue API',
      statuses: JOB_STATUSES,
      allowedTransitions: ALLOWED_TRANSITIONS,
      endpoints: {
        'POST /jobs': 'Create a job (always starts as pending)',
        'GET /jobs': 'List jobs, optionally ?status=pending',
        'GET /jobs/stats': 'Counts per status',
        'PATCH /jobs/:id/status': 'Move a job through the lifecycle',
        'DELETE /jobs/:id': 'Delete a job',
        'GET /jobs/:id/transitions': 'Audit trail for one job',
        'GET /health': 'Liveness and database connectivity',
      },
    };
  }

  /**
   * Checks the database round-trip, not just that the process is up — a
   * process that cannot reach Postgres cannot serve a single useful request,
   * so it should not be reported as healthy.
   */
  @Get('health')
  async health() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unreachable',
        message: error instanceof Error ? error.message : 'Unknown database error',
      });
    }

    return { status: 'ok', database: 'reachable', uptimeSeconds: Math.round(process.uptime()) };
  }
}
