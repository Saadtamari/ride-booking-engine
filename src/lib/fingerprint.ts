import { createHash } from 'node:crypto';

/**
 * A stable fingerprint of the *meaningful* request payload tied to an
 * Idempotency-Key. If a client later reuses the same key with a different
 * body, the fingerprints diverge and we can reject it (422) instead of
 * silently returning a response that belongs to a different request.
 */
export function computeFingerprint(input: {
  path: string;
  rideId: string;
  driverId: string;
}): string {
  return createHash('sha256')
    .update(`${input.path}\n${input.rideId}\n${input.driverId}`)
    .digest('hex');
}
