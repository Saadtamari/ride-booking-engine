#!/usr/bin/env node
// Seed a single pending ride and print its id. Handy for manual curl testing.
//   node scripts/seed.mjs [ride_id]
import { createRide, waitForServer, c } from './lib.mjs';

await waitForServer();
const id = await createRide(process.argv[2] ?? undefined);
console.log(`${c.green('seeded pending ride:')} ${c.bold(id)}`);
console.log(c.dim(`try:  curl -s -X POST $BASE_URL/api/v1/rides/accept \\`));
console.log(c.dim(`        -H 'content-type: application/json' \\`));
console.log(c.dim(`        -H 'idempotency-key: '$(uuidgen) \\`));
console.log(c.dim(`        -d '{"ride_id":"${id}","driver_id":"driver_1"}'`));
