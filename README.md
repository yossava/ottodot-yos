# Ottodot trial booking

A small trial-booking app focused on capacity, payment outcomes, and reproducible review.
This first slice provides the project and data foundation. Booking APIs, confirmation
concurrency, payments, and the booking UI are not implemented yet.

## Quick start

Use Node.js 22.14 or newer and npm. No credentials or external services are required.

```bash
npm install
npm run db:setup
npm test
npm run dev
```

Open [localhost:3000](http://localhost:3000) for the starter page. Setup creates `.env`
from `.env.example` only if absent, generates Prisma Client, opens the SQLite file, applies committed migrations,
and replaces the demo data. Existing `.env` settings are preserved.

```bash
npm run typecheck
npm run build
npx prisma studio
```

Studio lets you inspect all five models locally. Stop Studio and the app before resetting
or restoring their database.

## Demo data

| Class ID | Class | Confirmed / capacity |
| --- | --- | --- |
| `class-available` | Science Explorers | 1/4 |
| `class-last-seat` | Fractions Lab | 3/4 |
| `class-full` | Space Science | 4/4 |

These lines are also printed by the seeder. All students belong to `parent-demo`.
`student-alice` is already confirmed in `class-available` (the duplicate fixture).
`booking-failed` belongs to `student-eve` in that class, with a failed mock payment;
it consumes no seat. `student-eve` and `student-finn` are available as distinct last-seat
contenders. Confirmed fixtures each have a successful mock payment record.

Class dates and record timestamps are fixed demo values, not a live schedule.

## Database commands

| Command | Effect |
| --- | --- |
| `npm run db:setup` | Generate client, deploy migrations, replace fixture data |
| `npm run db:seed` | Replace all application data in the configured database |
| `npm run db:reset` | Drop and recreate the configured database, then seed |
| `npm run db:restore-demo` | Overwrite **only** `prisma/dev.db` with the committed snapshot |
| `npm run db:snapshot` | Regenerate `prisma/demo.db` using the migration and seed path (macOS/Linux shell) |

Seed/reset are destructive demo commands: check `DATABASE_URL` before running them.
Restore ignores custom database URLs and refuses when runtime SQLite sidecars exist.
Close all database clients before restoring even if there are no sidecars.
`prisma/dev.db` is local and ignored. `prisma/demo.db` is committed as a fallback;
the migration and seeder remain canonical. Snapshot recreation is optional for reviewers.

## Data contract and boundaries

`Parent → Student → Booking ← TrialClass`; each booking has independent `PaymentAttempt`
records. Capacity defaults to four. Booking statuses are `pending_payment`, `confirmed`,
`payment_failed`, `capacity_unavailable`, and `cancelled`; payment statuses are `succeeded`
and `failed`.

The two booking indexes support confirmed counts and student/class duplicate checks.
There is deliberately no unconditional unique constraint on student/class: historical
failed or cancelled attempts must permit retry. Prisma supplies enum types; SQLite does
not enforce these enum values for raw SQL writes. The schema alone does not prevent
overbooking or duplicate confirmation. Those guarantees belong to the later confirmation
slice and must be tested before the app accepts bookings.

SQLite makes local review self-contained. Prisma 6.12.0 is pinned for its built-in SQLite
connector without an additional driver adapter; it also avoids the config dependency
flagged by `npm audit` in 6.19.3. Setup explicitly opens SQLite before migration because
the migration CLI failed on an absent database file during verification. Production PostgreSQL would use a
transaction that locks the target class row, then rechecks duplicate and capacity before
confirmation, plus a confirmed-only partial unique index. SQLite and PostgreSQL locking
are not interchangeable. See the [Prisma SQLite reference](https://docs.prisma.io/docs/orm/v6/overview/databases/sqlite).

## Verification

`npm test` applies the real migration to a temporary database, seeds twice, checks exact
fixture equality and occupancy, verifies defaults/foreign keys/indexes/retry history, and
compares the committed snapshot with seeded tables and checks migration status. It never
resets `dev.db`. Build checks the minimal Next.js App Router shell.

Later slices add the booking services, atomic payment confirmation and race tests,
parent/teacher UI, and final submission documentation. Seat holds, real payments,
authentication, and refunds remain outside this take-home's implementation scope.
