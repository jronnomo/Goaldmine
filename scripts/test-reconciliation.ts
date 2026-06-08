// Test harness for long-effort reconciliation (REQ-007).
// Modeled on scripts/test-revision-flow.ts.
//
// Pure-function cases P1–P6 exercise reconcileLongEffort directly — no DB.
// DB cases D1–D5 exercise resolveDay/weekConflicts against a real DB.
// DB cases are skipped gracefully if the DB is unavailable or plan state
// doesn't match expectations.
//
// Exit code: 0 = all cases passed; 1 = any failure.

import "dotenv/config";
import { reconcileLongEffort } from "../src/lib/calendar";
import type { DayTemplate } from "../src/lib/program-template";

// ---------------------------------------------------------------------------
// Minimal assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A minimal DayTemplate for testing — only `category` is checked by reconcileLongEffort.
function makeTmpl(category: DayTemplate["category"]): DayTemplate {
  return {
    dayOfWeek: 6,
    category,
    title: `${category} day`,
    summary: `Test ${category} summary`,
    blocks: [],
  };
}

// A minimal planned-hike object.
function makeHike(dateStr: string, id = "h1") {
  // Use a Date that round-trips through dateKey correctly.
  return {
    id,
    route: `Test Hike ${id}`,
    distanceMi: 10,
    elevationFt: 3000,
    packWeightLb: null as number | null,
    durationMin: 300,
    date: new Date(`${dateStr}T12:00:00.000Z`), // noon UTC — doesn't matter for dateKey
  };
}

// ---------------------------------------------------------------------------
// Core invariant helper: runs reconcileLongEffort and asserts workoutTemplate
// is unchanged.
// ---------------------------------------------------------------------------

function callAndAssertNoMutation(
  args: Parameters<typeof reconcileLongEffort>[0],
  caseName: string,
) {
  const original = JSON.stringify(args.workoutTemplate);
  reconcileLongEffort(args);
  assert(
    JSON.stringify(args.workoutTemplate) === original,
    `${caseName}: workoutTemplate not mutated (invariant)`,
  );
}

// ---------------------------------------------------------------------------
// P1 — No hike this week
// ---------------------------------------------------------------------------
console.log("\nP1 — no hike this week");
{
  const tmpl = makeTmpl("long-endurance");
  const result = reconcileLongEffort({
    rotationDay: 6,
    weekIndex: 5,
    thisDateKey: "2026-06-13",
    plannedHikesThisWeek: [],
    isOverride: false,
    workoutTemplate: tmpl,
  });
  assert(result.plannedHikeToday === null, "plannedHikeToday is null");
  assert(result.workoutDeferredForHike === false, "workoutDeferredForHike is false");
  assert(result.longEffortConflict === null, "longEffortConflict is null");
  callAndAssertNoMutation(
    { rotationDay: 6, weekIndex: 5, thisDateKey: "2026-06-13", plannedHikesThisWeek: [], isOverride: false, workoutTemplate: tmpl },
    "P1",
  );
}

// ---------------------------------------------------------------------------
// P2 — Hike on the Day-6 date (Flag A only, no conflict)
// ---------------------------------------------------------------------------
console.log("\nP2 — hike on the Day-6 date");
{
  const tmpl = makeTmpl("long-endurance");
  const hike = makeHike("2026-06-13");
  // dateKey computes from the Date in USER_TZ. To avoid TZ issues in the test,
  // we use a Date whose UTC noon representation aligns with dateKey("2026-06-13").
  // We assert by checking the hike is populated and no conflict.
  const result = reconcileLongEffort({
    rotationDay: 6,
    weekIndex: 5,
    thisDateKey: "2026-06-13",
    plannedHikesThisWeek: [hike],
    isOverride: false,
    workoutTemplate: tmpl,
  });
  assert(result.plannedHikeToday !== null, "plannedHikeToday populated");
  assert(result.plannedHikeToday?.id === "h1", "plannedHikeToday has correct id");
  assert(result.workoutDeferredForHike === true, "workoutDeferredForHike true (non-rest template)");
  assert(result.longEffortConflict === null, "no longEffortConflict (hike IS on Day 6)");
  callAndAssertNoMutation(
    { rotationDay: 6, weekIndex: 5, thisDateKey: "2026-06-13", plannedHikesThisWeek: [hike], isOverride: false, workoutTemplate: tmpl },
    "P2",
  );
}

