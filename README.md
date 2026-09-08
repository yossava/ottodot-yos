# Ottodot trial booking

Trial-class booking with Next.js, TypeScript, Prisma, and SQLite.
The database and seed data are set up. Booking and payment flows are not implemented yet.

## Quick start

Use Node.js 22.14 or newer and npm. No credentials or external services are required.

```bash
npm install
npm run db:setup
npm test
npm run dev
```

Open [localhost:3000](http://localhost:3000). The page is a placeholder.
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
Capacity limits and duplicate confirmation checks are not implemented yet.

SQLite requires no separate database server. Prisma 6.12.0 includes the SQLite connector
and avoids the config dependency flagged by `npm audit` in 6.19.3. Setup opens the SQLite
file before migration to work around a CLI error when the file is missing.

For PostgreSQL, confirmation would lock the class row in a transaction, recheck capacity
and duplicates, then update the booking. A partial unique index on confirmed student/class
pairs would also prevent duplicates. This is a planned production approach, not the current
SQLite implementation. See the [Prisma SQLite reference](https://docs.prisma.io/docs/orm/v6/overview/databases/sqlite).

## Verification

`npm test` uses a temporary database and checks:

- Migrations and repeatable seeding, including class counts and payment records.
- Defaults, foreign keys, indexes, and retry history.
- Snapshot data and migration status against a freshly seeded database.

Tests do not change `dev.db`. GitHub Actions runs setup, tests, and the production build.

Seat holds, real payments, authentication, and refunds are out of scope for this take-home.
