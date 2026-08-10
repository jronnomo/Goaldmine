// Plain async helpers for Baseline mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/workout-actions.ts) AND MCP route handlers / tool
// registrations (src/lib/mcp/tools.ts). Adding the directive would constrain
// it to server-action call sites only and break the MCP path.
//
// Dual-caller contract:
//   - Server actions call these cores and then add revalidatePath.
//   - MCP tools (tools.ts) call these cores directly — no revalidatePath needed.

import { getDb } from "@/lib/db";
import { removeBaselineFromDayWorkout } from "@/lib/baseline-workout";
import { ACTIVITY_LINK_TYPE } from "@/lib/activity-links";

// ---------------------------------------------------------------------------
// deleteBaselineCore (#272 delete-hook consolidation)
// ---------------------------------------------------------------------------

export interface DeleteBaselineCoreResult {
  id: string;
  /** For the dashboard caller's revalidate/redirect targets. */
  testName: string;
  date: Date;
}

/**
 * Delete one Baseline row AND its ActivityGoalLink rows in the same
 * transaction, then sync the day's mirrored baseline workout
 * (removeBaselineFromDayWorkout — drops the mirrored exercise and, if that
 * leaves the baseline workout empty, deletes the workout via deleteWorkoutCore
 * so ITS links are cleaned too).
 *
 * - findUniqueOrThrow-first preserves both previous callers' semantics: a
 *   missing id throws before anything is written.
 * - The workout sync runs OUTSIDE the transaction: it is multi-statement, may
 *   itself open a transaction (deleteWorkoutCore), and was never atomic with
 *   the baseline delete before this consolidation either.
 * - Sequential top-level tx calls (never nested writes) so the getDb()
 *   tenant-scoping extension fires for both deletes.
 */
export async function deleteBaselineCore(id: string): Promise<DeleteBaselineCoreResult> {
  const db = await getDb();
  const row = await db.baseline.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.baseline.delete({ where: { id } });
    await tx.activityGoalLink.deleteMany({
      where: { activityType: ACTIVITY_LINK_TYPE.baseline, activityId: id },
    });
  });
  await removeBaselineFromDayWorkout({ testName: row.testName, date: row.date });
  return { id, testName: row.testName, date: row.date };
}
