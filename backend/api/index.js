/**
 * Vercel serverless function. Every route is rewritten here by vercel.json.
 *
 * This file is deliberately plain JavaScript that imports the *compiled* output
 * in `dist/`. Vercel's TypeScript pipeline builds functions with esbuild, which
 * does not emit `emitDecoratorMetadata` — and Nest's dependency injection and
 * TypeORM's column types both read that metadata at runtime. Compiling with
 * `tsc` first (via the build command in vercel.json) keeps it intact.
 */
import { createServer } from '../dist/serverless.js';

export default async function handler(req, res) {
  try {
    const server = await createServer();
    return server(req, res);
  } catch (error) {
    // A failure in here is a *bootstrap* failure — the Nest container or the
    // database connection, not a request. Without this the platform swallows it
    // and returns an opaque FUNCTION_INVOCATION_FAILED with no cause.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error('Bootstrap failed:', error);

    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'The API could not start.',
        detail,
      }),
    );
  }
}
