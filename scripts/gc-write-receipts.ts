// scripts/gc-write-receipts.ts
//
// #274: Garbage-collect old WriteReceipt rows (the MCP write-tool idempotency
// replay cache — see src/lib/mcp/idempotency.ts).
//
// Receipts only need to outlive the retry window of the claude.ai MCP
// transport (seconds-to-minutes); 30 days is a generous safety margin.
// Deleting an old receipt merely re-opens the idempotency window for that
// requestId — a retry arriving after the cutoff would re-run the write, which
// no real client does — so this GC is data-loss-free for practical purposes.
//
// MANUAL / CRON UTILITY — not wired into the app. Run by hand or from a cron:
//
//   npx tsx scripts/gc-write-receipts.ts               # delete rows older than 30 days
//   npx tsx scripts/gc-write-receipts.ts --days 90     # custom cutoff
//   npx tsx scripts/gc-write-receipts.ts --dry-run     # count only, delete nothing
//
// This is a DELETE, so unlike read-only scripts it deserves a look at the
// printed target host before trusting the output. It intentionally has no
// DB_ENV hard-refuse: pruning stale receipts on prod is the point of the
// utility (mirrors mint-invite.ts). Rows are deleted across ALL users — GC is
// cross-tenant maintenance, so it uses the script-local raw client per
// src/lib/db.ts §"When NOT to use getDb"; the deleteMany is scoped only by
// the createdAt cutoff (backed by @@index([userId, toolName, createdAt])).

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const DEFAULT_DAYS = 30;

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const daysIdx = args.indexOf("--days");
  const daysRaw = daysIdx !== -1 ? args[daysIdx + 1] : undefined;
  const days = daysRaw !== undefined ? Number.parseInt(daysRaw, 10) : DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1) {
    console.error(`--days must be a positive integer (got: ${daysRaw})`);
    process.exit(1);
  }
  return { days, dryRun: args.includes("--dry-run") };
}

async function main() {
  const { days, dryRun } = parseArgs(process.argv);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  // Same operator guard as mint-invite.ts: say which DB this delete targets.
  const host = new URL(connectionString).host;
  console.log(`Target DB host: ${host}`);

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  console.log(`Cutoff: receipts with createdAt < ${cutoff.toISOString()} (${days} day(s) old)`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    if (dryRun) {
      const count = await prisma.writeReceipt.count({ where: { createdAt: { lt: cutoff } } });
      console.log(`[dry-run] Would delete ${count} WriteReceipt row(s). Nothing was deleted.`);
      return;
    }
    const { count } = await prisma.writeReceipt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    console.log(`Deleted ${count} WriteReceipt row(s) older than ${days} day(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
