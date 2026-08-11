// src/lib/progress-records.ts
//
// Pure derivations for the /progress mixed-kind records feed (UXR-PROG-33/
// 36/37/38) and the PR pass over the SHARED scoped workout scan.
//
// UXR-PROG-38 (binding): /progress must NOT call recordsSetInWorkout() or
// getExerciseSummaries() — the PR feed is built from the same As-Of workout
// scan the rolling tracker reads (one query powers both features; getDb()
// scoping fixes the tenant story by construction).
//
// UXR-PROG-36: the DELTA is the celebration — `24 → 26 reps`, never
// "New PR! 🎉". recordsSetInWorkout returns {value, prior} and it had never
// been rendered anywhere; rendering it IS the feature.
//
// UXR-PROG-37 ⚠ noise filters: relative-improvement floor 3% ⚠[2–5] +
// prior-session floor 4 ⚠[3–5] (a near-new movement PRs every session for
// its first 5–8 — that is learning, not records). Rank by relative
// improvement, then recency, when trimming.
//
// Pure + client-safe imports only (records.ts's bestSetSummary/metric math).

import { bestSetSummary, canonicalExerciseName, epley1RM, isBetter, type MetricKind } from "@/lib/records";
import type { ScanWorkout } from "@/lib/progress-asof";

export const PR_RELATIVE_IMPROVEMENT_FLOOR = 0.03; // ⚠[2–5]%
export const PR_PRIOR_SESSION_FLOOR = 4; // ⚠[3–5]
export const RECORDS_WINDOW_DAYS = 21; // ⚠[14–21] — 7 duplicates /recap; 30 aligns with nothing

export type FeedKind = "pr" | "baseline" | "hike";

export type RecordFeedItem = {
  kind: FeedKind;
  id: string;
  date: Date;
  title: string;
  /** `prior → value units` when a prior exists; `value units` otherwise. */
  prior: number | null;
  value: number;
  units: string;
  /** PR ranking key (relative improvement); 0 for non-PR kinds. */
  relImprovement: number;
};

export type PrEvent = {
  exercise: string;
  kind: MetricKind;
  date: Date;
  workoutId: string;
  value: number;
  prior: number;
  relImprovement: number;
  priorSessions: number;
};

function unitsOf(kind: MetricKind): string {
  switch (kind) {
    case "rm":
      return "lb 1RM";
    case "reps":
      return "reps";
    case "duration":
    case "time":
      return "sec";
    case "distance":
      return "mi";
  }
}

function metricOf(
  s: { weightLb: number | null; reps: number | null; durationSec: number | null; distanceMi: number | null },
  primary: MetricKind,
): number | null {
  if (primary === "rm") {
    return s.weightLb !== null && s.reps !== null ? epley1RM(s.weightLb, s.reps) : null;
  }
  if (primary === "reps") return s.reps;
  if (primary === "duration" || primary === "time") return s.durationSec;
  if (primary === "distance") return s.distanceMi;
  return null;
}

/**
 * Running-best PR pass over the scan (oldest → newest). A session is a PR
 * event when its best strictly beats the prior running best (direction-
 * aware), the movement has ≥ priorSessionFloor prior sessions, and the
 * relative improvement clears the floor. The scan's take bound means "prior
 * best" is prior-within-scan — the accepted trade the bound carries
 * (dev-warned at the As-Of layer).
 */