// ---------------------------------------------------------------------------
// P3 — Hike on non-Day-6 date (the phantom case)
// ---------------------------------------------------------------------------
console.log("\nP3a — hike date perspective (Day 7, rest)");
{
  const tmpl = makeTmpl("rest");
  const hike = makeHike("2026-06-14");
  const result = reconcileLongEffort({
    rotationDay: 7,
    weekIndex: 5,
    thisDateKey: "2026-06-14",
    plannedHikesThisWeek: [hike],
    isOverride: false,
    workoutTemplate: tmpl,
  });
  assert(result.plannedHikeToday !== null, "plannedHikeToday populated on hike date");
  assert(result.workoutDeferredForHike === false, "workoutDeferredForHike false (rest day)");
  assert(result.longEffortConflict === null, "no longEffortConflict on hike date itself");
  callAndAssertNoMutation(
    { rotationDay: 7, weekIndex: 5, thisDateKey: "2026-06-14", plannedHikesThisWeek: [hike], isOverride: false, workoutTemplate: tmpl },
    "P3a",
  );
}

console.log("\nP3b — Day-6 perspective (long-endurance, hike elsewhere)");
{
  const tmpl = makeTmpl("long-endurance");
  const hike = makeHike("2026-06-14");
  const result = reconcileLongEffort({
    rotationDay: 6,
    weekIndex: 5,
    thisDateKey: "2026-06-13",
    plannedHikesThisWeek: [hike],
    isOverride: false,
    workoutTemplate: tmpl,
  });
  assert(result.plannedHikeToday === null, "no hike on Day 6 itself");
  assert(result.workoutDeferredForHike === false, "workoutDeferredForHike false (no hike today)");
  assert(result.longEffortConflict !== null, "longEffortConflict set");
  assertEqual(
    result.longEffortConflict?.rotationLongEffortDate,
    "2026-06-13",
    "rotationLongEffortDate correct",
  );
  assert(
    result.longEffortConflict?.plannedHikeDates.includes("2026-06-14") === true,
    "plannedHikeDates includes hike date",
  );
  callAndAssertNoMutation(
    { rotationDay: 6, weekIndex: 5, thisDateKey: "2026-06-13", plannedHikesThisWeek: [hike], isOverride: false, workoutTemplate: tmpl },
    "P3b",
  );
}

// ---------------------------------------------------------------------------
// P4 — 2+ hikes same week
// ---------------------------------------------------------------------------
console.log("\nP4 — two hikes in the same week");
{
  const tmpl = makeTmpl("long-endurance");
  const hike1 = makeHike("2026-06-14", "h1");
  const hike2 = makeHike("2026-06-15", "h2");
  const result = reconcileLongEffort({
    rotationDay: 6,
    weekIndex: 5,
    thisDateKey: "2026-06-13",
    plannedHikesThisWeek: [hike1, hike2],
    isOverride: false,
    workoutTemplate: tmpl,
  });
  assert(result.longEffortConflict !== null, "longEffortConflict set");
  assert(
    result.longEffortConflict!.plannedHikeDates.length === 2,
    "plannedHikeDates has 2 entries",
  );
  callAndAssertNoMutation(
    { rotationDay: 6, weekIndex: 5, thisDateKey: "2026-06-13", plannedHikesThisWeek: [hike1, hike2], isOverride: false, workoutTemplate: tmpl },
    "P4",
  );
}

// ---------------------------------------------------------------------------
// P5 — Explicit override suppresses all flags
// ---------------------------------------------------------------------------
console.log("\nP5 — explicit override suppresses flags");
{
  const tmpl = makeTmpl("long-endurance");
  const hike = makeHike("2026-06-14");
  const result = reconcileLongEffort({
    rotationDay: 6,
    weekIndex: 5,
    thisDateKey: "2026-06-13",
    plannedHikesThisWeek: [hike],
    isOverride: true, // override present
    workoutTemplate: tmpl,
  });
  assert(result.plannedHikeToday === null, "plannedHikeToday null when overridden");
  assert(result.workoutDeferredForHike === false, "workoutDeferredForHike false when overridden");
  assert(result.longEffortConflict === null, "longEffortConflict null when overridden");
  callAndAssertNoMutation(
    { rotationDay: 6, weekIndex: 5, thisDateKey: "2026-06-13", plannedHikesThisWeek: [hike], isOverride: true, workoutTemplate: tmpl },
    "P5",
  );
}

