import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

/**
 * Long-running server entry point: local development, Docker, Render, Railway.
 *
 * Vercel does not use this file — see `serverless.ts`.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  // Let Nest close the Postgres pool cleanly on SIGTERM, which is how hosting
  // platforms stop a container during a deploy.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  Logger.log(`Job Queue API listening on port ${port}`, 'Bootstrap');
}

await bootstrap();
