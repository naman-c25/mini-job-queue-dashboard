import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Everything that must be true of the app regardless of how it is hosted.
 *
 * There are three entry points — the long-running server (`main.ts`), the
 * Vercel serverless handler (`serverless.ts`) and the e2e tests — and it would
 * be very easy for validation or CORS to drift between them. They all call
 * this instead.
 */
export function configureApp(app: INestApplication): void {
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
}
