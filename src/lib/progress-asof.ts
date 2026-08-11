// src/lib/progress-asof.ts
//
// The As-Of Snapshot Table (UXR-PROG-18, ⚑ approved) — the perf spine of the
// /progress overhaul. Replaces "what was the value on week N?" (one query per
// metric per cursor: ~445 for a 3-member Program at week 20, ~956 for a
// legacy 3-year goal) with ONE bounded scan per metric family, after which
// every cursor evaluates as pure in-memory arithmetic (0 queries).
//
// This generalizes rarity.ts:392-420's already-shipped shared-scan pattern
// (getReachTier's rolling batch) from rolling:* to every metric family, and
// feeds computeReadiness through its additive `opts` routing param — the
// second use of the computeGoalFeasibility currentOverrides doctrine.
// readiness.ts stays consumed-not-modified: scoring math is untouched.
//
// ── Byte-identity requirements (UXR-PROG-20, each a regression test) ────────
//  (a) Every date-ordered pick carries the `id` tiebreak on BOTH sides:
//      the scans order [{date desc},{id desc}] and the in-memory pick takes
//      the first matching row of that order — and goal-targets.ts's direct
//      findFirst orderBys gained the same tiebreak, so a tenant with two
//      baselines on one day resolves identically through either path.
//  (b) Cutoff comparisons use endOfDay(cursor) from @/lib/calendar-core,
//      never a raw <= on the cursor instant (the resolver's own bucketing).
//  (c) Cumulative log:* reproduces raw _sum semantics — NULL at zero rows,
//      never 0 (an unstarted project goal must not mis-tier as legendary).
//
// ── Hazard B (report §4.6): the per-cursor override trap ────────────────────
// buildCurrentOverrides MUST be called once per cursor — a single now-valued
// rolling override applied at all 26 cursors flattens the readiness arc into
// a lie that looks plausible. buildStartOverrides is cursor-independent
// (resolveMetricStart takes no asOf) and may be shared across cursors.
//
// ── Bounds (R22: no streaming escape hatch ⇒ bounding is mandatory) ─────────
// Every scan is take-bounded (⚠ tuning ranges in the ledger). When a scan
// hits its bound, the affected family's START falls out of the override maps
// (one true DB query per goal instead of a wrong number), and a dev-only
// console.warn fires. Current-value parity below the bound is exact; a
// >bound history degrades deepest-history cursors first — documented, not
// silent.
//
// Server-only (Prisma via getDb). The pure math lives in rolling-metrics.ts.

import { endOfDay } from "@/lib/calendar-core";
import { getDb } from "@/lib/db";
import {
  ROLLING_METRIC_PREFIX,
  LOG_METRIC_PREFIX,
  ROLLING_SCAN_TAKE,
  type GoalTarget,
  type RollingParams,
} from "@/lib/goal-targets";
import {
  computeRollingValueFromWorkouts,
  rollingParamsFromTargets,
  rollingWindowSlots,
  type RollingSlot,
} from "@/lib/rolling-metrics";
import { bestSetSummary, canonicalExerciseName, epley1RM } from "@/lib/records";

// ── Scan bounds (⚠ tuning — ledger rows 16/68) ──────────────────────────────
export const ASOF_MEASUREMENT_TAKE = 400; // ⚠[180–600]
export const ASOF_BASELINE_TAKE = 500;
export const ASOF_LOG_TAKE = 1000;
export const ASOF_WORKOUT_COUNT_TAKE = 2000;
export const ASOF_HIKE_TAKE = 1000;

// ── Row shapes the table holds in memory ────────────────────────────────────
export type ScanWorkoutExercise = {
  name: string;
  equipment: string | null;
  sets: ReadonlyArray<{
    weightLb: number | null;
    reps: number | null;
    durationSec: number | null;
    distanceMi: number | null;
  }>;
};
/** Structurally satisfies RollingWorkoutSlotSource — the widened select rides
 *  along so rolling, exercise:*, and the PR feed share ONE scan. */
export type ScanWorkout = {
  id: string;
  startedAt: Date;
  exercises: ReadonlyArray<ScanWorkoutExercise>;
};
export type ScanMeasurement = {
  id: string;
  date: Date;
  weightLb: number | null;
  bodyFatPct: number | null;
};
export type ScanBaseline = {
  id: string;
  date: Date;
  testName: string;
  value: number;
  units: string;
  capped: boolean;
  notes: string | null;
};