export function derivePrEvents(
  workoutsNewestFirst: readonly ScanWorkout[],
  opts?: { relFloor?: number; priorSessionFloor?: number },
): PrEvent[] {
  const relFloor = opts?.relFloor ?? PR_RELATIVE_IMPROVEMENT_FLOOR;
  const priorFloor = opts?.priorSessionFloor ?? PR_PRIOR_SESSION_FLOOR;

  // Bucket per canonical movement: [{date, workoutId, sets}] oldest-first.
  const byMovement = new Map<
    string,
    { date: Date; workoutId: string; sets: ScanWorkout["exercises"][number]["sets"][number][] }[]
  >();
  for (let i = workoutsNewestFirst.length - 1; i >= 0; i--) {
    const w = workoutsNewestFirst[i]!;
    const perMovement = new Map<string, ScanWorkout["exercises"][number]["sets"][number][]>();
    for (const ex of w.exercises) {
      const key = canonicalExerciseName(ex.name);
      const arr = perMovement.get(key) ?? [];
      arr.push(...ex.sets);
      perMovement.set(key, arr);
    }
    for (const [key, sets] of perMovement) {
      const arr = byMovement.get(key) ?? [];
      arr.push({ date: w.startedAt, workoutId: w.id, sets });
      byMovement.set(key, arr);
    }
  }

  const events: PrEvent[] = [];
  for (const [movement, sessions] of byMovement) {
    // Primary metric kind from the movement's WHOLE scan history (mirrors
    // getExerciseHistory's all-sets summary).
    const summary = bestSetSummary(
      sessions.flatMap((s) => s.sets),
      movement,
    );
    if (!summary) continue;

    let runningBest: number | null = null;
    let sessionCount = 0;
    for (const sess of sessions) {
      const vals = sess.sets
        .map((s) => metricOf(s, summary.primary))
        .filter((v): v is number => v !== null);
      if (vals.length === 0) continue;
      const best = summary.direction === "lower" ? Math.min(...vals) : Math.max(...vals);
      if (runningBest !== null && isBetter(summary.direction, best, runningBest)) {
        const rel =
          summary.direction === "lower"
            ? (runningBest - best) / runningBest
            : (best - runningBest) / runningBest;
        if (sessionCount >= priorFloor && rel >= relFloor) {
          events.push({
            exercise: movement,
            kind: summary.primary,
            date: sess.date,
            workoutId: sess.workoutId,
            value: best,
            prior: runningBest,
            relImprovement: rel,
            priorSessions: sessionCount,
          });
        }
      }
      if (runningBest === null || isBetter(summary.direction, best, runningBest)) {
        runningBest = best;
      }
      sessionCount++;
    }
  }
  return events;
}

const fmtNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));

/**
 * The mixed-kind feed over the trailing window (UXR-PROG-33): PR events +
 * baseline results + completed hikes, date-ASC within the window (forward
 * time, like every axis on the page). PRs beyond the shown count are trimmed
 * by (relative improvement desc, recency desc) per UXR-PROG-37 before the
 * merge — kinds never crowd each other out by volume alone.
 */
export function buildRecordsFeed(input: {
  now: Date;
  windowDays?: number;
  prEvents: readonly PrEvent[];
  baselines: readonly { id: string; testName: string; value: number; units: string; date: Date }[];
  /** Baselines OLDER than the window, newest-first per test — the prior lookup. */
  priorBaselineValue: (testName: string, before: Date) => number | null;
  hikes: readonly { id: string; route: string; distanceMi: number; elevationFt: number; date: Date }[];
  maxPrs?: number;
}): RecordFeedItem[] {
  const windowDays = input.windowDays ?? RECORDS_WINDOW_DAYS;
  const cutoff = new Date(input.now.getTime() - windowDays * 24 * 3600 * 1000);

  const prs = input.prEvents
    .filter((e) => e.date >= cutoff && e.date <= input.now)
    .sort((a, b) => b.relImprovement - a.relImprovement || b.date.getTime() - a.date.getTime())
    .slice(0, input.maxPrs ?? 6)
    .map(
      (e): RecordFeedItem => ({
        kind: "pr",
        id: `pr-${e.workoutId}-${e.exercise}`,
        date: e.date,
        title: e.exercise,
        prior: Math.round(e.prior * 10) / 10,
        value: Math.round(e.value * 10) / 10,
        units: unitsOf(e.kind),
        relImprovement: e.relImprovement,
      }),
    );

  const baselines = input.baselines
    .filter((b) => b.date >= cutoff && b.date <= input.now)
    .map(
      (b): RecordFeedItem => ({
        kind: "baseline",
        id: `baseline-${b.id}`,
        date: b.date,
        title: b.testName,
        prior: input.priorBaselineValue(b.testName, b.date),
        value: b.value,
        units: b.units,
        relImprovement: 0,
      }),
    );

  const hikes = input.hikes
    .filter((h) => h.date >= cutoff && h.date <= input.now)
    .map(
      (h): RecordFeedItem => ({
        kind: "hike",
        id: `hike-${h.id}`,
        date: h.date,
        title: h.route,
        prior: null,
        value: h.elevationFt,
        units: `ft · ${fmtNum(h.distanceMi)} mi`,
        relImprovement: 0,
      }),
    );

  return [...prs, ...baselines, ...hikes].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Display: `1 → 2 reps` / `38 sec` — the delta IS the celebration. */
export function feedValueText(item: RecordFeedItem): string {
  const v = fmtNum(item.value);
  return item.prior !== null ? `${fmtNum(item.prior)} → ${v} ${item.units}` : `${v} ${item.units}`;
}
