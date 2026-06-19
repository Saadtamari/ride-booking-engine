import { pool } from '../db/pool.js';

/**
 * Test/operational helpers used by the seed + demo scripts. Kept deliberately
 * separate from the core accept path so the booking logic stays focused.
 */

export interface RideRow {
  id: string;
  status: string;
  rider_id: string | null;
  driver_id: string | null;
  accepted_at: string | null;
  created_at: string;
}

/** Create a fresh `pending` ride. Idempotent on id so re-seeding is safe. */
export async function createRide(rideId: string, riderId?: string): Promise<RideRow> {
  const res = await pool.query(
    `INSERT INTO rides (id, rider_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (id) DO UPDATE SET rider_id = EXCLUDED.rider_id
     RETURNING id, status, rider_id, driver_id, accepted_at, created_at`,
    [rideId, riderId ?? null],
  );
  return res.rows[0];
}

/**
 * Inspect a ride together with its booking count. `bookings_count` is the
 * money shot for the demo: thanks to UNIQUE(ride_id) it is provably 0 or 1,
 * never more — no matter how many drivers raced.
 */
export async function getRideWithBookings(
  rideId: string,
): Promise<{ ride: RideRow; bookings_count: number } | null> {
  const rideRes = await pool.query(
    `SELECT id, status, rider_id, driver_id, accepted_at, created_at
       FROM rides WHERE id = $1`,
    [rideId],
  );
  if (rideRes.rowCount === 0) return null;

  const countRes = await pool.query(
    `SELECT count(*)::int AS c FROM bookings WHERE ride_id = $1`,
    [rideId],
  );
  return { ride: rideRes.rows[0], bookings_count: countRes.rows[0].c };
}
