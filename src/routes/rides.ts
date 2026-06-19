import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { acceptRide } from '../services/rideService.js';
import { createRide, getRideWithBookings } from '../services/rideAdminService.js';
import { fail } from '../lib/response.js';

const acceptBodySchema = z.object({
  ride_id: z.string().min(1, 'ride_id is required'),
  driver_id: z.string().min(1, 'driver_id is required'),
});

const createBodySchema = z.object({
  ride_id: z.string().min(1, 'ride_id is required'),
  rider_id: z.string().min(1).optional(),
});

export async function ridesRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/rides/accept — the core endpoint ─────────────────────────
  app.post('/api/v1/rides/accept', async (request, reply) => {
    // 1) Idempotency-Key header is mandatory (case-insensitive per HTTP).
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      return reply
        .code(400)
        .send(fail('IDEMPOTENCY_KEY_REQUIRED', 'The "Idempotency-Key" header is required.'));
    }

    // 2) Validate the JSON body.
    const parsed = acceptBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        fail('VALIDATION_ERROR', 'Invalid request body.', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }),
      );
    }

    // 3) Execute the booking. All concurrency/idempotency logic lives in the service.
    const result = await acceptRide({
      rideId: parsed.data.ride_id,
      driverId: parsed.data.driver_id,
      idempotencyKey: idempotencyKey.trim(),
    });

    return reply
      .code(result.statusCode)
      .header('Idempotent-Replay', String(result.replay))
      .type('application/json')
      .send(result.payload); // raw bytes — byte-identical across replays
  });

  // ── POST /api/v1/rides — test helper: create a pending ride ───────────────
  app.post('/api/v1/rides', async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        fail('VALIDATION_ERROR', 'Invalid request body.', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }),
      );
    }
    const ride = await createRide(parsed.data.ride_id, parsed.data.rider_id);
    return reply.code(201).send({ success: true, data: ride });
  });

  // ── GET /api/v1/rides/:id — inspect ride + provable booking count ─────────
  app.get<{ Params: { id: string } }>('/api/v1/rides/:id', async (request, reply) => {
    const found = await getRideWithBookings(request.params.id);
    if (!found) {
      return reply
        .code(404)
        .send(fail('RIDE_NOT_FOUND', `Ride '${request.params.id}' does not exist.`));
    }
    return reply.code(200).send({ success: true, data: found });
  });
}
