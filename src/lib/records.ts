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

/**
 * A personal record set in a single workout session.
 * Returned by recordsSetInWorkout and surfaced via log_workout.
 */
export type RecordSet = {
  name: string;
  equipment: string | null;
  /** Which metric determined this is a PR. */
  kind: "rm" | "reps" | "duration";
  /** New personal best: Epley 1RM (lb), max reps, or max durationSec. */
  value: number;
  /** Previous all-time best (same metric, excluding this workout). */
  prior: number;
  /** The raw set that produced the new best. */
  raw: {
    weightLb: number | null;
    reps: number | null;
    durationSec: number | null;
  };
};

export function epley1RM(weightLb: number, reps: number): number {
  return weightLb * (1 + reps / 30);
}

// ----------------------------------------------------------------------------
// Exercise name canonicalization.
//
// One movement gets logged under several names — Strong-export spelling drift
// ("Pull Up" vs "Pull-Up"), and baseline tests mirror into workouts under their
// descriptive testName ("Plank Max Hold") rather than the working name
// ("Plank"). Equipment strings are just as inconsistent for one movement
// (null / "Bodyweight" / "Dumbbell"). Left unmerged, PR detection and the
// records summary fragment: a 64s working plank "beats" the 60s working best
// while the real 252s max sits in a separate "Plank Max Hold" bucket.
//
// Fix: group by canonical name ONLY — equipment is descriptive metadata, never
// a bucket key. The alias map is curated, not pattern-stripped: some baseline
// tests are a DIFFERENT metric ("Pull-Up Total Across 5 Sets" is a 5-set sum,
// "2-Min Bodyweight Squat" is a timed AMRAP) and must NOT fold into the
// movement, or they'd suppress real single-set PRs.
//
// canonical → every variant spelling that folds into it.
const EXERCISE_ALIAS_GROUPS: Record<string, string[]> = {
  "Pull-Up": ["Pull Up", "Pull-Up Max Reps"],
  "Push-Up": ["Push Up", "Push-Up Max Reps"],
  Dip: ["Chest Dip", "Dip (strict, unassisted)", "Dip Max Reps"],
  Plank: ["Plank Max Hold"],
  "Hollow Body Hold": ["Hollow Hold"],
  "DB Shoulder Press": ["Shoulder Press"],
  "Bent-Over One-Arm DB Row": ["Bent Over One Arm Row"],
  "Step-Up": ["Step-Ups"],
  "Stair Climber": ["CLMBR", "Climbr (Stair Climber)"],
};

// Normalized variant key → canonical. Each canonical also maps to itself so
// "Pull-Up" and "pull-up" both resolve.
const EXERCISE_ALIAS_INDEX = new Map<string, string>();
for (const [canonical, variants] of Object.entries(EXERCISE_ALIAS_GROUPS)) {
  EXERCISE_ALIAS_INDEX.set(canonical.trim().toLowerCase(), canonical);
  for (const v of variants) EXERCISE_ALIAS_INDEX.set(v.trim().toLowerCase(), canonical);
}

/**
 * Resolve a logged exercise name to its canonical movement name. Unmapped names
 * pass through trimmed (so they stay their own bucket). Case-insensitive.
 */
