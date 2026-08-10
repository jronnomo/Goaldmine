// src/lib/mcp/today-shapers.ts
//
// Pure (no DB) shaper functions for get_today_plan.
//
// #283 (plan §4.2): this module is now a MERGER, not a nuller. Any user with
// an active Program gets the program-shaped payload (shapeProgramTodayPayload):
// the rotation prescription fields pass through from ResolvedDay untouched
// (they already reflect ONLY the Program's plan — the seam scopes them), PLUS
// program / scheduledItemsToday / goalMarks / per-goal sections. The old
// project-vs-fitness payload fork survives ONLY for zero-Program legacy
// tenants (shapeLegacyProjectTodayPayload — byte-identical to the pre-#283
// nuller, plus the additive #282 keys). Unit-tested in today-shapers.test.ts.

import type { ResolvedDay } from "@/lib/calendar";
import type { GoalFeasibility } from "@/lib/rarity-core";

// ─────────────────────────────────────────────────────────────────────────────
// Local shape aliases (mirrors tools.ts handler locals)
// ─────────────────────────────────────────────────────────────────────────────

export type ActiveGoalShape = {
  id: string;
  kind: string;
  objective: string | null;
  githubRepo: string | null;
};

export type StandingRuleShape = {
  id: string;
  body: string;
  date: Date;
  lastAcknowledgedAt: Date | null;
};

