// prisma/backfill-body-metrics.ts
//
// Idempotent backfill: migrate Measurement.restingHr (not null) rows into the
// new BodyMetric table as key="rhr" entries.
//
// Idempotency guard: a row is skipped when a BodyMetric with key="rhr" AND
// source="backfill" already exists within the same calendar day window
// (startOfDay … endOfDay, USER_TZ-aware). Safe to run multiple times.
//
// Usage:
//   npx tsx prisma/backfill-body-metrics.ts
//   (DATABASE_URL loaded from .env via dotenv import below.)

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { startOfDay, endOfDay } from "../src/lib/calendar-core";

async function main() {
  // Fetch all Measurement rows that have a non-null restingHr.
  const measurements = await prisma.measurement.findMany({
    where: { restingHr: { not: null } },
    select: { id: true, date: true, restingHr: true },
    orderBy: { date: "asc" },
  });

  console.log(`Found ${measurements.length} Measurement row(s) with restingHr != null.`);

  let inserted = 0;
  let skipped = 0;

  for (const m of measurements) {
    const dayStart = startOfDay(m.date);
    const dayEnd = endOfDay(m.date);

    // Idempotency guard: skip if a backfill rhr row already exists for this day.
    const existing = await prisma.bodyMetric.findFirst({
      where: {
        key: "rhr",
        source: "backfill",
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.bodyMetric.create({
      data: {
        date:   dayStart,
        key:    "rhr",
        // restingHr is Int? in Measurement; non-null guarded by where clause above.
        // Float column accepts integer values without loss.
        value:  m.restingHr!,
        unit:   "bpm",
        source: "backfill",
        notes:  "migrated from Measurement",
      },
    });

    inserted++;
  }

  console.log(`Done. inserted=${inserted}, skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
