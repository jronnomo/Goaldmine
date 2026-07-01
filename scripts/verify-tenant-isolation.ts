// scripts/verify-tenant-isolation.ts
//
// E5-1 — Adversarial cross-tenant isolation harness.
//
// Proves that three global-write paths (setFocusGoalCore, resolveAllPendingNotes,
// unskipDay) and getDb() reads are ALL scoped to the requesting user — one
// user's bulk action cannot touch another user's rows.
//
// Run only against the dev branch:
//   npx tsx scripts/verify-tenant-isolation.ts
//
// Idempotent: seeds usr_iso_a / usr_iso_b, exercises the three traps, then
// deletes all seeded rows + both users in a finally block.

import "dotenv/config";

// ---------------------------------------------------------------------------
// Dev-DB guard — must run first, before any DB import
// ---------------------------------------------------------------------------
if (process.env.DB_ENV !== "development") {
  console.error(
    "[ABORT] DB_ENV is not 'development'. Refusing to run against non-dev DB.\n" +
      `       Got: DB_ENV=${process.env.DB_ENV ?? "(unset)"}`,
  );
  process.exit(1);
}

import { prisma, forUser, runWithUser, getDb } from "../src/lib/db";
import { setFocusGoalCore } from "../src/lib/goal-core";
import { resolveAllPendingNotes } from "../src/lib/note-actions";
import { unskipDay } from "../src/lib/day-log-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A safe past date that won't collide with any real user data.
// "2000-01-15" noon UTC = 05:00 MST — falls inside startOfDay/endOfDay("2000-01-15")
// for America/Denver (UTC-7 in January, MST).
const ISO_DATE_KEY = "2000-01-15";
const ISO_STARTED_AT = new Date("2000-01-15T12:00:00.000Z");

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

/** Whether an error looks like a Next.js revalidatePath / cache invariant thrown
 *  outside a request context — expected when calling server actions in a script. */
function isRevalidateError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("revalidatePath") ||
    msg.includes("revalidateTag") ||
    msg.includes("static generation store") ||
    msg.includes("Invariant") ||
    // Next.js 15/16 throws ERR_INVALID_STATE when cache context is missing
    msg.includes("ERR_INVALID_STATE")
  );
}

