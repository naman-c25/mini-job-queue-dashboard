import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { type Express } from 'express';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

/**
 * Serverless entry point (Vercel).
 *
 * The difference from `main.ts` is that nothing listens on a port: the platform
 * owns the socket and hands us one request at a time, so the app is initialised
 * and then used as a plain Express handler. Vercel invokes the exported handler
 * directly rather than waiting for a server to bind, which makes cold starts
 * deterministic.
 *
 * The bootstrapped app is cached across invocations because a warm instance
 * reuses its module scope. Without this, every request would rebuild the Nest
 * container and open a new Postgres pool.
 *
 * The *promise* is cached rather than the resolved app: two requests can hit a
 * cold instance at once, and caching the promise means the second waits for the
 * first bootstrap instead of starting a competing one.
 */
let cachedServer: Promise<Express> | undefined;

async function createServerOnce(): Promise<Express> {
  const expressApp = express();

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    // Vercel captures stdout per invocation; the default logger is very chatty
    // on every cold start.
    logger: ['error', 'warn'],
    // Nest's default is to terminate the process when initialisation fails.
    // On a serverless platform that turns any startup problem into an opaque
    // FUNCTION_INVOCATION_FAILED with no stack; throwing instead lets the
    // handler report what actually went wrong.
    abortOnError: false,
  });

  configureApp(app);

  await app.init();

  return expressApp;
}

export function createServer(): Promise<Express> {
  cachedServer ??= createServerOnce();
  return cachedServer;
}