/** The contract from report §7 Stage 2 — six accessors, all pure once built. */
export type AsOfTable = {
  baselineAt(testName: string, cutoff: Date): number | null;
  measurementAt(field: "weightLb" | "bodyFatPct", cutoff: Date): number | null;
  logAt(goalId: string, key: string, cutoff: Date, cumulative: boolean): number | null;
  rollingAt(params: RollingParams, cutoff: Date): number | null;
  rollingSlotsAt(params: RollingParams, cutoff: Date): RollingSlot[];
  workoutCountAt(cutoff: Date): number;

  // ── Additive extras beyond the six named accessors ────────────────────────
  /** hike:* aggregates, goal-scoped like the resolver (UXR — family-conditional scan). */
  hikeAt(goalId: string, metric: string, cutoff: Date): number | null;
  /** exercise:* latest-best as of cutoff — folded into the scoped workout scan
   *  (UXR-PROG-21: tenant-correct + kills 26 lifetime scans per target). */
  exerciseBestAt(name: string, cutoff: Date): number | null;

  /** Cursor-independent starts (resolveMetricStart semantics). `has` = covered. */
  startFor(goalId: string, target: GoalTarget): { covered: boolean; value: number | null };

  /** Raw scans, exposed for the Seam Strip / PR feed / weight chart so those
   *  features cost zero additional queries. All newest-first. */
  workouts: ScanWorkout[];
  measurements: ScanMeasurement[];
  baselines: ScanBaseline[];
  /** True when the matching scan returned exactly its take bound. */
  boundHit: { workouts: boolean; measurements: boolean; baselines: boolean; logs: boolean };
};

type BuildInput = {
  goals: { id: string; targets: GoalTarget[] }[];
  until: Date;
  /** Force the workout scan even when no rolling / exercise targets exist —
   *  the records/PR feed reads it. Default false. */
  includeWorkoutScan?: boolean;
};

/** Which families a metric belongs to — drives the conditional scan list. */
function familiesOf(goals: BuildInput["goals"]) {
  const baselineNames = new Set<string>();
  const logKeys: { goalId: string; key: string }[] = [];
  const hikeGoalIds = new Set<string>();
  let needMeasurement = false;
  let needWorkoutScan = false;
  let needWorkoutCount = false;
  for (const g of goals) {
    for (const t of g.targets) {
      const m = t.metric;
      if (m === "weightLb" || m === "bodyFatPct") needMeasurement = true;
      else if (m.startsWith("baseline:")) baselineNames.add(m.slice("baseline:".length));
      else if (m.startsWith(LOG_METRIC_PREFIX))
        logKeys.push({ goalId: g.id, key: m.slice(LOG_METRIC_PREFIX.length) });
      else if (m.startsWith(ROLLING_METRIC_PREFIX) || m.startsWith("exercise:"))
        needWorkoutScan = true;
      else if (m === "workout:count") needWorkoutCount = true;
      else if (m.startsWith("hike:")) hikeGoalIds.add(g.id);
    }
  }
  return { baselineNames, logKeys, hikeGoalIds, needMeasurement, needWorkoutScan, needWorkoutCount };
}

/** max-by-(date,id) pick over rows already sorted [{date desc},{id desc}]. */
function firstAtOrBefore<T extends { date: Date }>(rowsDesc: readonly T[], cutoffEod: Date): T | null {
  for (const r of rowsDesc) {
    if (r.date.getTime() <= cutoffEod.getTime()) return r;
  }
  return null;
}

