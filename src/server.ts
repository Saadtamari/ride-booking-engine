import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { closeRedis } from './redis/client.js';

async function main(): Promise<void> {
  // Ensure the schema exists before accepting traffic (idempotent).
  await migrate();

  const app = buildApp();
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`🚗 Ride-booking engine listening on http://${config.host}:${config.port}`);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received — shutting down gracefully`);
    try {
      await app.close(); // stop accepting, drain in-flight requests
      await closePool();
      await closeRedis();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('fatal: failed to start server', err);
  process.exit(1);
});
