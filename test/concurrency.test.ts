import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { pool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests — they exercise the real Postgres + Redis stack, so bring
 * the infra up first:  `docker compose up -d postgres redis`  then  `npm test`.
 */
let app: FastifyInstance;

async function seedRide(): Promise<string> {
  const id = `ride_${randomUUID().slice(0, 8)}`;
  await pool.query(`INSERT INTO rides (id, status) VALUES ($1, 'pending')`, [id]);
  return id;
}

async function accept(rideId: string, driverId: string, key: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/rides/accept',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    payload: { ride_id: rideId, driver_id: driverId },
  });
}

beforeAll(async () => {
  await migrate();
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
  await closeRedis();
});

describe('anti double-booking', () => {
  it('lets exactly one of 50 concurrent drivers win, the rest 409', async () => {
    const rideId = await seedRide();
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) => accept(rideId, `driver_${i}`, randomUUID())),
    );
    const codes = responses.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(49);

    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM bookings WHERE ride_id = $1`, [rideId]);
    expect(rows[0].c).toBe(1); // the negative, proven
  });

  it('returns a structured 409 body for the losers', async () => {
    const rideId = await seedRide();
    await accept(rideId, 'winner', randomUUID());
    const loser = await accept(rideId, 'loser', randomUUID());
    expect(loser.statusCode).toBe(409);
    const body = loser.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RIDE_ALREADY_ACCEPTED');
    expect(body.error.details.accepted_by).toBe('winner');
  });
});

describe('idempotency (network-drop retries)', () => {
  it('replays the identical cached response for the same key', async () => {
    const rideId = await seedRide();
    const key = randomUUID();
    const first = await accept(rideId, 'driver_42', key);
    const retry = await accept(rideId, 'driver_42', key);

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json()); // byte-identical
    expect(retry.headers['idempotent-replay']).toBe('true');

    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM bookings WHERE ride_id = $1`, [rideId]);
    expect(rows[0].c).toBe(1); // retry created no extra booking
  });

  it('handles 50 concurrent retries of the same key with all 200s and one booking', async () => {
    const rideId = await seedRide();
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => accept(rideId, 'driver_99', key)),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);

    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM bookings WHERE ride_id = $1`, [rideId]);
    expect(rows[0].c).toBe(1);
  });

  it('rejects the same key reused with a different body (422)', async () => {
    const rideId = await seedRide();
    const key = randomUUID();
    await accept(rideId, 'driver_a', key);
    const reused = await accept(rideId, 'driver_b', key); // different driver, same key
    expect(reused.statusCode).toBe(422);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('validation', () => {
  it('400 when the Idempotency-Key header is missing', async () => {
    const rideId = await seedRide();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rides/accept',
      headers: { 'content-type': 'application/json' },
      payload: { ride_id: rideId, driver_id: 'd1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('400 when the body is invalid', async () => {
    const res = await accept('', '', randomUUID());
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('404 for a ride that does not exist', async () => {
    const res = await accept(`ride_${randomUUID()}`, 'driver_x', randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('RIDE_NOT_FOUND');
  });
});
