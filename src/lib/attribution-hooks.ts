// src/lib/attribution-hooks.ts
//
// Auto-link engine v1 — DB glue (#307/#308/#309). Wraps the pure evaluators
// in src/lib/attribution.ts with membership loading and ActivityGoalLink
// writes. Called from the activity write cores (createWorkoutCore,
// appendBaselineToDayWorkout, logHikeCore, logNutritionCore, log_metric) and
// from scripts/backfill-attribution.ts (which passes a preloaded context).
//
// Plain async helper module — NO server-action directive (dual-caller
// contract, same as workout-core.ts).
//
// Contract every hook obeys:
//   - SKIP entirely when the user has no ACTIVE Program
//     (getActiveProgramMembership() === null): zero reads beyond the
//     membership probe, zero writes. Pre-Program tenants are untouched.
//   - Only ACTIVE member goals are ever linked (the pure evaluators enforce
//     this; see attribution.ts).
//   - IDEMPOTENT + EXPLICIT-SAFE + TOMBSTONE-SAFE by construction: links are
//     written with ONE top-level `createMany({ skipDuplicates: true })` —
//     Postgres ON CONFLICT DO NOTHING against @@unique([activityType,
//     activityId, goalId]). A pre-existing row — INCLUDING a
//     source:"explicit" one AND a source:"removed" TOMBSTONE (UXR-PV-89) —
//     is never updated, downgraded, or deleted; there is no update path in
//     this module at all (append-only). The tombstone occupies the unique
//     key, so an explicitly-removed link can never be resurrected by these
//     hooks or by scripts/backfill-attribution.ts. Coverage:
//     attribution-manual.test.ts ("auto-engine cannot resurrect …").
//   - TOP-LEVEL SCOPED WRITES ONLY (gotcha §B.10): the createMany is a direct
//     model call on a getDb()-derived client (or its $transaction tx client),
//     so the $extends extension injects userId into every row. NEVER a
//     nested relation write — those bypass the injection and produce
//     userId:null rows.
//   - activityDate = the activity's USER_TZ day (startOfDay from
//     @/lib/calendar), matching the schema's "USER_TZ midnight" contract.
//   - BEST-EFFORT at the call sites: cores invoke hooks with
//     `.catch(swallowAutoLinkError(site))`. The activity row is already
//     committed when a hook runs; letting a link failure fail the tool call
//     would make the coach retry and duplicate the ACTIVITY (a failed call
//     stores no WriteReceipt). A swallowed gap is repairable —
//     scripts/backfill-attribution.ts re-derives links idempotently.
//     (Caveat: inside batch_log_nutrition's $transaction a swallowed link
//     error can still abort the tx at the next statement — Postgres aborts
//     the tx on any errored statement — which fails the batch loudly instead
//     of silently; acceptable.)

import { getDb } from "@/lib/db";
import { getActiveProgramMembership } from "@/lib/program";
import { parseAttributionHints } from "@/lib/goal-attribution";
import { startOfDay } from "@/lib/calendar";
import { ACTIVITY_LINK_TYPE, type ActivityLinkType } from "@/lib/activity-links";
import {
  evaluateWorkoutLinks,
  evaluateNutritionLinks,
  evaluateMirrorLinkGoalIds,
  type AttributionMemberGoal,
} from "@/lib/attribution";
import type { AttributionRule } from "@/lib/attribution-rules";

// ---------------------------------------------------------------------------
// Writer seam
// ---------------------------------------------------------------------------

/** The minimal client surface link writes need. Structurally satisfied by the
 *  getDb() ScopedClient AND its $transaction tx client — hooks write through
 *  whichever client wrote the activity row, so links ride the caller's
 *  transaction when there is one (batch_log_nutrition) and share the scoped
 *  extension's userId injection everywhere. */