// ---------------------------------------------------------------------------
// Main harness
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== E5-1 Adversarial Tenant Isolation Harness ===");
  console.log(`DB_ENV: ${process.env.DB_ENV ?? "unset"}  [dev — safe ✓]\n`);

  // Seeded row IDs (captured for targeted cleanup)
  let goalA1Id = "";
  let goalA2Id = "";
  let goalBId = "";
  let noteAId = "";
  let noteBId = "";
  let workoutAId = "";
  let workoutBId = "";

  try {
    // -----------------------------------------------------------------------
    // SEED
    // -----------------------------------------------------------------------
    console.log("--- Seeding ---");

    // Create two throwaway users via raw prisma (scripts run outside user context)
    const userA = await prisma.user.upsert({
      where: { id: "usr_iso_a" },
      update: {},
      create: { id: "usr_iso_a", name: "Isolation Test A" },
    });
    const userB = await prisma.user.upsert({
      where: { id: "usr_iso_b" },
      update: {},
      create: { id: "usr_iso_b", name: "Isolation Test B" },
    });
    console.log(`  Created users: ${userA.id}, ${userB.id}`);

    // Seed user A fixtures via the scoped client (forUser injects userId)
    const dbA = forUser("usr_iso_a");

    // A needs two goals so setFocusGoalCore has a target different from the current focus.
    const goalA1 = await dbA.goal.create({
      data: { objective: "iso-goal-a1", kind: "fitness", active: true, isFocus: true },
    });
    goalA1Id = goalA1.id;

    const goalA2 = await dbA.goal.create({
      data: { objective: "iso-goal-a2", kind: "fitness", active: true, isFocus: false },
    });
    goalA2Id = goalA2.id;

    const noteA = await dbA.note.create({
      data: { body: "iso-note-a", type: "journal", date: new Date(), resolvedAt: null },
    });
    noteAId = noteA.id;

    const workoutA = await dbA.workout.create({
      data: { title: "iso-skip-a", startedAt: ISO_STARTED_AT, status: "skipped" },
    });
    workoutAId = workoutA.id;

    console.log(`  User A: goals ${goalA1Id} (focus), ${goalA2Id}; note ${noteAId}; workout ${workoutAId}`);

    // Seed user B fixtures
    const dbB = forUser("usr_iso_b");

    const goalB = await dbB.goal.create({
      data: { objective: "iso-goal-b", kind: "fitness", active: true, isFocus: true },
    });
    goalBId = goalB.id;

    const noteB = await dbB.note.create({
      data: { body: "iso-note-b", type: "journal", date: new Date(), resolvedAt: null },
    });
    noteBId = noteB.id;

    const workoutB = await dbB.workout.create({
      data: { title: "iso-skip-b", startedAt: ISO_STARTED_AT, status: "skipped" },
    });
    workoutBId = workoutB.id;

    console.log(`  User B: goal ${goalBId} (focus); note ${noteBId}; workout ${workoutBId}`);

    // -----------------------------------------------------------------------
    // TRAP 1 — Focus switch (setFocusGoalCore)
    // -----------------------------------------------------------------------
    console.log("\n[1] Focus trap: setFocusGoalCore(goalA2) as user A");

    await runWithUser("usr_iso_a", async () => {
      // Switches A's focus from goalA1 → goalA2.
      // Internally calls: tx.goal.updateMany({ data: { isFocus: false } })
      // The extension injects userId="usr_iso_a" into the where clause → scoped.
      await setFocusGoalCore(goalA2Id);
    });

    // Verify B's goal was NOT touched
    const goalBRow = await prisma.goal.findUnique({ where: { id: goalBId }, select: { isFocus: true } });
    assert(
      goalBRow?.isFocus === true,
      "B's goal isFocus=true — A's updateMany({ data:{isFocus:false} }) did NOT touch B",
      "B's goal isFocus was cleared — A's updateMany bled into B's rows!",
      `goalBRow.isFocus=${goalBRow?.isFocus}`,
    );

    // Verify A's focus DID switch (confirms the write happened)
    const goalA2Row = await prisma.goal.findUnique({ where: { id: goalA2Id }, select: { isFocus: true } });
    const goalA1Row = await prisma.goal.findUnique({ where: { id: goalA1Id }, select: { isFocus: true } });
    assert(
      goalA2Row?.isFocus === true && goalA1Row?.isFocus === false,
      "A's focus switched A1→A2 as expected (write confirmed)",
      "A's focus switch did not apply — write may have silently failed",
      `a1.isFocus=${goalA1Row?.isFocus} a2.isFocus=${goalA2Row?.isFocus}`,
    );

    // -----------------------------------------------------------------------
    // TRAP 2 — Bulk note resolve (resolveAllPendingNotes)
    // -----------------------------------------------------------------------
    console.log("\n[2] Notes trap: resolveAllPendingNotes() as user A");

    await runWithUser("usr_iso_a", async () => {
      try {
        await resolveAllPendingNotes();
      } catch (e) {
        // revalidatePath throws outside a Next.js request — DB write committed before this.
        // Re-throw anything that looks like a genuine DB error.
        if (!isRevalidateError(e)) throw e;
        // else: expected Next.js cache error — continue
      }
    });

    // Verify B's note was NOT resolved
    const noteBRow = await prisma.note.findUnique({
      where: { id: noteBId },
      select: { resolvedAt: true },
    });
    assert(
      noteBRow?.resolvedAt === null,
      "B's note resolvedAt=null — A's updateMany({ where:{resolvedAt:null} }) did NOT touch B",
      "B's note was resolved by A — updateMany bled into B's notes!",
      `noteBRow.resolvedAt=${noteBRow?.resolvedAt}`,
    );

    // Verify A's note WAS resolved (write confirmed)
    const noteARow = await prisma.note.findUnique({
      where: { id: noteAId },
      select: { resolvedAt: true },
    });
    assert(
      noteARow?.resolvedAt !== null,
      "A's note resolvedAt is set — write confirmed",
      "A's note was NOT resolved — write did not happen",
      `noteARow.resolvedAt=${noteARow?.resolvedAt}`,
    );

    // -----------------------------------------------------------------------
    // TRAP 3 — Unskip day (unskipDay → workout.deleteMany)
    // -----------------------------------------------------------------------
    console.log("\n[3] Unskip trap: unskipDay(dateKey) as user A");

    await runWithUser("usr_iso_a", async () => {
      try {
        await unskipDay(ISO_DATE_KEY);
      } catch (e) {
        if (!isRevalidateError(e)) throw e;
      }
    });

    // Verify B's workout still exists (was NOT deleted)
    const workoutBRow = await prisma.workout.findUnique({
      where: { id: workoutBId },
      select: { id: true, status: true },
    });
    assert(
      workoutBRow !== null && workoutBRow.status === "skipped",
      "B's skipped workout still exists — A's deleteMany did NOT touch B",
      "B's workout was deleted by A — deleteMany bled into B's rows!",
      `workoutBRow=${JSON.stringify(workoutBRow)}`,
    );

    // Verify A's workout WAS deleted (write confirmed)
    const workoutARow = await prisma.workout.findUnique({ where: { id: workoutAId }, select: { id: true } });
    assert(
      workoutARow === null,
      "A's skipped workout was deleted by unskipDay — write confirmed",
      "A's workout was NOT deleted — unskipDay write did not happen",
      `workoutARow=${JSON.stringify(workoutARow)}`,
    );

    // -----------------------------------------------------------------------
    // TRAP 4 — Read isolation (getDb().goal.findMany inside runWithUser)
    // -----------------------------------------------------------------------
    console.log("\n[4] Read isolation: getDb().goal.findMany() inside runWithUser(A)");

    const goalsSeenByA = await runWithUser("usr_iso_a", async () => {
      const db = await getDb();
      return db.goal.findMany({ select: { id: true, userId: true } });
    });

    const bGoalInAResults = goalsSeenByA.find((g) => g.id === goalBId);
    assert(
      bGoalInAResults === undefined,
      "A's findMany() does NOT include B's goal — read isolation confirmed",
      "A's findMany() returned B's goal — read scoping is broken!",
      `goalsSeenByA ids: ${goalsSeenByA.map((g) => g.id).join(", ")}`,
    );

    // Sanity: A should see their own goals
    const aGoal1InAResults = goalsSeenByA.find((g) => g.id === goalA1Id);
    const aGoal2InAResults = goalsSeenByA.find((g) => g.id === goalA2Id);
    assert(
      aGoal1InAResults !== undefined && aGoal2InAResults !== undefined,
      `A's findMany() returns A's own goals (${goalsSeenByA.length} total — may include pre-existing goals)`,
      "A's findMany() is missing A's own goals — over-scoping!",
    );
  } finally {
    // -----------------------------------------------------------------------
    // CLEANUP — always runs, even on assertion failures
    // -----------------------------------------------------------------------
    console.log("\n--- Cleanup ---");

    // Delete children first, then parent users.
    // (onDelete:Cascade on the FK means deleting a User cascades, but explicit
    //  child deletes are safer and let us report counts accurately.)
    const deletedNotes = await prisma.note.deleteMany({
      where: { userId: { in: ["usr_iso_a", "usr_iso_b"] } },
    });
    console.log(`  Notes deleted:    ${deletedNotes.count}`);

    const deletedWorkouts = await prisma.workout.deleteMany({
      where: { userId: { in: ["usr_iso_a", "usr_iso_b"] } },
    });
    console.log(`  Workouts deleted: ${deletedWorkouts.count}`);

    const deletedGoals = await prisma.goal.deleteMany({
      where: { userId: { in: ["usr_iso_a", "usr_iso_b"] } },
    });
    console.log(`  Goals deleted:    ${deletedGoals.count}`);

    const deletedUsers = await prisma.user.deleteMany({
      where: { id: { in: ["usr_iso_a", "usr_iso_b"] } },
    });
    console.log(`  Users deleted:    ${deletedUsers.count}`);

    // Verify cleanup
    const remaining = await prisma.user.findMany({
      where: { id: { in: ["usr_iso_a", "usr_iso_b"] } },
      select: { id: true },
    });
    if (remaining.length === 0) {
      console.log("  Cleanup verified — usr_iso_a and usr_iso_b are gone ✓");
    } else {
      console.error(`  Cleanup INCOMPLETE — remaining users: ${remaining.map((u) => u.id).join(", ")}`);
      failures++;
    }
  }

  // -----------------------------------------------------------------------
  // FINAL RESULT
  // -----------------------------------------------------------------------
  console.log("\n=== Results ===");
  if (failures === 0) {
    console.log("ALL ASSERTIONS PASSED — tenant isolation confirmed. Exit 0.\n");
  } else {
    console.error(`${failures} ASSERTION(S) FAILED — isolation breach detected! Exit 1.\n`);
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n[FATAL UNHANDLED ERROR]", err);
  process.exit(1);
});
