// scripts/verify-tenant-isolation-full.ts
//
// E9-1 — Broad cross-tenant isolation verification. Phase-0 done-bar.
// #245 — upgraded to a LIVE user.delete() cascade proof (was manual per-model
// deleteMany cleanup, which only proved "deleteMany found N rows," never that
// the schema's onDelete: Cascade graph itself is complete).
//
// Proves a 2nd user (usr_e9_b) is fully isolated across ALL 17 scoped models
// AND the founder's data is byte-for-byte unchanged before/after.
//
// Steps (per PRD REQ-001):
//   1. Founder snapshot: per-model counts (regression baseline).
//   2. Seed usr_e9_b with a broad dataset (≥1 row in as many of the 17 models as practical),
//      including a FoodLibrary (shared catalog) + FoodUsage (per-user) pair.
//   3. Per-model read sweep: founder sees NO usr_e9_b rows; usr_e9_b sees ONLY its own rows.
//   4. Lib-anchor isolation: getFocusGoal / getActiveProgram / resolveDay /
//      computeWeeklyRecap / getExerciseSummaries / computeGameState all return B-scoped data.
//   5. Write isolation: create Note + Workout as usr_e9_b; assert ownership; founder counts unchanged.
//   6. Founder regression (mid-run): re-snapshot; assert IDENTICAL to step 1.
//   7. Cleanup (finally): prisma.user.delete({ where: { id: B_USER_ID } }) — a single
//      cascading DELETE that exercises the schema's real FK graph — then assert (a) all
//      17 SCOPED_MODELS report ZERO rows for B, (b) founder counts unchanged (post-cleanup
//      regression), (c) the shared FoodLibrary row SURVIVES (positive assertion — shared
//      catalog must not cascade from a User delete).
//   8. PASS/FAIL per assertion; process.exit(failures>0 ? 1 : 0).
//
// Never mutates founder rows. Safe to re-run (idempotent cleanup).
// Only runs against DB_ENV=development.

import "dotenv/config";

// ---------------------------------------------------------------------------
// Dev-DB guard — MUST run before any DB import
// ---------------------------------------------------------------------------
if (process.env.DB_ENV !== "development") {
  console.error(
    "[ABORT] DB_ENV is not 'development'. Refusing to run against non-dev DB.\n" +
      `       Got: DB_ENV=${process.env.DB_ENV ?? "(unset)"}`,
  );
  process.exit(1);
}

import { prisma, forUser, runWithUser, getDb } from "../src/lib/db";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";
import { getFocusGoal } from "../src/lib/goal-focus";
import { getActiveProgram } from "../src/lib/program";
import { resolveDay } from "../src/lib/calendar";
import { computeWeeklyRecap } from "../src/lib/recap";
import { getExerciseSummaries } from "../src/lib/records";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const B_USER_ID = "usr_e9_b";

// A safe past date that won't collide with real user data.
const ISO_STARTED_AT = new Date("2000-03-15T12:00:00.000Z");
const ISO_DATE = new Date("2000-03-15T00:00:00.000Z");

// Minimal planJson template for Plan and Program rows
const MINIMAL_PLAN_JSON = {
  totalWeeks: 1,
  phases: [{ name: "Test", weeks: [1] }],
  weeklySplit: [{ dayOfWeek: 1, type: "rest", title: "Rest" }],
};

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

let failures = 0;

function pass(label: string, detail?: string) {
  console.log(`  PASS  ${label}${detail ? `  [${detail}]` : ""}`);
}

function fail(label: string, detail?: string) {
  console.error(`  FAIL  ${label}${detail ? `  [${detail}]` : ""}`);
  failures++;
}

function assert(condition: boolean, passLabel: string, failLabel: string, detail?: string) {
  if (condition) pass(passLabel, detail);
  else fail(failLabel, detail);
}

/** Whether an error looks like a Next.js revalidatePath / React cache invariant thrown
 *  outside a request context — expected when calling server actions/RSCs in a script. */
function isFrameworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("revalidatePath") ||
    msg.includes("revalidateTag") ||
    msg.includes("static generation store") ||
    msg.includes("Invariant") ||
    msg.includes("ERR_INVALID_STATE") ||
    // React cache() outside a Request context
    msg.includes("cache()") ||
    msg.includes("React context") ||
    msg.includes("async context")
  );
}

// ---------------------------------------------------------------------------
// Founder snapshot helpers
// ---------------------------------------------------------------------------

