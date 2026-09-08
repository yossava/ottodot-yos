# Ottodot trial booking

Trial-class booking with Next.js, TypeScript, Prisma, and SQLite.
Includes a booking page, mock payments, live availability, and confirmed-student rosters.

## Quick start

Use Node.js 22.14 or newer and npm. No credentials or external services are required.

```bash
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
and the pre-payment check when another student takes the last seat. The temporary database
is removed when the test server stops; `dev.db` and the running demo are untouched.
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

Create two pending bookings in `class-last-seat`, using Eve and Finn. Both can reach payment
because pending bookings do not reserve seats. Pay Finn first, then Eve: Finn confirms,
Eve becomes `capacity_unavailable`, both successful payments are recorded, and the roster
has exactly four students. Sending the payment requests together must produce the same counts,
although either student can win.

The SQLite payment transaction begins with a no-op `UPDATE` on the booking, before reading
its status or class capacity. This acquires SQLite's database-wide write lock. While it is held,
the service validates the pending state, records the mock payment, checks duplicates and
capacity, and updates the booking. Competing writers must wait or fail with a lock error.
All reads use the transaction client. There is no application-level mutex.

Known lock/conflict errors retry the entire transaction up to three times. Exhaustion returns
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
