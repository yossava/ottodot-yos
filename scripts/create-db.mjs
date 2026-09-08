import { PrismaClient } from "@prisma/client";

// Create the SQLite file before migrate deploy, which can fail when it is absent.
const prisma = new PrismaClient();
try {
  await prisma.$connect();
} finally {
  await prisma.$disconnect();
}
