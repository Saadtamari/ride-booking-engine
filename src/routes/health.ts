import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { redis } from '../redis/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness — is the process up?
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Readiness — can we actually serve traffic (DB reachable)?
  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await pool.query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'down';
    }
    try {
      checks.redis = (await redis.ping()) === 'PONG' ? 'ok' : 'down';
    } catch {
      checks.redis = 'down';
    }
    // Postgres is required; Redis is only an accelerator, so it does not gate readiness.
    const ready = checks.postgres === 'ok';
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not-ready', checks });
  });
}
