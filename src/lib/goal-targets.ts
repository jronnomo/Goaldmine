// Readiness target registry. Each metric describes a measurable signal that
// can be tied to a Goal, plus how to fetch its current value from the DB.
//
// Default target values for known goals are research-grounded — derived from
// route demands, population norms, and what successful achievers tend to
// demonstrate. Each metric documents its rationale so it can be defended or
// re-tuned later (often after Claude reads attached references in claude.ai).
//
// Client-safe types and constants live in metrics-registry.ts (no Prisma,
// no Node.js built-ins). Server-only resolve helpers live below.

import type { PrismaClient } from "@/generated/prisma/client";
import { endOfDay } from "@/lib/calendar";
import { getExerciseHistory } from "@/lib/records";

// Re-export all pure data / types so existing imports of goal-targets.ts
// continue to work unchanged.
export type { Direction, GoalTarget, MetricSpec } from "@/lib/metrics-registry";
export {
  LOG_METRIC_PREFIX,
  METRICS,
  METRIC_BY_ID,
  MT_ELBERT_DEFAULT_TARGETS,
} from "@/lib/metrics-registry";

import { LOG_METRIC_PREFIX } from "@/lib/metrics-registry";

/** Resolve the latest value for a metric as of `asOf` (default: now). */
export async function resolveMetricValue(
  prisma: PrismaClient,
  metric: string,
  asOf: Date = new Date(),
  goalId: string,
): Promise<number | null> {
  // Bucket by user-tz day, not exact timestamp. A result logged earlier today
  // with an evening wall-clock time stores a `date` a few hours ahead of
  // `new Date()`, which a raw `date <= asOf` filter would wrongly exclude until
  // the clock catches up (this hid an off-schedule baseline PR until 9:30pm).
  // Cap at end-of-day so anything dated today counts today; future days stay out.
  const cutoff = endOfDay(asOf);

  if (metric === "weightLb") {
    const m = await prisma.measurement.findFirst({
      where: { date: { lte: cutoff }, weightLb: { not: null } },
      orderBy: { date: "desc" },
    });
    return m?.weightLb ?? null;
  }

  if (metric.startsWith("baseline:")) {
    const testName = metric.slice("baseline:".length);
    const b = await prisma.baseline.findFirst({
      where: { testName, date: { lte: cutoff } },
      orderBy: { date: "desc" },
    });
    return b?.value ?? null;
  }

  if (metric === "hike:prep_completion") {
    return prisma.hike.count({
      where: {
        date: { lte: cutoff },
        status: "completed",
        distanceMi: { gte: 5 },
        elevationFt: { gte: 2000 },
      },
    });
  }

  if (metric === "hike:max_elevation_single") {
    const r = await prisma.hike.aggregate({
      _max: { elevationFt: true },
      where: { date: { lte: cutoff }, status: "completed" },
    });
    return r._max.elevationFt ?? 0;
  }

  if (metric === "hike:total_elevation_ft") {
    const r = await prisma.hike.aggregate({
      _sum: { elevationFt: true },
      where: { date: { lte: cutoff }, status: "completed" },
    });
    return r._sum.elevationFt ?? 0;
  }

  if (metric === "hike:total_distance_mi") {
    const r = await prisma.hike.aggregate({
      _sum: { distanceMi: true },
      where: { date: { lte: cutoff }, status: "completed" },
    });
    return r._sum.distanceMi ?? 0;
  }

  if (metric === "workout:count") {
    return prisma.workout.count({
      where: { startedAt: { lte: cutoff }, status: "completed" },
    });
  }

  if (metric.startsWith(LOG_METRIC_PREFIX)) {
    const key = metric.slice(LOG_METRIC_PREFIX.length);
    const entry = await prisma.logEntry.findFirst({
      where: {
        goalId,
        metric: key,
        date: { lte: cutoff },
        value: { not: null },
      },
      orderBy: { date: "desc" },
    });
    return entry?.value ?? null;
  }

  // exercise:<canonical name> — latest best (est 1RM, max reps, or max duration)
  // from workout history as of asOf. The PrismaClient param is unused here because
  // getExerciseHistory uses the shared singleton, but it is accepted for interface
  // consistency with other branches.
  if (metric.startsWith("exercise:")) {
    void prisma; // singleton used internally by getExerciseHistory
    const exerciseName = metric.slice("exercise:".length);
    const { history } = await getExerciseHistory(exerciseName);
    const filtered = history.filter((p) => p.date <= cutoff);
    return filtered.length > 0 ? (filtered.at(-1)!.best) : null;
  }

  return null;
}

/** Earliest available value for a metric — used to auto-fill `start` if missing. */
export async function resolveMetricStart(
  prisma: PrismaClient,
  metric: string,
  goalId: string, // reserved for future goal-scoped start queries; fitness branches ignore it
): Promise<number | null> {
  void goalId;
  if (metric === "weightLb") {
    const m = await prisma.measurement.findFirst({
      where: { weightLb: { not: null } },
      orderBy: { date: "asc" },
    });
    return m?.weightLb ?? null;
  }

  if (metric.startsWith("baseline:")) {
    const testName = metric.slice("baseline:".length);
    const b = await prisma.baseline.findFirst({
      where: { testName },
      orderBy: { date: "asc" },
    });
    return b?.value ?? null;
  }

  // Cumulative / count / max metrics start at 0.
  if (metric.startsWith("hike:") || metric === "workout:count") return 0;

  // log:* metrics build from zero — same pattern as hike:*/workout:count.
  if (metric.startsWith(LOG_METRIC_PREFIX)) return 0;

  // exercise:<canonical name> — earliest recorded best from workout history.
  if (metric.startsWith("exercise:")) {
    const exerciseName = metric.slice("exercise:".length);
    const { history } = await getExerciseHistory(exerciseName);
    return history.length > 0 ? history[0]!.best : null;
  }

  return null;
}
