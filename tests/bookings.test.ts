import { execFileSync, fork } from "node:child_process";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { prisma } from "../lib/prisma";
import { createTrialBooking, getBooking, getTrialClassRoster, listStudents, listTrialClasses } from "../lib/bookings";
import { apiResponse } from "../lib/api";
import { POST } from "../app/api/bookings/route";
import { GET as studentsGET } from "../app/api/students/route";
import { GET as classesGET } from "../app/api/trial-classes/route";
import { GET as bookingGET } from "../app/api/bookings/[id]/route";
import { GET as rosterGET } from "../app/api/trial-classes/[id]/roster/route";
import { processMockPayment } from "../lib/payments";
import { POST as paymentPOST } from "../app/api/mock-payments/route";
import { Prisma } from "@prisma/client";

const { directory, databaseUrl } = await vi.hoisted(async () => {
  const { mkdtempSync, copyFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "ottodot-bookings-"));
  const path = join(directory, "test.db");
  copyFileSync("prisma/demo.db", path);
  return { directory, databaseUrl: `file:${path}` };
});

vi.mock("../lib/prisma", async (importOriginal) => {
  const { PrismaClient } = await import("@prisma/client");
  return { ...await importOriginal<typeof import("../lib/prisma")>(), prisma: new PrismaClient({ datasourceUrl: databaseUrl }) };
});

