// scripts/list-access-requests.ts
//
// List pending access requests (requests submitted via the pre-invite
// "request access" form), oldest first.
//
// Usage:
//   npx tsx scripts/list-access-requests.ts
//
// Read-only — no DB_ENV hard-refuse (reading pending requests on prod is
// legitimate, same rationale as mint-invite.ts).

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// ---------------------------------------------------------------------------
// Bootstrap Prisma (same pattern as other scripts)
// ---------------------------------------------------------------------------
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗  DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// ---------------------------------------------------------------------------
// Print target host (no credentials) — like db-guard
// ---------------------------------------------------------------------------
function targetHost(): string {
  try {
    return new URL(connectionString!).hostname;
  } catch {
    return "<malformed URL>";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const dbEnv = process.env.DB_ENV ?? "(not set)";
  const host = targetHost();

  console.log(`\nDB_ENV: ${dbEnv}  host: ${host}`);

  const requests = await prisma.accessRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (requests.length === 0) {
    console.log("\n(no pending access requests)\n");
    return;
  }

  console.log(`\n${requests.length} pending access request(s):\n`);
  for (const req of requests) {
    console.log(`   id        : ${req.id}`);
    console.log(`   email     : ${req.email}`);
    console.log(`   note      : ${req.note ?? "(none)"}`);
    console.log(`   createdAt : ${req.createdAt.toISOString()}`);
    console.log(`   mint with : npx tsx scripts/mint-invite.ts --email ${req.email}`);
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error("\n✗  Unhandled error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
