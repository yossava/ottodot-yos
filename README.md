# Ottodot trial booking

Trial-class booking with Next.js, TypeScript, Prisma, and SQLite.
Includes a booking page, mock payments, advisory availability, and confirmed-student rosters.

See [AI usage](AI_USAGE.md).

Time spent: approximately **2 hours 10 minutes elapsed**, from the first commit
(`d70116c`, 8 September 2026 at 10:58:38 WIB) to the documentation checkpoint at
13:09:02 WIB that day. This includes review and waiting time; it is not an active-work
timer and excludes planning before the first commit and any later recording work.
Walkthrough recording: not yet linked.

## Quick start

Use Node.js 22.14 or newer and npm. No credentials or external services are required.

```bash
git clone https://github.com/yossava/ottodot-yos.git
cd ottodot-yos
npm install
npm run db:setup
npm test
npm run dev
```

Open [localhost:3000](http://localhost:3000).
Setup creates `.env` if missing, generates Prisma Client, creates the database,
applies migrations, and seeds demo data. It preserves existing `.env` settings.

```bash
npm run typecheck
npm run build
npx prisma studio
```

Use Prisma Studio to inspect the database. Stop Studio and the app before resetting
or restoring it.

## Demo data

Choose Eve and Science Explorers, then book a trial. The booking stays pending and
the roster does not change until **Simulate Successful Payment** confirms it.
Use **Start a new booking** to try a failed payment with Finn, a duplicate with
Alice, or a full class with Space Science. **Refresh** reloads availability and the roster.

Payment and booking outcomes are shown separately. If payment succeeds but the last
seat is gone, the page shows `capacity_unavailable` with disabled refund and class-transfer
options. These actions are deferred; no real money is charged. Use **Refresh booking status**
to load an outcome processed in another tab or through the API.

| Class ID | Class | Confirmed / capacity |
| --- | --- | --- |
| `class-available` | Science Explorers | 1/4 |
| `class-last-seat` | Fractions Lab | 3/4 |
| `class-full` | Space Science | 4/4 |

All students belong to `parent-demo`.

- `student-alice` is confirmed in `class-available`, for testing duplicate bookings.
- `booking-failed` belongs to `student-eve` in the same class. Its payment failed, so it consumes no seat.
- `student-eve` and `student-finn` have no bookings in `class-last-seat`, for testing the last-seat race.
- Every confirmed booking has a successful mock payment record.

Dates and record IDs are fixed so repeated seeds produce the same data.

## Database commands

| Command | Effect |
| --- | --- |
| `npm run db:setup` | Generate client, deploy migrations, replace fixture data |
| `npm run db:seed` | Replace all application data in the configured database |
| `npm run db:reset` | Drop and recreate the configured database, then seed |
| `npm run db:restore-demo` | Overwrite `prisma/dev.db` with the committed snapshot |
| `npm run db:snapshot` | Regenerate `prisma/demo.db` using the migration and seed path (macOS/Linux shell) |

Setup, seed, and reset replace existing data. Check `DATABASE_URL` before running them.
Restore always targets `prisma/dev.db`, regardless of `DATABASE_URL`. It refuses to run
if SQLite journal, WAL, or SHM files exist. Close all database clients before restoring.

`prisma/dev.db` is ignored by Git. `prisma/demo.db` is a committed backup generated from
the migrations and seeder. Use `db:setup` for a fresh database; use `db:restore-demo`
to restore the backup.

## Schema

`Parent → Student → Booking ← TrialClass`; each booking has independent `PaymentAttempt`
records. Capacity defaults to four. Booking statuses are `pending_payment`, `confirmed`,
`payment_failed`, `capacity_unavailable`, and `cancelled`; payment statuses are `succeeded`
and `failed`.

Booking indexes cover `(trialClassId, status)` and `(studentId, trialClassId, status)`.
Student/class pairs are not unique because failed or cancelled bookings must allow retries.
Prisma checks enum values; raw SQLite writes can bypass those checks.
Booking creation rejects confirmed duplicates and currently full classes. Pending bookings
do not reserve seats. Payment processing rechecks capacity and duplicates inside a write
transaction before confirming a booking.

SQLite requires no separate database server. Prisma 6.12.0 includes the SQLite connector
and avoids the config dependency flagged by `npm audit` in 6.19.3. Setup opens the SQLite
file before migration to work around a CLI error when the file is missing.

For PostgreSQL, confirmation would lock the class row in a transaction, recheck capacity
and duplicates, then update the booking. A partial unique index on confirmed student/class
pairs would also prevent duplicates. This is a planned production approach, not the current
SQLite implementation. See the [Prisma SQLite reference](https://docs.prisma.io/docs/orm/v6/overview/databases/sqlite).

## Verification

Browser smoke tests use Chromium and a temporary copy of the demo database:

```bash
npx playwright install chromium
npm run test:e2e
```

This builds the app and starts a separate server on port 3200. Keep that port free.
Tests cover successful payment and roster updates, failed payment without roster membership,
recovery after a lost payment response, and the pre-payment check when another student
takes the last seat. The temporary database is removed when the test server stops;
`dev.db` is untouched. The command rebuilds `.next`; stop any production server
using that build before running it.
Playwright traces for failed tests are saved under `test-results/`.

`npm test` uses a temporary database and checks:

- Migrations and repeatable seeding, including class counts and payment records.
- Defaults, foreign keys, indexes, and retry history.
- Snapshot data and migration status against a freshly seeded database.

Tests do not change `dev.db`. GitHub Actions runs setup, tests, and the production build.

Booking tests also cover input validation, pending bookings, retries, full classes,
confirmed-only rosters, stale availability, and HTTP responses. They use a separate
temporary SQLite database and reseed before each test.
UI rendering tests cover separate booking/payment statuses and disabled recovery controls.

### Scenario coverage

Verified from a fresh clone of `71cf64b` on 8 September 2026 with Node 22.14.0 and
npm 10.9.2 on macOS: install, database setup, 41 Vitest cases, four Chromium cases,
typecheck, production build, seed/reset/restore, and migration status all passed.
No existing `.env`, runtime database, or copied `node_modules` was used.
The development server was checked on port 3300 to leave an existing demo on 3000 running.

The test names below are in `tests/bookings.test.ts` unless noted otherwise.

| Scenario | Test name | Expected result |
| --- | --- | --- |
| Successful payment | `successful payment confirms a booking and adds the student to the roster` | `succeeded` / `confirmed`; student joins roster |
| Failed payment and retry | `failed payment consumes no seat and a new booking can succeed` | `payment_failed`; no roster change; new attempt can confirm |
| Duplicate or full class | `rejects a confirmed duplicate and a full class without inserting a booking` | Conflict; no new booking |
| Confirmed-only roster | `roster ignores payment results and all unconfirmed statuses` | Pending, failed, cancelled, and capacity-unavailable bookings excluded |
| Last-seat race across processes | `separate processes competing for the last seat cannot overbook` | Two successful mock payments; exactly one new confirmation; 4/4 roster |
| Repeated callback | `simultaneous callbacks on one booking create only one payment attempt` | One payment attempt; no double confirmation |
| Lost payment response | `a lost successful payment response recovers the result and refreshes the roster` in `e2e/booking.e2e.ts` | Authoritative status recovered; counts and roster refreshed |

Run just the cross-process race check:

```bash
npm test -- tests/bookings.test.ts -t 'separate processes competing for the last seat cannot overbook'
```

## API

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/students` | Students ordered by name |
| GET | `/api/trial-classes` | Classes with confirmed count, seats remaining, and `availability: "advisory"` |
| POST | `/api/bookings` | Create a `pending_payment` booking (201) |
| POST | `/api/mock-payments` | Process a mock success/failure and return payment and booking outcomes |
| GET | `/api/bookings/:id` | Booking and payment attempts |
| GET | `/api/trial-classes/:id/roster` | Class details, confirmed count, and confirmed students |

```bash
curl http://localhost:3000/api/trial-classes
curl -i http://localhost:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"studentId":"student-eve","trialClassId":"class-available"}'
curl http://localhost:3000/api/trial-classes/class-available/roster
```

Read the returned booking ID at `/api/bookings/:id`. Until payment, the booking stays pending;
the roster still lists Alice and availability remains 1/4 confirmed.
Use `student-alice` to test a duplicate, or `class-full` with Eve to test capacity.
Both return 409 and create no booking. Eve's earlier failed payment does not block a new attempt.

Errors use `{"error":{"code":"...","message":"..."}}`: invalid input returns 400,
missing records 404, and duplicate/full conflicts 409. Responses use `Cache-Control: no-store`.
Recognized database contention returns 503 `DATABASE_BUSY`; retry the request shortly.
Only `studentId` and `trialClassId` are used from the POST body; callers cannot set booking status.

Availability can change after a read. Refreshing before payment can catch a full class,
but only confirmation can guarantee a seat. The page checks availability immediately
before starting mock payment; this check does not hold a seat.
This local demo has no authentication; all seeded students and bookings are accessible.

Seat holds, real payments, authentication, and refunds are out of scope for this take-home.

## Mock payments

```bash
curl -i http://localhost:3000/api/mock-payments \
  -H 'Content-Type: application/json' \
  -d '{"bookingId":"<booking ID>","outcome":"success"}'
```

Use `failure` to simulate a failed payment. Only pending bookings can be processed.
The response contains separate `payment` and `booking` records, plus a nullable `reason`.

| Payment | Booking | Reason |
| --- | --- | --- |
| `succeeded` | `confirmed` | `null` |
| `failed` | `payment_failed` | `null` |
| `succeeded` | `capacity_unavailable` | `CAPACITY_UNAVAILABLE` |
| `succeeded` | `cancelled` | `DUPLICATE_CONFIRMED_BOOKING` |

A processed mock outcome returns 200, including a successful payment without a seat.
Repeating a request on a terminal booking returns 409 `BOOKING_NOT_PAYABLE` without another
payment attempt. Invalid requests return 400; missing bookings return 404. Retries after a
failed payment require a new booking.

`cancelled` covers a second pending attempt for a student who has since confirmed the same
class. Its successful payment remains recorded. The duplicate reason is returned by the
payment endpoint; the stored records contain the cancelled booking and successful payment.

No money moves in this demo. A real provider integration would need idempotency keys and
webhook handling, with authorization/capture or void/refund handling when a paid booking
cannot confirm. Expiring checkout holds are another option, deferred from this take-home.

## Last-seat race

Through the API, create two pending bookings in `class-last-seat`, using Eve and Finn. Both can reach payment
because pending bookings do not reserve seats. Pay Finn first, then Eve: Finn confirms,
Eve becomes `capacity_unavailable`, both successful payments are recorded, and the roster
has exactly four students. Sending the payment requests together must produce the same counts,
although either student can win.

In the UI, paying after the other booking has already confirmed will normally be blocked
by the pre-payment check. To show the paid-without-seat outcome deliberately, process both
payments through the API, then refresh the losing booking's status in its original browser tab.
The concurrent automated test proves the remaining race after an availability check.

The SQLite payment transaction begins with a no-op `UPDATE` on the booking, before reading
its status or class capacity. This acquires SQLite's database-wide write lock. While it is held,
the service validates the pending state, records the mock payment, checks duplicates and
capacity, and updates the booking. Competing writers must wait or fail with a lock error.
All reads use the transaction client. There is no application-level mutex.

Known lock/conflict errors allow three total transaction attempts (two retries). Exhaustion returns
503 `DATABASE_BUSY`. Other errors propagate and roll back the transaction. Since the payment
is simulated in SQLite, rollback removes both changes; this would not undo a real provider charge.
The payment service cannot protect arbitrary SQL writes that bypass it.

SQLite serializes writes across the whole database, including unrelated classes. For production
PostgreSQL, lock the target class row with `SELECT ... FOR UPDATE` inside a transaction,
then reread the booking, check duplicates and capacity, and confirm or reject before committing.
Add a partial unique index on `(studentId, trialClassId) WHERE status = 'confirmed'` as a
database constraint. Payment network calls should run outside that transaction.

See [SQLite transactions](https://www.sqlite.org/lang_transaction.html) and
[Prisma transaction errors and retries](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).

Payment tests cover success/failure, full capacity, duplicate confirmation, repeated callbacks,
rollback, and bounded retries. The last-seat tests run both concurrent service calls and two
independent processes released from a shared start barrier. They require both payment calls to
finish successfully with one confirmed booking and two successful payment attempts; a lock
error does not count as a passing race test.

## Responsibility boundaries

| Layer | Responsibility |
| --- | --- |
| UI | Required selections, advisory availability, pre-payment refresh, in-flight controls, and separate payment/booking feedback. No optimistic confirmation. |
| Backend | Input validation, duplicate/capacity checks, status transitions, and bounded payment retries. Route handlers delegate to `lib/bookings.ts` and `lib/payments.ts`. |
| Database | Foreign keys, indexes, persistence, and transaction atomicity. SQLite's write lock serializes confirmation; service checks enforce capacity and confirmed duplicates. |
| Background work | None in this demo. A real integration would need webhook retries, reconciliation, stale-pending cleanup, and void/refund processing. |

## Assumptions and scope

I use one synthetic parent and pre-existing children. Registration and login are not needed
to exercise the requested booking flow; this is not a publicly deployable authenticated app.
Classes have a stored capacity, seeded at four, and times are displayed in WIB.
The mock payment result and booking update share one SQLite transaction. That atomicity
does not extend to an external payment provider.

I deferred seat holds, regular enrollment, real payments, working refunds/class transfers,
notifications, waitlists, and admin CRUD. An expiring hold remains a good production
candidate, but needs release on cancellation and failure plus automatic expiry so abandoned
checkouts do not indefinitely block seats. The take-home instead demonstrates authoritative
confirmation under contention and makes the paid-without-seat outcome explicit.

## Monitoring after release

These checks are planned, not implemented monitoring:

- Alert on confirmed counts above capacity or duplicate confirmed student/class pairs.
- Track successful payments without confirmed bookings until void/refund reconciliation finishes.
- Track payment failures, database-busy responses, unexpected 5xx errors, and transaction latency.
- Review ageing pending bookings and repeated callbacks. With a real provider, also track webhook failures and refund delays.

## Next steps

Before accepting real payments, add identity and ownership checks, provider idempotency and
webhook handling, and an explicit void/refund lifecycle. Choose between short-lived checkout
holds and payment authorization/capture based on the provider's capabilities. For higher
write throughput, move to PostgreSQL with class-row locking and a confirmed-only unique index.
Keep the race and lost-response tests when replacing those pieces.
