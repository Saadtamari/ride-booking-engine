import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

/**
 * A single shared connection pool. `max` must exceed peak concurrency: every
 * losing request holds its connection while blocked on the contended ride row,
 * so a pool smaller than the burst size would deadlock itself.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // Surfacing pool-level errors keeps an idle client failure from going silent.
  console.error('[pg-pool] unexpected error on idle client', err);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
