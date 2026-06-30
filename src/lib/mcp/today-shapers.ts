// src/lib/mcp/today-shapers.ts
//
// Pure (no DB) shaper functions for get_today_plan's project-focus branch.
// The fitness branch is unchanged — only kind='project' focus uses these.
// Unit-tested in today-shapers.test.ts.

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
// ProjectTodayPayload type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * get_today_plan response shape for a project-kind focus goal.
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
// shapeProjectTodayPayload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the project-shaped get_today_plan payload from the resolved day + handler locals.
 *
 * Pure function — no DB calls, no side effects. Every ResolvedDay field is
 * explicitly handled so the return has the same keys as the fitness payload.
 *
 * Field handling (28 ResolvedDay fields):
 *   CARRY      date, dateKey, isInPlan, isGoalDate, confidence,
 *              otherGoalEvents, crossGoalConflicts
 *   FILTERED   notesAboutDate (type:'review' excluded — weekly-review note is
 *              fitness noise; project-relevant notes pass through)
 *   OVERRIDE   goalObjective ← activeGoal.objective
 *   NULL       todayTask, activeWorkout, deferredWorkout, plannedHikeToday,
 *              longEffortConflict, nutritionText, nutritionPlan, mobilityText,
 *              notes, override, rotationDay, weekIndex
 *   FALSE      isOverride, workoutDeferredForBaseline, workoutDeferredForHike,
 *              orphanedOverride
 *   EMPTY []   workouts, loggedNutrition, baselinesDue
 *   PROJECT    todayItems, feasibility, standingRules, focusGoal, activeGoal
 */
export function shapeProjectTodayPayload(
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
