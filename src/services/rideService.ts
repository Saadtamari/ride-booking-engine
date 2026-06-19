import { pool } from '../db/pool.js';
import { idempotencyCache } from '../redis/client.js';
import { computeFingerprint } from '../lib/fingerprint.js';
import { ok, fail } from '../lib/response.js';
import type { SuccessBody, ErrorBody } from '../lib/response.js';

const ENDPOINT = '/api/v1/rides/accept';

export interface AcceptInput {
  rideId: string;
  driverId: string;
  idempotencyKey: string;
}

export interface AcceptResult {
  statusCode: number;
  /** The canonical serialized JSON body, sent verbatim so replays are byte-identical. */
  payload: string;
  /** true when served from the idempotency record (a replay), not freshly processed. */
  replay: boolean;
}

const serialize = (body: SuccessBody | ErrorBody): string => JSON.stringify(body);

/**
 * Accept a ride.
 *
 * Two real-world hazards are handled here, and the ORDER of the guards matters:
 *
 *  1. ANTI DOUBLE-BOOKING — the authoritative serialization point is a single
 *     atomic, conditional UPDATE:
 *
 *         UPDATE rides SET status='accepted', driver_id=$d
 *         WHERE id=$r AND status='pending'
 *
 *     Postgres takes a row lock; concurrent acceptors queue, and when they
 *     unblock the `status='pending'` predicate is re-evaluated against the
 *     freshly-committed row — so exactly ONE driver ever matches. No advisory
 *     locks, no Redis required: the database is the source of truth.
 *
 *  2. NETWORK-DROP RETRIES — Stripe-style idempotency. Claiming the key, doing
 *     the booking, and recording the response all happen in ONE transaction.
 *     A duplicate request racing on the same key blocks on the key's PRIMARY
 *     KEY index until the winner commits, then reads back the cached response —
 *     so a retried request can never observe a half-finished "in_progress"
 *     state and can never create a second booking.
 */
export async function acceptRide(input: AcceptInput): Promise<AcceptResult> {
  const { rideId, driverId, idempotencyKey } = input;
  const fingerprint = computeFingerprint({ path: ENDPOINT, rideId, driverId });

  // ── Fast path: Redis idempotency cache ────────────────────────────────────
  // A retry after a dropped response is answered here without touching the DB.
  const cached = await idempotencyCache.get(idempotencyKey);
  if (cached) {
    if (cached.fingerprint !== fingerprint) return keyReuseConflict(idempotencyKey);
    return { statusCode: cached.statusCode, payload: cached.payload, replay: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Claim the idempotency key (the concurrency gate) ────────────────────
    // Winner inserts the row. Duplicates ON CONFLICT block on the PK index
    // until the winner COMMITs, then fall through to the replay branch below.
    const claim = await client.query(
      `INSERT INTO idempotency_keys (key, request_fingerprint, status, endpoint)
       VALUES ($1, $2, 'in_progress', $3)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [idempotencyKey, fingerprint, ENDPOINT],
    );

    if (claim.rowCount === 0) {
      // We are a duplicate of a key already claimed. The winner has committed.
      const existing = await client.query(
        `SELECT request_fingerprint, status, response_code, response_body
           FROM idempotency_keys WHERE key = $1`,
        [idempotencyKey],
      );
      await client.query('COMMIT');

      const row = existing.rows[0];
      if (!row) return serviceBusy(); // winner rolled back (crash) — ask to retry
      if (row.request_fingerprint !== fingerprint) return keyReuseConflict(idempotencyKey);
      if (row.status === 'completed') {
        const result: AcceptResult = {
          statusCode: row.response_code as number,
          payload: row.response_body as string,
          replay: true,
        };
        // Warm the Redis cache so the next replay skips the DB entirely.
        await idempotencyCache.set(idempotencyKey, {
          fingerprint,
          statusCode: result.statusCode,
          payload: result.payload,
        });
        return result;
      }
      // 'in_progress' only reachable after a crash; never under normal concurrency.
      return serviceBusy();
    }

    // ── We own the key — perform the authoritative atomic booking ───────────
    const booking = await client.query(
      `UPDATE rides
          SET status = 'accepted', driver_id = $2, accepted_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING id, driver_id, status, accepted_at`,
      [rideId, driverId],
    );

    let statusCode: number;
    let body: SuccessBody | ErrorBody;

    if (booking.rowCount === 1) {
      const r = booking.rows[0];
      // Append to the audit ledger. UNIQUE(ride_id) is a second, independent
      // guard against double-booking — this INSERT would throw on a duplicate.
      await client.query(`INSERT INTO bookings (ride_id, driver_id) VALUES ($1, $2)`, [
        rideId,
        driverId,
      ]);
      statusCode = 200;
      body = ok({
        ride_id: r.id,
        driver_id: r.driver_id,
        status: r.status,
        accepted_at: r.accepted_at,
      });
    } else {
      // 0 rows updated: the ride is not 'pending'. Disambiguate why.
      const ride = await client.query(
        `SELECT id, status, driver_id, accepted_at FROM rides WHERE id = $1`,
        [rideId],
      );
      if (ride.rowCount === 0) {
        statusCode = 404;
        body = fail('RIDE_NOT_FOUND', `Ride '${rideId}' does not exist.`, { ride_id: rideId });
      } else {
        const r = ride.rows[0];
        if (r.driver_id === driverId) {
          // This driver already holds the ride (via a different key) — idempotent success.
          statusCode = 200;
          body = ok({
            ride_id: r.id,
            driver_id: r.driver_id,
            status: r.status,
            accepted_at: r.accepted_at,
          });
        } else {
          statusCode = 409;
          body = fail(
            'RIDE_ALREADY_ACCEPTED',
            `Ride '${rideId}' has already been accepted by another driver.`,
            { ride_id: rideId, accepted_by: r.driver_id, accepted_at: r.accepted_at },
          );
        }
      }
    }

    const payload = serialize(body);

    // ── Record the outcome under the key (success AND failure are cached) ────
    // so a dropped 409/200 retried with the same key always returns the same bytes.
    await client.query(
      `UPDATE idempotency_keys
          SET status = 'completed', response_code = $2, response_body = $3
        WHERE key = $1`,
      [idempotencyKey, statusCode, payload],
    );

    await client.query('COMMIT');

    // Write-through to Redis (best-effort; never gates correctness).
    await idempotencyCache.set(idempotencyKey, { fingerprint, statusCode, payload });

    return { statusCode, payload, replay: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function keyReuseConflict(idempotencyKey: string): AcceptResult {
  return {
    statusCode: 422,
    payload: serialize(
      fail(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request body.',
        { idempotency_key: idempotencyKey },
      ),
    ),
    replay: false,
  };
}

function serviceBusy(): AcceptResult {
  return {
    statusCode: 409,
    payload: serialize(
      fail(
        'REQUEST_IN_PROGRESS',
        'A request with this Idempotency-Key is still being processed. Please retry.',
      ),
    ),
    replay: false,
  };
}
