import "./env.mjs";
import { copyFileSync, existsSync } from "node:fs";

// Restore is deliberately scoped to the local demo, independent of DATABASE_URL.
for (const suffix of ["-wal", "-shm", "-journal"]) {
  if (existsSync(`prisma/dev.db${suffix}`)) {
    throw new Error("Stop database clients and checkpoint/recover dev.db before restoring; SQLite sidecars exist.");
  }
}
copyFileSync("prisma/demo.db", "prisma/dev.db");
console.log("Restored prisma/dev.db from prisma/demo.db.");