// ---------------------------------------------------------------------------
// P6 — Hike on a rest day (workoutDeferredForHike must be false)
// ---------------------------------------------------------------------------
console.log("\nP6 — hike on a rest day");
{
  const tmpl = makeTmpl("rest");
  const hike = makeHike("2026-06-14");
  const result = reconcileLongEffort({
    rotationDay: 7,
    weekIndex: 5,
    thisDateKey: "2026-06-14",
    plannedHikesThisWeek: [hike],
    isOverride: false,
    workoutTemplate: tmpl,
  });
  assert(result.plannedHikeToday !== null, "plannedHikeToday populated on rest+hike day");
  assert(result.workoutDeferredForHike === false, "workoutDeferredForHike false (category=rest)");
  callAndAssertNoMutation(
    { rotationDay: 7, weekIndex: 5, thisDateKey: "2026-06-14", plannedHikesThisWeek: [hike], isOverride: false, workoutTemplate: tmpl },
    "P6",
  );
}

// ---------------------------------------------------------------------------
// P-extra — null workoutTemplate (no rotation day scheduled)
// ---------------------------------------------------------------------------
console.log("\nP-extra — null workoutTemplate");
{
  const hike = makeHike("2026-06-14");
  const result = reconcileLongEffort({
    rotationDay: 7,
    weekIndex: 5,
    thisDateKey: "2026-06-14",
    plannedHikesThisWeek: [hike],
    isOverride: false,
    workoutTemplate: null,
  });
  assert(result.plannedHikeToday !== null, "plannedHikeToday populated even with null template");
  assert(result.workoutDeferredForHike === false, "workoutDeferredForHike false (no template)");
  assert(result.longEffortConflict === null, "no longEffortConflict (null template not long-endurance)");
  callAndAssertNoMutation(
    { rotationDay: 7, weekIndex: 5, thisDateKey: "2026-06-14", plannedHikesThisWeek: [hike], isOverride: false, workoutTemplate: null },
    "P-extra",
  );
}

// ---------------------------------------------------------------------------
// DB-backed cases (skip gracefully if DB unavailable)
// ---------------------------------------------------------------------------