export type TodayItemShape = {
  id: string;
  type: string;
  title: string;
  status: string;
  completedAt: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// ProgramTodayPayload (#283 — the merged, program-shaped payload)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One member goal's section of the merged payload — that goal's ScheduledItems
 * for today plus (project-kind only) its computed feasibility. Keyed by goalId
 * in ProgramTodayPayload.goalSections.
 */
export type MemberGoalSection = {
  goalId: string;
  objective: string;
  kind: string;
  status: string;
  todayItems: TodayItemShape[];
  /** Reach tier for project-kind member goals (one computation per project
   *  goal, done by the handler); null for fitness kinds and compute failures. */
  feasibility: GoalFeasibility | null;
};

/**
 * get_today_plan response for ANY user with an active Program (#283).
 *
 * The full ResolvedDay passes through UNTOUCHED — including the rotation
 * prescription fields (todayTask/activeWorkout/nutrition/baselines/...),
 * which already reflect only the Program's plan: an active Program with no
 * rotation plan resolves to todayTask "out_of_plan" with null/[] fitness
 * fields (the chewgether "no rotation today" state — NOT an error, and never
 * a fall-through to some other goal's plan), and isInPlan/confidence likewise
 * describe the Program's plan window or null/'past' when there is none (the
 * RFC-cited cross-plan leak cannot occur here).
 *
 * On top of ResolvedDay:
 *  - standingRules / focusGoal / activeGoal — session-start surfaces,
 *    unchanged from the legacy payloads.
 *  - todayItems — saved-prompt-compatible flat list, now the UNION across all
 *    member goals (each row gains goalId + goalObjective so cross-goal work
 *    is attributable at a glance).
 *  - goalSections — per-member-goal sections keyed by goalId (RFC D5 point 3:
 *    todayItems/feasibility move from focus-goal-only to per-member-goal).
 */
export type ProgramTodayPayload = ResolvedDay & {
  standingRules: StandingRuleShape[];
  focusGoal: ActiveGoalShape | null;
  activeGoal: ActiveGoalShape | null; // saved-prompt compat duplicate
  todayItems: (TodayItemShape & { goalId: string; goalObjective: string | null })[];
  goalSections: Record<string, MemberGoalSection>;
};

// ─────────────────────────────────────────────────────────────────────────────
// shapeProgramTodayPayload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the merged program-shaped payload from the resolved day + handler
 * locals. Pure — no DB; the handler supplies feasibility (one computation per
 * ACTIVE project-kind member goal) via `feasibilityByGoalId`.
 *
 * The project/fitness dichotomy dissolves here: rotation fields AND
 * program-shaped fields coexist in one payload, so a day where the
 * rotation-owning goal is fitness but a project member goal has work due
 * shows BOTH (the founder's Monday walk + AWS case).
 */
export function shapeProgramTodayPayload(
  r: ResolvedDay,
  activeGoal: ActiveGoalShape | null,
  standingRules: StandingRuleShape[],
  feasibilityByGoalId: ReadonlyMap<string, GoalFeasibility | null>,
): ProgramTodayPayload {
  const todayItems = r.scheduledItemsToday.map((it) => ({
    id: it.id,
    type: it.type,
    title: it.title,
    status: it.status,
    completedAt: it.completedAt ? it.completedAt.toISOString() : null,
    goalId: it.goalId,
    goalObjective: it.goalObjective,
  }));

  const goalSections: Record<string, MemberGoalSection> = {};
  for (const g of r.program?.memberGoals ?? []) {
    goalSections[g.id] = {
      goalId: g.id,
      objective: g.objective,
      kind: g.kind,
      status: g.status,
      todayItems: todayItems
        .filter((it) => it.goalId === g.id)
        .map(({ id, type, title, status, completedAt }) => ({ id, type, title, status, completedAt })),
      feasibility: feasibilityByGoalId.get(g.id) ?? null,
    };
  }

  return {
    ...r,
    standingRules,
    focusGoal: activeGoal,
    activeGoal, // saved-prompt compat — remove next release (mirrors legacy payloads)
    todayItems,
    goalSections,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ProjectTodayPayload type (LEGACY — zero-Program project-focus tenants only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * get_today_plan response shape for a project-kind focus goal WITHOUT any
 * Program (#283: this shape now serves zero-Program legacy tenants only —
 * Program users get ProgramTodayPayload above).
 *
 * Extends ResolvedDay minus todayTask (which is null here, not TodayTask).
 * All fitness-only scalars are null/false/[], never omitted, so saved-prompt
 * destructuring degrades gracefully to null/[] rather than undefined.
 * Project-specific fields (todayItems, feasibility, standingRules, focusGoal,
 * activeGoal) are added on top.
 */
export type ProjectTodayPayload = Omit<ResolvedDay, "todayTask"> & {
  // Override: null (not a TodayTask enum value — avoids ripple to Today page / game engine)
  todayTask: null;
  // Project additions
  todayItems: TodayItemShape[];
  feasibility: GoalFeasibility | null;
  standingRules: StandingRuleShape[];
  focusGoal: ActiveGoalShape | null;
  activeGoal: ActiveGoalShape | null; // saved-prompt compat duplicate
};

// ─────────────────────────────────────────────────────────────────────────────
// shapeLegacyProjectTodayPayload (the pre-#283 "nuller", legacy tenants only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the project-shaped get_today_plan payload from the resolved day + handler locals.
 *
 * #283: reached ONLY when the user has NO active Program (r.program === null)
 * and the focus goal is project-kind — the zero-Program legacy tenant path,
 * kept byte-identical to the pre-#283 output (plus the additive #282 keys,
 * which are null/[]/[] here by definition). Program users never hit this;
 * they get shapeProgramTodayPayload's merged shape instead.
 *
 * Pure function — no DB calls, no side effects. Every ResolvedDay field is
 * explicitly handled so the return has the same keys as the fitness payload.
 *
 * Field handling (32 ResolvedDay fields):
 *   CARRY      date, dateKey, isInPlan, isGoalDate, confidence,
 *              otherGoalEvents, crossGoalConflicts,
 *              program, scheduledItemsToday, goalMarks (#282 — this shaper is
 *              only reached when r.program is null (zero-Program legacy
 *              tenants), so these carry through as null/[]/[] by definition)
 *   FILTERED   notesAboutDate (type:'review' excluded — weekly-review note is
 *              fitness noise; project-relevant notes pass through)
 *   OVERRIDE   goalObjective ← activeGoal.objective
 *   NULL       todayTask, activeWorkout, deferredWorkout, plannedHikeToday,
 *              longEffortConflict, nutritionText, nutritionPlan, mobilityText,
 *              notes, override, rotationDay, weekIndex, resolvedPlan (REQ-003:
 *              Plan/program is a fitness-only rotation concept)
 *   FALSE      isOverride, workoutDeferredForBaseline, workoutDeferredForHike,
 *              orphanedOverride
 *   EMPTY []   workouts, loggedNutrition, baselinesDue
 *   PROJECT    todayItems, feasibility, standingRules, focusGoal, activeGoal
 */
export function shapeLegacyProjectTodayPayload(
  r: ResolvedDay,
  activeGoal: ActiveGoalShape | null,
  standingRules: StandingRuleShape[],
  todayItems: TodayItemShape[],
  feasibility: GoalFeasibility | null,
): ProjectTodayPayload {
  return {
    // ── CARRY ──────────────────────────────────────────────────────────────
    date: r.date,
    dateKey: r.dateKey,
    isInPlan: r.isInPlan,
    isGoalDate: r.isGoalDate,
    confidence: r.confidence,
    otherGoalEvents: r.otherGoalEvents,
    crossGoalConflicts: r.crossGoalConflicts,
    // #282 additions — carried, not re-nulled: this legacy shaper is only
    // reached when r.program is null, so these are null/[]/[] by definition.
    program: r.program,
    scheduledItemsToday: r.scheduledItemsToday,
    goalMarks: r.goalMarks,

    // ── CARRY with filter ──────────────────────────────────────────────────
    // Exclude weekly-review notes — they are fitness coaching artefacts and
    // are noise when the focus goal is a project.
    notesAboutDate: r.notesAboutDate.filter((n) => n.type !== "review"),

    // ── OVERRIDE ───────────────────────────────────────────────────────────
    // r.goalObjective is null except on the exact goal date; always use the
    // active goal's objective so the coach sees the project name on every call.
    goalObjective: activeGoal?.objective ?? null,

    // ── NULL scalars ───────────────────────────────────────────────────────
    todayTask: null,
    activeWorkout: null,
    deferredWorkout: null,
    plannedHikeToday: null,
    longEffortConflict: null,
    nutritionText: null,
    nutritionPlan: null,
    mobilityText: null,
    notes: null,
    override: null,
    rotationDay: null,
    weekIndex: null,
    // resolvedPlan (REQ-003): Plan/program is a fitness-only rotation concept —
    // nulled here same as rotationDay/weekIndex/activeWorkout above.
    resolvedPlan: null,

    // ── FALSE booleans ─────────────────────────────────────────────────────
    isOverride: false,
    workoutDeferredForBaseline: false,
    workoutDeferredForHike: false,
    orphanedOverride: false,

    // ── EMPTY arrays ───────────────────────────────────────────────────────
    workouts: [],
    loggedNutrition: [],
    baselinesDue: [],

    // ── PROJECT fields ─────────────────────────────────────────────────────
    todayItems,
    feasibility,
    standingRules,
    focusGoal: activeGoal,
    activeGoal, // saved-prompt compat — remove next release (mirrors fitness branch)
  };
}
