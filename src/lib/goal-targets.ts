// Readiness target registry. Each metric describes a measurable signal that
// can be tied to a Goal, plus how to fetch its current value from the DB.
//
// Default target values for known goals are research-grounded — derived from
// route demands, population norms, and what successful achievers tend to
// demonstrate. Each metric documents its rationale so it can be defended or
// re-tuned later (often after Claude reads attached references in claude.ai).

import type { PrismaClient } from "@/generated/prisma/client";

export type Direction = "increase" | "decrease";

export type GoalTarget = {
  metric: string;
  label: string;
  units: string;
  direction: Direction;
  target: number;
  /** Optional starting value. Auto-captured at goal creation if absent. */
  start?: number;
  /** Importance weight (0-1). Goal-wide weights should sum to ~1. */
  weight: number;
  /** Optional rationale string for the user / Claude to read. */
  rationale?: string;
};

export type MetricSpec = {
  id: string;
  label: string;
  units: string;
  direction: Direction;
  description: string;
};

/** Namespace prefix for metrics backed by LogEntry rows. */
export const LOG_METRIC_PREFIX = "log:" as const;

/** Curated registry — keeps the UI to known metrics and avoids typos. */
export const METRICS: MetricSpec[] = [
  {
    id: "weightLb",
    label: "Body weight",
    units: "lb",
    direction: "decrease",
    description: "Latest logged body weight from /measurements.",
  },
  {
    id: "baseline:1.5 Mile Run",
    label: "1.5-mile run time",
    units: "sec",
    direction: "decrease",
    description: "Latest baseline test result for the 1.5-mile run.",
  },
  {
    id: "baseline:20 Min Step-Up Reps",
    label: "20-min step-up reps",
    units: "reps",
    direction: "increase",
    description: "Top gym predictor for sustained climbing endurance.",
  },
  {
    id: "baseline:Deep Squat Hold",
    label: "Deep squat hold",
    units: "sec",
    direction: "increase",
    description: "Hip + ankle mobility benchmark — matters most on steep descents.",
  },
  {
    id: "baseline:Goblet Squat 10-rep Max",
    label: "Goblet squat 10-rep max",
    units: "lb",
    direction: "increase",
    description: "Leg strength under sustained load.",
  },
  {
    id: "baseline:Vertical Jump",
    label: "Vertical jump",
    units: "in",
    direction: "increase",
    description: "Lower-body power. Carries to snowboarding control.",
  },
  {
    id: "baseline:Pull-Up Max Reps",
    label: "Pull-up max reps",
    units: "reps",
    direction: "increase",
    description: "Relative upper-body strength.",
  },
  {
    id: "baseline:Plank Max Hold",
    label: "Plank max hold",
    units: "sec",
    direction: "increase",
    description: "Core endurance for pack stability.",
  },
  {
    id: "hike:prep_completion",
    label: "Prep hikes completed",
    units: "hikes",
    direction: "increase",
    description: "Number of completed Hike records since the goal start that approximate the goal's difficulty profile (distance ≥ 5 mi AND elevation ≥ 2000 ft).",
  },
  {
    id: "hike:max_elevation_single",
    label: "Max single-hike elevation gain",
    units: "ft",
    direction: "increase",
    description: "Largest elevation gain demonstrated in a single completed hike.",
  },
  {
    id: "hike:total_elevation_ft",
    label: "Cumulative hike elevation",
    units: "ft",
    direction: "increase",
    description: "Sum of elevation gain from all completed hikes since program start.",
  },
  {
    id: "hike:total_distance_mi",
    label: "Cumulative hike distance",
    units: "mi",
    direction: "increase",
    description: "Sum of distance from all completed hikes since program start.",
  },
  {
    id: "workout:count",
    label: "Workouts completed",
    units: "sessions",
    direction: "increase",
    description: "Total completed workouts since program start.",
  },
  {
    id: "log:mrr",
    label: "Monthly recurring revenue",
    units: "$",
    direction: "increase",
    description: "Latest MRR snapshot from a LogEntry.",
  },
  {
    id: "log:milestones_done",
    label: "Milestones completed",
    units: "milestones",
    direction: "increase",
    description: "Count of completed milestones, logged via log_metric.",
  },
];

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

/**
 * Mt. Elbert via Black Cloud Trail — research-grounded default targets.
 *
 * Route stats: ~11 mi RT, ~5,200 ft gain, 14,440 ft summit, sustained Class 1+
 * climbing. Standard prep advice for similar 14ers (CMC, 14ers.com community,
 * AMC trail-running endurance research) emphasizes:
 *   1. Repeated exposure to long mountain efforts (most direct predictor)
 *   2. A confirmed single-day big-elevation effort before the attempt
 *   3. Cumulative weekly volume of climbing
 *
 * Gym tests are secondary signals — useful, but no number of step-ups
 * substitutes for actually climbing 4000+ ft on a Saturday.
 *
 * Total weight = 1.00.
 */
