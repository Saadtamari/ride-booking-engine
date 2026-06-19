// Shared helpers for the seed / load-test / demo scripts.
// Pure Node — uses the built-in global `fetch` and `crypto` (Node >= 20).

import { randomUUID } from 'node:crypto';

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// ── tiny ANSI colour helpers (no dependency) ────────────────────────────────
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

export const hr = (ch = '─', n = 70) => c.gray(ch.repeat(n));
export function banner(title) {
  console.log('\n' + hr('═'));
  console.log('  ' + c.bold(c.cyan(title)));
  console.log(hr('═'));
}

// ── API helpers ─────────────────────────────────────────────────────────────
export async function waitForServer(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE_URL}/ready`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Server at ${BASE_URL} did not become ready in ${timeoutMs}ms`);
}

export async function createRide(rideId = `ride_${randomUUID().slice(0, 8)}`) {
  const r = await fetch(`${BASE_URL}/api/v1/rides`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ride_id: rideId, rider_id: `rider_${randomUUID().slice(0, 6)}` }),
  });
  if (!r.ok) throw new Error(`createRide failed: ${r.status} ${await r.text()}`);
  return rideId;
}

export async function accept(rideId, driverId, idempotencyKey) {
  const started = performance.now();
  const r = await fetch(`${BASE_URL}/api/v1/rides/accept`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({ ride_id: rideId, driver_id: driverId }),
  });
  const body = await r.json().catch(() => ({}));
  return {
    status: r.status,
    replay: r.headers.get('idempotent-replay') === 'true',
    body,
    ms: performance.now() - started,
    driverId,
  };
}

export async function inspect(rideId) {
  const r = await fetch(`${BASE_URL}/api/v1/rides/${rideId}`);
  return r.json();
}

/**
 * Fire N request thunks as close to simultaneously as possible: build them all
 * first, then release in a single Promise.all so they hit the server together.
 */
export async function fireSimultaneously(thunks) {
  return Promise.all(thunks.map((t) => t()));
}

export function tally(results) {
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return byStatus;
}