export function canonicalExerciseName(name: string): string {
  return EXERCISE_ALIAS_INDEX.get(name.trim().toLowerCase()) ?? name.trim();
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

    // Initial checkpoint = end of the test's first-collection week (week 1
    // unless initialWeek says otherwise); retests follow. retestWeeks at or
    // before the initial week are dropped — they can't be retests of it.
    const initialWeek = test.initialWeek ?? 1;
    const targets: { week: number; targetDate: Date; label: "initial" | "retest" }[] = [
      { week: initialWeek, targetDate: addDays(startedOn, initialWeek * 7), label: "initial" },
      ...test.retestWeeks
        .filter((w) => w > initialWeek)
        .map((w) => ({
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
    // chain in order. A not-done retest is unanchored only when no earlier
    // checkpoint was completed AND none is still collectable — i.e. the initial
    // already came due and was missed. If an earlier checkpoint is still
    // upcoming/due, the chain isn't broken yet, so we don't cry wolf.
    let anchored = false;
    let earlierPending = false;
    for (const cp of checkpoints) {
      if (cp.label === "retest" && cp.status !== "done" && !anchored && !earlierPending) {
        cp.unanchored = true;
      }
      if (cp.status === "done") anchored = true;
      if (cp.status === "upcoming" || cp.status === "due") earlierPending = true;
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

  // Group by canonical name — equipment is descriptive, not a bucket boundary.
  const byKey = new Map<
    string,
    { name: string; sessions: Set<string>; sets: typeof exercises[number]["sets"]; source: typeof exercises }
  >();
  for (const ex of exercises) {
    const key = canonicalExerciseName(ex.name);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { name: key, sessions: new Set(), sets: [], source: [] };
      byKey.set(key, bucket);
    }
    bucket.sessions.add(ex.workoutId);
    bucket.sets.push(...ex.sets);
    bucket.source.push(ex);
  }

  const out: ExerciseSummary[] = [];
  for (const [, bucket] of byKey) {
    const summary = bestSetSummary(bucket.sets);
    if (!summary) continue;

    // Representative equipment + date = the source exercise holding the best set.
    let bestDate: Date = new Date(0);
    let bestEquipment: string | null = null;
    for (const ex of bucket.source) {
      for (const s of ex.sets) {
        if (matchesBest(s, summary) && ex.workout.startedAt > bestDate) {
          bestDate = ex.workout.startedAt;
          bestEquipment = ex.equipment;
        }
      }
    }

    out.push({
      name: bucket.name,
      equipment: bestEquipment,
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

export async function getExerciseHistory(name: string): Promise<{ summary: ExerciseSummary | null; history: ExerciseHistoryPoint[] }> {
  // Match every logged spelling that folds into this canonical movement
  // (equipment is descriptive, not part of identity).
  const canonical = canonicalExerciseName(name);
  const all = await prisma.workoutExercise.findMany({
    include: { sets: true, workout: { select: { id: true, startedAt: true, title: true } } },
    orderBy: { workout: { startedAt: "asc" } },
  });
  const exercises = all.filter((ex) => canonicalExerciseName(ex.name) === canonical);

  const allSets = exercises.flatMap((ex) => ex.sets);
  const summary = bestSetSummary(allSets);
  if (!summary) return { summary: null, history: [] };

  // Representative equipment + date = the source exercise holding the best set.
  let bestDate: Date = new Date(0);
  let bestEquipment: string | null = null;
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (matchesBest(s, summary) && ex.workout.startedAt > bestDate) {
        bestDate = ex.workout.startedAt;
        bestEquipment = ex.equipment;
      }
    }
  }

  const summaryOut: ExerciseSummary = {
    name: canonical,
    equipment: bestEquipment,
    sessionCount: new Set(exercises.map((e) => e.workout.id)).size,
    totalSets: allSets.length,
    primary: summary.primary,
    bestValue: summary.value,
    bestRaw: summary.raw,
    bestDate,
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

/**
 * For each canonical movement in the given workout, compare this session's best
 * against the prior all-time best (excluding this workout). Returns only the
 * movements where this session strictly beats the prior best.
 *
 * Grouping is by canonicalExerciseName ONLY — equipment is descriptive, not part
 * of identity. This folds baseline-mirrored exercises ("Plank Max Hold") and
 * spelling variants ("Pull Up") into the working movement so a low working set
 * can't announce a false PR over a higher baseline max.
 *
 * Edge cases:
 *  - Brand-new movement (no prior history) → NOT a PR (no prior to beat).
 *  - Prior primary type differs from this session's → use this session's primary
 *    to select the prior metric value too (consistent with getExerciseHistory).
 *  - Sets with no metric at all → skipped.
 *  - Re-logging same workout: the `workout: { id: { not: workoutId } }` filter
 *    prevents the just-created workout from inflating the prior baseline.
 */
export async function recordsSetInWorkout(workoutId: string): Promise<RecordSet[]> {
  // 1. Load all exercises (with sets) for this workout.
  const exercises = await prisma.workoutExercise.findMany({
    where: { workoutId },
    include: { sets: true },
  });

  if (exercises.length === 0) return [];

  // 2. Group this workout's exercises by canonical name.
  const byKey = new Map<
    string,
    { name: string; sets: typeof exercises[number]["sets"]; source: typeof exercises }
  >();
  for (const ex of exercises) {
    const key = canonicalExerciseName(ex.name);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { name: key, sets: [], source: [] };
      byKey.set(key, bucket);
    }
    bucket.sets.push(...ex.sets);
    bucket.source.push(ex);
  }

  // 3. Prior sets from ALL other workouts, bucketed by canonical name (one query
  //    instead of one per movement). The id filter keeps the just-logged workout
  //    out of its own prior baseline.
  const priorExercises = await prisma.workoutExercise.findMany({
    where: { workout: { id: { not: workoutId } } },
    include: { sets: true },
  });
  const priorByKey = new Map<string, typeof priorExercises[number]["sets"]>();
  for (const ex of priorExercises) {
    const key = canonicalExerciseName(ex.name);
    const arr = priorByKey.get(key) ?? [];
    arr.push(...ex.sets);
    priorByKey.set(key, arr);
  }

  const results: RecordSet[] = [];

  for (const [key, bucket] of byKey) {
    // 4. This session's best.
    const thisSummary = bestSetSummary(bucket.sets);
    if (!thisSummary) continue; // no metric at all — skip

    const priorSets = priorByKey.get(key) ?? [];
    const priorSummary = bestSetSummary(priorSets);

    // 5. Brand-new movement (no prior history) → NOT a PR per PRD §6.
    if (!priorSummary) continue;

    // 6. Use this session's primary to compare apples-to-apples.
    let priorValue: number;
    if (priorSummary.primary === thisSummary.primary) {
      priorValue = priorSummary.value;
    } else {
      const recomputed = priorSets
        .map((s) => metricValue(s, thisSummary.primary))
        .filter((v): v is number => v !== null);
      if (recomputed.length === 0) continue; // no comparable prior data
      priorValue = Math.max(...recomputed);
    }

    // 7. Strict improvement only.
    if (thisSummary.value <= priorValue) continue;

    // Representative equipment = the source exercise holding the best set.
    let equipment: string | null = null;
    for (const ex of bucket.source) {
      if (ex.sets.some((s) => matchesBest(s, thisSummary))) {
        equipment = ex.equipment;
        break;
      }
    }

    results.push({
      name: bucket.name,
      equipment,
      kind: thisSummary.primary,
      value: thisSummary.value,
      prior: priorValue,
      raw: thisSummary.raw,
    });
  }

  return results;
}

export function bestSetSummary(sets: { weightLb: number | null; reps: number | null; durationSec: number | null }[]): {
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