export async function buildAsOfTable(input: BuildInput): Promise<AsOfTable> {
  const { goals, until } = input;
  const untilEod = endOfDay(until);
  const fam = familiesOf(goals);
  const db = await getDb();

  const wantWorkouts = fam.needWorkoutScan || input.includeWorkoutScan === true;
  const logGoalIds = [...new Set(fam.logKeys.map((k) => k.goalId))];
  const logKeySet = [...new Set(fam.logKeys.map((k) => k.key))];

  // ONE Promise.all of ≤6 bounded scans (report §4.6 depth 3).
  const [baselineRows, measurementRows, logRows, workoutRows, workoutCountRows, hikeRows] =
    await Promise.all([
      fam.baselineNames.size > 0
        ? db.baseline.findMany({
            where: { testName: { in: [...fam.baselineNames] }, date: { lte: untilEod } },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: ASOF_BASELINE_TAKE,
            select: {
              id: true,
              date: true,
              testName: true,
              value: true,
              units: true,
              capped: true,
              notes: true,
            },
          })
        : Promise.resolve([] as ScanBaseline[]),
      fam.needMeasurement
        ? db.measurement.findMany({
            where: {
              date: { lte: untilEod },
              OR: [{ weightLb: { not: null } }, { bodyFatPct: { not: null } }],
            },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: ASOF_MEASUREMENT_TAKE,
            select: { id: true, date: true, weightLb: true, bodyFatPct: true },
          })
        : Promise.resolve([] as ScanMeasurement[]),
      fam.logKeys.length > 0
        ? db.logEntry.findMany({
            // NO value:{not:null} here — resolveMetricStart's earliest-row
            // lookup has no value filter, so the scan must be the superset;
            // the current-value pick applies value!=null in memory.
            where: {
              goalId: { in: logGoalIds },
              metric: { in: logKeySet },
              date: { lte: untilEod },
            },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: ASOF_LOG_TAKE,
            select: { id: true, goalId: true, metric: true, date: true, value: true },
          })
        : Promise.resolve(
            [] as { id: string; goalId: string; metric: string; date: Date; value: number | null }[],
          ),
      wantWorkouts
        ? db.workout.findMany({
            where: { status: "completed", startedAt: { lte: untilEod } },
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            take: ROLLING_SCAN_TAKE,
            select: {
              id: true,
              startedAt: true,
              exercises: {
                orderBy: { orderIndex: "asc" },
                select: {
                  name: true,
                  equipment: true,
                  sets: {
                    orderBy: { setIndex: "asc" },
                    select: { weightLb: true, reps: true, durationSec: true, distanceMi: true },
                  },
                },
              },
            },
          })
        : Promise.resolve([] as ScanWorkout[]),
      fam.needWorkoutCount
        ? db.workout.findMany({
            where: { status: "completed", startedAt: { lte: untilEod } },
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            take: ASOF_WORKOUT_COUNT_TAKE,
            select: { startedAt: true },
          })
        : Promise.resolve([] as { startedAt: Date }[]),
      fam.hikeGoalIds.size > 0
        ? db.hike.findMany({
            where: {
              goalId: { in: [...fam.hikeGoalIds] },
              status: "completed",
              date: { lte: untilEod },
            },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: ASOF_HIKE_TAKE,
            select: { goalId: true, date: true, distanceMi: true, elevationFt: true },
          })
        : Promise.resolve(
            [] as { goalId: string | null; date: Date; distanceMi: number; elevationFt: number }[],
          ),
    ]);

  const boundHit = {
    workouts: wantWorkouts && workoutRows.length === ROLLING_SCAN_TAKE,
    measurements: fam.needMeasurement && measurementRows.length === ASOF_MEASUREMENT_TAKE,
    baselines: fam.baselineNames.size > 0 && baselineRows.length === ASOF_BASELINE_TAKE,
    logs: fam.logKeys.length > 0 && logRows.length === ASOF_LOG_TAKE,
  };
  if (process.env.NODE_ENV !== "production") {
    for (const [k, hit] of Object.entries(boundHit)) {
      if (hit) console.warn(`[progress-asof] ${k} scan hit its take bound — deep-history cursors degrade`);
    }
  }

  // Bucket log rows by goalId|key, kept in scan (desc) order.
  const logByGoalKey = new Map<string, typeof logRows>();
  for (const r of logRows) {
    const k = `${r.goalId}|${r.metric}`;
    const arr = logByGoalKey.get(k) ?? [];
    arr.push(r);
    logByGoalKey.set(k, arr);
  }
  // Bucket baselines by testName (desc order preserved).
  const baselinesByTest = new Map<string, ScanBaseline[]>();
  for (const b of baselineRows) {
    const arr = baselinesByTest.get(b.testName) ?? [];
    arr.push(b);
    baselinesByTest.set(b.testName, arr);
  }

  // exercise:* — per canonical name: the all-scan best summary defines the
  // primary metric kind (mirrors getExerciseHistory: summary from ALL sets,
  // then per-workout bests), then a date-filtered pick per cutoff.
  type ExercisePoint = { date: Date; best: number };
  const exerciseHistories = new Map<string, ExercisePoint[]>(); // asc by date
  function historyFor(canonical: string): ExercisePoint[] {
    let hist = exerciseHistories.get(canonical);
    if (hist) return hist;
    const matching = workoutRows
      .map((w) => ({
        w,
        sets: w.exercises
          .filter((ex) => canonicalExerciseName(ex.name) === canonical)
          .flatMap((ex) => ex.sets),
      }))
      .filter((p) => p.sets.length > 0);
    const allSets = matching.flatMap((p) => p.sets);
    const summary = bestSetSummary(allSets, canonical);
    if (!summary) {
      hist = [];
      exerciseHistories.set(canonical, hist);
      return hist;
    }
    const metricOf = (s: (typeof allSets)[number]): number | null => {
      if (summary.primary === "rm")
        return s.weightLb !== null && s.reps !== null ? epley1RM(s.weightLb, s.reps) : null;
      if (summary.primary === "reps") return s.reps;
      if (summary.primary === "duration" || summary.primary === "time") return s.durationSec;
      if (summary.primary === "distance") return s.distanceMi ?? null;
      return null;
    };
    hist = matching
      .map((p) => {
        const vals = p.sets.map(metricOf).filter((v): v is number => v !== null);
        if (vals.length === 0) return null;
        const best =
          summary.direction === "lower" ? Math.min(...vals) : Math.max(...vals);
        return { date: p.w.startedAt, best };
      })
      .filter((p): p is ExercisePoint => p !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    exerciseHistories.set(canonical, hist);
    return hist;
  }

  const table: AsOfTable = {
    baselineAt(testName, cutoff) {
      const rows = baselinesByTest.get(testName);
      if (!rows) return null;
      return firstAtOrBefore(rows, endOfDay(cutoff))?.value ?? null;
    },

    measurementAt(field, cutoff) {
      const eod = endOfDay(cutoff);
      for (const m of measurementRows) {
        if (m.date.getTime() > eod.getTime()) continue;
        const v = field === "weightLb" ? m.weightLb : m.bodyFatPct;
        if (v !== null) return v;
      }
      return null;
    },

    logAt(goalId, key, cutoff, cumulative) {
      const rows = logByGoalKey.get(`${goalId}|${key}`) ?? [];
      const eod = endOfDay(cutoff).getTime();
      if (cumulative) {
        // (c) NULL at zero rows, never 0 — raw _sum semantics. The resolver's
        // aggregate carries value:{not:null}; sum only non-null values and
        // return null when none matched.
        let sum = 0;
        let any = false;
        for (const r of rows) {
          if (r.date.getTime() > eod || r.value === null) continue;
          sum += r.value;
          any = true;
        }
        return any ? sum : null;
      }
      for (const r of rows) {
        if (r.date.getTime() <= eod && r.value !== null) return r.value;
      }
      return null;
    },

    rollingAt(params, cutoff) {
      const eod = endOfDay(cutoff).getTime();
      return computeRollingValueFromWorkouts(
        workoutRows.filter((w) => w.startedAt.getTime() <= eod),
        params,
      );
    },

    rollingSlotsAt(params, cutoff) {
      const eod = endOfDay(cutoff).getTime();
      return rollingWindowSlots(
        workoutRows.filter((w) => w.startedAt.getTime() <= eod),
        params,
      ).slots;
    },

    workoutCountAt(cutoff) {
      const eod = endOfDay(cutoff).getTime();
      return workoutCountRows.filter((w) => w.startedAt.getTime() <= eod).length;
    },

    hikeAt(goalId, metric, cutoff) {
      const eod = endOfDay(cutoff).getTime();
      const rows = hikeRows.filter(
        (h) => h.goalId === goalId && h.date.getTime() <= eod,
      );
      if (metric === "hike:prep_completion") {
        return rows.filter((h) => h.distanceMi >= 5 && h.elevationFt >= 2000).length;
      }
      if (metric === "hike:max_elevation_single") {
        return rows.length === 0 ? 0 : Math.max(...rows.map((h) => h.elevationFt));
      }
      if (metric === "hike:total_elevation_ft") {
        return rows.reduce((s, h) => s + h.elevationFt, 0);
      }
      if (metric === "hike:total_distance_mi") {
        return rows.reduce((s, h) => s + h.distanceMi, 0);
      }
      return null;
    },

    exerciseBestAt(name, cutoff) {
      const hist = historyFor(canonicalExerciseName(name));
      const eod = endOfDay(cutoff).getTime();
      const filtered = hist.filter((p) => p.date.getTime() <= eod);
      return filtered.length > 0 ? filtered.at(-1)!.best : null;
    },

    startFor(goalId, target) {
      const m = target.metric;
      const cumulative = target.cumulative ?? false;
      // Constant-starts first (byte-identical to resolveMetricStart).
      if (m.startsWith("hike:") || m === "workout:count") return { covered: true, value: 0 };
      if (m.startsWith(ROLLING_METRIC_PREFIX)) return { covered: true, value: 0 };
      if (cumulative && m.startsWith(LOG_METRIC_PREFIX)) return { covered: true, value: 0 };

      if (m === "weightLb" || m === "bodyFatPct") {
        if (boundHit.measurements) return { covered: false, value: null };
        // Earliest row with the field non-null: min by (date,id) — scan is
        // desc, so walk from the tail.
        for (let i = measurementRows.length - 1; i >= 0; i--) {
          const row = measurementRows[i]!;
          const v = m === "weightLb" ? row.weightLb : row.bodyFatPct;
          if (v !== null) return { covered: true, value: v };
        }
        return { covered: true, value: null };
      }
      if (m.startsWith("baseline:")) {
        if (boundHit.baselines) return { covered: false, value: null };
        const rows = baselinesByTest.get(m.slice("baseline:".length));
        if (!rows || rows.length === 0) return { covered: true, value: null };
        return { covered: true, value: rows.at(-1)!.value };
      }
      if (m.startsWith(LOG_METRIC_PREFIX)) {
        if (boundHit.logs) return { covered: false, value: null };
        const rows = logByGoalKey.get(`${goalId}|${m.slice(LOG_METRIC_PREFIX.length)}`) ?? [];
        // Earliest ROW (no value filter — resolveMetricStart has none).
        return rows.length === 0
          ? { covered: true, value: null }
          : { covered: true, value: rows.at(-1)!.value ?? null };
      }
      if (m.startsWith("exercise:")) {
        if (boundHit.workouts) return { covered: false, value: null };
        const hist = historyFor(canonicalExerciseName(m.slice("exercise:".length)));
        return { covered: true, value: hist.length > 0 ? hist[0]!.best : null };
      }
      return { covered: false, value: null };
    },

    workouts: workoutRows as ScanWorkout[],
    measurements: measurementRows,
    baselines: baselineRows,
    boundHit,
  };

  return table;
}

// ── Override-map builders (the computeReadiness routing layer) ──────────────

/**
 * Per-cursor current-value map for one goal. ⚠ Hazard B: call this fresh for
 * EVERY cursor — never hoist one map across a series.
 *
 * Families the table covers land in the map (null = resolved-to-null,
 * honest untested). Families it does not cover — e.g. an unbounded-start
 * fallback — are OMITTED so computeReadiness falls through to the true
 * resolver for that metric only.
 */
export function buildCurrentOverrides(
  table: AsOfTable,
  goal: { id: string; targets: GoalTarget[] },
  cursor: Date,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const t of goal.targets) {
    const m = t.metric;
    if (m === "weightLb" || m === "bodyFatPct") {
      map.set(m, table.measurementAt(m, cursor));
    } else if (m.startsWith("baseline:")) {
      map.set(m, table.baselineAt(m.slice("baseline:".length), cursor));
    } else if (m.startsWith(LOG_METRIC_PREFIX)) {
      map.set(m, table.logAt(goal.id, m.slice(LOG_METRIC_PREFIX.length), cursor, t.cumulative ?? false));
    } else if (m.startsWith(ROLLING_METRIC_PREFIX)) {
      const params = rollingParamsFromTargets(goal.targets, m);
      map.set(m, params === null ? null : table.rollingAt(params, cursor));
    } else if (m === "workout:count") {
      map.set(m, table.workoutCountAt(cursor));
    } else if (m.startsWith("hike:")) {
      map.set(m, table.hikeAt(goal.id, m, cursor));
    } else if (m.startsWith("exercise:")) {
      map.set(m, table.exerciseBestAt(m.slice("exercise:".length), cursor));
    }
    // Unknown families: omitted → computeReadiness falls through.
  }
  return map;
}

/** Cursor-independent start map for one goal — build ONCE, share across the
 *  series. Metrics whose start the table cannot answer exactly (a scan hit
 *  its bound) are omitted → one true resolveMetricStart query each, total,
 *  not per cursor. Targets with an explicit `start` never consult this. */
export function buildStartOverrides(
  table: AsOfTable,
  goal: { id: string; targets: GoalTarget[] },
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const t of goal.targets) {
    if (t.start !== undefined && t.start !== null) continue; // explicit start wins upstream
    const r = table.startFor(goal.id, t);
    if (r.covered) map.set(t.metric, r.value);
  }
  return map;
}