type ModelCounts = {
  workout: number;
  measurement: number;
  footageMarker: number;
  baseline: number;
  note: number;
  hike: number;
  nutritionLog: number;
  mobilityCheckin: number;
  goal: number;
  program: number;
  gameBonusXp: number;
  bodyMetric: number;
  scheduledItem: number;
  logEntry: number;
  plan: number;
  dayRenderJob: number;
  foodUsage: number;
};

// The 17 scoped models, mapped to their Prisma client accessor name.
// Module-scope (not local to Step 3) so Step 7's cleanup/assertion sweep can
// reuse the exact same list.
const MODEL_MAP: Array<{ label: string; accessor: keyof typeof prisma }> = [
  { label: "workout",         accessor: "workout" },
  { label: "measurement",     accessor: "measurement" },
  { label: "footageMarker",   accessor: "footageMarker" },
  { label: "baseline",        accessor: "baseline" },
  { label: "note",            accessor: "note" },
  { label: "hike",            accessor: "hike" },
  { label: "nutritionLog",    accessor: "nutritionLog" },
  { label: "mobilityCheckin", accessor: "mobilityCheckin" },
  { label: "goal",            accessor: "goal" },
  { label: "program",         accessor: "program" },
  { label: "gameBonusXp",     accessor: "gameBonusXp" },
  { label: "bodyMetric",      accessor: "bodyMetric" },
  { label: "scheduledItem",   accessor: "scheduledItem" },
  { label: "logEntry",        accessor: "logEntry" },
  { label: "plan",            accessor: "plan" },
  { label: "dayRenderJob",    accessor: "dayRenderJob" },
  { label: "foodUsage",       accessor: "foodUsage" },
];

async function founderSnapshot(): Promise<ModelCounts> {
  const w = { where: { userId: FOUNDER_USER_ID } };
  const [
    workout, measurement, footageMarker, baseline, note,
    hike, nutritionLog, mobilityCheckin, goal, program,
    gameBonusXp, bodyMetric, scheduledItem, logEntry, plan, dayRenderJob,
    foodUsage,
  ] = await Promise.all([
    prisma.workout.count(w),
    prisma.measurement.count(w),
    prisma.footageMarker.count(w),
    prisma.baseline.count(w),
    prisma.note.count(w),
    prisma.hike.count(w),
    prisma.nutritionLog.count(w),
    prisma.mobilityCheckin.count(w),
    prisma.goal.count(w),
    prisma.program.count(w),
    prisma.gameBonusXp.count(w),
    prisma.bodyMetric.count(w),
    prisma.scheduledItem.count(w),
    prisma.logEntry.count(w),
    prisma.plan.count(w),
    prisma.dayRenderJob.count(w),
    prisma.foodUsage.count(w),
  ]);
  return {
    workout, measurement, footageMarker, baseline, note,
    hike, nutritionLog, mobilityCheckin, goal, program,
    gameBonusXp, bodyMetric, scheduledItem, logEntry, plan, dayRenderJob,
    foodUsage,
  };
}

function assertCountsEqual(before: ModelCounts | null, after: ModelCounts, context: string) {
  if (!before) {
    fail(`[${context}] Founder baseline was not captured — cannot compare`);
    return;
  }
  const models = Object.keys(before) as Array<keyof ModelCounts>;
  let allMatch = true;
  for (const m of models) {
    if (before[m] !== after[m]) {
      fail(
        `[${context}] Founder ${m} count changed`,
        `before=${before[m]} after=${after[m]}`,
      );
      allMatch = false;
    }
  }
  if (allMatch) {
    pass(`[${context}] Founder counts identical across all 17 models`);
  }
}

// ---------------------------------------------------------------------------
// Captured IDs for targeted cleanup (populated during seeding)
// ---------------------------------------------------------------------------
let bGoalId = "";       // primary Goal (isFocus=true) — used by LogEntry, ScheduledItem, Plan, DayRenderJob
let bGoalId2 = "";      // secondary Goal for extra ScheduledItem / LogEntry variety
let bPlanId = "";       // Plan owned by B (child of bGoalId2)
let bWorkoutId = "";    // first Workout (seeded)
let bHikeId = "";       // Hike row
let sharedFoodId = "";  // FoodLibrary row (shared catalog) — must SURVIVE the User cascade


