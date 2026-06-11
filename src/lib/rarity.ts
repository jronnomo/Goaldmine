// src/lib/rarity.ts
//
// Async wrapper around the pure rarity engine (rarity-core.ts).
// Imports Prisma + @/lib/calendar — NOT client-safe. Server and MCP only.
//
// All date math via @/lib/calendar (USER_TZ correctness — Vercel runs UTC).

import { prisma } from "@/lib/db";
import { startOfDay, addDays } from "@/lib/calendar";
import { resolveMetricValue } from "@/lib/goal-targets";
import { getExerciseHistory } from "@/lib/records";
import { getGoalEventsResult } from "@/lib/goal-events";
import { crossGoalConflicts } from "@/lib/goal-conflicts";
import { getActiveProgram } from "@/lib/program";
import {
  RARITY_RULES,
  normPackForGoal,
  weeklySlope,
  lookbackWeeksFor,
  computeTargetFeasibility,
  aggregateGoalTier,
  concurrentLoadBump,
  aggregateStackTier,
  effectiveTier as resolveEffectiveTier,
  parseCoachFeasibility,
  type GoalFeasibility,
  type StackRarity,
  type TargetFeasibility,
} from "@/lib/rarity-core";
import type { GoalTarget } from "@/lib/metrics-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Weeks remaining (calendar midnights, USER_TZ)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Number of whole weeks from now's midnight to targetDate's midnight.
 * Floors at minWeeksRemaining so past-due targets are rated against a 1-week runway.
 */
export function weeksRemainingFrac(
  targetDate: Date,
  now: Date = new Date(),
  rules: typeof RARITY_RULES = RARITY_RULES,
): number {
  const nowMid = startOfDay(now);
  const targetMid = startOfDay(targetDate);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeks = (targetMid.getTime() - nowMid.getTime()) / msPerWeek;
  return Math.max(rules.minWeeksRemaining, weeks);
}

// ─────────────────────────────────────────────────────────────────────────────
// Observed series per metric family
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the last observedLookbackWeeks weeks of data for a single target.
 * Returns { points, current } where current = last point's value OR resolveMetricValue fallback OR target.start.
 *
 * Query budget: up to 2 per target when the series window is empty (series fetch + resolveMetricValue fallback).
 * Series assembly mirrors metric families in goal-targets.ts resolveMetricValue.
 *
 * For cumulative/build-from-zero metrics (hike:*, workout:count, log:*) the
 * series is built as weekly snapshots of the cumulative total so the slope
 * is directly the weekly accumulation rate.
 */
export async function observedSeriesFor(
  metric: string,
  goalId: string,
  since: Date,
  now: Date = new Date(),
): Promise<{ points: { date: Date; value: number }[]; current: number | null }> {
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

  if (metric === "weightLb") {
    const rows = await prisma.measurement.findMany({
      where: { date: { gte: since, lte: now }, weightLb: { not: null } },
      orderBy: { date: "asc" },
      select: { date: true, weightLb: true },
    });
    const points = rows
      .filter((r) => r.weightLb !== null)
      .map((r) => ({ date: r.date, value: r.weightLb as number }));
    const current = points.length > 0 ? points.at(-1)!.value : null;
    return { points, current };
  }

  if (metric.startsWith("baseline:")) {
    const testName = metric.slice("baseline:".length);
    const rows = await prisma.baseline.findMany({
      where: { testName, date: { gte: since, lte: now } },
      orderBy: { date: "asc" },
      select: { date: true, value: true },
    });
    const points = rows.map((r) => ({ date: r.date, value: r.value }));
    const current = points.length > 0 ? points.at(-1)!.value : null;
    return { points, current };
  }

  // Cumulative metrics: build weekly snapshot series over the lookback window.
  // The rate we want is "how much accumulated per week", which is the slope of
  // the cumulative total over time.
  if (
    metric === "hike:prep_completion" ||
    metric === "hike:max_elevation_single" ||
    metric === "hike:total_elevation_ft" ||
    metric === "hike:total_distance_mi" ||
    metric === "workout:count"
  ) {
    const weeks = Math.ceil((now.getTime() - since.getTime()) / MS_PER_WEEK);
    const snapshots: { date: Date; value: number }[] = [];

    for (let w = 0; w <= weeks; w++) {
      const snapDate = w === weeks ? now : addDays(since, w * 7);
      const val = await resolveMetricValue(prisma, metric, snapDate, goalId);
      if (val !== null) {
        snapshots.push({ date: snapDate, value: val });
      }
    }

    const current = snapshots.length > 0 ? snapshots.at(-1)!.value : null;
    return { points: snapshots, current };
  }

  if (metric.startsWith("log:")) {
    const key = metric.slice("log:".length);
    const rows = await prisma.logEntry.findMany({
      where: { goalId, metric: key, date: { gte: since, lte: now }, value: { not: null } },
      orderBy: { date: "asc" },
      select: { date: true, value: true },
    });
    const points = rows
      .filter((r) => r.value !== null)
      .map((r) => ({ date: r.date, value: r.value as number }));
    const current = points.length > 0 ? points.at(-1)!.value : null;
    return { points, current };
  }

  // exercise:<canonical name> — pull from workout history (est 1RM, max reps, or max duration)
  if (metric.startsWith("exercise:")) {
    const exerciseName = metric.slice("exercise:".length);
    const { history } = await getExerciseHistory(exerciseName);
    const points = history
      .filter((p) => p.date >= since && p.date <= now)
      .map((p) => ({ date: p.date, value: p.best }));
    const current = points.length > 0 ? points.at(-1)!.value : null;
    return { points, current };
  }

  return { points: [], current: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse targets from the goal's Json field with a shape guard
// ─────────────────────────────────────────────────────────────────────────────

function parseTargets(raw: unknown): GoalTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t) =>
      t !== null &&
      typeof t === "object" &&
      typeof t.metric === "string" &&
      typeof t.label === "string" &&
      typeof t.units === "string" &&
      typeof t.direction === "string" &&
      typeof t.target === "number" &&
      typeof t.weight === "number",
  ) as GoalTarget[];
}

