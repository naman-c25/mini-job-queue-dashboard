import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip anything the DTO does not declare, then reject the request if it
      // carried unknown fields. A caller trying to sneak `status` into
      // POST /jobs gets a 400 rather than having it silently dropped.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // In production the allowed origins are pinned to the deployed frontend.
  // Left unset (local development), any origin is reflected.
  const configured = process.env.CORS_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: configured?.length ? configured : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Let Nest close the Postgres pool cleanly on SIGTERM, which is how hosting
  // platforms stop a container during a deploy.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  Logger.log(`Job Queue API listening on port ${port}`, 'Bootstrap');
}

await bootstrap();
