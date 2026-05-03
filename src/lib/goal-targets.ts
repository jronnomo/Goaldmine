// Readiness target registry. Each metric describes a measurable signal that
// can be tied to a Goal, plus how to fetch its current value from the DB.

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
};

export type MetricSpec = {
  id: string;
  label: string;
  units: string;
  direction: Direction;
  description: string;
};

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
    description: "Top predictor for Mt. Elbert leg endurance.",
  },
  {
    id: "baseline:Deep Squat Hold",
    label: "Deep squat hold",
    units: "sec",
    direction: "increase",
    description: "Hip + ankle mobility benchmark.",
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
    id: "hike:total_elevation_ft",
    label: "Cumulative hike elevation",
    units: "ft",
    direction: "increase",
    description: "Sum of elevation gain from all logged hikes since program start.",
  },
  {
    id: "hike:total_distance_mi",
    label: "Cumulative hike distance",
    units: "mi",
    direction: "increase",
    description: "Sum of distance from all logged hikes since program start.",
  },
  {
    id: "workout:count",
    label: "Workouts completed",
    units: "sessions",
    direction: "increase",
    description: "Total completed workouts since program start.",
  },
];

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

/** Default Mt. Elbert / Black Cloud Trail readiness targets. */
export const MT_ELBERT_DEFAULT_TARGETS: GoalTarget[] = [
  { metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 0.1 },
  {
    metric: "baseline:1.5 Mile Run",
    label: "1.5-mile run",
    units: "sec",
    direction: "decrease",
    target: 660,
    weight: 0.2,
  },
  {
    metric: "baseline:20 Min Step-Up Reps",
    label: "20-min step-ups",
    units: "reps",
    direction: "increase",
    target: 1000,
    weight: 0.25,
  },
  {
    metric: "baseline:Deep Squat Hold",
    label: "Deep squat hold",
    units: "sec",
    direction: "increase",
    target: 180,
    weight: 0.1,
  },
  {
    metric: "baseline:Goblet Squat 10-rep Max",
    label: "Goblet squat 10rm",
    units: "lb",
    direction: "increase",
    target: 50,
    weight: 0.15,
  },
  {
    metric: "hike:total_elevation_ft",
    label: "Cumulative hike elevation",
    units: "ft",
    direction: "increase",
    target: 25000,
    weight: 0.2,
  },
];

/** Resolve the latest value for a metric as of `asOf` (default: now). */
export async function resolveMetricValue(
  prisma: PrismaClient,
  metric: string,
  asOf: Date = new Date(),
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

  if (metric === "hike:total_elevation_ft") {
    const r = await prisma.hike.aggregate({
      _sum: { elevationFt: true },
      where: { date: { lte: asOf } },
    });
    return r._sum.elevationFt ?? 0;
  }

  if (metric === "hike:total_distance_mi") {
    const r = await prisma.hike.aggregate({
      _sum: { distanceMi: true },
      where: { date: { lte: asOf } },
    });
    return r._sum.distanceMi ?? 0;
  }

  if (metric === "workout:count") {
    return prisma.workout.count({
      where: { startedAt: { lte: asOf }, status: "completed" },
    });
  }

  return null;
}

/** Earliest available value for a metric — used to auto-fill `start` if missing. */
export async function resolveMetricStart(
  prisma: PrismaClient,
  metric: string,
): Promise<number | null> {
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

  // Cumulative metrics start at 0.
  if (metric.startsWith("hike:") || metric === "workout:count") return 0;

  return null;
}
