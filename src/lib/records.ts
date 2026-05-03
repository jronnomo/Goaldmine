// Aggregations for baseline tests + per-exercise PRs.
// "PR" here is the best single-set effort across all completed workouts.

import { prisma } from "@/lib/db";

export type BaselineSummary = {
  testName: string;
  units: string;
  latest: { date: Date; value: number };
  earliest: { date: Date; value: number };
  count: number;
  /** Δ from earliest to latest. Direction is metric-dependent — display only. */
  delta: number;
};

export type ExerciseSummary = {
  name: string;
  equipment: string | null;
  sessionCount: number;
  totalSets: number;
  /** What kind of "best" this exercise tracks. */
  primary: "rm" | "reps" | "duration";
  bestValue: number; // estimated 1RM (lb), max reps, or max duration sec
  bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null };
  bestDate: Date;
};

export type ExerciseHistoryPoint = {
  date: Date;
  workoutId: string;
  workoutTitle: string | null;
  /** Best of any set in this session (matched to the exercise's primary). */
  best: number;
  rawWeight: number | null;
  rawReps: number | null;
  rawDuration: number | null;
};

export function epley1RM(weightLb: number, reps: number): number {
  return weightLb * (1 + reps / 30);
}

export async function getBaselineSummaries(): Promise<BaselineSummary[]> {
  const groups = await prisma.baseline.groupBy({
    by: ["testName"],
    _count: { _all: true },
  });

  const out: BaselineSummary[] = [];
  for (const g of groups) {
    const [first, last] = await Promise.all([
      prisma.baseline.findFirst({ where: { testName: g.testName }, orderBy: { date: "asc" } }),
      prisma.baseline.findFirst({ where: { testName: g.testName }, orderBy: { date: "desc" } }),
    ]);
    if (!first || !last) continue;
    out.push({
      testName: g.testName,
      units: last.units,
      latest: { date: last.date, value: last.value },
      earliest: { date: first.date, value: first.value },
      count: g._count._all,
      delta: last.value - first.value,
    });
  }
  return out.sort((a, b) => a.testName.localeCompare(b.testName));
}

export async function getBaselineHistory(testName: string) {
  return prisma.baseline.findMany({
    where: { testName },
    orderBy: { date: "asc" },
  });
}