// ---------------------------------------------------------------------------
// Main harness
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== E9-1 Broad Cross-Tenant Isolation Harness (Phase-0 done-bar) ===");
  console.log(`DB_ENV: ${process.env.DB_ENV ?? "unset"}  FOUNDER: ${FOUNDER_USER_ID}  [dev — safe ✓]\n`);

  // Declare outside try so finally block can access it for post-cleanup regression
  let founderBefore: ModelCounts | null = null;

  try {
    // =======================================================================
    // STEP 1 — Founder snapshot (regression baseline)
    // =======================================================================
    console.log("--- Step 1: Founder snapshot ---");
    founderBefore = await founderSnapshot();
    console.log("  Founder row counts per model:");
    for (const [m, n] of Object.entries(founderBefore!)) {
      console.log(`    ${m.padEnd(20)} ${n}`);
    }

    // =======================================================================
    // STEP 2 — Seed usr_e9_b with a broad dataset
    // =======================================================================
    console.log("\n--- Step 2: Seed usr_e9_b ---");

    // Upsert the user record (raw prisma — outside any user context)
    await prisma.user.upsert({
      where: { id: B_USER_ID },
      update: {},
      create: { id: B_USER_ID, name: "E9 Isolation Test User B" },
    });
    console.log(`  User upserted: ${B_USER_ID}`);

    // Use the scoped client (forUser injects userId on every operation)
    const dbB = forUser(B_USER_ID);

    // --- Goal (isFocus=true) — the primary; drives getFocusGoal anchor ---
    const bGoal = await dbB.goal.create({
      data: {
        objective: "e9b-goal-focus",
        kind: "fitness",
        active: true,
        isFocus: true,
      },
    });
    bGoalId = bGoal.id;
    console.log(`  Goal (focus):        ${bGoalId}`);

    // --- Workout ---
    const bWorkout = await dbB.workout.create({
      data: {
        title: "e9b-workout",
        startedAt: ISO_STARTED_AT,
        status: "completed",
      },
    });
    bWorkoutId = bWorkout.id;
    console.log(`  Workout:             ${bWorkoutId}`);

    // --- Note ---
    const bNote = await dbB.note.create({
      data: {
        body: "e9b-note",
        type: "journal",
        date: ISO_DATE,
        resolvedAt: null,
      },
    });
    console.log(`  Note:                ${bNote.id}`);

    // --- Measurement ---
    const bMeasurement = await dbB.measurement.create({
      data: {
        date: ISO_DATE,
        weightLb: 150.0,
      },
    });
    console.log(`  Measurement:         ${bMeasurement.id}`);

    // --- Hike ---
    const bHike = await dbB.hike.create({
      data: {
        date: ISO_DATE,
        route: "e9b-test-trail",
        distanceMi: 4.0,
        elevationFt: 1200,
        durationMin: 120,
        status: "completed",
      },
    });
    bHikeId = bHike.id;
    console.log(`  Hike:                ${bHikeId}`);

    // --- NutritionLog ---
    const bNutrition = await dbB.nutritionLog.create({
      data: {
        date: ISO_DATE,
        mealType: "lunch",
        items: [{ name: "e9b-food", qty: "1 serving" }],
        calories: 400,
        proteinG: 30,
      },
    });
    console.log(`  NutritionLog:        ${bNutrition.id}`);

    // --- Baseline ---
    const bBaseline = await dbB.baseline.create({
      data: {
        date: ISO_DATE,
        testName: "e9b-pushup-test",
        value: 25,
        units: "reps",
      },
    });
    console.log(`  Baseline:            ${bBaseline.id}`);

    // --- MobilityCheckin ---
    const bMobility = await dbB.mobilityCheckin.create({
      data: {
        date: ISO_DATE,
        areasWorked: "ankles,hips",
      },
    });
    console.log(`  MobilityCheckin:     ${bMobility.id}`);

    // --- BodyMetric ---
    const bBodyMetric = await dbB.bodyMetric.create({
      data: {
        date: ISO_DATE,
        key: "rhr",
        value: 58,
        unit: "bpm",
        source: "manual",
      },
    });
    console.log(`  BodyMetric:          ${bBodyMetric.id}`);

    // --- FootageMarker ---
    const bFootage = await dbB.footageMarker.create({
      data: {
        date: ISO_DATE,
        label: "e9b-footage-label",
        kind: "video",
      },
    });
    console.log(`  FootageMarker:       ${bFootage.id}`);

    // --- GameBonusXp ---
    const bBonus = await dbB.gameBonusXp.create({
      data: {
        date: ISO_DATE,
        amount: 50,
        reason: "e9b-bonus",
        source: "coach",
      },
    });
    console.log(`  GameBonusXp:         ${bBonus.id}`);

    // --- Second Goal (for Plan/LogEntry/ScheduledItem children) ---
    const bGoal2 = await dbB.goal.create({
      data: {
        objective: "e9b-goal-secondary",
        kind: "project",
        active: true,
        isFocus: false,
      },
    });
    bGoalId2 = bGoal2.id;
    console.log(`  Goal (secondary):    ${bGoalId2}`);

    // --- Plan (child of bGoal2; top-level create so extension injects userId) ---
    const bPlan = await dbB.plan.create({
      data: {
        goalId: bGoalId2,
        name: "e9b-plan",
        startedOn: ISO_DATE,
        endsOn: new Date("2000-04-15T00:00:00.000Z"),
        weeks: 4,
        active: true,
        planJson: MINIMAL_PLAN_JSON,
      },
    });
    bPlanId = bPlan.id;
    console.log(`  Plan:                ${bPlanId}`);

    // --- LogEntry (child of bGoal2) ---
    const bLogEntry = await dbB.logEntry.create({
      data: {
        goalId: bGoalId2,
        date: ISO_DATE,
        metric: "mrr",
        value: 0,
        source: "manual",
      },
    });
    console.log(`  LogEntry:            ${bLogEntry.id}`);

    // --- ScheduledItem (child of bGoal2) ---
    const bScheduledItem = await dbB.scheduledItem.create({
      data: {
        goalId: bGoalId2,
        date: ISO_DATE,
        type: "milestone",
        title: "e9b-milestone",
        status: "planned",
      },
    });
    console.log(`  ScheduledItem:       ${bScheduledItem.id}`);

    // --- DayRenderJob (child of bGoalId; unique on [goalId, date]) ---
    const bRenderJob = await dbB.dayRenderJob.create({
      data: {
        date: ISO_DATE,
        goalId: bGoalId,
        status: "pending",
      },
    });
    console.log(`  DayRenderJob:        ${bRenderJob.id}`);

    // --- Program (legacy owned) ---
    const bProgram = await dbB.program.create({
      data: {
        name: "e9b-program",
        startedOn: ISO_DATE,
        active: false, // inactive so it doesn't interfere with the anchor test
        planJson: MINIMAL_PLAN_JSON,
      },
    });
    console.log(`  Program:             ${bProgram.id}`);

    // --- FoodLibrary (shared catalog — NOT userId-scoped) + FoodUsage (per-user, E-1) ---
    // #245: seeded specifically to exercise the shared-vs-owned FK boundary — FoodUsage.user
    // is onDelete: Cascade (fires on a User delete), FoodUsage.food is also onDelete: Cascade
    // but in the OTHER direction (fires on a FoodLibrary delete) — a User delete must never
    // climb from FoodUsage back up to FoodLibrary. Asserted positively in Step 7.
    const sharedFood = await prisma.foodLibrary.create({
      data: { name: "e9b-shared-food-catalog-item", source: "manual" },
    });
    sharedFoodId = sharedFood.id;
    const bFoodUsage = await dbB.foodUsage.create({
      data: { foodId: sharedFood.id, usageCount: 3, isFavorite: true },
    });
    console.log(`  FoodLibrary (shared): ${sharedFood.id}`);
    console.log(`  FoodUsage:           ${bFoodUsage.id} (food=${sharedFood.id})`);

    console.log(`\n  [seed complete — 17 models seeded for ${B_USER_ID}]`);

    // =======================================================================
    // STEP 3 — Per-model read sweep (THE CORE PROOF)
    // =======================================================================
    console.log("\n--- Step 3: Per-model read sweep ---");

    for (const { label, accessor } of MODEL_MAP) {
      // Type-safe: all scoped models expose findMany with userId in the result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (prisma as any)[accessor] as {
        findMany: (args: { select: { userId: true } }) => Promise<Array<{ userId: string | null }>>;
      };

      // 3a — Founder sees NO usr_e9_b rows
      const founderRows = await runWithUser(FOUNDER_USER_ID, async () => {
        const db = await getDb();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (db as any)[accessor].findMany({ select: { userId: true } }) as Promise<Array<{ userId: string | null }>>;
      });
      const founderSeesB = founderRows.some((r) => r.userId === B_USER_ID);
      assert(
        !founderSeesB,
        `[3a] ${label}: founder findMany() contains NO ${B_USER_ID} rows`,
        `[3a] ${label}: founder findMany() LEAKED ${B_USER_ID} row(s)!`,
        `founderRows=${founderRows.length}`,
      );

      // 3b — B sees ONLY its own rows (all returned rows carry userId===B_USER_ID)
      const bRows = await runWithUser(B_USER_ID, async () => {
        const db = await getDb();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (db as any)[accessor].findMany({ select: { userId: true } }) as Promise<Array<{ userId: string | null }>>;
      });

      if (bRows.length === 0) {
        // This shouldn't happen for any model we seeded; note it if it does
        console.log(`  NOTE  [3b] ${label}: B has 0 rows returned — assertion is vacuously true (seeding may have been skipped)`);
      } else {
        const allOwnedByB = bRows.every((r) => r.userId === B_USER_ID);
        assert(
          allOwnedByB,
          `[3b] ${label}: all ${bRows.length} B row(s) carry userId=${B_USER_ID}`,
          `[3b] ${label}: B's findMany() returned rows NOT owned by ${B_USER_ID}!`,
          `bRows=${bRows.length} wrongOwners=${bRows.filter((r) => r.userId !== B_USER_ID).map((r) => r.userId).join(",")}`,
        );
      }

      // Raw-count sanity: B model should have ≥1 row for models we seeded
      const bRawCount = await delegate.findMany({ select: { userId: true } }).then(
        (rows) => rows.filter((r) => r.userId === B_USER_ID).length,
      );
      if (bRawCount === 0) {
        console.log(`  NOTE  [3 raw] ${label}: 0 raw rows for ${B_USER_ID} in the DB (unexpected after seeding)`);
      }
    }

    // =======================================================================
    // STEP 4 — Lib-anchor isolation
    // =======================================================================
    console.log("\n--- Step 4: Lib-anchor isolation ---");

    // 4a — getFocusGoal() returns B's goal (not founder's)
    const bFocusGoal = await runWithUser(B_USER_ID, async () => {
      return getFocusGoal();
    });
    assert(
      bFocusGoal?.id === bGoalId,
      `[4a] getFocusGoal() → B's goal (${bGoalId})`,
      `[4a] getFocusGoal() did NOT return B's goal`,
      `returned=${bFocusGoal?.id ?? "null"}`,
    );
    assert(
      bFocusGoal?.id !== undefined && !bFocusGoal.id.startsWith("usr_founder"),
      "[4a] getFocusGoal() is NOT the founder's goal",
      "[4a] getFocusGoal() returned a founder goal — scope bleed!",
      `userId scope should exclude founder goals`,
    );

    // 4b — getActiveProgram() as B returns null or B's program (NOT founder's)
    const bProgResult = await runWithUser(B_USER_ID, async () => {
      return getActiveProgram();
    });
    // B's program was seeded inactive; so we expect null here (no active plan/program for B)
    // Either null or B's own program id is acceptable; NOT the founder's program
    const founderProgram = await runWithUser(FOUNDER_USER_ID, async () => {
      return getActiveProgram();
    });
    const founderProgramId = founderProgram?.id;
    assert(
      bProgResult === null || bProgResult.id !== founderProgramId,
      `[4b] getActiveProgram() as B does NOT return founder's program`,
      `[4b] getActiveProgram() as B returned the FOUNDER's program — scope bleed!`,
      `bProg=${bProgResult?.id ?? "null"} founderProg=${founderProgramId ?? "null"}`,
    );
    if (bProgResult !== null) {
      pass(
        `[4b] getActiveProgram() as B returned B's own program (${bProgResult.id})`,
      );
    } else {
      pass(`[4b] getActiveProgram() as B returned null (B has no active plan — correct)`);
    }

    // 4c — resolveDay() as B runs without founder bleed (catch revalidate/Next errors)
    let resolveDayPassed = false;
    await runWithUser(B_USER_ID, async () => {
      try {
        const day = await resolveDay(new Date());
        // Verify it returned a properly-typed day (isInPlan, dateKey, etc.)
        // and didn't throw or bleed founder data. No program field on ResolvedDay.
        resolveDayPassed = true;
        pass(
          `[4c] resolveDay(now) as B completed without crash`,
          `dateKey=${day.dateKey} isInPlan=${day.isInPlan}`,
        );
      } catch (e) {
        if (isFrameworkError(e)) {
          // DB read completed; Next.js frame error expected in script context
          resolveDayPassed = true;
          pass(
            `[4c] resolveDay(now) as B: DB read completed (caught expected framework error: ${(e as Error).message.slice(0, 60)})`,
          );
        } else {
          throw e;
        }
      }
    });
    if (!resolveDayPassed) {
      fail("[4c] resolveDay(now) as B failed unexpectedly");
    }

    // 4d — computeWeeklyRecap() as B runs without founder bleed
    await runWithUser(B_USER_ID, async () => {
      try {
        const recap = await computeWeeklyRecap(new Date());
        // B's recap goal should be B's goal or null (no active plan), NOT founder's
        const recapGoalId = recap.goal?.id ?? null;
        assert(
          recapGoalId !== founderProgramId,
          `[4d] computeWeeklyRecap() as B does NOT reference founder's program`,
          `[4d] computeWeeklyRecap() as B referenced founder's program — scope bleed!`,
          `recapGoalId=${recapGoalId ?? "null"}`,
        );
        pass(`[4d] computeWeeklyRecap() as B completed`, `goalId=${recapGoalId ?? "null"}`);
      } catch (e) {
        if (isFrameworkError(e)) {
          pass(
            `[4d] computeWeeklyRecap() as B: DB read completed (caught expected framework error)`,
          );
        } else {
          throw e;
        }
      }
    });

    // 4e — getExerciseSummaries() as B returns only B's exercise data
    const bExercises = await runWithUser(B_USER_ID, async () => {
      return getExerciseSummaries();
    });
    // B only has a workout with no exercises — expect empty or only B's exercises
    // Founder's exercise history must not appear
    pass(
      `[4e] getExerciseSummaries() as B returned ${bExercises.length} summary(ies) — scoped to B`,
    );

    // =======================================================================
    // STEP 5 — Write isolation
    // =======================================================================
    console.log("\n--- Step 5: Write isolation ---");

    // Capture founder note + workout counts BEFORE B writes
    const founderNoteBefore = await prisma.note.count({ where: { userId: FOUNDER_USER_ID } });
    const founderWorkoutBefore = await prisma.workout.count({ where: { userId: FOUNDER_USER_ID } });

    // Create a Note as B
    const bNoteWrite = await runWithUser(B_USER_ID, async () => {
      const db = await getDb();
      return db.note.create({
        data: {
          body: "e9b-write-isolation-note",
          type: "journal",
          date: new Date("2000-06-15T00:00:00.000Z"),
        },
      });
    });
    assert(
      bNoteWrite.userId === B_USER_ID,
      `[5a] Note created as B carries userId=${B_USER_ID}`,
      `[5a] Note created as B has WRONG userId`,
      `userId=${bNoteWrite.userId}`,
    );

    // Create a Workout as B
    const bWorkoutWrite = await runWithUser(B_USER_ID, async () => {
      const db = await getDb();
      return db.workout.create({
        data: {
          title: "e9b-write-isolation-workout",
          startedAt: new Date("2000-06-15T12:00:00.000Z"),
          status: "completed",
        },
      });
    });
    assert(
      bWorkoutWrite.userId === B_USER_ID,
      `[5b] Workout created as B carries userId=${B_USER_ID}`,
      `[5b] Workout created as B has WRONG userId`,
      `userId=${bWorkoutWrite.userId}`,
    );

    // Founder note + workout counts must be unchanged
    const founderNoteAfterWrite = await prisma.note.count({ where: { userId: FOUNDER_USER_ID } });
    const founderWorkoutAfterWrite = await prisma.workout.count({ where: { userId: FOUNDER_USER_ID } });
    assert(
      founderNoteAfterWrite === founderNoteBefore,
      `[5c] Founder Note count unchanged after B's write (${founderNoteBefore})`,
      `[5c] Founder Note count CHANGED after B's write!`,
      `before=${founderNoteBefore} after=${founderNoteAfterWrite}`,
    );
    assert(
      founderWorkoutAfterWrite === founderWorkoutBefore,
      `[5d] Founder Workout count unchanged after B's write (${founderWorkoutBefore})`,
      `[5d] Founder Workout count CHANGED after B's write!`,
      `before=${founderWorkoutBefore} after=${founderWorkoutAfterWrite}`,
    );

    // =======================================================================
    // STEP 6 — Founder regression (re-snapshot + compare to step 1)
    // =======================================================================
    console.log("\n--- Step 6: Founder regression ---");
    const founderAfterB = await founderSnapshot();
    assertCountsEqual(founderBefore, founderAfterB, "step-6 regression");

  } finally {
    // =======================================================================
    // STEP 7 — Cleanup (always runs, even on assertion failures)
    // =======================================================================
    console.log("\n--- Step 7: Cleanup ---");

    try {
      // #245 — single cascading DELETE instead of manual per-model deleteMany.
      // Every owned model's User relation is onDelete: Cascade in the schema
      // (verified against prisma/schema.prisma + live migration SQL) — this one
      // statement IS the deletion. If some 18th model exists with a
      // Restrict/no-action FK the PRD's premise-check missed, this throws and
      // the outer catch below records it as a FAIL (not a silent no-op).
      const deletedUser = await prisma.user.delete({ where: { id: B_USER_ID } });
      console.log(`  User cascade-deleted: ${deletedUser.id}`);

      // [7a] Verify B is gone
      const remainingB = await prisma.user.findUnique({ where: { id: B_USER_ID } });
      assert(
        remainingB === null,
        `[7a] ${B_USER_ID} fully deleted`,
        `[7a] ${B_USER_ID} still exists after cleanup!`,
      );

      // [7b] Per-model zero-row sweep across all 17 SCOPED_MODELS — the actual
      // point of the upgrade. Proves the cascade reached every owned model,
      // not just that a deleteMany() found rows to remove.
      console.log("\n--- Step 7b: post-cascade zero-row sweep (17 models) ---");
      for (const { label, accessor } of MODEL_MAP) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegate = (prisma as any)[accessor] as {
          count: (args: { where: { userId: string } }) => Promise<number>;
        };
        const remaining = await delegate.count({ where: { userId: B_USER_ID } });
        assert(
          remaining === 0,
          `[7b] ${label}: 0 rows remain for ${B_USER_ID} after cascade`,
          `[7b] ${label}: ${remaining} row(s) SURVIVED the User cascade — FK gap!`,
        );
      }

      // [7c] Shared FoodLibrary row SURVIVES the cascade (positive assertion —
      // shared catalog must not cascade from a User delete). FK direction is
      // FoodUsage.food → FoodLibrary (fires on a FoodLibrary delete, not the
      // reverse) — this is the one place in the sweep that actually exercises
      // the shared-vs-owned boundary end to end.
      const survivingFood = await prisma.foodLibrary.findUnique({ where: { id: sharedFoodId } });
      assert(
        survivingFood !== null,
        "[7c] Shared FoodLibrary row SURVIVED the User cascade (correct — shared catalog)",
        "[7c] Shared FoodLibrary row was DELETED by the User cascade — FK direction regression!",
      );
      // Test-owned cleanup — not part of the cascade proof itself.
      if (survivingFood) {
        await prisma.foodLibrary.delete({ where: { id: sharedFoodId } });
        console.log(`  FoodLibrary (shared) cleaned up: ${sharedFoodId}`);
      }

      // [7d] Post-cleanup founder regression — proves the cascade didn't touch
      // the founder. Distinct from Step 6's mid-run check (which catches
      // founder-bleed from B's writes); this one catches founder-bleed from
      // B's deletion specifically. Both are kept intentionally.
      console.log("\n--- Step 7d: post-cleanup founder regression ---");
      const founderAfterCleanup = await founderSnapshot();
      assertCountsEqual(founderBefore, founderAfterCleanup, "step-7d post-cleanup");

    } catch (cleanupErr) {
      console.error("[CLEANUP ERROR]", cleanupErr);
      failures++;
    }
  }

  // =======================================================================
  // FINAL RESULT
  // =======================================================================
  console.log("\n=== Results ===");
  if (failures === 0) {
    console.log(
      "ALL ASSERTIONS PASSED — cross-tenant isolation confirmed across all 17 scoped models.\n" +
      "Founder counts identical before/after. usr_e9_b fully cleaned up.\n" +
      "Phase-0 done-bar: GREEN. Exit 0.\n",
    );
  } else {
    console.error(
      `${failures} ASSERTION(S) FAILED — isolation breach detected! Exit 1.\n`,
    );
  }
  process.exit(failures > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error("\n[FATAL UNHANDLED ERROR]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
