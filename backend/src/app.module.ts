import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
// TypeORM resolves its driver with a dynamic `require('pg')` at runtime. Static
// analysis — Vercel's file tracer, and bundlers generally — cannot follow that,
// so `pg` gets left out of the deployment and TypeORM fails at boot with
// "Postgres package has not been found installed". This import is never used
// directly; it exists so the driver stays in the bundle.
import 'pg';
import { AppController } from './app.controller.js';
import { JobStatusTransition } from './jobs/entities/job-status-transition.entity.js';
import { Job } from './jobs/entities/job.entity.js';
import { JobsModule } from './jobs/jobs.module.js';
import { InitSchema1789390440000 } from './migrations/1789390440000-InitSchema.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Fail fast and loudly at boot if the database is not configured,
        // rather than at the first request.
        const url = config.getOrThrow<string>('DATABASE_URL');
        const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);

        // Vercel sets this on every deployment. On a serverless platform each
        // instance serves one request at a time and is frozen in between.
        const isServerless = Boolean(config.get<string>('VERCEL'));

        return {
          type: 'postgres' as const,
          url,
          // Managed Postgres (Neon, Render, Supabase) terminates TLS at a proxy
          // whose chain the container often cannot verify; a plain local
          // Postgres speaks no TLS at all.
          ssl: isLocal ? false : { rejectUnauthorized: false },
          entities: [Job, JobStatusTransition],
          migrations: [InitSchema1789390440000],
          // Applying the schema on boot keeps a container deploy self-contained.
          // It can be turned off where migrations are run as a separate step.
          migrationsRun: config.get<string>('DB_RUN_MIGRATIONS') !== 'false',
          synchronize: false,
          logging: config.get<string>('DB_LOGGING') === 'true' ? 'all' : ['error', 'warn'],
          // Nest retries a failed connection ten times, three seconds apart, by
          // default. On a serverless platform that just burns the invocation
          // and buries the real error; failing fast surfaces it instead.
          retryAttempts: isServerless ? 1 : 5,
          retryDelay: 1000,
          extra: {
            // A big pool per instance is counterproductive under serverless:
            // instances multiply with traffic, and each one would hold
            // connections open against the database's limit while idle.
            // Pair this with a pooled connection string (Neon's `-pooler` host).
            max: isServerless ? 2 : 10,
            // Neon suspends an idle compute; the first connection after that
            // has to wait for it to wake up.
            connectionTimeoutMillis: 15_000,
          },
        };
      },
    }),
    JobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
