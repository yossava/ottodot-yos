import { execFileSync } from "node:child_process";
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

const { directory, databaseUrl } = await vi.hoisted(async () => {
  const { mkdtempSync, copyFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "ottodot-bookings-"));
  const path = join(directory, "test.db");
  copyFileSync("prisma/demo.db", path);
  return { directory, databaseUrl: `file:${path}` };
});

vi.mock("../lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: databaseUrl }) };
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
