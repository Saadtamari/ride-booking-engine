-- ============================================================================
--  Schema for the Idempotent Ride-Booking Engine
--  Everything here is idempotent (IF NOT EXISTS) so it can be run on every boot.
-- ============================================================================

-- ── rides ───────────────────────────────────────────────────────────────────
-- The authoritative record. A ride is born 'pending'. The transition
-- pending -> accepted is the single moment we must serialize across drivers.
CREATE TABLE IF NOT EXISTS rides (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'cancelled', 'completed')),
    rider_id    TEXT,
    driver_id   TEXT,
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── bookings (audit ledger) ─────────────────────────────────────────────────
-- One row is written the instant a driver wins a ride. The UNIQUE(ride_id)
-- constraint is a second, independent guarantee against double-booking: even
-- if two transactions somehow both passed the conditional UPDATE (they can't),
-- the database itself would reject the duplicate. This is what lets the demo
-- *prove the negative*: SELECT count(*) is always exactly 1.
CREATE TABLE IF NOT EXISTS bookings (
    id         BIGSERIAL PRIMARY KEY,
    ride_id    TEXT NOT NULL REFERENCES rides(id),
    driver_id  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_bookings_ride UNIQUE (ride_id)
);

-- ── idempotency_keys ────────────────────────────────────────────────────────
-- Stripe-style idempotency. The PRIMARY KEY on `key` is the concurrency gate:
-- duplicate requests racing on the same key block on this unique index until
-- the winner COMMITs, then read back the cached response. `request_fingerprint`
-- detects the same key being reused with a *different* body (a client bug).
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key                 TEXT PRIMARY KEY,
    request_fingerprint TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'completed')),
    response_code       INTEGER,
    -- Stored as the EXACT serialized bytes (not JSONB) so a replayed retry is
    -- byte-for-byte identical to the original response. JSONB would reorder keys.
    response_body       TEXT,
    endpoint            TEXT NOT NULL DEFAULT '/api/v1/rides/accept',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys (created_at);
