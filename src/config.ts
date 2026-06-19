import 'dotenv/config';

/**
 * Centralised, validated runtime configuration.
 * Reading env vars in exactly one place keeps the rest of the codebase pure.
 */
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: int('PORT', 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: process.env.DATABASE_URL ?? 'postgres://rides:rides@localhost:5432/rides',
  pgPoolMax: int('PG_POOL_MAX', 80),

  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  idempotencyTtlSeconds: int('IDEMPOTENCY_TTL_SECONDS', 86_400),
} as const;

export type Config = typeof config;
