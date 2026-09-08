import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, test } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "ottodot-test-"));
const databaseUrl = `file:${join(directory, "test.db")}`;
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const env = { ...process.env, DATABASE_URL: databaseUrl };
const seed = () => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], { env });

beforeAll(async () => {
  await prisma.$connect();
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env });
  seed();
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

test("migration and repeat seeding produce the same complete fixtures", async () => {
  const read = () => prisma.trialClass.findMany({
    orderBy: { startsAt: "asc" },
    include: { bookings: { orderBy: { id: "asc" }, include: { paymentAttempts: true } } },
  });
  const first = await read();
  seed();
  expect(await read()).toEqual(first);
  expect(first.map((c) => [c.id, c.capacity, c.bookings.filter((b) => b.status === "confirmed").length])).toEqual([
    ["class-available", 4, 1], ["class-last-seat", 4, 3], ["class-full", 4, 4],
  ]);
  expect(await prisma.student.count()).toBe(6);
  expect(await prisma.booking.findUnique({ where: { id: "booking-failed" }, include: { paymentAttempts: true } })).toMatchObject({
    status: "payment_failed", paymentAttempts: [{ status: "failed" }],
  });
  expect(await prisma.booking.count({ where: {
    trialClassId: "class-available", studentId: "student-alice", status: "confirmed",
  } })).toBe(1);
  expect(await prisma.booking.count({ where: {
    trialClassId: "class-last-seat", studentId: { in: ["student-eve", "student-finn"] },
  } })).toBe(0);
  expect(first.flatMap((c) => c.bookings).filter((b) => b.status === "confirmed")
    .every((b) => b.paymentAttempts.length === 1 && b.paymentAttempts[0].status === "succeeded")).toBe(true);
});

test("defaults, foreign keys, indexes, and retry history support the booking contract", async () => {
  const indexes = await prisma.$queryRawUnsafe<{ name: string }[]>("PRAGMA index_list('Booking')");
  expect(indexes.map((i) => i.name)).toEqual(expect.arrayContaining([
    "Booking_trialClassId_status_idx", "Booking_studentId_trialClassId_status_idx",
  ]));
  await prisma.$transaction(async (tx) => {
    const trialClass = await tx.trialClass.create({ data: { title: "Default capacity", startsAt: new Date() } });
    expect(trialClass.capacity).toBe(4);
    await tx.trialClass.delete({ where: { id: trialClass.id } });
    const data = { studentId: "student-eve", trialClassId: "class-available" };
    const cancelled = await tx.booking.create({ data: { ...data, status: "cancelled" } });
    const retry = await tx.booking.create({ data });
    expect(retry.status).toBe("pending_payment");
    expect(await tx.booking.count({ where: { ...data, status: "confirmed" } })).toBe(0);
    await tx.booking.deleteMany({ where: { id: { in: [cancelled.id, retry.id] } } });
  });
  await expect(prisma.booking.create({ data: {
    studentId: "missing", trialClassId: "class-available",
  } })).rejects.toMatchObject({ code: "P2003" });
});

test("committed snapshot restores the same fixtures and migration history", async () => {
  const snapshotPath = join(directory, "snapshot.db");
  copyFileSync(resolve("prisma/demo.db"), snapshotPath);
  const snapshot = new PrismaClient({ datasourceUrl: `file:${snapshotPath}` });
  try {
    for (const table of ["Parent", "Student", "TrialClass", "Booking", "PaymentAttempt"]) {
      const query = `SELECT * FROM "${table}" ORDER BY id`;
      expect(await snapshot.$queryRawUnsafe(query)).toEqual(await prisma.$queryRawUnsafe(query));
    }
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "status"], {
      env: { ...env, DATABASE_URL: `file:${snapshotPath}` },
    });
  } finally {
    await snapshot.$disconnect();
  }
});
