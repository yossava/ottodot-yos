import { Prisma, PrismaClient } from "@prisma/client";

export function isDatabaseBusy(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (
    error.code === "P1008" || error.code === "P2034" ||
    (error.code === "P2010" && ["5", "6"].includes(String(error.meta?.code)))
  );
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