export interface AttributionLinkWriter {
  activityGoalLink: {
    createMany(args: {
      data: Array<{
        activityType: string;
        activityId: string;
        goalId: string;
        source: string;
        activityDate: Date;
      }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
}

/**
 * Write `source:"auto"` links for one activity — ONE top-level createMany with
 * skipDuplicates (insert-or-skip on the unique constraint; existing rows,
 * explicit or auto, are never touched). Returns the number of rows actually
 * created (0 on a fully-duplicate re-run). Empty goalIds → no DB call.
 */
export async function writeAutoLinks(
  writer: AttributionLinkWriter,
  activityType: ActivityLinkType,
  activityId: string,
  activityDate: Date,
  goalIds: readonly string[],
): Promise<number> {
  if (goalIds.length === 0) return 0;
  const res = await writer.activityGoalLink.createMany({
    data: goalIds.map((goalId) => ({
      activityType,
      activityId,
      goalId,
      source: "auto",
      activityDate,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

/** Everything the evaluators need about the active Program, loaded once.
 *  null ⇔ no active Program ⇔ every hook is a no-op. */
export interface AttributionContext {
  programId: string;
  memberGoals: AttributionMemberGoal[];
  /** goalId → RAW attributionHints (evaluators canonicalize). Only active
   *  member goals with ≥1 hint appear. Empty when loaded with
   *  { includeHints: false } (the mirror/nutrition hooks never read it). */
  hintsByGoal: Map<string, string[]>;
  rules: AttributionRule[] | null;
}

/**
 * Load the active Program's attribution context, or null when there is no
 * active Program. Membership + parsed rules come from
 * getActiveProgramMembership() (the single trust boundary for the rules
 * Json); hints need one extra scoped read because the membership shape
 * deliberately doesn't carry them.
 *
 * `includeHints: false` skips the hints query for hooks that never
 * hint-match (nutrition, mirrors).
 */
export async function loadAttributionContext(
  opts: { includeHints?: boolean } = {},
): Promise<AttributionContext | null> {
  const includeHints = opts.includeHints ?? true;
  const membership = await getActiveProgramMembership();
  if (!membership) return null;

  const memberGoals: AttributionMemberGoal[] = membership.memberGoals.map(
    ({ id, kind, status }) => ({ id, kind, status }),
  );

  const hintsByGoal = new Map<string, string[]>();
  if (includeHints) {
    const activeIds = memberGoals.filter((g) => g.status === "active").map((g) => g.id);
    if (activeIds.length > 0) {
      const db = await getDb();
      const rows = await db.goal.findMany({
        where: { id: { in: activeIds } },
        select: { id: true, attributionHints: true },
      });
      for (const row of rows) {
        const hints = parseAttributionHints(row.attributionHints);
        if (hints.length > 0) hintsByGoal.set(row.id, hints);
      }
    }
  }

  return {
    programId: membership.id,
    memberGoals,
    hintsByGoal,
    rules: membership.attributionRules,
  };
}

/** Resolve a hook's context parameter: an explicitly-passed context (the
 *  backfill's preloaded one, possibly null) is used as-is; undefined loads. */
async function resolveContext(
  ctx: AttributionContext | null | undefined,
  includeHints: boolean,
): Promise<AttributionContext | null> {
  return ctx !== undefined ? ctx : loadAttributionContext({ includeHints });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface WorkoutAutoLinkInput {
  workoutId: string;
  /** Workout.title as stored. */
  title: string | null;
  /** Workout.source as stored. */
  source: string | null;
  /** Workout.status — only "completed" workouts link (a skipped placeholder
   *  advanced nothing; linking it would badge a skipped day as training). */
  status: string;
  startedAt: Date;
  /** Raw exercise names as stored (canonicalization happens in the evaluator). */
  exerciseNames: readonly string[];
}

/**
 * v1a (#307): hint-matching + Program-rules auto-links for a just-created
 * Workout row. Returns the goalIds linked (already-existing links included —
 * the return reflects evaluation, not row creation).
 */
export async function autoLinkWorkout(
  writer: AttributionLinkWriter,
  input: WorkoutAutoLinkInput,
  ctx?: AttributionContext | null,
): Promise<string[]> {
  if (input.status !== "completed") return [];
  const context = await resolveContext(ctx, true);
  if (!context) return [];
  const goalIds = evaluateWorkoutLinks(
    {
      exerciseNames: input.exerciseNames,
      workoutTitle: input.title,
      source: input.source,
    },
    context.memberGoals,
    context.hintsByGoal,
    context.rules,
  );
  await writeAutoLinks(
    writer,
    ACTIVITY_LINK_TYPE.workout,
    input.workoutId,
    startOfDay(input.startedAt),
    goalIds,
  );
  return goalIds;
}

export interface MirrorLinkInput {
  activityType: typeof ACTIVITY_LINK_TYPE.hike | typeof ACTIVITY_LINK_TYPE.logEntry;
  activityId: string;
  /** The row's authoritative goalId, focus-fallback ALREADY resolved by the
   *  caller (logHikeCore resolves null → current focus goal id). null skips
   *  without touching membership. */
  goalId: string | null;
  /** The activity row's date column (instant; converted to USER_TZ day here). */
  date: Date;
}

/**
 * v1b (#308): mirror Hike.goalId / LogEntry.goalId into the link table. The
 * goalId column stays authoritative; the link only materializes when the goal
 * is an active member of the active Program.
 */
export async function mirrorActivityGoalLink(
  writer: AttributionLinkWriter,
  input: MirrorLinkInput,
  ctx?: AttributionContext | null,
): Promise<string[]> {
  if (!input.goalId) return [];
  const context = await resolveContext(ctx, false);
  if (!context) return [];
  const goalIds = evaluateMirrorLinkGoalIds(input.goalId, context.memberGoals);
  await writeAutoLinks(
    writer,
    input.activityType,
    input.activityId,
    startOfDay(input.date),
    goalIds,
  );
  return goalIds;
}

export interface NutritionAutoLinkInput {
  nutritionLogId: string;
  /** NutritionLog.date (instant; converted to USER_TZ day here). */
  date: Date;
}

/**
 * v1c (#309): a logged meal links to every ACTIVE FITNESS-kind member goal —
 * never to project-kind members, and Program attributionRules deliberately
 * do NOT apply to nutrition in v1 (see evaluateNutritionLinks' doc).
 */
export async function autoLinkNutrition(
  writer: AttributionLinkWriter,
  input: NutritionAutoLinkInput,
  ctx?: AttributionContext | null,
): Promise<string[]> {
  const context = await resolveContext(ctx, false);
  if (!context) return [];
  const goalIds = evaluateNutritionLinks(context.memberGoals);
  await writeAutoLinks(
    writer,
    ACTIVITY_LINK_TYPE.nutrition,
    input.nutritionLogId,
    startOfDay(input.date),
    goalIds,
  );
  return goalIds;
}

// ---------------------------------------------------------------------------
// Call-site error policy
// ---------------------------------------------------------------------------

/**
 * Catch handler for hook invocations at activity-write call sites:
 * `await autoLinkWorkout(...).catch(swallowAutoLinkError("createWorkoutCore"))`.
 * Logs and returns [] — see the module header for why auto-linking must never
 * fail an already-committed activity write. The backfill script deliberately
 * does NOT use this (failures there should be loud).
 */
export function swallowAutoLinkError(site: string): (e: unknown) => string[] {
  return (e: unknown) => {
    console.error(
      `[attribution] auto-link failed at ${site} — activity row already written; ` +
        `links can be repaired with scripts/backfill-attribution.ts:`,
      e,
    );
    return [];
  };
}
