import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * Redis is used purely as a *fast idempotency response cache* — an accelerator
 * in front of the authoritative Postgres store. It is best-effort: if Redis is
 * unavailable we transparently fall back to the database, and correctness is
 * never affected. (See the README for the SETNX distributed-lock pattern, the
 * alternative strategy the assessment names.)
 */
export const redis = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
});

redis.on('error', (err: Error) => {
  // Log and swallow — Redis problems must degrade gracefully, not crash bookings.
  console.error('[redis] connection error (continuing on Postgres only):', err.message);
});

export interface CachedResponse {
  fingerprint: string;
  statusCode: number;
  /** The exact serialized response bytes, replayed verbatim. */
  payload: string;
}

function keyFor(idempotencyKey: string): string {
  return `idem:${idempotencyKey}`;
}

export const idempotencyCache = {
  async get(idempotencyKey: string): Promise<CachedResponse | null> {
    try {
      const raw = await redis.get(keyFor(idempotencyKey));
      return raw ? (JSON.parse(raw) as CachedResponse) : null;
    } catch {
      return null; // degrade to Postgres
    }
  },

  async set(idempotencyKey: string, value: CachedResponse): Promise<void> {
    try {
      await redis.set(
        keyFor(idempotencyKey),
        JSON.stringify(value),
        'EX',
        config.idempotencyTtlSeconds,
      );
    } catch {
      /* best-effort; Postgres remains the source of truth */
    }
  },
};

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    /* ignore */
  }
}
