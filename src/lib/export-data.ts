// src/lib/export-data.ts
// #246 — builds the full data-export payload for the session user.
//
// Isolation by construction: every findMany below runs against the
// ALS-scoped client passed in (see src/lib/db.ts `forUser`/`runWithUser`),
// which auto-injects `where.userId` on all 17 SCOPED_MODELS. There is no
// manual filtering here — the scoping is structural, not something this
// file could get wrong.
//
// Non-scoped models (User, FoodLibrary, Account, Session, VerificationToken,
// OAuth*, WorkoutExercise, Set, PlanDayOverride, PlanRevision) are never
// queried top-level here. The four child models without their own `userId`
// (WorkoutExercise, Set, PlanDayOverride, PlanRevision) are reachable only
// via the `workout`/`plan` relation `include`s below, which inherit their
// parent's userId-scoped `where` — see db.ts:268-270 for the doc comment on
// why that's safe.

import type { ScopedClient } from "@/lib/db";

export interface ExportPayload {
  exportedAt: string;
  format: "goaldmine-export-v1";
  models: {
    workout: unknown[];
    measurement: unknown[];
    footageMarker: unknown[];
    baseline: unknown[];
    note: unknown[];
    hike: unknown[];
    nutritionLog: unknown[];
    mobilityCheckin: unknown[];
    goal: unknown[];
    program: unknown[];
    gameBonusXp: unknown[];
    bodyMetric: unknown[];
    scheduledItem: unknown[];
    logEntry: unknown[];
    plan: unknown[];
    dayRenderJob: unknown[];
    foodUsage: unknown[];
  };
}

/**
 * Builds the full JSON export payload for the current tenant.
 *
 * `db` must be the ALS-scoped client (`getDb()` inside `runWithUser`) — this
 * function performs no ownership filtering itself, it relies entirely on the
 * scoping the passed-in client already enforces.
 */
export async function buildExportPayload(db: ScopedClient): Promise<ExportPayload> {
  const [
    workout,
    measurement,
    footageMarker,
    baseline,
    note,
    hike,
    nutritionLog,
    mobilityCheckin,
    goal,
    program,
    gameBonusXp,
    bodyMetric,
    scheduledItem,
    logEntry,
    plan,
    dayRenderJob,
    foodUsage,
  ] = await Promise.all([
    db.workout.findMany({
      orderBy: { createdAt: "asc" },
      include: { exercises: { include: { sets: true } } },
    }),
    db.measurement.findMany({ orderBy: { createdAt: "asc" } }),
    // FootageMarker: TOP-LEVEL ONLY, not also nested under workout's include.
    // FootageMarker.workoutId is nullable (hike/baseline/other-tagged footage
    // isn't attached to any Workout row), so this top-level query is the
    // complete set — nesting it under `workout` as well would duplicate
    // every workout-linked row for no benefit. The `workoutId` FK on each
    // exported row is sufficient for a reader to reconstruct the linkage.
    db.footageMarker.findMany({ orderBy: { createdAt: "asc" } }),
    db.baseline.findMany({ orderBy: { createdAt: "asc" } }),
    // Note: ALL types included, unfiltered. standing_rule/review/open_item
    // are the user's own rows — the leaky-reads MCP-surface rule (private
    // note types must not leak through *read tools*) doesn't apply to an
    // export of the user's own data; filtering here would silently drop
    // rows the user is entitled to get back.
    db.note.findMany({ orderBy: { createdAt: "asc" } }),
    db.hike.findMany({ orderBy: { createdAt: "asc" } }),
    db.nutritionLog.findMany({ orderBy: { createdAt: "asc" } }),
    db.mobilityCheckin.findMany({ orderBy: { createdAt: "asc" } }),
    db.goal.findMany({ orderBy: { createdAt: "asc" } }),
    db.program.findMany({ orderBy: { createdAt: "asc" } }),
    db.gameBonusXp.findMany({ orderBy: { createdAt: "asc" } }),
    db.bodyMetric.findMany({ orderBy: { createdAt: "asc" } }),
    db.scheduledItem.findMany({ orderBy: { createdAt: "asc" } }),
    db.logEntry.findMany({ orderBy: { createdAt: "asc" } }),
    db.plan.findMany({
      orderBy: { createdAt: "asc" },
      include: { revisions: true, overrides: true },
    }),
    db.dayRenderJob.findMany({ orderBy: { createdAt: "asc" } }),
    db.foodUsage.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    format: "goaldmine-export-v1",
    models: {
      workout,
      measurement,
      footageMarker,
      baseline,
      note,
      hike,
      nutritionLog,
      mobilityCheckin,
      goal,
      program,
      gameBonusXp,
      bodyMetric,
      scheduledItem,
      logEntry,
      plan,
      dayRenderJob,
      foodUsage,
    },
  };
}
