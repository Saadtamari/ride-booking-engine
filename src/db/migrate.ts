import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, closePool } from './pool.js';

/** Read schema.sql from next to this module (dist/db) or fall back to src/db. */
async function readSchema(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'schema.sql'), // compiled: dist/db/schema.sql ; or source: src/db/schema.sql
    join(here, '..', '..', 'src', 'db', 'schema.sql'), // compiled fallback if asset copy was skipped
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new Error(`schema.sql not found (looked in: ${candidates.join(', ')})`);
}

/**
 * Applies schema.sql. Idempotent (everything is IF NOT EXISTS), so it is safe
 * to run on every boot — which is exactly what the Docker entrypoint does.
 */
export async function migrate(): Promise<void> {
  const sql = await readSchema();
  await pool.query(sql);
}

// Allow `tsx src/db/migrate.ts` / `node dist/db/migrate.js` as a standalone step.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  migrate()
    .then(() => {
      console.log('[migrate] schema applied successfully');
    })
    .catch((err) => {
      console.error('[migrate] failed', err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