export const MT_ELBERT_DEFAULT_TARGETS: GoalTarget[] = [
  {
    metric: "hike:prep_completion",
    label: "Prep hikes completed (≥5 mi & ≥2000 ft)",
    units: "hikes",
    direction: "increase",
    target: 6,
    weight: 0.3,
    rationale:
      "Most direct predictor. Six substantial Colorado hikes during a 12-week build (roughly one every other weekend) gives the body repeat exposure to sustained climbing, altitude, pacing, and terrain — none of which transfer perfectly from gym work.",
  },
  {
    metric: "hike:max_elevation_single",
    label: "Largest single hike (ft gained)",
    units: "ft",
    direction: "increase",
    target: 4000,
    weight: 0.2,
    rationale:
      "Black Cloud Trail's 5,200 ft gain is unforgiving. Successfully completing a 4,000+ ft single-day effort first (e.g. Bierstadt + extension, Quandary, Massive) is the proof that the cardio-vascular and quad-eccentric demands are within reach.",
  },
  {
    metric: "hike:total_elevation_ft",
    label: "Cumulative hike elevation",
    units: "ft",
    direction: "increase",
    target: 25000,
    weight: 0.15,
    rationale:
      "~5× Elbert's elevation gain across the build. Ensures sufficient repeat exposure rather than a single hero hike.",
  },
  {
    metric: "baseline:20 Min Step-Up Reps",
    label: "20-min step-up reps",
    units: "reps",
    direction: "increase",
    target: 1000,
    weight: 0.1,
    rationale:
      "Best gym proxy for sustained climbing under fatigue. ~50 reps/min for 20 min is a strong indicator the legs can keep cadence on a 4-6 hour ascent.",
  },
  {
    metric: "baseline:1.5 Mile Run",
    label: "1.5-mile run",
    units: "sec",
    direction: "decrease",
    target: 660,
    weight: 0.1,
    rationale:
      "Sub-11:00 indicates VO2max headroom for the thin air at 12-14k ft. Not the bottleneck for trained hikers, but a useful aerobic-base sanity check.",
  },
  {
    metric: "baseline:Deep Squat Hold",
    label: "Deep squat hold",
    units: "sec",
    direction: "increase",
    target: 180,
    weight: 0.05,
    rationale:
      "Hip + ankle mobility — pays dividends on the 5,200 ft of *descent* (where most knee-pain stories begin). 3 minutes is comfortable; under 60 seconds suggests work to do.",
  },
  {
    metric: "baseline:Goblet Squat 10-rep Max",
    label: "Goblet squat 10-rep max",
    units: "lb",
    direction: "increase",
    target: 50,
    weight: 0.05,
    rationale:
      "Strength insurance against terrain that demands big steps + pack weight. Less critical than endurance metrics — capped at 5%.",
  },
  {
    metric: "weightLb",
    label: "Body weight",
    units: "lb",
    direction: "decrease",
    target: 155,
    weight: 0.05,
    rationale:
      "User's stated lean target. Marginal effect on uphill efficiency (every 5 lb saved ≈ 1-2 min/hour), but capped low because user already trains near goal weight.",
  },
];

/** Resolve the latest value for a metric as of `asOf` (default: now). */
export async function resolveMetricValue(
  prisma: PrismaClient,
  metric: string,
  asOf: Date = new Date(),
  goalId: string,
): Promise<number | null> {
  if (metric === "weightLb") {
    const m = await prisma.measurement.findFirst({
      where: { date: { lte: asOf }, weightLb: { not: null } },
      orderBy: { date: "desc" },
    });
    return m?.weightLb ?? null;
  }

  if (metric.startsWith("baseline:")) {
    const testName = metric.slice("baseline:".length);
    const b = await prisma.baseline.findFirst({
      where: { testName, date: { lte: asOf } },
      orderBy: { date: "desc" },
    });
    return b?.value ?? null;
  }

  if (metric === "hike:prep_completion") {
    return prisma.hike.count({
      where: {
        date: { lte: asOf },
        status: "completed",
        distanceMi: { gte: 5 },
        elevationFt: { gte: 2000 },
      },
    });
  }

  if (metric === "hike:max_elevation_single") {
    const r = await prisma.hike.aggregate({
      _max: { elevationFt: true },
      where: { date: { lte: asOf }, status: "completed" },
    });
    return r._max.elevationFt ?? 0;
  }

  if (metric === "hike:total_elevation_ft") {
    const r = await prisma.hike.aggregate({
      _sum: { elevationFt: true },
      where: { date: { lte: asOf }, status: "completed" },
    });
    return r._sum.elevationFt ?? 0;
  }

  if (metric === "hike:total_distance_mi") {
    const r = await prisma.hike.aggregate({
      _sum: { distanceMi: true },
      where: { date: { lte: asOf }, status: "completed" },
    });
    return r._sum.distanceMi ?? 0;
  }

  if (metric === "workout:count") {
    return prisma.workout.count({
      where: { startedAt: { lte: asOf }, status: "completed" },
    });
  }

  if (metric.startsWith(LOG_METRIC_PREFIX)) {
    const key = metric.slice(LOG_METRIC_PREFIX.length);
    const entry = await prisma.logEntry.findFirst({
      where: {
        goalId,
        metric: key,
        date: { lte: asOf },
        value: { not: null },
      },
      orderBy: { date: "desc" },
    });
    return entry?.value ?? null;
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

  return null;
}
