import { addDays, endOfDay, startOfWeekMonday } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import {
  LOG_METRIC_PREFIX,
  type GoalTarget,
  resolveMetricStart,
  resolveMetricValue,
} from "@/lib/goal-targets";

export type TargetProgress = {
  target: GoalTarget;
  current: number | null;
  start: number | null;
  /** 0..1 progress toward target. Null if no data. */
  progress: number | null;
};

/**
 * Sub-condition readouts for a COMPOUND gate — a gate whose cleared status
 * depends on more than a single metric reaching progress ≥ 1. Currently only
 * the hike prep gate (hike:prep_completion) uses this. Each field is optional
 * so the shape can grow without breaking consumers.
 */
export type GateSubConditions = {
  /** Completed hikes meeting the difficulty profile (≥5 mi & ≥2000 ft gain). */
  qualifyingCount?: { have: number; need: number };
  /** Completed hikes carrying ≥15 lb pack. */
  packHikes?: { have: number; need: number };
  /** Whether ≥1 completed hike summited above 12,000 ft (reads summitFt). */
  above12k?: { have: boolean };
};

/** One gating target's cleared status — returned in ReadinessSnapshot.gates[]. */
export type ReadinessGate = {
  /** Human-readable label from GoalTarget.label. */
  label: string;
  /** 0..1 progress, or null if no data yet. */
  progress: number | null;
  /**
   * Cleared status. For simple gates: progress !== null && progress >= 1.
   * For compound gates (see subConditions): every sub-condition must hold —
   * a full progress bar alone does NOT clear them.
   */
  cleared: boolean;
  /** Present only for compound gates; explains what still blocks clearing. */
  subConditions?: GateSubConditions;
};

// ── Hike prep-gate composition thresholds ──────────────────────────────────
/** Pack weight (lb) that makes a completed hike count as "loaded". */
const PREP_PACK_WEIGHT_MIN_LB = 15;
/** Loaded hikes required to clear the prep gate. */
const PREP_PACK_HIKES_NEED = 2;
/** Summit altitude (ft) one hike must exceed (reads summitFt, NOT elevationFt). */
const PREP_ABOVE_ALTITUDE_FT = 12000;

/** Score ceiling applied while any gating target remains uncleared. */
export const GATE_CEILING = 80;

export type ReadinessSnapshot = {
  /**
   * 0..100 overall readiness score = Math.min(rawScore, ceiling).
   * This is the honest, capped headline number. Feed it to the ring / chart.
   */
  score: number;
  /**
   * Uncapped weighted average over ALL targets (untested = 0 progress, full
   * weight in denominator). Equals score when no gates are open.
   * Math.round(Σ(weightᵢ · (progressᵢ ?? 0)) / Σ(all weights) * 100).
   */
  rawScore: number;
  /**
   * 80 when any gating target is uncleared, 100 otherwise.
   * score = Math.min(rawScore, ceiling).
   */
  ceiling: number;
  /** How many targets have been logged vs the total. */
  coverage: { tested: number; total: number };
  /** All targets flagged gating:true, with their cleared status. */
  gates: ReadinessGate[];
  /** Count of gating targets not yet cleared (progress === null OR progress < 1). */
  openGateCount: number;
  /** Per-target breakdown including untested targets (progress: null). */
  breakdown: TargetProgress[];
  /**
   * Targets with no data yet. Counted as 0 progress in the score denominator —
   * they are NOT excluded from the score (unlike the old behavior).
   * JSDoc updated: was "excluded from overall score" — no longer accurate.
   *
   * Note: a gate metric with start === target.target returns progress 0 from
   * progressFor and can never clear — data-config caveat, not an engine bug.
   */
  missing: GoalTarget[];
};

export type ReadinessSeriesPoint = {
  weekEnd: Date;
  score: number;
};

export function progressFor(target: GoalTarget, current: number | null, start: number | null): number | null {
  if (current === null) return null;

  // Build-from-zero metrics (INCREASE/accumulation only): progress = current / target.
  // Decrease log:* metrics (e.g. churn, CAC) fall through to the comparative path
  // below, which measures motion from the starting value toward the (lower) target.
  if (
    target.direction === "increase" &&
    (target.metric.startsWith("hike:") ||
      target.metric === "workout:count" ||
      target.metric.startsWith(LOG_METRIC_PREFIX))
  ) {
    if (target.target === 0) return null;
    return clamp01(current / target.target);
  }

  // Already met? Doesn't matter where we started — if the absolute value is
  // past the target, full progress. Handles the degenerate case where the
  // target is set below the user's day-1 baseline.
  if (target.direction === "increase" && current >= target.target) return 1;
  if (target.direction === "decrease" && current <= target.target) return 1;

  // Comparative metrics: need a start to measure partial motion.
  if (start === null) return null;
  if (start === target.target) return 0;
  if (target.direction === "decrease") {
    return clamp01((start - current) / (start - target.target));
  }
  return clamp01((current - start) / (target.target - start));
}

