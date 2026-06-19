#!/usr/bin/env node
// ============================================================================
//  Guided demo for the screen recording. Prints a short narration, waits for
//  the server, then runs the full load test. Use this one on camera.
//    node scripts/demo.mjs [concurrency]
// ============================================================================
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BASE_URL, c, banner, waitForServer } from './lib.mjs';

const N = process.argv[2] ?? '50';
const here = dirname(fileURLToPath(import.meta.url));

banner('IDEMPOTENT RIDE-BOOKING ENGINE · LIVE DEMO');
console.log(`  Target service : ${c.cyan(BASE_URL)}`);
console.log(`  Concurrency    : ${c.cyan(N)} simultaneous requests per scenario`);
console.log('');
console.log(c.dim('  What you are about to see:'));
console.log(c.dim('   • Scenario A — ' + N + ' drivers hit ACCEPT on the same ride at once.'));
console.log(c.dim('     Only ONE wins (200). Everyone else gets a clean 409. DB proves 1 booking.'));
console.log(c.dim('   • Scenario B — the same request is retried ' + N + '× (network drops).'));
console.log(c.dim('     Every retry returns the identical cached 200. Still just 1 booking.'));

await waitForServer();
console.log(c.green('\n  ✔ service is ready — starting load test…'));

const child = spawn(process.execPath, [join(here, 'load-test.mjs'), String(N)], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 0));
