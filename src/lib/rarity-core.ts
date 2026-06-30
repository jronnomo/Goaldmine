// src/lib/rarity-core.ts
//
// Pure, client-safe rarity/feasibility engine.
// NO Prisma imports. NO @/lib/calendar imports.
// UI chips import types from here; async wrapper is rarity.ts.
// Tunables mirror game/rules.ts and goal-conflicts.ts CROSS_GOAL_RULES idiom.

import type { GoalTarget } from "@/lib/metrics-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Tier definitions
// ─────────────────────────────────────────────────────────────────────────────

export const RARITY_TIERS = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;

export type RarityTier = (typeof RARITY_TIERS)[number];

export function tierIndex(t: RarityTier): number {
  return RARITY_TIERS.indexOf(t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// All defaults documented with a one-line rationale.
// ─────────────────────────────────────────────────────────────────────────────

export const RARITY_RULES = {
  tierThresholds: {
    // requiredRate / plausibleRate ≤ 0.5 → common: target is half the natural rate or easier
    common: 0.5,
    // ≤ 1.0 → uncommon: target matches the natural rate — doable but requires consistency
    uncommon: 1.0,
    // ≤ 1.5 → rare: 1.5× the natural rate — demands focused effort and ideal conditions
    rare: 1.5,
    // ≤ 2.5 → epic: 2–2.5× the natural rate — near the edge of what elite effort can sustain
    epic: 2.5,
    // > 2.5 → legendary: beyond consistent human adaptation rates in the time available
  },
  // Ratio cap prevents division-near-zero blowups from displaying nonsensical numbers
  ratioCap: 99,
  // Targets with weight < 0.1 are too small to dominate the tier; below-floor → fallback to highest-weight
  weightFloor: 0.1,
  // Someday goals have no deadline; dated goals with expired dates use 1 week as the runway floor
  minWeeksRemaining: 1,
  // Per-family lookback windows: baselines and exercise history recur on multi-week cycles,
  // so 6 weeks may not reach minObservedPoints — use 16w for those families.
  observedLookbackWeeks: {
    // Default: aligns with the program's mesocycle length — long enough to smooth noise, short enough to be recent
    default: 6,
    // baseline:* tests repeat on 4-8 week cycles; 16w guarantees ≥3 data points for a serious trainee
    baseline: 16,
    // exercise:* PRs also plateau for weeks; 16w captures a full strength phase
    exercise: 16,
  },
  // ≥3 weekly data points needed for a reliable slope; fewer → fall back to norm
  minObservedPoints: 3,
  // Plateau/regression: plausible floored at 25% of norm — gives some credit for prior progress without being generous
  regressionFloorFactor: 0.25,
  stack: {
    // Stack bump fires at ≥3 concurrent dated active goals — 3 is where schedule math starts to degrade
    goalCountBumpAt: 3,
    // Look 28 days ahead for conflicts — covers the immediate planning horizon
    conflictWindowDays: 28,
    // ≥4 cross-goal conflicts in the window signals structural overcommitment
    conflictBumpAt: 4,
    // Bump is binary (0 or 1) — graded multiplier is a future seam
    maxBump: 1,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Norm packs
// ─────────────────────────────────────────────────────────────────────────────

export type NormPack = {
  goalKind: string;
  norms: {
    // Strength improvements: ~1.5%/wk of current value for intermediate lifters (NSCA guidelines)
    strengthPctPerWeek: number;
    // Absolute strength floors per unit: even slow learners gain this much/week minimum
    strengthAbsFloorPerWeek: { reps: number; lb: number; sec: number; in: number; default: number };
    // Endurance time: ~1%/wk improvement aligns with periodized running research (Jack Daniels)
    enduranceTimePctPerWeek: number;
    // Fat loss: 1–1.5 lb/wk is the evidence-based sustainable rate (ACSM recommendation)
    weightLossLbPerWeek: number;
    // Lean gain: ~0.5 lb/wk for natural athletes in a training surplus (Lyle McDonald)
    weightGainLbPerWeek: number;
    // Colorado 14er prep: one significant hike every 5–6 days is a realistic build rate
    hikesPerWeek: number;
    // Weekly elevation: ~5000 ft/wk matches a progressive Rocky Mountain training block
    elevationFtPerWeek: number;
    // Single-hike elevation PR: route selection can add ~500 ft/wk of max — beyond that is aggressive
    maxElevationGainFtPerWeek: number;
    // Weekly distance: 20 mi/wk is a solid hiking base (REI Training Guide)
    distanceMiPerWeek: number;
    // 6 sessions/wk is the max sustainable gym frequency for a single user
    workoutsPerWeek: number;
    // log:* metrics have no population norm — observed-only by design
  };
};

export const FITNESS_NORM_PACK: NormPack = {
  goalKind: "fitness",
  norms: {
    strengthPctPerWeek: 0.015,
    strengthAbsFloorPerWeek: { reps: 0.5, lb: 2, sec: 10, in: 0.25, default: 0.5 },
    enduranceTimePctPerWeek: 0.01,
    weightLossLbPerWeek: 1.5,
    weightGainLbPerWeek: 0.5,
    hikesPerWeek: 1.25,
    elevationFtPerWeek: 5000,
    maxElevationGainFtPerWeek: 500,
    distanceMiPerWeek: 20,
    workoutsPerWeek: 6,
    /* log:* intentionally NO norm — observed-only */
  },
};

// Seam: non-fitness norm packs can be registered here in future phases.
// Only FITNESS_NORM_PACK is built; all other kinds fall back to fitness.
export const RARITY_NORM_PACKS: Record<string, NormPack> = {
  fitness: FITNESS_NORM_PACK,
};

export function normPackForGoal(goalKind: string): NormPack {
  return RARITY_NORM_PACKS[goalKind] ?? FITNESS_NORM_PACK;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric family classification
// ─────────────────────────────────────────────────────────────────────────────

export type MetricFamily =
  | "weight"
  | "endurance-time"
  | "strength-like"
  | "hike-count"
  | "hike-elevation"
  | "hike-max-elevation"
  | "hike-distance"
  | "workout-count"
  | "log"
  | "unknown";

/**
 * Classify a metric into a family so the right norm can be applied.
 * Uses metric id, units, and direction — matches METRICS registry semantics.
 */
export function metricFamilyFor(
  metric: string,
  units: string,
  direction: "increase" | "decrease",
): MetricFamily {
  if (metric === "weightLb") return "weight";

  if (metric.startsWith("baseline:")) {
    // baseline:1.5 Mile Run is time-based (decrease direction) → endurance-time
    if (direction === "decrease" && (units === "sec" || units === "min")) {
      return "endurance-time";
    }
    // Everything else is strength-like (reps, lb, in, sec increasing)
    return "strength-like";
  }

  // exercise:<canonical name> tracks workout history best (est 1RM, max reps, or max duration)
  if (metric.startsWith("exercise:")) return "strength-like";

  if (metric === "hike:prep_completion") return "hike-count";
  // hike:max_elevation_single is a PR-style metric (best single effort), not cumulative
  if (metric === "hike:max_elevation_single") return "hike-max-elevation";
  if (metric === "hike:total_elevation_ft") return "hike-elevation";
  if (metric === "hike:total_distance_mi") return "hike-distance";
  if (metric === "workout:count") return "workout-count";
  if (metric.startsWith("log:")) return "log";

  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TargetVerdict = "met" | RarityTier | "unknown";

export type TargetFeasibility = {
  metric: string;
  label: string;
  weight: number;
  requiredRate: number | null;
  observedRate: number | null;
  plausibleRate: number | null;
  rateBasis: "observed" | "norm" | "none";
  ratio: number | null;
  verdict: TargetVerdict;
  countsTowardTier: boolean;
  /** Whether this target is a readiness gate (mirrors GoalTarget.gating).
   *  Propagated so aggregateGoalTier can floor the goal tier to no easier than
   *  'rare' when a gating target is unrated (verdict==='unknown'). */
  gating: boolean;
  /** The most recent measured value for this metric, or null when unknown.
   *  Null when no data has been logged and no target.start is set (the "unknown"
   *  path). Populated as the effective current value (last series point →
   *  resolveMetricValue fallback → target.start) by the async caller in rarity.ts. */
  currentValue: number | null;
};

export type GoalFeasibility = {
  goalId: string;
  tier: RarityTier | null;
  unratedReason: "someday" | "no-targets" | "no-data" | null;
  ratio: number | null;
  perTarget: TargetFeasibility[];
  basis: "observed" | "norms" | "mixed" | null;
  weeksRemaining: number | null;
  computedAt: string; // ISO timestamp
};

export type CoachFeasibility = {
  tier: RarityTier;
  rationale: string;
  assessedAt: string; // ISO timestamp
  assessedBy: "coach";
};

export type StackRarity = {
  tier: RarityTier | null;
  baseTier: RarityTier | null;
  loadBump: 0 | 1;
  loadBumpReasons: string[];
  datedActiveGoalCount: number;
  conflictCount28d: number;
  perGoal: Array<{
    goalId: string;
    objective: string;
    computed: GoalFeasibility;
    coach: CoachFeasibility | null;
    effectiveTier: RarityTier | null;
  }>;
  computedAt: string; // ISO timestamp
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure math helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Least-squares linear regression slope over (date, value) points.
 * Returns the slope in units/WEEK, or null when fewer than minPoints points.
 * Uses ms-based x-axis; no calendar imports.
 */
export function weeklySlope(
  points: { date: Date; value: number }[],
  minPoints: number,
): number | null {
  if (points.length < minPoints) return null;

  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  // Normalise x to weeks from the first point to avoid floating-point drift
  const t0 = points[0]!.date.getTime();
  const xs = points.map((p) => (p.date.getTime() - t0) / MS_PER_WEEK);
  const ys = points.map((p) => p.value);
  const n = xs.length;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
    sumXY += xs[i]! * ys[i]!;
    sumXX += xs[i]! * xs[i]!;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0; // all x values equal (single distinct time point)
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Map a ratio (requiredRate / plausibleRate) to a RarityTier.
 * Inclusive upper bounds: ≤0.5 common, ≤1.0 uncommon, ≤1.5 rare, ≤2.5 epic, >2.5 legendary.
 */
export function tierFromRatio(
  ratio: number,
  rules: typeof RARITY_RULES = RARITY_RULES,
): RarityTier {
  const { common, uncommon, rare, epic } = rules.tierThresholds;
  if (ratio <= common) return "common";
  if (ratio <= uncommon) return "uncommon";
  if (ratio <= rare) return "rare";
  if (ratio <= epic) return "epic";
  return "legendary";
}

// ─────────────────────────────────────────────────────────────────────────────
// Norm resolution per metric family
// ─────────────────────────────────────────────────────────────────────────────

function normForFamily(
  family: MetricFamily,
  units: string,
  direction: "increase" | "decrease",
  current: number | null,
  normPack: NormPack,
): number | null {
  const n = normPack.norms;

  switch (family) {
    case "strength-like": {
      // Strength norm = max(pct-of-current, absolute-floor) — whichever is larger
      const pct = current !== null && current > 0 ? n.strengthPctPerWeek * current : 0;
      const absFloor = absFloorForUnits(units, n.strengthAbsFloorPerWeek);
      return Math.max(pct, absFloor);
    }
    case "endurance-time": {
      // Endurance time: improvement = pct of current (lower is better — we compute gap as current-target anyway)
      return current !== null && current > 0 ? n.enduranceTimePctPerWeek * current : null;
    }
    case "weight": {
      return direction === "decrease" ? n.weightLossLbPerWeek : n.weightGainLbPerWeek;
    }
    case "hike-count":
      return n.hikesPerWeek;
    case "hike-elevation":
      return n.elevationFtPerWeek;
    case "hike-max-elevation":
      return n.maxElevationGainFtPerWeek;
    case "hike-distance":
      return n.distanceMiPerWeek;
    case "workout-count":
      return n.workoutsPerWeek;
    case "log":
      // log:* — no norm; observed-only
      return null;
    default:
      return null;
  }
}

function absFloorForUnits(
  units: string,
  floors: NormPack["norms"]["strengthAbsFloorPerWeek"],
): number {
  const u = units.toLowerCase();
  if (u === "reps") return floors.reps;
  if (u === "lb") return floors.lb;
  if (u === "sec") return floors.sec;
  if (u === "in") return floors.in;
  return floors.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-family lookback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the observation lookback window (in weeks) for a given metric.
 * baseline:* and exercise:* tests recur on multi-week cycles; use 16w to
 * guarantee ≥3 data points. All other families default to 6w (mesocycle).
 */
export function lookbackWeeksFor(metric: string): number {
  const lw = RARITY_RULES.observedLookbackWeeks;
  if (metric.startsWith("baseline:")) return lw.baseline;
  if (metric.startsWith("exercise:")) return lw.exercise;
  return lw.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-target feasibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute per-target feasibility.
 *
 * Convention: `observedWeeklyRate` MUST be pre-normalized by the caller so that
 * a POSITIVE value means "moving toward the goal" regardless of direction.
 * For a "decrease" metric (e.g. body weight), the raw least-squares slope is
 * negative when the metric is improving; the caller must negate it:
 *   observedRate = direction === "decrease" ? -rawSlope : rawSlope
 * rarity.ts performs this normalization at the point where direction and slope
 * meet (in computeGoalFeasibility). This function asserts the convention via
 * the check `observedWeeklyRate > 0` — which would silently invert a
 * non-normalized decrease metric into "regression" and produce a much higher
 * ratio.
 */
export function computeTargetFeasibility(input: {
  target: GoalTarget;
  current: number | null;
  weeksRemaining: number;
  /** Pre-normalized: positive = improving toward goal. See JSDoc above. */
  observedWeeklyRate: number | null;
  observedPoints: number;
  normPack: NormPack;
  rules?: typeof RARITY_RULES;
}): TargetFeasibility {
  const { target, current, weeksRemaining, observedWeeklyRate, observedPoints, normPack } = input;
  const rules = input.rules ?? RARITY_RULES;

  const family = metricFamilyFor(target.metric, target.units, target.direction);

  // Note: gating is propagated onto TargetFeasibility; aggregateGoalTier floors
  // the goal tier to no easier than 'rare' when a gating target is unrated
  // (verdict==='unknown' — no confident rate / unrated). The readiness SCORE's
  // 80-cap is a separate mechanism in readiness.ts.

  // post-merge fix: never-measured targets (null current, no explicit start) are 'unknown'
  // — mirrors readiness `missing` semantics.
  // Build-from-zero metrics (hike:*, workout:count) always have current=0 from
  // resolveMetricValue, so they are never null here. log:* with cumulative=false
  // (snapshot) is NOT build-from-zero: resolveMetricValue returns the latest LogEntry
  // value or null (`entry?.value ?? null`), so a log: metric with zero entries IS null
  // and DOES fire this 'unknown' guard — the honest no-data state for a fresh project
  // metric like log:mrr. log:* with cumulative=true also returns null for zero entries
  // (raw `_sum.value` when no rows exist), so the same 'unknown' guard applies.
  // The guard likewise fires for baseline:*, exercise:*, and weightLb when no data
  // has been logged yet.
  if (current === null && (target.start === undefined || target.start === null)) {
    return {
      metric: target.metric,
      label: target.label,
      weight: target.weight,
      requiredRate: null,
      observedRate: observedWeeklyRate,
      plausibleRate: null,
      rateBasis: "none",
      ratio: null,
      verdict: "unknown",
      countsTowardTier: false,
      gating: target.gating ?? false,
      currentValue: null,
    };
  }

  // Gap: how far from current to target (always positive when not met)
  const effectiveCurrent = current ?? target.start ?? 0;
  const gap =
    target.direction === "increase"
      ? target.target - effectiveCurrent
      : effectiveCurrent - target.target;

  // Met check
  if (gap <= 0) {
    return {
      metric: target.metric,
      label: target.label,
      weight: target.weight,
      requiredRate: 0,
      observedRate: observedWeeklyRate,
      plausibleRate: null,
      rateBasis: "none",
      ratio: 0,
      verdict: "met",
      countsTowardTier: true,
      gating: target.gating ?? false,
      currentValue: effectiveCurrent,
    };
  }

  const requiredRate = gap / weeksRemaining;

  // Norm for this family
  const norm = normForFamily(family, target.units, target.direction, effectiveCurrent, normPack);

  // Plausible rate computation
  let plausibleRate: number | null = null;
  let rateBasis: "observed" | "norm" | "none" = "none";

  if (observedPoints >= rules.minObservedPoints && observedWeeklyRate !== null) {
    if (observedWeeklyRate > 0) {
      // Healthy observed rate — floor at regressionFloorFactor × norm to prevent tiny-norm domination
      if (norm !== null) {
        plausibleRate = Math.max(observedWeeklyRate, rules.regressionFloorFactor * norm);
      } else {
        plausibleRate = observedWeeklyRate;
      }
    } else {
      // Plateau or regression
      if (norm !== null) {
        plausibleRate = rules.regressionFloorFactor * norm;
      } else {
        // No norm + observed ≤ 0 → cap out the ratio (effectively impossible)
        return {
          metric: target.metric,
          label: target.label,
          weight: target.weight,
          requiredRate,
          observedRate: observedWeeklyRate,
          plausibleRate: null,
          rateBasis: "none",
          ratio: rules.ratioCap,
          verdict: tierFromRatio(rules.ratioCap, rules),
          countsTowardTier: true,
          gating: target.gating ?? false,
          currentValue: effectiveCurrent,
        };
      }
    }
    rateBasis = "observed";
  } else if (norm !== null) {
    plausibleRate = norm;
    rateBasis = "norm";
  } else {
    // No norm, not enough observed data → unknown
    return {
      metric: target.metric,
      label: target.label,
      weight: target.weight,
      requiredRate,
      observedRate: observedWeeklyRate,
      plausibleRate: null,
      rateBasis: "none",
      ratio: null,
      verdict: "unknown",
      countsTowardTier: false,
      gating: target.gating ?? false,
      currentValue: effectiveCurrent,
    };
  }

  // Ratio = min(requiredRate / plausibleRate, ratioCap)
  const rawRatio = plausibleRate > 0 ? requiredRate / plausibleRate : rules.ratioCap;
  const ratio = Math.min(rawRatio, rules.ratioCap);
  const verdict: TargetVerdict = tierFromRatio(ratio, rules);

  return {
    metric: target.metric,
    label: target.label,
    weight: target.weight,
    requiredRate,
    observedRate: observedWeeklyRate,
    plausibleRate,
    rateBasis,
    ratio,
    verdict,
    countsTowardTier: true,
    gating: target.gating ?? false,
    currentValue: effectiveCurrent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate goal tier from per-target results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Worst-target-dominates over targets with weight ≥ weightFloor and computable ratio.
 * All-below-floor → fall back to single highest-weight target.
 * All-unknown → tier null ("unrated").
 */
export function aggregateGoalTier(
  perTarget: TargetFeasibility[],
  rules: typeof RARITY_RULES = RARITY_RULES,
): { tier: RarityTier | null; ratio: number | null; basis: "observed" | "norms" | "mixed" | null } {
  // Met targets count toward tier with ratio 0
  const eligible = perTarget.filter((t) => t.countsTowardTier && t.ratio !== null);

  if (eligible.length === 0) {
    return { tier: null, ratio: null, basis: null };
  }

  // Targets above weightFloor
  const aboveFloor = eligible.filter((t) => t.weight >= rules.weightFloor);
  const pool = aboveFloor.length > 0
    ? aboveFloor
    : [eligible.reduce((a, b) => (a.weight >= b.weight ? a : b))]; // highest-weight fallback

  // Worst ratio dominates
  let worstRatio = -Infinity;
  let worstTier: RarityTier = "common";
  let hasObserved = false;
  let hasNorm = false;

  for (const t of pool) {
    if (t.ratio === null) continue;
    if (t.ratio > worstRatio) {
      worstRatio = t.ratio;
      worstTier = tierFromRatio(t.ratio, rules);
    }
    if (t.rateBasis === "observed") hasObserved = true;
    if (t.rateBasis === "norm") hasNorm = true;
  }

  if (worstRatio === -Infinity) return { tier: null, ratio: null, basis: null };

  // Gate floor: if any gating target is unrated (no confident rate), floor the
  // tier to no easier than 'rare'. Uses full perTarget (not just eligible) so an
  // unrated gate with countsTowardTier=false is still captured.
  const hasUnratedGate = perTarget.some((t) => t.gating && t.verdict === "unknown");
  if (hasUnratedGate) worstTier = RARITY_TIERS[Math.max(tierIndex(worstTier), tierIndex("rare"))]!;

  let basis: "observed" | "norms" | "mixed" | null = null;
  if (hasObserved && hasNorm) basis = "mixed";
  else if (hasObserved) basis = "observed";
  else if (hasNorm) basis = "norms";

  // Note: after a gate floor, tier may be elevated above what ratio implies.
  // ratio always reflects the pre-floor worst pool target (unchanged by floor).
  return { tier: worstTier, ratio: worstRatio, basis };
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent load bump (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Binary 0|1 bump. Fires when goal count ≥ goalCountBumpAt OR conflicts ≥ conflictBumpAt.
 * Future seam: graded multiplier.
 */
export function concurrentLoadBump(input: {
  datedActiveGoalCount: number;
  conflictCount28d: number;
  rules?: typeof RARITY_RULES;
}): { bump: 0 | 1; reasons: string[] } {
  const rules = input.rules ?? RARITY_RULES;
  const { datedActiveGoalCount, conflictCount28d } = input;
  const reasons: string[] = [];

  if (datedActiveGoalCount >= rules.stack.goalCountBumpAt) {
    reasons.push(
      `${datedActiveGoalCount} concurrent dated active goals (≥${rules.stack.goalCountBumpAt})`,
    );
  }
  if (conflictCount28d >= rules.stack.conflictBumpAt) {
    reasons.push(
      `${conflictCount28d} cross-goal conflicts in next ${rules.stack.conflictWindowDays} days (≥${rules.stack.conflictBumpAt})`,
    );
  }

  return { bump: reasons.length > 0 ? 1 : 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack tier aggregation (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * stackTierIndex = max(perGoal effectiveTier index) + bump, capped at Legendary.
 * Someday / unrated goals (null effective tier) are excluded from max().
 */
export function aggregateStackTier(
  perGoalEffectiveTiers: (RarityTier | null)[],
  bump: 0 | 1,
): { tier: RarityTier | null; baseTier: RarityTier | null } {
  const rated = perGoalEffectiveTiers.filter((t): t is RarityTier => t !== null);
  if (rated.length === 0) return { tier: null, baseTier: null };

  const maxIdx = Math.max(...rated.map(tierIndex));
  const baseTier = RARITY_TIERS[maxIdx] ?? "legendary";
  const bumpedIdx = Math.min(maxIdx + bump, RARITY_TIERS.length - 1);
  const tier = RARITY_TIERS[bumpedIdx] ?? "legendary";

  return { tier, baseTier };
}

// ─────────────────────────────────────────────────────────────────────────────
// Effective tier (coach ?? computed)
// ─────────────────────────────────────────────────────────────────────────────

export function effectiveTier(
  computed: RarityTier | null,
  coach: CoachFeasibility | null,
): RarityTier | null {
  return coach?.tier ?? computed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared coach-feasibility parser (replaces local copies in rarity.ts,
// tools.ts, and goals/[id]/page.tsx).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw JSON value from the DB into a typed CoachFeasibility, or null.
 * Validates that the stored tier is a known RARITY_TIERS member so stale or
 * corrupted values don't propagate as valid overrides.
 *
 * TODO(REQ-63-3): the MCP description for set_goal_feasibility should note the
 * "someday-override caveat": the coach CAN set a tier on a someday goal
 * (targetDate=null). effectiveTier() will return the coach tier even though
 * computed is null/unrated. The MCP tool description should explain this so
 * the coach knows the override persists if the user later adds a targetDate.
 */
export function parseCoachFeasibility(raw: unknown): CoachFeasibility | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.tier !== "string" ||
    !RARITY_TIERS.includes(r.tier as RarityTier) ||
    typeof r.rationale !== "string" ||
    typeof r.assessedAt !== "string" ||
    r.assessedBy !== "coach"
  ) {
    return null;
  }
  return {
    tier: r.tier as RarityTier,
    rationale: r.rationale,
    assessedAt: r.assessedAt,
    assessedBy: "coach",
  };
}
