// src/lib/goal-story-core.ts
//
// Pure, client-safe core for the goal-story bundle — the time-aware
// retrospective view of a goal (readiness arc + targets table + baseline/
// hike/metric arcs + phase timeline with revision changelog). Assembled by
// goal-story.ts (the IO layer, Stage B2 — getDb-backed), consumed by the
// get_goal_story MCP tool AND the trophy page's Story section (Stage B3).
// NO Prisma imports — date math only via @/lib/calendar-core (mirrors the
// goal-completion.ts / goal-completion-core.ts split: pure math here, IO
// done by the caller).
//
// Moved here in Stage A2 (S9, architecture-blueprint-v2.md) rather than
// alongside goal-story.ts in Stage B2, so B2 (assembly) and B3 (components)
// both branch from a worktree that already has the agreed GoalStory type —
// they can't disagree about its shape.

import { addDays, dateKey } from "@/lib/calendar-core";
import type { ProgramTemplate } from "@/lib/program-template";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

/**
 * The full story bundle for a single goal — achieved (frozen, sourced from
 * its GoalCompletionSnapshot) or active (live, "story so far"). Every field
 * is plain/serializable (ISO date strings or USER_TZ dateKeys only — never a
 * raw Date, never a Prisma row) so the type crosses both boundaries this
 * feature needs unmodified: the MCP JSON-RPC wire AND the server→client
 * component prop boundary on the trophy page.
 *
 * R9 (binding): for an achieved goal, `readinessSeries`/`targets` come from
 * the frozen snapshot ONLY — goal-story.ts never calls computeReadiness for
 * an achieved goal. `snapshot` itself is null while the goal is still active
 * (there is nothing frozen yet).
 */
export type GoalStory = {
  /** Minimal, never-the-raw-row goal identity (no userId — MCP-safe). */
  goal: {
    id: string;
    objective: string;
    kind: string;
    status: string;
    /** dateKey(goal.createdAt), USER_TZ. */
    createdAtKey: string;
    /** dateKey(goal.completedAt) when achieved, else null. */
    completedDateKey: string | null;
  };
  /**
   * The window every arc below is clipped to — [createdAtKey, endKey] where
   * endKey is completedDateKey for an achieved goal or "today" for an active
   * one. Callers should clip any per-goal history through this window via
   * clipToWindow rather than re-deriving it.
   */
  window: { startKey: string; endKey: string };
  /** Frozen completion snapshot for an achieved goal; null while active. */
  snapshot: GoalCompletionSnapshot | null;
  /**
   * Readiness-over-time points, USER_TZ dateKeys. Achieved: the series
   * frozen at complete_goal time (S2) — null when absent (a zero-target goal,
   * OR a legacy pre-freeze completion; the trophy page's degrade path is the
   * same "reopen and re-complete to capture the arc" hint either way — never
   * assume null implies "legacy"). Active: the live story-so-far series.
   * Null means "not captured" — never coerce to an empty array, the UI
   * distinguishes "no arc yet" from "arc with zero points".
   */
  readinessSeries: { dateKey: string; score: number }[] | null;
  /** Start→final targets table. Achieved: snapshot.targets. Active: the live equivalent, same shape. */
  targets: GoalCompletionSnapshot["targets"];
  /**
   * Fitness-only: per-baseline-test history, clipped to `window`. Baseline
   * has no goalId column (S6) — this is the user's full test history for
   * that test name, clipped, same semantics readiness itself uses. Empty
   * array for project goals (never null — "no baseline arcs" is a real,
   * expected state for that kind).
   */
  baselineArcs: {
    testName: string;
    units: string;
    points: { dateKey: string; value: number }[];
  }[];
  /**
   * Fitness-only: this goal's hike history (goalId-scoped — see Hike model),
   * clipped to `window`. Empty for project goals.
   */
  hikeArc: {
    dateKey: string;
    route: string;
    distanceMi: number;
    elevationFt: number;
    summitFt: number | null;
    packWeightLb: number | null;
    durationMin: number;
    status: string;
  }[];
  /** Project-only: per-`log:*` target time series (getLogMetricSeries shape). Empty for fitness goals. */
  metricArcs: {
    metric: string;
    label: string;
    units: string;
    domain: [number, number];
    points: { date: string; value: number; label: string }[];
  }[];
  /**
   * The goal's latest plan's phase timeline + revision changelog, fetched
   * regardless of the plan's active state (an achieved goal's plan is always
   * deactivated). Null when the goal never had a plan (plan-less project
   * goals, or a fitness goal never upgraded to a program).
   */
  timeline: {
    planName: string;
    startedOnKey: string;
    weeksTotal: number;
    phases: {
      name: string;
      weekStart: number;
      weekEnd: number;
      startKey: string;
      endKey: string;
    }[];
    /**
     * Revision changelog — intentionally triggerNote-FREE (S5). The trophy
     * page's full-fidelity PlanChangelog component reads triggerNote
     * directly off PlanRevision for the same-tenant page; THIS type also
     * crosses the MCP tool boundary (get_goal_story), where triggerNoteId
     * can point at a private note type — so it never carries triggerNote,
     * by design, on both consumers (leaky-reads-safe).
     */
    revisions: {
      id: string;
      createdAtKey: string;
      triggerSource: string;
      summary: string;
      reasoning: string | null;
    }[];
  } | null;
};

/**
 * Clip a dateKey-stamped point list to a window, INCLUSIVE on both ends.
 * Pure lexicographic string comparison — dateKeys are "yyyy-mm-dd", so
 * string order equals calendar order. Generic over any point shape that
 * carries a `dateKey` field (baseline points, hike-arc rows, …).
 */
export function clipToWindow<T extends { dateKey: string }>(
  points: T[],
  window: { startKey: string; endKey: string },
): T[] {
  return points.filter((p) => p.dateKey >= window.startKey && p.dateKey <= window.endKey);
}

/**
 * Derive the phase timeline's `phases[]` (name + week range + calendar
 * dates) from a ProgramTemplate's `phases[]` and the plan's `startedOn`.
 *
 * Week numbering is 1-based and keys off `startedOn`, NOT calendar weekday —
 * week 1 day 1 is startedOn itself (mirrors the rotation-day math everywhere
 * else in this codebase, e.g. calendar.ts's isInPlan). Week N therefore
 * spans the 7-day block [startedOn + (N-1)*7, startedOn + N*7 - 1]. A
 * phase's own range is the min..max of its (possibly non-contiguous, though
 * templates in practice use a contiguous run) `weeks[]` array — so its
 * startKey is the first day of its lowest week and its endKey is the last
 * day of its highest week.
 */
export function derivePhaseTimeline(
  template: ProgramTemplate,
  startedOn: Date,
): NonNullable<GoalStory["timeline"]>["phases"] {
  return template.phases.map((phase) => {
    const weekStart = Math.min(...phase.weeks);
    const weekEnd = Math.max(...phase.weeks);
    return {
      name: phase.name,
      weekStart,
      weekEnd,
      startKey: dateKey(addDays(startedOn, (weekStart - 1) * 7)),
      endKey: dateKey(addDays(startedOn, weekEnd * 7 - 1)),
    };
  });
}
