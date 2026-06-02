import { addDays, startOfWeekMonday } from "@/lib/calendar";
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

export type ReadinessSnapshot = {
  /** 0..100 overall readiness. */
  score: number;
  /** Per-target breakdown. */
  breakdown: TargetProgress[];
  /** Targets with no data yet (excluded from overall score). */
  missing: GoalTarget[];
};

export type ReadinessSeriesPoint = {
  weekEnd: Date;
  score: number;
};

export function progressFor(target: GoalTarget, current: number | null, start: number | null): number | null {
  if (current === null) return null;

  // Build-from-zero metrics: progress = current / target, no start needed.
  if (
    target.metric.startsWith("hike:") ||
    target.metric === "workout:count" ||
    target.metric.startsWith(LOG_METRIC_PREFIX)
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

export async function computeReadiness(
  targets: GoalTarget[],
  asOf: Date = new Date(),
  goalId: string,
): Promise<ReadinessSnapshot> {
  const breakdown: TargetProgress[] = [];
  const missing: GoalTarget[] = [];

  for (const t of targets) {
    const current = await resolveMetricValue(prisma, t.metric, asOf, goalId);
    const start = t.start !== undefined && t.start !== null
      ? t.start
      : await resolveMetricStart(prisma, t.metric, goalId);
    const progress = progressFor(t, current, start);

    if (progress === null) {
      missing.push(t);
    }
    breakdown.push({ target: t, current, start, progress });
  }

  const usable = breakdown.filter((b) => b.progress !== null);
  if (usable.length === 0) return { score: 0, breakdown, missing };

  const totalWeight = usable.reduce((acc, b) => acc + (b.target.weight ?? 0), 0);
  if (totalWeight === 0) return { score: 0, breakdown, missing };

  const weighted = usable.reduce((acc, b) => acc + (b.target.weight ?? 0) * (b.progress ?? 0), 0);
  return { score: Math.round((weighted / totalWeight) * 100), breakdown, missing };
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