// parseCoachFeasibility is re-exported from rarity-core.ts (shared with tools.ts
// and goals/[id]/page.tsx). Local copy removed — use the import above.

// ─────────────────────────────────────────────────────────────────────────────
// Per-goal feasibility
// ─────────────────────────────────────────────────────────────────────────────

export type GoalLike = {
  id: string;
  targetDate: Date | null;
  targets: unknown;
  kind: string;
};

/**
 * Compute feasibility for a single goal.
 * Someday goals (targetDate=null) are unrated and make zero DB queries.
 */
export async function computeGoalFeasibility(
  goal: GoalLike,
  opts?: { now?: Date },
): Promise<GoalFeasibility> {
  const now = opts?.now ?? new Date();
  const computedAt = now.toISOString();

  // Someday: unrated, zero queries
  if (goal.targetDate === null) {
    return {
      goalId: goal.id,
      tier: null,
      unratedReason: "someday",
      ratio: null,
      perTarget: [],
      basis: null,
      weeksRemaining: null,
      computedAt,
    };
  }

  const targets = parseTargets(goal.targets);
  if (targets.length === 0) {
    return {
      goalId: goal.id,
      tier: null,
      unratedReason: "no-targets",
      ratio: null,
      perTarget: [],
      basis: null,
      weeksRemaining: null,
      computedAt,
    };
  }

  const weeksRemaining = weeksRemainingFrac(goal.targetDate, now);
  const normPack = normPackForGoal(goal.kind);

  // Per-target lookback: baseline:* and exercise:* use 16w; all others use 6w.
  // Fetch observed series for each target in parallel with its own lookback window.
  const seriesResults = await Promise.all(
    targets.map((t) => {
      const lookbackWeeks = lookbackWeeksFor(t.metric);
      const lookbackStart = addDays(now, -(lookbackWeeks * 7));
      return observedSeriesFor(t.metric, goal.id, lookbackStart, now);
    }),
  );

  // Resolve current value: last series point → resolveMetricValue fallback → target.start
  const perTarget: TargetFeasibility[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const { points, current: seriesCurrent } = seriesResults[i]!;

    let current: number | null = seriesCurrent;
    if (current === null) {
      // Fallback to resolveMetricValue
      current = await resolveMetricValue(prisma, t.metric, now, goal.id);
    }
    if (current === null && t.start !== undefined && t.start !== null) {
      current = t.start;
    }

    const rawSlope = weeklySlope(points, RARITY_RULES.minObservedPoints);

    // H1 — direction sign normalization: positive observedRate = moving toward goal.
    // For "decrease" metrics (e.g. body weight), an improving trend has a negative raw
    // slope; negate so computeTargetFeasibility receives a sign-consistent rate.
    const normalizedSlope =
      rawSlope !== null
        ? t.direction === "decrease"
          ? -rawSlope
          : rawSlope
        : null;

    const tf = computeTargetFeasibility({
      target: t,
      current,
      weeksRemaining,
      observedWeeklyRate: normalizedSlope,
      observedPoints: points.length,
      normPack,
    });
    perTarget.push(tf);
  }

  const { tier, ratio, basis } = aggregateGoalTier(perTarget);

  const unratedReason = tier === null && perTarget.every((t) => !t.countsTowardTier)
    ? "no-data"
    : null;

  return {
    goalId: goal.id,
    tier,
    unratedReason: tier === null ? (unratedReason ?? "no-data") : null,
    ratio,
    perTarget,
    basis,
    weeksRemaining,
    computedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack rarity
// ─────────────────────────────────────────────────────────────────────────────

export type ExtraGoal = {
  /**
   * Optional goal id. When provided and it matches a goal already fetched from
   * the DB, the fetched copy is excluded before this extraGoal is injected —
   * enabling preview of an *updated* version of an existing goal without
   * double-counting it in the stack.
   */
  id?: string;
  objective: string;
  targetDate: Date | null;
  targets: unknown;
  kind: string;
  coachFeasibility?: unknown;
};

/**
 * Compute the full stack rarity for all active dated goals.
 * Optionally inject a hypothetical goal (extraGoal) for preview / creation warning.
 *
 * Query budget (realistic stack):
 *   1 findMany for goals
 *   + Σ per-dated-goal queries (≤2/target)
 *   + 3 for getGoalEventsResult
 *   + 1 getActiveProgram (cached by the framework in SSR; fresh in MCP)
 *   ≈ 20 total for a typical stack
 */
export async function computeStackRarity(opts?: {
  now?: Date;
  extraGoal?: ExtraGoal;
}): Promise<StackRarity> {
  const now = opts?.now ?? new Date();
  const computedAt = now.toISOString();

  // Fetch all active goals with status=active (excludes achieved/abandoned).
  // coachFeasibility is added in REQ-63-2 migration; query it as an unknown
  // extra field so the code is forward-compatible once the column exists.
  const dbGoals = await prisma.goal.findMany({
    where: { active: true, status: "active" },
    select: {
      id: true,
      objective: true,
      targetDate: true,
      targets: true,
      kind: true,
      coachFeasibility: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Merge extraGoal if provided
  type GoalEntry = {
    id: string;
    objective: string;
    targetDate: Date | null;
    targets: unknown;
    kind: string;
    // coachFeasibility is REQ-63-2; defaults to null until the column exists
    coachFeasibility: unknown;
  };

  // Cast the DB rows — coachFeasibility is now read from the column (REQ-63-2 migration applied)
  const allGoals: GoalEntry[] = dbGoals.map((g) => ({ ...g }));
  if (opts?.extraGoal) {
    const eg = opts.extraGoal;
    // M8: when extraGoal carries an id matching a fetched goal, exclude the fetched
    // copy before injecting — lets preview show an *updated* version of an existing
    // goal without double-counting it in the stack.
    if (eg.id) {
      const existingIdx = allGoals.findIndex((g) => g.id === eg.id);
      if (existingIdx !== -1) {
        allGoals.splice(existingIdx, 1);
      }
    }
    allGoals.push({
      id: eg.id ?? `__preview__${Date.now()}`,
      objective: eg.objective,
      targetDate: eg.targetDate ?? null,
      targets: eg.targets,
      kind: eg.kind,
      coachFeasibility: eg.coachFeasibility ?? null,
    });
  }

  // M9: explicit targetDate !== null filter — someday goals (targetDate = null) are excluded
  // from the count, feasibility computation, and the concurrent-load bump.
  const datedGoals = allGoals.filter((g) => g.targetDate !== null);
  const datedActiveGoalCount = datedGoals.length;

  // Compute feasibility for all dated goals in parallel
  const computedFeasibilities = await Promise.all(
    allGoals.map((g) =>
      computeGoalFeasibility(
        { id: g.id, targetDate: g.targetDate, targets: g.targets, kind: g.kind },
        { now },
      ),
    ),
  );

  // Compute cross-goal conflict count for the next 28 days
  const windowEnd = addDays(now, RARITY_RULES.stack.conflictWindowDays);
  const program = await getActiveProgram();
  const eventsResult = await getGoalEventsResult({ start: now, end: windowEnd });
  const plannedHikeDks = eventsResult.events
    .filter((e) => e.type === "planned-hike")
    .map((e) => e.dateKey);
  const conflicts = crossGoalConflicts({
    events: eventsResult.events,
    focusGoalId: eventsResult.focusGoalId,
    focusProgram: program,
    plannedHikeDateKeys: plannedHikeDks,
    overrideDateKeys: [],
    range: { start: now, end: windowEnd },
  });
  const conflictCount28d = conflicts.length;

  // Build perGoal array
  const perGoal = allGoals.map((g, i) => {
    const computed = computedFeasibilities[i]!;
    const coach = parseCoachFeasibility(g.coachFeasibility);
    return {
      goalId: g.id,
      objective: g.objective,
      computed,
      coach,
      effectiveTier: resolveEffectiveTier(computed.tier, coach),
    };
  });

  // Stack aggregation: only dated active goals contribute (someday = null = excluded)
  const effectiveTiers = perGoal.map((pg) =>
    // Someday goals are unrated — null effective tier
    allGoals.find((g) => g.id === pg.goalId)?.targetDate !== null ? pg.effectiveTier : null,
  );

  const { bump, reasons } = concurrentLoadBump({ datedActiveGoalCount, conflictCount28d });
  const { tier, baseTier } = aggregateStackTier(effectiveTiers, bump);

  return {
    tier,
    baseTier,
    loadBump: bump,
    loadBumpReasons: reasons,
    datedActiveGoalCount,
    conflictCount28d,
    perGoal,
    computedAt,
  };
}