async function runDbCases(): Promise<void> {
  let prismaClient: import("../src/generated/prisma/client").PrismaClient | null = null;

  try {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("../src/generated/prisma/client");
    const { resolveDay, weekConflicts } = await import("../src/lib/calendar");
    const { getActiveProgram } = await import("../src/lib/program");

    if (!process.env.DATABASE_URL) {
      console.log("\nDB cases: SKIPPED (DATABASE_URL not set)");
      return;
    }

    prismaClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    const program = await getActiveProgram();
    if (!program) {
      console.log("\nDB cases: SKIPPED (no active program)");
      return;
    }

    console.log("\n--- DB cases ---");

    // We'll seed a hike for testing and clean it up in finally.
    const seededHikeIds: string[] = [];
    const seededOverrideIds: string[] = [];

    try {
      // Compute a date within the plan (Day 1 of week 1) for a known baseline.
      const { addDays, startOfDay, dateKey } = await import("../src/lib/calendar");
      const day1 = startOfDay(program.startedOn);

      // D1 — resolveDay on a date with no planned hikes: flags are null/false.
      console.log("\nD1 — resolveDay, no planned hikes");
      {
        const r = await resolveDay(day1);
        assert(r.plannedHikeToday === null, "D1: plannedHikeToday null");
        assert(r.workoutDeferredForHike === false, "D1: workoutDeferredForHike false");
        assert(r.longEffortConflict === null, "D1: longEffortConflict null");
      }

      // D2 — resolveDay with a planned hike seeded on that date.
      console.log("\nD2 — resolveDay, hike seeded on same date");
      {
        const hike = await prismaClient!.hike.create({
          data: {
            route: "Test Reconciliation D2",
            date: day1,
            distanceMi: 5,
            elevationFt: 1000,
            durationMin: 180,
            status: "planned",
          },
        });
        seededHikeIds.push(hike.id);

        const r = await resolveDay(day1);
        assert(r.plannedHikeToday !== null, "D2: plannedHikeToday populated");
        assert(r.plannedHikeToday?.route === "Test Reconciliation D2", "D2: correct route");
      }

      // D3 — weekConflicts returns [] when no hikes in the week.
      console.log("\nD3 — weekConflicts, no hikes");
      {
        // Clean up D2 hike first so week 1 has no hikes.
        if (seededHikeIds.length > 0) {
          await prismaClient!.hike.deleteMany({ where: { id: { in: seededHikeIds } } });
          seededHikeIds.length = 0;
        }
        const conflicts = await weekConflicts(program, 1);
        assert(conflicts.length === 0, "D3: no conflicts when no hikes");
      }

      // D4 — weekConflicts returns long-effort conflict when hike is off Day 6.
      // Uses a week far enough in the future that no existing overrides are expected.
      console.log("\nD4 — weekConflicts, hike off Day 6");
      {
        const day6Tmpl = program.template.weeklySplit.find((d) => d.dayOfWeek === 6);
        if (day6Tmpl?.category !== "long-endurance") {
          console.log("  SKIPPED — Day 6 is not long-endurance in this program");
        } else {
          // Use last week of the plan to avoid collision with existing week-1 overrides.
          const lastWeek = program.template.totalWeeks;
          const lastWeekDay1 = addDays(day1, (lastWeek - 1) * 7);
          const lastWeekDay6 = addDays(lastWeekDay1, 5);
          const lastWeekDay7 = addDays(lastWeekDay1, 6);
          const day6Key = dateKey(lastWeekDay6);

          // Check if Day 6 of this week already has a workoutJson override (would suppress conflict).
          const existingOvr = await prismaClient!.planDayOverride.findUnique({
            where: { planId_date: { planId: program.id, date: lastWeekDay6 } },
            select: { workoutJson: true },
          });
          if (existingOvr?.workoutJson != null) {
            console.log(`  SKIPPED — Day 6 of week ${lastWeek} already has a workoutJson override`);
          } else {
            // Seed a planned hike on Day 7 of the last week.
            const hike = await prismaClient!.hike.create({
              data: {
                route: "Test Reconciliation D4",
                date: lastWeekDay7,
                distanceMi: 8,
                elevationFt: 2000,
                durationMin: 240,
                status: "planned",
              },
            });
            seededHikeIds.push(hike.id);

            const conflicts = await weekConflicts(program, lastWeek);
            const longEffort = conflicts.filter((c) => c.kind === "long-effort");
            assert(longEffort.length > 0, "D4: long-effort conflict detected");
            if (longEffort.length > 0) {
              assert(
                longEffort[0]!.dateKey === day6Key,
                "D4: conflict on Day-6 dateKey",
              );
              assert(
                longEffort[0]!.withDates.some((d) => d === dateKey(lastWeekDay7)),
                "D4: conflict lists the hike date",
              );
            }
          }
        }
      }

      // D5 — weekConflicts respects workoutJson overrides (override suppresses conflict).
      console.log("\nD5 — weekConflicts, Day-6 override suppresses conflict");
      {
        const day6Tmpl = program.template.weeklySplit.find((d) => d.dayOfWeek === 6);
        if (day6Tmpl?.category !== "long-endurance" || seededHikeIds.length === 0) {
          console.log("  SKIPPED — prerequisite from D4 not met or Day 6 not long-endurance");
        } else {
          const lastWeek = program.template.totalWeeks;
          const lastWeekDay1 = addDays(day1, (lastWeek - 1) * 7);
          const lastWeekDay6 = addDays(lastWeekDay1, 5);

          // Use upsert to avoid unique constraint on existing overrides.
          const ov = await prismaClient!.planDayOverride.upsert({
            where: { planId_date: { planId: program.id, date: lastWeekDay6 } },
            create: {
              planId: program.id,
              date: lastWeekDay6,
              workoutJson: { dayOfWeek: 6, category: "rest", title: "Test override", blocks: [], summary: "Test" },
            },
            update: {
              workoutJson: { dayOfWeek: 6, category: "rest", title: "Test override", blocks: [], summary: "Test" },
            },
          });
          seededOverrideIds.push(ov.id);

          const conflicts = await weekConflicts(program, lastWeek);
          const longEffort = conflicts.filter((c) => c.kind === "long-effort");
          assert(longEffort.length === 0, "D5: no long-effort conflict when Day 6 is overridden");

          await prismaClient!.planDayOverride.delete({ where: { id: ov.id } }).catch(() => {
            // Ignore — might have been seeded before the test (existing override).
          });
          seededOverrideIds.length = 0;
        }
      }
    } finally {
      // Teardown: delete seeded rows.
      if (seededHikeIds.length > 0) {
        await prismaClient!.hike.deleteMany({ where: { id: { in: seededHikeIds } } });
      }
      if (seededOverrideIds.length > 0) {
        await prismaClient!.planDayOverride.deleteMany({ where: { id: { in: seededOverrideIds } } });
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("ECONNREFUSED") ||
        err.message.includes("can't reach database") ||
        err.message.includes("DATABASE_URL"))
    ) {
      console.log("\nDB cases: SKIPPED (DB unavailable)");
    } else {
      console.error("\nDB cases: UNEXPECTED ERROR");
      console.error(err);
      failed++;
    }
  } finally {
    if (prismaClient) {
      await prismaClient.$disconnect().catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Run and exit
// ---------------------------------------------------------------------------

runDbCases()
  .then(() => {
    console.log(`\n-----------------------------------------`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error("SOME TESTS FAILED");
      process.exit(1);
    } else {
      console.log("All tests passed.");
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error("Fatal error running test harness:", err);
    process.exit(1);
  });
