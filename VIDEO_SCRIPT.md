# 🎬 Screen-Recording Script (3–5 minutes)

A tight, confident walkthrough that hits every point the assessment asks for:
verbal codebase tour, the locking logic, and a **live** load test of 50+
concurrent requests. Aim for ~4 minutes. Speak to the *why*, not just the *what*.

> **Before you hit record**
> - `docker compose up --build` and wait for all three containers to be `healthy`
>   (`docker compose ps`). If ports clash, use
>   `PG_HOST_PORT=55432 REDIS_HOST_PORT=16380 docker compose up --build`.
> - Open two things side by side: your editor and a terminal.
> - Have `src/services/rideService.ts` open — it's the star.

---

### 0:00 – 0:30 · The problem (set the stakes)
> "This is a ride-booking acceptance service. It solves two real problems in an
> Uber-like app on mobile networks: first, **five drivers tapping Accept on the
> same ride in the same millisecond — only one can win**. Second, **a driver's
> network drops after we book but before the response arrives, so the app retries
> — we must not double-book**. I built it in Node, TypeScript and Fastify, with
> Postgres as the source of truth and Redis as a cache."

### 0:30 – 1:45 · The locking logic (open `rideService.ts`)
Point at the conditional `UPDATE`:
> "The anti-double-booking guarantee is **one atomic SQL statement**:
> `UPDATE rides SET status='accepted' WHERE id=$ride AND status='pending'`.
> Postgres row-locks the ride. Concurrent acceptors queue, and when they unblock,
> Postgres **re-checks** `status='pending'` against the now-committed row — it's
> `accepted`, so they update **zero rows** and get a `409`. Exactly one driver
> matches. No Redis lock needed for correctness — the database *is* the lock."

Scroll to the transaction / idempotency claim:
> "For retries, I use Stripe-style idempotency keys. Claiming the key, booking,
> and saving the response are in **one transaction**. A retry with the same key
> **blocks on the key's primary-key index** until the winner commits, then reads
> back the **exact stored response bytes** — so retries return an identical 200
> and create no extra booking."

Point at the `bookings` ledger / `UNIQUE(ride_id)`:
> "And here's my proof-of-correctness: every win writes a `bookings` row with a
> `UNIQUE(ride_id)` constraint — a second, independent guard. So I can prove
> there's exactly one booking, not just trust the status codes."

### 1:45 – 3:30 · Live load test (the money shot)
In the terminal:
```bash
node scripts/load-test.mjs 50      # bump to 100 if you want to flex
```
Narrate as it runs:
> "Scenario A fires **50 drivers at one ride simultaneously**. Watch the result:
> **one 200, forty-nine 409s** — and then it reads the database back:
> **bookings in DB: 1**. Zero duplicates, proven at the data layer.
>
> Scenario B simulates the network-drop retry: the **same key fired 50 times**.
> **All 50 return 200**, every body is **byte-identical**, and again **one
> booking**. That's idempotency working end to end."

Let the green **`✔ ALL CHECKS PASSED`** sit on screen for a beat.

*(Optional flourish — show the raw data):*
```bash
curl http://localhost:3000/api/v1/rides/<the-ride-id-from-scenario-A>
# → status:"accepted", driver_id:"driver_1", bookings_count:1
```

### 3:30 – 4:15 · Why it's robust (close strong)
> "A few design choices: the response is stored as exact bytes, not JSONB, so
> replays are byte-identical. Redis is **best-effort** — if it's down, we fall
> back to Postgres and correctness is unaffected. The connection pool is sized
> above peak concurrency so blocked losers don't starve it. And it's fully
> Dockerized — `docker compose up` brings up the app, Postgres and Redis with
> health checks and auto-migration. There's also an integration test suite
> covering the 50-way race, replays, and key-reuse. Thanks for watching."

---

**Checklist to show on camera:** codebase tour ✅ · locking logic explained ✅ ·
50+ concurrent live test ✅ · the `bookings in DB: 1` proof ✅.