beforeEach(() => {
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

const input = { studentId: "student-eve", trialClassId: "class-available" };
const request = (body: unknown) => new Request("http://localhost/api/bookings", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("lists students and advisory seats from confirmed bookings", async () => {
  expect((await listStudents()).map((s) => s.name)).toEqual(["Alice", "Ben", "Cara", "Dan", "Eve", "Finn"]);
  expect((await listTrialClasses()).map((c) => [c.confirmedCount, c.seatsRemaining, c.availability])).toEqual([
    [1, 3, "advisory"], [3, 1, "advisory"], [4, 0, "advisory"],
  ]);
});

test("creates a pending booking without changing seats or roster", async () => {
  const before = await listTrialClasses();
  const booking = await createTrialBooking({ ...input, status: "confirmed" });
  expect(booking.status).toBe("pending_payment");
  expect(await getBooking(booking.id)).toMatchObject({ ...input, status: "pending_payment", paymentAttempts: [] });
  expect(await listTrialClasses()).toEqual(before);
  expect(await getTrialClassRoster(input.trialClassId)).toMatchObject({
    confirmedCount: 1, capacity: 4, students: [{ id: "student-alice", name: "Alice" }],
  });
});

test.each(["payment_failed", "cancelled", "capacity_unavailable"] as const)("allows a new attempt after %s", async (status) => {
  await prisma.booking.update({ where: { id: "booking-failed" }, data: { status } });
  expect(await createTrialBooking(input)).toMatchObject({ ...input, status: "pending_payment" });
});

test("rejects a confirmed duplicate and a full class without inserting a booking", async () => {
  const count = await prisma.booking.count();
  await expect(createTrialBooking({ ...input, studentId: "student-alice" })).rejects.toMatchObject({ code: "DUPLICATE_CONFIRMED_BOOKING" });
  await expect(createTrialBooking({ ...input, trialClassId: "class-full" })).rejects.toMatchObject({ code: "CAPACITY_UNAVAILABLE" });
  expect(await prisma.booking.count()).toBe(count);
});

test("rejects missing and malformed IDs before writing", async () => {
  for (const body of [null, [], {}, "booking", { ...input, studentId: 1 }, { ...input, trialClassId: " " }]) {
    await expect(createTrialBooking(body)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  await expect(createTrialBooking({ ...input, studentId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(createTrialBooking({ ...input, trialClassId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getBooking("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getTrialClassRoster("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await prisma.booking.count()).toBe(9);
});

test("roster ignores payment results and all unconfirmed statuses", async () => {
  for (const status of ["pending_payment", "payment_failed", "cancelled", "capacity_unavailable"] as const) {
    await prisma.booking.create({ data: {
      ...input, status,
      paymentAttempts: { create: { provider: "mock", providerReference: `test-${status}`, status: "succeeded" } },
    } });
  }
  expect((await getTrialClassRoster(input.trialClassId)).students).toEqual([{ id: "student-alice", name: "Alice" }]);
  expect((await listTrialClasses())[0].seatsRemaining).toBe(3);
});

test("pending attempts do not hold the last seat; a later request rechecks availability", async () => {
  const trialClassId = "class-last-seat";
  const a = await createTrialBooking({ studentId: "student-eve", trialClassId });
  const b = await createTrialBooking({ studentId: "student-finn", trialClassId });
  expect((await listTrialClasses())[1].seatsRemaining).toBe(1);
  // Another booking takes the seat after availability was read.
  await prisma.booking.update({ where: { id: b.id }, data: { status: "confirmed" } });
  expect((await getBooking(a.id)).status).toBe("pending_payment");
  await expect(createTrialBooking({ studentId: "student-dan", trialClassId })).rejects.toMatchObject({ code: "CAPACITY_UNAVAILABLE" });
  expect((await listTrialClasses())[1].seatsRemaining).toBe(0);
});

test("availability never reports negative seats", async () => {
  await prisma.trialClass.update({ where: { id: "class-full" }, data: { capacity: 3 } });
  expect((await listTrialClasses())[2]).toMatchObject({ confirmedCount: 4, capacity: 3, seatsRemaining: 0 });
});

test("routes return 201, readable booking state, lists, and confirmed roster", async () => {
  const response = await POST(request(input));
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const booking = await response.json();
  expect(booking.status).toBe("pending_payment");
  const context = { params: Promise.resolve({ id: booking.id }) };
  expect(await (await bookingGET(request(input), context)).json()).toMatchObject({ id: booking.id, paymentAttempts: [] });
  expect((await (await studentsGET()).json()).length).toBe(6);
  expect((await (await classesGET()).json())[0].availability).toBe("advisory");
  const roster = await rosterGET(request(input), { params: Promise.resolve({ id: input.trialClassId }) });
  expect(await roster.json()).toMatchObject({ confirmedCount: 1, students: [{ id: "student-alice", name: "Alice" }] });
});

test("routes map malformed requests, missing records, and conflicts to stable errors", async () => {
  const cases: [unknown, number, string][] = [
    [null, 400, "INVALID_INPUT"],
    [{ ...input, studentId: "missing" }, 404, "NOT_FOUND"],
    [{ ...input, studentId: "student-alice" }, 409, "DUPLICATE_CONFIRMED_BOOKING"],
    [{ ...input, trialClassId: "class-full" }, 409, "CAPACITY_UNAVAILABLE"],
  ];
  for (const [body, status, code] of cases) {
    const response = await POST(request(body));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  }
  const malformed = await POST(new Request("http://localhost/api/bookings", { method: "POST", body: "{" }));
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
  for (const route of [bookingGET, rosterGET]) {
    expect((await route(request(input), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
  }
});

test("unexpected failures return a generic 500 without internal details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await apiResponse(async () => { throw new Error("private database path"); });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Unable to complete the request." } });
    expect(log).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});

test.each([
  ["P1008", undefined], ["P2034", undefined],
  ["P2010", { code: "5" }], ["P2010", { code: "6" }],
] as const)("booking creation maps database contention %s to 503", async (code, meta) => {
  const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
    new Prisma.PrismaClientKnownRequestError("busy", { code, meta, clientVersion: "6.12.0" }),
  );
  try {
    const response = await POST(request(input));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DATABASE_BUSY" } });
    expect(transaction).toHaveBeenCalledTimes(1);
  } finally { transaction.mockRestore(); }
});

test("unrelated database errors remain internal failures", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await apiResponse(async () => {
      throw new Prisma.PrismaClientKnownRequestError("SQL error", { code: "P2010", meta: { code: "1" }, clientVersion: "6.12.0" });
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  } finally { log.mockRestore(); }
});

test("successful payment confirms a booking and adds the student to the roster", async () => {
  const pending = await createTrialBooking(input);
  const response = await paymentPOST(request({ bookingId: pending.id, outcome: "success" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    payment: { bookingId: pending.id, status: "succeeded", provider: "mock" },
    booking: { id: pending.id, status: "confirmed" }, reason: null,
  });
  expect((await getTrialClassRoster(input.trialClassId)).students.map((s) => s.name)).toEqual(["Alice", "Eve"]);
});

test("failed payment consumes no seat and a new booking can succeed", async () => {
  const pending = await createTrialBooking(input);
  const before = await getTrialClassRoster(input.trialClassId);
  expect(await processMockPayment({ bookingId: pending.id, outcome: "failure" })).toMatchObject({
    payment: { status: "failed" }, booking: { status: "payment_failed" },
  });
  expect(await getTrialClassRoster(input.trialClassId)).toEqual(before);
  const retry = await createTrialBooking(input);
  expect((await processMockPayment({ bookingId: retry.id, outcome: "success" })).booking.status).toBe("confirmed");
});

test("B takes the last seat and A retains its successful payment without a seat", async () => {
  const a = await createTrialBooking({ ...input, trialClassId: "class-last-seat" });
  const b = await createTrialBooking({ studentId: "student-finn", trialClassId: "class-last-seat" });
  expect((await processMockPayment({ bookingId: b.id, outcome: "success" })).booking.status).toBe("confirmed");
  expect(await processMockPayment({ bookingId: a.id, outcome: "success" })).toMatchObject({
    payment: { status: "succeeded" }, booking: { status: "capacity_unavailable" }, reason: "CAPACITY_UNAVAILABLE",
  });
  expect((await getTrialClassRoster("class-last-seat")).confirmedCount).toBe(4);
  expect((await getBooking(a.id)).paymentAttempts).toHaveLength(1);
});

test("concurrent last-seat payments both settle with exactly one confirmed booking", async () => {
  const a = await createTrialBooking({ ...input, trialClassId: "class-last-seat" });
  const b = await createTrialBooking({ studentId: "student-finn", trialClassId: "class-last-seat" });
  const results = await Promise.all([a, b].map((booking) => processMockPayment({ bookingId: booking.id, outcome: "success" })));
  expect(results.map((r) => r.booking.status).sort()).toEqual(["capacity_unavailable", "confirmed"]);
  expect(results.every((r) => r.payment.status === "succeeded")).toBe(true);
  expect((await getTrialClassRoster("class-last-seat")).confirmedCount).toBe(4);
});

test("two pending attempts for the same student cannot both confirm", async () => {
  const a = await createTrialBooking(input);
  const b = await createTrialBooking(input);
  const results = await Promise.all([a, b].map((booking) => processMockPayment({ bookingId: booking.id, outcome: "success" })));
  expect(results.map((r) => r.booking.status).sort()).toEqual(["cancelled", "confirmed"]);
  expect(results.find((r) => r.booking.status === "cancelled")).toMatchObject({
    payment: { status: "succeeded" }, reason: "DUPLICATE_CONFIRMED_BOOKING",
  });
  expect(await prisma.booking.count({ where: { ...input, status: "confirmed" } })).toBe(1);
});

test("simultaneous callbacks on one booking create only one payment attempt", async () => {
  const pending = await createTrialBooking(input);
  const results = await Promise.allSettled(["success", "failure"].map((outcome) => processMockPayment({ bookingId: pending.id, outcome })));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "BOOKING_NOT_PAYABLE" } });
  const booking = await getBooking(pending.id);
  expect(booking.paymentAttempts).toHaveLength(1);
  expect(booking.status).toBe(booking.paymentAttempts[0].status === "succeeded" ? "confirmed" : "payment_failed");
});

test.each(["confirmed", "payment_failed", "cancelled", "capacity_unavailable"] as const)("rejects payment on %s without another attempt", async (status) => {
  const pending = await createTrialBooking(input);
  await prisma.booking.update({ where: { id: pending.id }, data: { status } });
  const response = await paymentPOST(request({ bookingId: pending.id, outcome: "success" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "BOOKING_NOT_PAYABLE" } });
  expect((await getBooking(pending.id)).paymentAttempts).toHaveLength(0);
});

test("payment rejects invalid input and missing bookings", async () => {
  for (const body of [null, [], {}, { bookingId: " ", outcome: "success" }, { bookingId: "x", outcome: "confirmed" }]) {
    expect((await paymentPOST(request(body))).status).toBe(400);
  }
  expect((await paymentPOST(new Request("http://localhost/api/mock-payments", { method: "POST", body: "{" }))).status).toBe(400);
  expect((await paymentPOST(request({ bookingId: "missing", outcome: "success" }))).status).toBe(404);
  expect(await prisma.paymentAttempt.count()).toBe(9);
});

test("confirmation errors roll back both the mock payment and the booking change", async () => {
  const pending = await createTrialBooking(input);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_confirmation BEFORE UPDATE OF status ON Booking
    WHEN NEW.status = 'confirmed' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try {
    await expect(processMockPayment({ bookingId: pending.id, outcome: "success" })).rejects.toThrow();
    expect(await getBooking(pending.id)).toMatchObject({ status: "pending_payment", paymentAttempts: [] });
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER reject_confirmation");
  }
});

test("transient lock failures retry the whole transaction without duplicate payments", async () => {
  const pending = await createTrialBooking(input);
  const busy = new Prisma.PrismaClientKnownRequestError("busy", { code: "P1008", clientVersion: "6.12.0" });
  const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(busy);
  try {
    expect((await processMockPayment({ bookingId: pending.id, outcome: "success" })).booking.status).toBe("confirmed");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect((await getBooking(pending.id)).paymentAttempts).toHaveLength(1);
  } finally { transaction.mockRestore(); }
});

test("persistent contention stops after three attempts and returns 503", async () => {
  const pending = await createTrialBooking(input);
  const busy = new Prisma.PrismaClientKnownRequestError("busy", { code: "P2034", clientVersion: "6.12.0" });
  const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValue(busy);
  try {
    const response = await paymentPOST(request({ bookingId: pending.id, outcome: "success" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DATABASE_BUSY" } });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(await getBooking(pending.id)).toMatchObject({ status: "pending_payment", paymentAttempts: [] });
  } finally { transaction.mockRestore(); }
});

test("separate processes competing for the last seat cannot overbook", async () => {
  const a = await createTrialBooking({ ...input, trialClassId: "class-last-seat" });
  const b = await createTrialBooking({ studentId: "student-finn", trialClassId: "class-last-seat" });
  const workers = [a, b].map((booking) => fork(resolve("tests/helpers/payment-worker.ts"), [booking.id], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, execArgv: ["--import", "tsx"], silent: true,
  }));
  let readyCount = 0;
  try {
    const results = await Promise.all(workers.map((child) => new Promise<Awaited<ReturnType<typeof processMockPayment>>>((resolve, reject) => {
      child.on("message", (message: { ready?: boolean; result?: Awaited<ReturnType<typeof processMockPayment>>; error?: string }) => {
        if (message.ready && ++readyCount === workers.length) workers.forEach((worker) => worker.send("go"));
        if (message.result) resolve(message.result);
        if (message.error) reject(new Error(message.error));
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Worker exited before returning a result: ${code}`)));
    })));
    expect(results.map((r) => r.booking.status).sort()).toEqual(["capacity_unavailable", "confirmed"]);
    expect(results.every((r) => r.payment.status === "succeeded")).toBe(true);
    expect((await getTrialClassRoster("class-last-seat")).confirmedCount).toBe(4);
    expect(await prisma.paymentAttempt.count({ where: { bookingId: { in: [a.id, b.id] } } })).toBe(2);
  } finally { workers.forEach((worker) => worker.kill()); }
}, 20_000);
