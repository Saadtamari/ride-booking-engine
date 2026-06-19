// Copies non-TS assets that `tsc` ignores into dist/ after a build.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'db', 'schema.sql');
const to = join(root, 'dist', 'db', 'schema.sql');

await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
console.log(`[copy-assets] ${from} -> ${to}`);
