import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { ridesRoutes } from './routes/rides.js';
import { healthRoutes } from './routes/health.js';
import { fail } from './lib/response.js';

/**
 * Builds (but does not start) the Fastify app. Kept separate from server.ts so
 * tests can spin up an instance without binding a port.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : config.env === 'development'
          ? { level: config.logLevel, transport: { target: 'pino-pretty' } }
          : { level: config.logLevel },
    // Generate/propagate a request id so concurrent requests are traceable in logs.
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
    bodyLimit: 64 * 1024,
  });

  app.register(healthRoutes);
  app.register(ridesRoutes);

  // Uniform 404 + error envelopes so clients always get the same shape.
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(fail('NOT_FOUND', `Route ${req.method} ${req.url} not found.`));
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'unhandled error');
    if (err.statusCode === 400 || err.validation) {
      return reply.code(400).send(fail('BAD_REQUEST', err.message));
    }
    return reply.code(500).send(fail('INTERNAL_ERROR', 'An unexpected error occurred.'));
  });

  return app;
}