/**
 * Resolve the extra sub-conditions for the hike prep gate: how many completed
 * hikes carried a loaded pack, and whether any summited above 12k ft. Scoped to
 * the goal under evaluation and as-of cutoff, mirroring resolveMetricValue.
 */
async function resolveHikePrepGateExtras(
  goalId: string,
  cutoff: Date,
): Promise<{ packHikeCount: number; above12k: boolean }> {
  const [packHikeCount, above12kRow] = await Promise.all([
    prisma.hike.count({
      where: {
        goalId,
        status: "completed",
        date: { lte: cutoff },
        packWeightLb: { gte: PREP_PACK_WEIGHT_MIN_LB },
      },
    }),
    prisma.hike.findFirst({
      where: {
        goalId,
        status: "completed",
        date: { lte: cutoff },
        summitFt: { gte: PREP_ABOVE_ALTITUDE_FT },
      },
      select: { id: true },
    }),
  ]);
  return { packHikeCount, above12k: above12kRow !== null };
}

export async function computeReadiness(
  targets: GoalTarget[],
  asOf: Date = new Date(),
  goalId: string,
): Promise<ReadinessSnapshot> {
  const breakdown: TargetProgress[] = [];
  const missing: GoalTarget[] = [];

  for (const t of targets) {
    const current = await resolveMetricValue(prisma, t.metric, asOf, goalId, t.cumulative ?? false);
    const start = t.start !== undefined && t.start !== null
      ? t.start
      : await resolveMetricStart(prisma, t.metric, goalId, t.cumulative ?? false);
    const progress = progressFor(t, current, start);

    if (progress === null) {
      missing.push(t);
    }
    breakdown.push({ target: t, current, start, progress });
  }

  // ── Coverage ────────────────────────────────────────────────────────────
  const tested = breakdown.filter((b) => b.progress !== null).length;
  const coverage = { tested, total: targets.length };

  // ── Gating ──────────────────────────────────────────────────────────────
  const gates: ReadinessGate[] = [];
  for (const b of breakdown) {
    if (b.target.gating !== true) continue;
    // Simple gate: cleared iff progress has data and is ≥ 1.
    let cleared = b.progress !== null && b.progress >= 1;
    let subConditions: GateSubConditions | undefined;

    // Compound prep gate: clearing additionally requires ≥2 pack-loaded hikes
    // AND ≥1 hike summiting above 12k ft (summitFt, NOT elevationFt which is
    // gain). A full progress bar (qualifyingCount ≥ need) alone does NOT clear
    // it until pack + altitude sub-conditions also hold.
    if (b.target.metric === "hike:prep_completion") {
      const qualifyingCount = b.current ?? 0;
      const need = b.target.target;
      const { packHikeCount, above12k } = await resolveHikePrepGateExtras(
        goalId,
        endOfDay(asOf),
      );
      subConditions = {
        qualifyingCount: { have: qualifyingCount, need },
        packHikes: { have: packHikeCount, need: PREP_PACK_HIKES_NEED },
        above12k: { have: above12k },
      };
      cleared =
        qualifyingCount >= need &&
        packHikeCount >= PREP_PACK_HIKES_NEED &&
        above12k;
    }

    gates.push({ label: b.target.label, progress: b.progress, cleared, subConditions });
  }
  const openGateCount = gates.filter((g) => !g.cleared).length;
  const ceiling = openGateCount > 0 ? GATE_CEILING : 100;

  // ── Scoring (untested = 0, full weight in denominator) ──────────────────
  const totalWeight = breakdown.reduce((acc, b) => acc + (b.target.weight ?? 0), 0);
  if (totalWeight === 0) {
    return { score: 0, rawScore: 0, ceiling, coverage, gates, openGateCount, breakdown, missing };
  }
  const weighted = breakdown.reduce(
    (acc, b) => acc + (b.target.weight ?? 0) * (b.progress ?? 0),
    0,
  );
  const rawScore = Math.round((weighted / totalWeight) * 100);
  const score = Math.min(rawScore, ceiling);

  return { score, rawScore, ceiling, coverage, gates, openGateCount, breakdown, missing };
}

export async function computeReadinessSeries(
  goalCreatedAt: Date,
  targets: GoalTarget[],
  now: Date = new Date(),
  goalId: string,
): Promise<ReadinessSeriesPoint[]> {
  const points: ReadinessSeriesPoint[] = [];
  const start = startOfWeek(goalCreatedAt);
  let cursor = addDays(start, 6); // first week-end (Sunday)
  while (cursor <= now) {
    const snap = await computeReadiness(targets, cursor, goalId);
    points.push({ weekEnd: new Date(cursor), score: snap.score });
    cursor = addDays(cursor, 7);
  }
  // Always include "today" as the latest point.
  if (points.length === 0 || points.at(-1)!.weekEnd.getTime() < now.getTime() - 24 * 3600 * 1000) {
    const snap = await computeReadiness(targets, now, goalId);
    points.push({ weekEnd: new Date(now), score: snap.score });
  }
  return points;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function startOfWeek(d: Date): Date {
  return startOfWeekMonday(d);
}
