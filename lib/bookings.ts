import { prisma } from "./prisma";

export class BookingError extends Error {
  constructor(public code: "INVALID_INPUT" | "NOT_FOUND" | "DUPLICATE_CONFIRMED_BOOKING" | "CAPACITY_UNAVAILABLE", message: string) {
    super(message);
  }
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BookingError("INVALID_INPUT", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

export async function listStudents() {
  return prisma.student.findMany({
    select: { id: true, name: true, parentId: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export async function listTrialClasses() {
  const classes = await prisma.trialClass.findMany({
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    include: { _count: { select: { bookings: { where: { status: "confirmed" } } } } },
  });
  return classes.map(({ _count, ...trialClass }) => ({
    ...trialClass,
    confirmedCount: _count.bookings,
    seatsRemaining: Math.max(trialClass.capacity - _count.bookings, 0),
    availability: "advisory" as const,
  }));
}

export async function createTrialBooking(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new BookingError("INVALID_INPUT", "Expected studentId and trialClassId.");
  }
  const fields = input as Record<string, unknown>;
  const studentId = requiredId(fields.studentId, "studentId");
  const trialClassId = requiredId(fields.trialClassId, "trialClassId");

  return prisma.$transaction(async (tx) => {
    if (!await tx.student.findUnique({ where: { id: studentId } })) {
      throw new BookingError("NOT_FOUND", "Student not found.");
    }
    const trialClass = await tx.trialClass.findUnique({ where: { id: trialClassId } });
    if (!trialClass) throw new BookingError("NOT_FOUND", "Class not found.");
    if (await tx.booking.findFirst({ where: { studentId, trialClassId, status: "confirmed" } })) {
      throw new BookingError("DUPLICATE_CONFIRMED_BOOKING", "This student already has a confirmed booking for this class.");
    }
    const confirmedCount = await tx.booking.count({ where: { trialClassId, status: "confirmed" } });
    if (confirmedCount >= trialClass.capacity) {
      throw new BookingError("CAPACITY_UNAVAILABLE", "This class is full.");
    }
    // Pending bookings do not reserve seats. Confirmation must check capacity again.
    return tx.booking.create({ data: { studentId, trialClassId, status: "pending_payment" } });
  });
}

export async function getBooking(id: unknown) {
  const booking = await prisma.booking.findUnique({
    where: { id: requiredId(id, "bookingId") },
    include: { paymentAttempts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!booking) throw new BookingError("NOT_FOUND", "Booking not found.");
  return booking;
}

export async function getTrialClassRoster(id: unknown) {
  const trialClass = await prisma.trialClass.findUnique({
    where: { id: requiredId(id, "trialClassId") },
    include: { bookings: {
      where: { status: "confirmed" },
      select: { student: { select: { id: true, name: true } } },
      orderBy: [{ student: { name: "asc" } }, { id: "asc" }],
    } },
  });
  if (!trialClass) throw new BookingError("NOT_FOUND", "Class not found.");
  const { bookings, ...details } = trialClass;
  return { ...details, confirmedCount: bookings.length, students: bookings.map((b) => b.student) };
}
