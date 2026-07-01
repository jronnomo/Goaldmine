// verify-no-null-userid.ts
//
// REQ-002 (E7-1): 0-null ownership guard.
// Counts rows WHERE userId IS NULL across all 16 scoped models.
// Prints per-table counts + a summary; exits non-zero if any table has nulls.
//
// Safe to run on any DB — read-only, no writes.
// Print DB_ENV + host for clarity before doing anything.
//
// Usage:
//   npx tsx scripts/verify-no-null-userid.ts
//   npm run db:verify-owned
//
// Pre-deploy check: run before `prisma migrate deploy` to catch unowned rows
// that would violate the future hard NOT NULL constraint (Phase 1).

import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const host = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).hostname
    : "(no DATABASE_URL)";
  const dbEnv = process.env.DB_ENV ?? "(not set)";
  console.log(`DB_ENV: ${dbEnv}  host: ${host}`);
  console.log("Checking for unowned rows (userId IS NULL) across 16 scoped models...\n");

  // All 16 models that carry a userId column (scoped models per E2 migration).
  const checks: { label: string; count: () => Promise<number> }[] = [
    {
      label: "workout",
      count: () =>
        prisma.workout.count({ where: { userId: null } }),
    },
    {
      label: "measurement",
      count: () =>
        prisma.measurement.count({ where: { userId: null } }),
    },
    {
      label: "footageMarker",
      count: () =>
        prisma.footageMarker.count({ where: { userId: null } }),
    },
    {
      label: "baseline",
      count: () =>
        prisma.baseline.count({ where: { userId: null } }),
    },
    {
      label: "note",
      count: () =>
        prisma.note.count({ where: { userId: null } }),
    },
    {
      label: "hike",
      count: () =>
        prisma.hike.count({ where: { userId: null } }),
    },
    {
      label: "nutritionLog",
      count: () =>
        prisma.nutritionLog.count({ where: { userId: null } }),
    },
    {
      label: "mobilityCheckin",
      count: () =>
        prisma.mobilityCheckin.count({ where: { userId: null } }),
    },
    {
      label: "goal",
      count: () =>
        prisma.goal.count({ where: { userId: null } }),
    },
    {
      label: "program",
      count: () =>
        prisma.program.count({ where: { userId: null } }),
    },
    {
      label: "gameBonusXp",
      count: () =>
        prisma.gameBonusXp.count({ where: { userId: null } }),
    },
    {
      label: "bodyMetric",
      count: () =>
        prisma.bodyMetric.count({ where: { userId: null } }),
    },
    {
      label: "scheduledItem",
      count: () =>
        prisma.scheduledItem.count({ where: { userId: null } }),
    },
    {
      label: "logEntry",
      count: () =>
        prisma.logEntry.count({ where: { userId: null } }),
    },
    {
      label: "plan",
      count: () =>
        prisma.plan.count({ where: { userId: null } }),
    },
    {
      label: "dayRenderJob",
      count: () =>
        prisma.dayRenderJob.count({ where: { userId: null } }),
    },
  ];

  let total = 0;
  const results: { label: string; n: number }[] = [];

  for (const check of checks) {
    const n = await check.count();
    results.push({ label: check.label, n });
    total += n;
  }

  // Print per-table results
  for (const { label, n } of results) {
    const marker = n > 0 ? " ← UNOWNED" : "";
    console.log(`  ${label.padEnd(20)} ${n}${marker}`);
  }

  console.log();
  if (total === 0) {
    console.log(`✓ All 16 tables clean — 0 unowned rows. Exit 0.`);
  } else {
    console.error(`✗ ${total} unowned row(s) found across ${results.filter((r) => r.n > 0).length} table(s). Exit 1.`);
  }

  process.exit(total > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());
