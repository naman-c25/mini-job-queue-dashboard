import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema.
 *
 * Written by hand rather than generated, and run on boot via `migrationsRun`,
 * so that dev and production converge on exactly the same schema. TypeORM's
 * `synchronize` is off everywhere — it is convenient but it will happily drop a
 * column in production to match an entity, which is not a risk worth taking.
 */
export class InitSchema1789390440000 implements MigrationInterface {
  name = 'InitSchema1789390440000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The status domain lives in the database, not only in TypeScript. Any
    // client that reaches this database — including psql — is held to the four
    // allowed values.
    await queryRunner.query(
      `CREATE TYPE "job_status" AS ENUM('pending', 'running', 'completed', 'failed')`,
    );

    // gen_random_uuid() is in core Postgres from 13 onward, so no extension.
    await queryRunner.query(`
      CREATE TABLE "jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying(200) NOT NULL,
        "type" character varying(100) NOT NULL,
        "status" "job_status" NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_jobs_id" PRIMARY KEY ("id")
      )
    `);

    // The dashboard filters and counts by status on every load.
    await queryRunner.query(`CREATE INDEX "IDX_jobs_status" ON "jobs" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_jobs_created_at" ON "jobs" ("createdAt")`);

    // Append-only audit trail. No foreign key on purpose: these rows must
    // survive the deletion of the job they describe.
    await queryRunner.query(`
      CREATE TABLE "job_status_transitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "jobId" uuid NOT NULL,
        "fromStatus" "job_status",
        "toStatus" "job_status" NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_status_transitions_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_job_status_transitions_job_id" ON "job_status_transitions" ("jobId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "job_status_transitions"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
    await queryRunner.query(`DROP TYPE "job_status"`);
  }
}
