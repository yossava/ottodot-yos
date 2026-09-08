import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Prisma, type Booking } from "@prisma/client";
import { BookingError } from "./bookings";
import { prisma } from "./prisma";

// Called only after acquiring the write lock and recording a successful mock payment.
async function confirmPaidBooking(tx: Prisma.TransactionClient, booking: Booking) {
  const { id, studentId, trialClassId } = booking;
  const duplicate = await tx.booking.findFirst({
    where: { studentId, trialClassId, status: "confirmed" },
  });
  const trialClass = await tx.trialClass.findUniqueOrThrow({ where: { id: trialClassId } });
  const confirmedCount = await tx.booking.count({ where: { trialClassId, status: "confirmed" } });
  const reason = duplicate ? "DUPLICATE_CONFIRMED_BOOKING"
    : confirmedCount >= trialClass.capacity ? "CAPACITY_UNAVAILABLE" : null;
  const status = duplicate ? "cancelled" : reason ? "capacity_unavailable" : "confirmed";
  return { booking: await tx.booking.update({ where: { id }, data: { status } }), reason };
}

export async function processMockPayment(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new BookingError("INVALID_INPUT", "Expected bookingId and outcome.");
  }
  const { bookingId, outcome } = input as Record<string, unknown>;
  if (typeof bookingId !== "string" || !bookingId.trim()) {
    throw new BookingError("INVALID_INPUT", "bookingId must be a non-empty string.");
  }
  if (outcome !== "success" && outcome !== "failure") {
    throw new BookingError("INVALID_INPUT", "outcome must be success or failure.");
  }
  const id = bookingId.trim();
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // SQLite serializes writers across connections/processes. Acquire that lock before any reads.
        // ponytail: one database writer; use class-row locks in PostgreSQL if throughput matters.
        await tx.$executeRaw`UPDATE "Booking" SET "status" = "status" WHERE "id" = ${id}`;
        const booking = await tx.booking.findUnique({ where: { id } });
        if (!booking) throw new BookingError("NOT_FOUND", "Booking not found.");
        if (booking.status !== "pending_payment") {
          throw new BookingError("BOOKING_NOT_PAYABLE", "This booking has already been processed or cancelled.");
        }
        const payment = await tx.paymentAttempt.create({ data: {
          bookingId: id, provider: "mock", providerReference: randomUUID(),
          status: outcome === "success" ? "succeeded" : "failed",
        } });
        if (outcome === "failure") {
          return { payment, booking: await tx.booking.update({
            where: { id }, data: { status: "payment_failed" },
          }), reason: null };
        }
        return { payment, ...await confirmPaidBooking(tx, booking) };
      }, { maxWait: 5000, timeout: 5000 });
    } catch (error) {
      const busy = error instanceof Prisma.PrismaClientKnownRequestError && (
        error.code === "P1008" || error.code === "P2034" ||
        (error.code === "P2010" && ["5", "6"].includes(String(error.meta?.code)))
      );
      if (!busy) throw error;
      if (attempt === 2) throw new BookingError("DATABASE_BUSY", "Database is busy. Try again shortly.");
      await setTimeout(25 * (attempt + 1));
    }
  }
}