export async function getExerciseSummaries(): Promise<ExerciseSummary[]> {
  const exercises = await prisma.workoutExercise.findMany({
    include: { sets: true, workout: { select: { startedAt: true } } },
  });

  // Group by name+equipment.
  const byKey = new Map<string, { name: string; equipment: string | null; sessions: Set<string>; sets: typeof exercises[number]["sets"]; bestDate: Date }>();
  for (const ex of exercises) {
    const key = `${ex.name}|${ex.equipment ?? ""}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { name: ex.name, equipment: ex.equipment, sessions: new Set(), sets: [], bestDate: ex.workout.startedAt };
      byKey.set(key, bucket);
    }
    bucket.sessions.add(ex.workoutId);
    bucket.sets.push(...ex.sets);
  }

  const out: ExerciseSummary[] = [];
  for (const [, bucket] of byKey) {
    const summary = bestSetSummary(bucket.sets);
    if (!summary) continue;

    // Determine date of the best set by walking exercises again.
    let bestDate: Date = new Date(0);
    for (const ex of exercises) {
      if (ex.name !== bucket.name || (ex.equipment ?? "") !== (bucket.equipment ?? "")) continue;
      for (const s of ex.sets) {
        if (matchesBest(s, summary)) {
          if (ex.workout.startedAt > bestDate) bestDate = ex.workout.startedAt;
        }
      }
    }

    out.push({
      name: bucket.name,
      equipment: bucket.equipment,
      sessionCount: bucket.sessions.size,
      totalSets: bucket.sets.length,
      primary: summary.primary,
      bestValue: summary.value,
      bestRaw: summary.raw,
      bestDate,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getExerciseHistory(name: string, equipment: string | null): Promise<{ summary: ExerciseSummary | null; history: ExerciseHistoryPoint[] }> {
  const exercises = await prisma.workoutExercise.findMany({
    where: { name, equipment },
    include: { sets: true, workout: { select: { id: true, startedAt: true, title: true } } },
    orderBy: { workout: { startedAt: "asc" } },
  });

  const allSets = exercises.flatMap((ex) => ex.sets);
  const summary = bestSetSummary(allSets);
  if (!summary) return { summary: null, history: [] };

  const summaryOut: ExerciseSummary = {
    name,
    equipment,
    sessionCount: exercises.length,
    totalSets: allSets.length,
    primary: summary.primary,
    bestValue: summary.value,
    bestRaw: summary.raw,
    bestDate: bestDateOf(exercises, summary),
  };

  const history: ExerciseHistoryPoint[] = exercises
    .map((ex) => {
      const setsWithMetric = ex.sets
        .map((s) => ({ s, m: metricValue(s, summary.primary) }))
        .filter((p) => p.m !== null) as { s: typeof ex.sets[number]; m: number }[];
      if (setsWithMetric.length === 0) return null;
      const best = setsWithMetric.reduce((a, b) => (b.m > a.m ? b : a));
      return {
        date: ex.workout.startedAt,
        workoutId: ex.workout.id,
        workoutTitle: ex.workout.title,
        best: best.m,
        rawWeight: best.s.weightLb,
        rawReps: best.s.reps,
        rawDuration: best.s.durationSec,
      } satisfies ExerciseHistoryPoint;
    })
    .filter((p): p is ExerciseHistoryPoint => p !== null);

  return { summary: summaryOut, history };
}

function bestSetSummary(sets: { weightLb: number | null; reps: number | null; durationSec: number | null }[]): {
  primary: "rm" | "reps" | "duration";
  value: number;
  raw: { weightLb: number | null; reps: number | null; durationSec: number | null };
} | null {
  if (sets.length === 0) return null;
  const weighted = sets.filter((s) => s.weightLb !== null && s.reps !== null);
  if (weighted.length > 0) {
    const best = weighted.reduce((a, b) => (epley1RM(b.weightLb!, b.reps!) > epley1RM(a.weightLb!, a.reps!) ? b : a));
    return {
      primary: "rm",
      value: epley1RM(best.weightLb!, best.reps!),
      raw: { weightLb: best.weightLb, reps: best.reps, durationSec: null },
    };
  }
  const reps = sets.filter((s) => s.reps !== null);
  if (reps.length > 0) {
    const best = reps.reduce((a, b) => (b.reps! > a.reps! ? b : a));
    return { primary: "reps", value: best.reps!, raw: { weightLb: null, reps: best.reps, durationSec: null } };
  }
  const duration = sets.filter((s) => s.durationSec !== null);
  if (duration.length > 0) {
    const best = duration.reduce((a, b) => (b.durationSec! > a.durationSec! ? b : a));
    return { primary: "duration", value: best.durationSec!, raw: { weightLb: null, reps: null, durationSec: best.durationSec } };
  }
  return null;
}

function metricValue(s: { weightLb: number | null; reps: number | null; durationSec: number | null }, primary: "rm" | "reps" | "duration"): number | null {
  if (primary === "rm") {
    if (s.weightLb !== null && s.reps !== null) return epley1RM(s.weightLb, s.reps);
    return null;
  }
  if (primary === "reps") return s.reps;
  return s.durationSec;
}

function matchesBest(s: { weightLb: number | null; reps: number | null; durationSec: number | null }, summary: { primary: "rm" | "reps" | "duration"; value: number }): boolean {
  const v = metricValue(s, summary.primary);
  if (v === null) return false;
  return Math.abs(v - summary.value) < 0.01;
}

function bestDateOf(
  exercises: { sets: { weightLb: number | null; reps: number | null; durationSec: number | null }[]; workout: { startedAt: Date } }[],
  summary: { primary: "rm" | "reps" | "duration"; value: number },
): Date {
  let best: Date = new Date(0);
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (matchesBest(s, summary)) {
        if (ex.workout.startedAt > best) best = ex.workout.startedAt;
      }
    }
  }
  return best;
}
