import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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

        return {
          type: 'postgres' as const,
          url,
          // Managed Postgres (Neon, Render, Supabase) terminates TLS at a proxy
          // whose chain the container often cannot verify; a plain local
          // Postgres speaks no TLS at all.
          ssl: isLocal ? false : { rejectUnauthorized: false },
          entities: [Job, JobStatusTransition],
          migrations: [InitSchema1789390440000],
          migrationsRun: true,
          synchronize: false,
          logging: config.get<string>('DB_LOGGING') === 'true' ? 'all' : ['error', 'warn'],
        };
      },
    }),
    JobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
