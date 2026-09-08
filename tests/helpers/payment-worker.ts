import { processMockPayment } from "../../lib/payments";
import { prisma } from "../../lib/prisma";

await prisma.$connect();
process.send?.({ ready: true });
process.once("message", async () => {
  try {
    process.send?.({ result: await processMockPayment({ bookingId: process.argv[2], outcome: "success" }) });
  } catch (error) {
    process.send?.({ error: String(error) });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    process.disconnect();
  }
});
