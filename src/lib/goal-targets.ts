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

import { endOfDay } from "@/lib/calendar";
import { getDb } from "@/lib/db";
import { getExerciseHistory } from "@/lib/records";

// Re-export all pure data / types so existing imports of goal-targets.ts
// continue to work unchanged.
export type { Direction, GoalTarget, MetricSpec } from "@/lib/metrics-registry";
export {
  LOG_METRIC_PREFIX,
  METRICS,
  METRIC_BY_ID,
  HIKE_DEFAULT_TARGETS,
} from "@/lib/metrics-registry";

import { LOG_METRIC_PREFIX } from "@/lib/metrics-registry";

/** Resolve the current value for a metric as of `asOf` (default: now).
 *  When `cumulative` is true (only meaningful for `log:*`), returns the SUM
 *  of all `LogEntry.value` rows up to the cutoff instead of the latest value.
 *  The snapshot path (cumulative=false) is byte-for-byte unchanged.
 */
export async function resolveMetricValue(
  metric: string,
  asOf: Date = new Date(),
  goalId: string,
  cumulative = false,
): Promise<number | null> {
  // Bucket by user-tz day, not exact timestamp. A result logged earlier today
  // with an evening wall-clock time stores a `date` a few hours ahead of
  // `new Date()`, which a raw `date <= asOf` filter would wrongly exclude until
  // the clock catches up (this hid an off-schedule baseline PR until 9:30pm).
  // Cap at end-of-day so anything dated today counts today; future days stay out.
  const cutoff = endOfDay(asOf);
  const db = await getDb();

  if (metric === "weightLb") {
    const m = await db.measurement.findFirst({
      where: { date: { lte: cutoff }, weightLb: { not: null } },
      orderBy: { date: "desc" },
    });
    return m?.weightLb ?? null;
  }

  if (metric.startsWith("baseline:")) {
    const testName = metric.slice("baseline:".length);
    const b = await db.baseline.findFirst({
      where: { testName, date: { lte: cutoff } },
      orderBy: { date: "desc" },
    });
    return b?.value ?? null;
  }

  // All hike:* metrics scope to the goal under evaluation. Plan-scaffolded and
  // legacy rows are now goalId-stamped (backfill 6/19), so the Elbert headline
  // numbers are unchanged — this just stops a second goal with hike targets
  // (e.g. a future Longs Peak) from cross-counting the same hikes.
  if (metric === "hike:prep_completion") {
    return db.hike.count({
      where: {
        goalId,
        date: { lte: cutoff },
        status: "completed",
        distanceMi: { gte: 5 },
        elevationFt: { gte: 2000 },
      },
    });
  }

  if (metric === "hike:max_elevation_single") {
    const r = await db.hike.aggregate({
      _max: { elevationFt: true },
      where: { goalId, date: { lte: cutoff }, status: "completed" },
    });
    return r._max.elevationFt ?? 0;
  }

  if (metric === "hike:total_elevation_ft") {
    const r = await db.hike.aggregate({
      _sum: { elevationFt: true },
      where: { goalId, date: { lte: cutoff }, status: "completed" },
    });
    return r._sum.elevationFt ?? 0;
  }

  if (metric === "hike:total_distance_mi") {
    const r = await db.hike.aggregate({
      _sum: { distanceMi: true },
      where: { goalId, date: { lte: cutoff }, status: "completed" },
    });
    return r._sum.distanceMi ?? 0;
  }

  if (metric === "workout:count") {
    return db.workout.count({
      where: { startedAt: { lte: cutoff }, status: "completed" },
    });
  }

  if (metric.startsWith(LOG_METRIC_PREFIX)) {
    const key = metric.slice(LOG_METRIC_PREFIX.length);
    if (cumulative) {
      // Cumulative: sum all entries up to the cutoff.
      // Returns raw _sum.value — null when zero rows (honest "no data"),
      // not ?? 0 (which would mis-tier an unstarted goal as legendary).
      const r = await db.logEntry.aggregate({
        _sum: { value: true },
        where: {
          goalId,
          metric: key,
          date: { lte: cutoff },
          value: { not: null },
        },
      });
      return r._sum.value;
    }
    const entry = await db.logEntry.findFirst({
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
  // from workout history as of asOf. getExerciseHistory uses the raw prisma singleton
  // internally (WorkoutExercise is non-scoped).
  if (metric.startsWith("exercise:")) {
    const exerciseName = metric.slice("exercise:".length);
    const { history } = await getExerciseHistory(exerciseName);
    const filtered = history.filter((p) => p.date <= cutoff);
    return filtered.length > 0 ? (filtered.at(-1)!.best) : null;
  }

  return null;
}

/** Earliest available value for a metric — used to auto-fill `start` if missing.
 *  When `cumulative` is true for a `log:*` metric, returns 0 (build-from-zero
 *  accumulation, matching the hike:/workout:count convention). Snapshot path unchanged.
 */
export async function resolveMetricStart(
  metric: string,
  goalId: string, // used by the log:* start lookup; fitness branches ignore it
  cumulative = false,
): Promise<number | null> {
  const db = await getDb();

  if (metric === "weightLb") {
    const m = await db.measurement.findFirst({
      where: { weightLb: { not: null } },
      orderBy: { date: "asc" },
    });
    return m?.weightLb ?? null;
  }

  if (metric.startsWith("baseline:")) {
    const testName = metric.slice("baseline:".length);
    const b = await db.baseline.findFirst({
      where: { testName },
      orderBy: { date: "asc" },
    });
    return b?.value ?? null;
  }

  // Cumulative / count / max metrics start at 0.
  if (metric.startsWith("hike:") || metric === "workout:count") return 0;

  // Cumulative log:* also starts at 0 (build-from-zero accumulation).
  if (cumulative && metric.startsWith(LOG_METRIC_PREFIX)) return 0;

  // log:* — start from the EARLIEST logged value (the baseline you're moving from).
  // Increase metrics ignore start (build-from-zero in progressFor); decrease metrics
  // (churn, CAC) measure motion from this starting value toward the lower target.
  if (metric.startsWith(LOG_METRIC_PREFIX)) {
    const key = metric.slice(LOG_METRIC_PREFIX.length);
    const entry = await db.logEntry.findFirst({
      where: { goalId, metric: key },
      orderBy: { date: "asc" },
    });
    return entry?.value ?? null;
  }

  // exercise:<canonical name> — earliest recorded best from workout history.
  if (metric.startsWith("exercise:")) {
    const exerciseName = metric.slice("exercise:".length);
    const { history } = await getExerciseHistory(exerciseName);
    return history.length > 0 ? history[0]!.best : null;
  }

  return null;
}
