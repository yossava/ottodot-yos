import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdAt = new Date("2026-09-01T00:00:00Z");
const names = ["Alice", "Ben", "Cara", "Dan", "Eve", "Finn"];
const classes = [
  { id: "class-available", title: "Science Explorers", startsAt: new Date("2026-10-01T09:00:00Z"), count: 1 },
  { id: "class-last-seat", title: "Fractions Lab", startsAt: new Date("2026-10-02T09:00:00Z"), count: 3 },
  { id: "class-full", title: "Space Science", startsAt: new Date("2026-10-03T09:00:00Z"), count: 4 },
];

try {
  await prisma.$transaction(async (tx) => {
    await tx.paymentAttempt.deleteMany();
    await tx.booking.deleteMany();
    await tx.student.deleteMany();
    await tx.trialClass.deleteMany();
    await tx.parent.deleteMany();
    await tx.parent.create({ data: { id: "parent-demo", name: "Demo Parent" } });
    await tx.student.createMany({ data: names.map((name) => ({
      id: `student-${name.toLowerCase()}`, name, parentId: "parent-demo",
    })) });
    for (const { count, ...trialClass } of classes) {
      await tx.trialClass.create({ data: trialClass });
      for (const name of names.slice(0, count)) {
        const id = `booking-${trialClass.id}-${name.toLowerCase()}`;
        await tx.booking.create({ data: {
          id, studentId: `student-${name.toLowerCase()}`, trialClassId: trialClass.id,
          status: "confirmed", createdAt, updatedAt: createdAt,
          paymentAttempts: { create: {
            id: `payment-${id}`, provider: "mock", providerReference: `mock-${id}`,
            status: "succeeded", createdAt,
          } },
        } });
      }
    }
    await tx.booking.create({ data: {
      id: "booking-failed", studentId: "student-eve", trialClassId: "class-available",
      status: "payment_failed", createdAt, updatedAt: createdAt,
      paymentAttempts: { create: {
        id: "payment-failed", provider: "mock", providerReference: "mock-failed",
        status: "failed", createdAt,
      } },
    } });
  });
  for (const trialClass of await prisma.trialClass.findMany({
    orderBy: { startsAt: "asc" },
    include: { _count: { select: { bookings: { where: { status: "confirmed" } } } } },
  })) {
    console.log(`${trialClass.id} | ${trialClass.title} | ${trialClass._count.bookings}/${trialClass.capacity} confirmed`);
  }
} finally {
  await prisma.$disconnect();
}
