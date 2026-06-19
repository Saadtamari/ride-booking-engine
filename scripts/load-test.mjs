#!/usr/bin/env node
// ============================================================================
//  LIVE LOAD TEST — the script to run on camera.
//
//  Scenario A (Anti Double-Booking): N drivers, each with a UNIQUE
//    Idempotency-Key, slam 'accept' on the SAME ride at once.
//    Expect: exactly 1 × 200, the rest × 409, and provably 1 booking in the DB.
//
//  Scenario B (Idempotency / network-drop retry): the SAME request is fired
//    N times with the SAME Idempotency-Key.
//    Expect: every response is an identical 200, and still only 1 booking.
//
//  Usage:  node scripts/load-test.mjs [concurrency]      (default 50)
//          BASE_URL=http://localhost:3000 node scripts/load-test.mjs 100
// ============================================================================

import { randomUUID } from 'node:crypto';
import {
  BASE_URL, c, hr, banner, waitForServer, createRide, accept, inspect,
  fireSimultaneously, tally,
} from './lib.mjs';

const N = Number(process.argv[2] ?? 50);
let failures = 0;
const check = (cond, label) => {
  console.log(`   ${cond ? c.green('✔ PASS') : c.red('✘ FAIL')}  ${label}`);
  if (!cond) failures++;
};

console.log(c.bold(`\n🚗  Ride-Booking Engine — live load test  (target: ${c.cyan(BASE_URL)})`));
console.log(c.dim(`    concurrency = ${N} requests fired simultaneously per scenario`));
await waitForServer();

// ───────────────────────────── Scenario A ──────────────────────────────────
banner(`SCENARIO A · Anti Double-Booking — ${N} drivers race for ONE ride`);
const rideA = await createRide();
console.log(`   seeded pending ride: ${c.yellow(rideA)}`);

const thunksA = Array.from({ length: N }, (_, i) =>
  () => accept(rideA, `driver_${i + 1}`, randomUUID()), // unique driver + unique key each
);
const t0 = performance.now();
const resultsA = await fireSimultaneously(thunksA);
const elapsedA = performance.now() - t0;

const statusA = tally(resultsA);
const winners = resultsA.filter((r) => r.status === 200);
const conflicts = resultsA.filter((r) => r.status === 409);

console.log(`\n   ${c.bold('HTTP status breakdown:')}`);
console.log(`     ${c.green(`200 OK       : ${statusA[200] ?? 0}`)}   ${c.dim('(ride accepted)')}`);
console.log(`     ${c.yellow(`409 Conflict : ${statusA[409] ?? 0}`)}   ${c.dim('(already taken — clean rejection)')}`);
for (const s of Object.keys(statusA)) {
  if (s !== '200' && s !== '409') console.log(`     ${c.red(`${s}          : ${statusA[s]}`)} ${c.red('(unexpected!)')}`);
}
console.log(`   ${c.dim(`fired ${N} requests in ${elapsedA.toFixed(0)} ms`)}`);

// The decisive proof — read the data layer back.
const afterA = await inspect(rideA);
const winnerDriver = winners[0]?.body?.data?.driver_id;
console.log(`\n   ${c.bold('DATA-LAYER PROOF:')}`);
console.log(`     ride status      : ${c.cyan(afterA.data.ride.status)}`);
console.log(`     accepted driver  : ${c.cyan(afterA.data.ride.driver_id)}`);
console.log(`     ${c.bold(`bookings in DB   : ${c.magenta(afterA.data.bookings_count)}`)}  ${c.dim('(UNIQUE(ride_id) — can never exceed 1)')}`);

console.log('');
check(winners.length === 1, `exactly ONE driver got 200 OK (got ${winners.length})`);
check(conflicts.length === N - 1, `the other ${N - 1} got a clean 409 (got ${conflicts.length})`);
check(afterA.data.bookings_count === 1, `exactly 1 booking persisted — ZERO duplicates`);
check(afterA.data.ride.driver_id === winnerDriver, `DB winner matches the single 200 responder (${winnerDriver})`);

// ───────────────────────────── Scenario B ──────────────────────────────────
banner(`SCENARIO B · Idempotency — same key retried ${N}× (simulated network drops)`);
const rideB = await createRide();
const sharedKey = randomUUID();
const driverB = 'driver_42';
console.log(`   seeded pending ride: ${c.yellow(rideB)}`);
console.log(`   shared Idempotency-Key: ${c.dim(sharedKey)}`);

const thunksB = Array.from({ length: N }, () => () => accept(rideB, driverB, sharedKey));
const resultsB = await fireSimultaneously(thunksB);

const statusB = tally(resultsB);
const ok200 = resultsB.filter((r) => r.status === 200);
const replays = resultsB.filter((r) => r.replay);
const distinctBodies = new Set(resultsB.map((r) => JSON.stringify(r.body)));

console.log(`\n   ${c.bold('HTTP status breakdown:')}`);
console.log(`     ${c.green(`200 OK       : ${statusB[200] ?? 0}`)}   ${c.dim('(all return the SAME cached booking)')}`);
for (const s of Object.keys(statusB)) {
  if (s !== '200') console.log(`     ${c.red(`${s}          : ${statusB[s]}`)} ${c.red('(unexpected!)')}`);
}
console.log(`     ${c.dim(`served from idempotency record (replays): ${replays.length}/${N}`)}`);

const afterB = await inspect(rideB);
console.log(`\n   ${c.bold('DATA-LAYER PROOF:')}`);
console.log(`     accepted driver  : ${c.cyan(afterB.data.ride.driver_id)}`);
console.log(`     ${c.bold(`bookings in DB   : ${c.magenta(afterB.data.bookings_count)}`)}  ${c.dim('(retries created NO extra bookings)')}`);

console.log('');
check(ok200.length === N, `all ${N} retries returned 200 OK (got ${ok200.length})`);
check(distinctBodies.size === 1, `every response body was byte-identical (distinct bodies: ${distinctBodies.size})`);
check(afterB.data.bookings_count === 1, `the ride was booked exactly once despite ${N} retries`);
check(afterB.data.ride.driver_id === driverB, `booked by the expected driver (${driverB})`);

// ───────────────────────────── Verdict ─────────────────────────────────────
console.log('\n' + hr('═'));
if (failures === 0) {
  console.log('  ' + c.green(c.bold('✔ ALL CHECKS PASSED')) + c.dim('  — lock holds, idempotency holds, zero double-bookings.'));
} else {
  console.log('  ' + c.red(c.bold(`✗ ${failures} CHECK(S) FAILED`)));
}
console.log(hr('═') + '\n');
process.exit(failures === 0 ? 0 : 1);
