// Aggregations for baseline tests + per-exercise PRs.
// "PR" here is the best single-set effort across all completed workouts.

import { addDays as addDaysCal, endOfDay, startOfDay } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import type { BaselineDay, BaselineTest, ProgramTemplate } from "@/lib/program-template";

export type CheckpointStatus = "upcoming" | "due" | "overdue" | "done";

export type ScheduledCheckpoint = {
  week: number;
  targetDate: Date;
  label: "initial" | "retest";
  status: CheckpointStatus;
  completedOn?: Date;
  completedValue?: number;
  /**
   * True for a not-yet-done retest checkpoint whose initial (and every earlier
   * checkpoint) was never completed — there is no prior result to retest
   * against, so calling it a "retest" is meaningless. Display as an overdue
   * initial; the plan linter treats it as an error.
   */
  unanchored?: boolean;
};

/**
 * Human label for a checkpoint. An unanchored retest reads as an overdue
 * initial — there's no prior result to retest against — rather than "retest".
 */
export function checkpointLabel(cp: Pick<ScheduledCheckpoint, "label" | "unanchored">): string {
  return cp.unanchored ? "initial (overdue)" : cp.label;
}

export type ScheduledBaseline = {
  testName: string;
  units: string;
  protocol: string;
  dayOfWeek: number;
  retestWeeks: number[];
  checkpoints: ScheduledCheckpoint[];
  latestResult: { date: Date; value: number; units: string } | null;
  resultCount: number;
};

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

/**
 * Resolve scheduled baselines from the active Plan's template, fold in DB
 * results, and compute status (initial + each retest checkpoint).
 *
 * Initial test is week 1; retests are at template-defined retestWeeks. A
 * checkpoint is "done" if a Baseline row exists on or after its target
 * date for the same testName.
 */
export async function getBaselineSchedule(opts?: { now?: Date }): Promise<{
  startedOn: Date | null;
  totalWeeks: number | null;
  scheduled: ScheduledBaseline[];
  unscheduledExtras: { testName: string; units: string; resultCount: number; latest: { date: Date; value: number } }[];
}> {
  const now = opts?.now ?? new Date();
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!plan) {
    return { startedOn: null, totalWeeks: null, scheduled: [], unscheduledExtras: [] };
  }

  const template = plan.planJson as unknown as ProgramTemplate;
  const startedOn = plan.startedOn;

  // Flatten template baseline tests preserving their day-of-week.
  const flat: { day: BaselineDay; test: BaselineTest }[] = [];
  for (const day of template.baselineWeek ?? []) {
    for (const test of day.tests) flat.push({ day, test });
  }

  // Pull all baselines once and bucket by testName for efficiency.
  const allBaselines = await prisma.baseline.findMany({ orderBy: { date: "asc" } });
  const byName = new Map<string, typeof allBaselines>();
  for (const b of allBaselines) {
    const arr = byName.get(b.testName) ?? [];
    arr.push(b);
    byName.set(b.testName, arr);
  }

  const scheduled: ScheduledBaseline[] = flat.map(({ day, test }) => {
    const rows = byName.get(test.testName) ?? [];

    // Initial checkpoint = end of week 1 (day 7 of program); retests follow.
    const targets: { week: number; targetDate: Date; label: "initial" | "retest" }[] = [
      { week: 1, targetDate: addDays(startedOn, 7), label: "initial" },
      ...test.retestWeeks.map((w) => ({
        week: w,
        targetDate: addDays(startedOn, w * 7),
        label: "retest" as const,
      })),
    ];

    // Each checkpoint owns the window [prev target or program start, next target or +28d).
    // Results logged anywhere in the window — including before the target — count it as done.
    const checkpoints: ScheduledCheckpoint[] = targets.map((t, i) => {
      const windowStart = i === 0 ? startedOn : targets[i - 1].targetDate;
      const windowEnd =
        i < targets.length - 1 ? targets[i + 1].targetDate : addDays(t.targetDate, 28);
      return {
        ...t,
        ...statusFor(t.targetDate, rows, now, windowStart, windowEnd),
      };
    });

    // Honest labels: a retest needs a prior result to retest against. Walk the
    // chain in order; once any checkpoint is done, later retests are anchored.
    // A not-done retest with no earlier done checkpoint is flagged unanchored
    // (an overdue initial in disguise) rather than left looking like a retest.
    let anchored = false;
    for (const cp of checkpoints) {
      if (cp.status === "done") {
        anchored = true;
        continue;
      }
      if (cp.label === "retest" && !anchored) cp.unanchored = true;
    }

    const latest = rows.at(-1);
    return {
      testName: test.testName,
      units: test.units,
      protocol: test.protocol,
      dayOfWeek: day.dayOfWeek,
      retestWeeks: test.retestWeeks,
      checkpoints,
      latestResult: latest
        ? { date: latest.date, value: latest.value, units: latest.units }
        : null,
      resultCount: rows.length,
    };
  });

  // Tests logged but not in the template — surface them so they're not lost.
  const scheduledNames = new Set(flat.map((f) => f.test.testName));
  const unscheduledExtras: { testName: string; units: string; resultCount: number; latest: { date: Date; value: number } }[] = [];
  for (const [testName, rows] of byName) {
    if (scheduledNames.has(testName)) continue;
    const latest = rows.at(-1)!;
    unscheduledExtras.push({
      testName,
      units: latest.units,
      resultCount: rows.length,
      latest: { date: latest.date, value: latest.value },
    });
  }
  unscheduledExtras.sort((a, b) => a.testName.localeCompare(b.testName));

  return {
    startedOn,
    totalWeeks: plan.weeks,
    scheduled,
    unscheduledExtras,
  };
}

// USER_TZ-aware end-of-day shifted by n days.
function addDays(d: Date, n: number): Date {
  return endOfDay(addDaysCal(d, n));
}

function statusFor(
  target: Date,
  rows: { date: Date; value: number }[],
  now: Date,
  windowStart: Date,
  windowEnd: Date,
): { status: CheckpointStatus; completedOn?: Date; completedValue?: number } {
  const match = rows.find(
    (r) => r.date >= startOfDay(windowStart) && r.date < windowEnd,
  );
  if (match) return { status: "done", completedOn: match.date, completedValue: match.value };

  const dueWindowStart = addDays(target, -7); // window opens 1 week before target
  if (now >= dueWindowStart && now <= addDays(target, 7)) return { status: "due" };
  if (now > addDays(target, 7)) return { status: "overdue" };
  return { status: "upcoming" };
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
