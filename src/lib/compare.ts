// src/lib/compare.ts
//
// Server-only assembly for the "Glance back, forge ahead" two-date snapshot
// comparison: computeComparison(aKey, bKey). Reads existing logged history
// only — no plan/override reads (see PRD §4.6). DB via getDb() for scoped
// models; raw prisma for workoutExercise/Set (unscoped, no userId column —
// matches records.ts convention exactly).

import { getDb, prisma } from "@/lib/db";
import { computeReadiness } from "@/lib/readiness";
import { computeGameState } from "@/lib/game/engine";
import { levelFromXp, OVERALL_LEVEL_BASE } from "@/lib/game/rules";
import type { GoalTarget } from "@/lib/goal-targets";
import { resolveBodyMetric, BODY_METRICS } from "@/lib/metrics-registry";
import {
  canonicalExerciseName,
  bestSetSummary,
  metricKindFor,
  epley1RM,
  type MetricKind,
} from "@/lib/records";
import { parseDateKey, dateKey as toDateKey, startOfDay, endOfDay, addDays } from "@/lib/calendar-core";
import {
  buildEntry,
  normalizeDateRange,
  directionForMetricKind,
  type CompareEntry,
  type CompareDirection,
  type ComparisonResult,
  type GoalCompareSection,
  type CountersSection,
  type NutritionCompareSection,
} from "@/lib/compare-core";

export async function computeComparison(aKeyRaw: string, bKeyRaw: string): Promise<ComparisonResult> {
  const todayKey = toDateKey(new Date());
  const { dateA, dateB, swapped, sameDay, clampedToToday, spanDays } =
    normalizeDateRange(aKeyRaw, bKeyRaw, todayKey);
  const cutA = endOfDay(parseDateKey(dateA));
  const cutB = endOfDay(parseDateKey(dateB));

  // Fetch active goals ONCE — shared by goal sections, baseline direction
  // fallback, and body-metric weight direction (avoids 3 separate queries).
  // DECISION (deviates slightly from "goal readiness chains + family queries
  // under Promise.all" phrasing, but is strictly more efficient and simpler).
  const db = await getDb();
  const goals = await db.goal.findMany({
    where: { active: true },
    orderBy: [{ isFocus: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
  });
  const goalTargetsList: GoalTarget[][] = goals.map(
    (g) => (g.targets as unknown as GoalTarget[] | null) ?? [],
  );

  const [goalsSection, strengthEntries, baselineEntries, bodyEntries, countersSection, nutritionSection] =
    await Promise.all([
      buildGoalSections(goals, cutA, cutB),
      buildStrengthEntries(cutA, cutB),
      buildBaselineEntries(goalTargetsList, cutA, cutB),
      buildBodyEntries(goalTargetsList, cutA, cutB),
      buildCountersSection(cutA, cutB, dateA, dateB),
      buildNutritionSection(dateA, dateB),
    ]);

  const hasAnyDataA = computeHasAnyDataA(
    goalsSection, strengthEntries, baselineEntries, bodyEntries, countersSection, nutritionSection,
  );

  return {
    dateA, dateB, swapped, sameDay, clampedToToday, spanDays,
    generatedAt: new Date().toISOString(),
    hasAnyDataA,
    goals: goalsSection,
    strength: strengthEntries,
    baselines: baselineEntries,
    body: bodyEntries,
    counters: countersSection,
    nutrition: nutritionSection,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Goal sections (per PRD §3.1 item 3; acceptance #12)
// ─────────────────────────────────────────────────────────────────────────

async function buildGoalSections(
  goals: Array<{ id: string; objective: string; kind: string; createdAt: Date; targets: unknown }>,
  cutA: Date,
  cutB: Date,
): Promise<GoalCompareSection[]> {
  return Promise.all(
    goals.map(async (g) => {
      const targets = (g.targets as unknown as GoalTarget[] | null) ?? [];
      const createdAfterA = g.createdAt > cutA;

      if (targets.length === 0) {
        return { goalId: g.id, objective: g.objective, kind: g.kind, createdAfterA, readiness: null, targets: [] };
      }

      // v3 Fix 2: parallelize A/B readiness per goal — createdAfterA ⇒ skip
      // the A-side call entirely (computeReadiness runs EXACTLY ONCE for
      // this goal, acceptance #12), not twice-then-discard.
      const [snapshotB, snapshotA] = await Promise.all([
        computeReadiness(targets, cutB, g.id),
        createdAfterA ? Promise.resolve(null) : computeReadiness(targets, cutA, g.id),
      ]);

      const readiness = buildEntry({
        key: "readiness",
        label: "Readiness",
        units: "%",
        valueA: snapshotA?.score ?? null,
        valueB: snapshotB.score,
        direction: "increase",
      });

      // Match by target.metric per PRD/research — NOT by index (breakdown
      // order equals input order today, but metric matching is future-proof
      // and is what a reviewer will expect; research confirmed both work).
      const targetEntries = targets.map((t) => {
        const bA = snapshotA?.breakdown.find((b) => b.target.metric === t.metric);
        const bB = snapshotB.breakdown.find((b) => b.target.metric === t.metric);
        return buildEntry({
          key: `target:${t.metric}`,
          label: t.label,
          units: t.units,
          valueA: bA?.current ?? null,
          valueB: bB?.current ?? null,
          direction: t.direction, // already "increase"/"decrease" — no mapping needed
        });
      });

      return { goalId: g.id, objective: g.objective, kind: g.kind, createdAfterA, readiness, targets: targetEntries };
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Strength PRs (per PRD §3.1 item 4)
// ─────────────────────────────────────────────────────────────────────────

const UNITS_BY_KIND: Record<MetricKind, string> = {
  rm: "lb", reps: "reps", duration: "sec", distance: "mi", time: "sec",
};

/** Local re-implementation of records.ts's PRIVATE `metricValue` — NOT
 *  exported there, and this feature is instructed to reuse only
 *  canonicalExerciseName/bestSetSummary/metricKindFor/epley1RM (research
 *  §Risks item 3). See architecture-blueprint.md §8 Critical Decisions for
 *  why this 6-line function is duplicated rather than exporting records.ts's
 *  private helper. */
function valueForPrimary(
  s: { weightLb: number | null; reps: number | null; durationSec: number | null; distanceMi: number | null },
  primary: MetricKind,
): number | null {
  if (primary === "rm") return s.weightLb !== null && s.reps !== null ? epley1RM(s.weightLb, s.reps) : null;
  if (primary === "reps") return s.reps;
  if (primary === "duration" || primary === "time") return s.durationSec;
  if (primary === "distance") return s.distanceMi;
  return null;
}

async function buildStrengthEntries(cutA: Date, cutB: Date): Promise<CompareEntry[]> {
  // ONE query. Completed-only + startedAt<=cutB filter is required here —
  // getExerciseSummaries()/getExerciseHistory() do NOT filter by status
  // (research §Risks item 3) — do not reuse them.
  const exercises = await prisma.workoutExercise.findMany({
    where: { workout: { status: "completed", startedAt: { lte: cutB } } },
    include: { sets: true, workout: { select: { startedAt: true } } },
  });

  type SetRow = { weightLb: number | null; reps: number | null; durationSec: number | null; distanceMi: number | null };
  const byCanonical = new Map<string, { setsA: SetRow[]; setsB: SetRow[] }>();
  for (const ex of exercises) {
    const canonical = canonicalExerciseName(ex.name);
    const bucket = byCanonical.get(canonical) ?? { setsA: [], setsB: [] };
    for (const s of ex.sets) {
      bucket.setsB.push(s); // already bounded to cutB by the query
      if (ex.workout.startedAt <= cutA) bucket.setsA.push(s);
    }
    byCanonical.set(canonical, bucket);
  }

  const entries: CompareEntry[] = [];
  for (const [canonical, { setsA, setsB }] of byCanonical) {
    const summaryB = bestSetSummary(setsB, canonical);
    if (!summaryB) continue; // no usable metric at all for this exercise

    const summaryA = bestSetSummary(setsA, canonical); // [] → null, handles "no data at A"

    let valueA: number | null = null;
    if (summaryA) {
      if (summaryA.primary === summaryB.primary) {
        valueA = summaryA.value;
      } else {
        // Kind mismatch A vs B → recompute A using B's primary metric.
        const candidates = setsA
          .map((s) => valueForPrimary(s, summaryB.primary))
          .filter((v): v is number => v !== null);
        valueA = candidates.length === 0
          ? null // incomparable → newSinceA (buildEntry derives this from valueA===null)
          : summaryB.direction === "lower"
            ? Math.min(...candidates)
            : Math.max(...candidates);
      }
    }

    entries.push(buildEntry({
      key: `exercise:${canonical}`,
      label: canonical,
      units: UNITS_BY_KIND[summaryB.primary],
      valueA,
      valueB: summaryB.value,
      direction: directionForMetricKind(summaryB.direction),
    }));
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

// ─────────────────────────────────────────────────────────────────────────
// Baseline tests (per PRD §3.1 item 5)
// ─────────────────────────────────────────────────────────────────────────

function bestBaselineValue(rows: { value: number }[], direction: CompareDirection): number | null {
  if (rows.length === 0) return null;
  return direction === "decrease" ? Math.min(...rows.map((r) => r.value)) : Math.max(...rows.map((r) => r.value));
}

async function buildBaselineEntries(
  goalTargetsList: GoalTarget[][],
  cutA: Date,
  cutB: Date,
): Promise<CompareEntry[]> {
  const db = await getDb();
  // ONE query — direction-aware BEST-as-of (not latest), per PRD ("PR" semantics).
  const rows = await db.baseline.findMany({
    where: { date: { lte: cutB } },
    orderBy: { date: "asc" },
  });

  const byTestName = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byTestName.get(r.testName) ?? [];
    arr.push(r);
    byTestName.set(r.testName, arr);
  }

  const entries: CompareEntry[] = [];
  for (const [testName, testRows] of byTestName) {
    const rowsA = testRows.filter((r) => r.date <= cutA);

    // 3-try direction fallback chain (research §Risks item 12):
    //  1. metricKindFor(testName) → maps "higher"/"lower" → increase/decrease
    //  2. any active goal's `baseline:<testName>` target's direction (already increase/decrease)
    //  3. default "increase"
    const kind = metricKindFor(testName);
    let direction: CompareDirection;
    if (kind) {
      direction = directionForMetricKind(kind.direction);
    } else {
      const fallback = goalTargetsList.flat().find((t) => t.metric === `baseline:${testName}`);
      direction = fallback?.direction ?? "increase";
    }

    entries.push(buildEntry({
      key: `baseline:${testName}`,
      label: testName,
      units: testRows[0]!.units,
      valueA: bestBaselineValue(rowsA, direction),
      valueB: bestBaselineValue(testRows, direction),
      direction,
    }));
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

// ─────────────────────────────────────────────────────────────────────────
// Body & wearables (per PRD §3.1 item 6)
// ─────────────────────────────────────────────────────────────────────────

async function buildBodyEntries(
  goalTargetsList: GoalTarget[][],
  cutA: Date,
  cutB: Date,
): Promise<CompareEntry[]> {
  const db = await getDb();
  const weightDirection: CompareDirection =
    goalTargetsList.flat().find((t) => t.metric === "weightLb")?.direction ?? "neutral";

  const [measurements, bodyMetricRows] = await Promise.all([
    db.measurement.findMany({ where: { date: { lte: cutB } }, orderBy: { date: "desc" } }),
    // Tie-break EXACTLY matches get_body_metrics (tools.ts:2128): [{date:"desc"},{createdAt:"desc"}]
    db.bodyMetric.findMany({ where: { date: { lte: cutB } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
  ]);
  const measurementsA = measurements.filter((m) => m.date <= cutA);

  const weightB = measurements.find((m) => m.weightLb !== null)?.weightLb ?? null;
  const weightA = measurementsA.find((m) => m.weightLb !== null)?.weightLb ?? null;
  const bfB = measurements.find((m) => m.bodyFatPct !== null)?.bodyFatPct ?? null;
  const bfA = measurementsA.find((m) => m.bodyFatPct !== null)?.bodyFatPct ?? null;

  const entries: CompareEntry[] = [
    buildEntry({ key: "body:weightLb", label: "Body weight", units: "lb", valueA: weightA, valueB: weightB, direction: weightDirection }),
    buildEntry({ key: "body:bodyFatPct", label: "Body fat %", units: "%", valueA: bfA, valueB: bfB, direction: "decrease" }),
  ];

  // latest-per-key reduction — re-derived in-memory from the ONE already-
  // fetched row array (no second bodyMetric query for the A side).
  const latestPerKey = (rows: typeof bodyMetricRows) => {
    const seen = new Set<string>();
    const out = new Map<string, { value: number; unit: string | null }>();
    for (const row of rows) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      out.set(row.key, { value: row.value, unit: row.unit });
    }
    return out;
  };
  const byKeyB = latestPerKey(bodyMetricRows);
  const byKeyA = latestPerKey(bodyMetricRows.filter((r) => r.date <= cutA));

  // registry-keys-first, then ad-hoc alphabetical — matches get_body_metrics exactly.
  const registryKeys = BODY_METRICS.map((m) => m.key);
  const adHocKeys = [...byKeyB.keys()].filter((k) => !registryKeys.includes(k)).sort();
  const orderedKeys = [...registryKeys.filter((k) => byKeyB.has(k)), ...adHocKeys];

  for (const key of orderedKeys) {
    const latestB = byKeyB.get(key)!;
    const latestA = byKeyA.get(key) ?? null;
    const resolved = resolveBodyMetric(key, latestB.unit);
    entries.push(buildEntry({
      key: `body:${key}`, label: resolved.label, units: resolved.units,
      valueA: latestA?.value ?? null, valueB: latestB.value, direction: resolved.direction,
    }));
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────────────────
// Consistency counters (per PRD §3.1 item 7)
// ─────────────────────────────────────────────────────────────────────────

async function buildCountersSection(
  cutA: Date, cutB: Date, dateAKey: string, dateBKey: string,
): Promise<CountersSection> {
  const db = await getDb();
  const [
    workoutsBetween, hikesBetweenAgg, hikesBetweenCount, baselinesBetween, notesBetween,
    workoutCountA, workoutCountB, hikeAggA, hikeAggB,
    gameState,
  ] = await Promise.all([
    db.workout.count({ where: { status: "completed", startedAt: { gt: cutA, lte: cutB } } }),
    db.hike.aggregate({ _sum: { elevationFt: true, distanceMi: true }, where: { status: "completed", date: { gt: cutA, lte: cutB } } }),
    db.hike.count({ where: { status: "completed", date: { gt: cutA, lte: cutB } } }),
    db.baseline.count({ where: { date: { gt: cutA, lte: cutB } } }),
    // "notesLogged" = genuine activity notes only (journal/audible/feedback),
    // matching recent_history's ACTIVITY_NOTE_TYPES precedent (tools.ts) —
    // excludes standing_rule/review/open_item, which are coaching plumbing,
    // not "work done" (per CLAUDE.md: recent_history already excludes these).
    db.note.count({ where: { date: { gt: cutA, lte: cutB }, type: { in: ["journal", "audible", "feedback"] } } }),
    db.workout.count({ where: { status: "completed", startedAt: { lte: cutA } } }),
    db.workout.count({ where: { status: "completed", startedAt: { lte: cutB } } }),
    db.hike.aggregate({ _sum: { elevationFt: true, distanceMi: true }, where: { status: "completed", date: { lte: cutA } } }),
    db.hike.aggregate({ _sum: { elevationFt: true, distanceMi: true }, where: { status: "completed", date: { lte: cutB } } }),
    computeGameState(), // zero-args, React cache()-wrapped; always computes "now"'s full event history
  ]);

  let xpEarned = 0;
  let levelA: number | null = null;
  let levelB: number | null = null;
  if (gameState.goalKind !== null) {
    // xpAsOf: sum every event whose dateKey <= key (lexicographic — safe per PRD §4.5).
    const xpAsOf = (key: string) => gameState.events.filter((e) => e.dateKey <= key).reduce((s, e) => s + e.xp, 0);
    const xpA = xpAsOf(dateAKey);
    const xpB = xpAsOf(dateBKey);
    xpEarned = xpB - xpA;
    levelA = levelFromXp(xpA, OVERALL_LEVEL_BASE).level;
    levelB = levelFromXp(xpB, OVERALL_LEVEL_BASE).level;
  }
  // else: no active program → levelA/levelB stay null, xpEarned stays 0 (PRD §6).

  return {
    between: {
      workoutsCompleted: workoutsBetween,
      hikesCompleted: hikesBetweenCount,
      hikeElevationFt: hikesBetweenAgg._sum.elevationFt ?? 0,
      hikeDistanceMi: hikesBetweenAgg._sum.distanceMi ?? 0,
      baselineTestsLogged: baselinesBetween,
      notesLogged: notesBetween,
      xpEarned,
      levelA,
      levelB,
    },
    cumulative: [
      buildEntry({ key: "counter:workouts", label: "Workouts completed", units: "sessions", valueA: workoutCountA, valueB: workoutCountB, direction: "increase" }),
      buildEntry({ key: "counter:elevation", label: "Cumulative hike elevation", units: "ft", valueA: hikeAggA._sum.elevationFt ?? 0, valueB: hikeAggB._sum.elevationFt ?? 0, direction: "increase" }),
      buildEntry({ key: "counter:distance", label: "Cumulative hike distance", units: "mi", valueA: hikeAggA._sum.distanceMi ?? 0, valueB: hikeAggB._sum.distanceMi ?? 0, direction: "increase" }),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Nutrition (per PRD §3.1 item 8)
// ─────────────────────────────────────────────────────────────────────────

async function buildNutritionSection(dateAKey: string, dateBKey: string): Promise<NutritionCompareSection> {
  const db = await getDb();
  const WINDOW_DAYS = 7;

  const windowFor = (key: string) => ({
    start: startOfDay(addDays(parseDateKey(key), -(WINDOW_DAYS - 1))),
    end: endOfDay(parseDateKey(key)),
  });
  const winA = windowFor(dateAKey);
  const winB = windowFor(dateBKey);

  // Two small bounded queries (not one spanning-range query) — avoids
  // pulling a huge irrelevant middle range when A and B are far apart.
  const [rowsA, rowsB] = await Promise.all([
    db.nutritionLog.findMany({
      where: { date: { gte: winA.start, lte: winA.end } },
      select: { date: true, calories: true, proteinG: true, carbsG: true, fatG: true },
    }),
    db.nutritionLog.findMany({
      where: { date: { gte: winB.start, lte: winB.end } },
      select: { date: true, calories: true, proteinG: true, carbsG: true, fatG: true },
    }),
  ]);

  const bucket = (rows: typeof rowsA) => {
    const byDay = new Map<string, { calories: number; proteinG: number; carbsG: number; fatG: number }>();
    for (const r of rows) {
      // USER_TZ bucket via toDateKey — NEVER raw UTC date parts (matches
      // get_nutrition_history's 00:30Z → prior Denver day precedent).
      const key = toDateKey(r.date);
      const day = byDay.get(key) ?? { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
      day.calories += r.calories ?? 0;
      day.proteinG += r.proteinG ?? 0;
      day.carbsG += r.carbsG ?? 0;
      day.fatG += r.fatG ?? 0;
      byDay.set(key, day);
    }
    const daysLogged = byDay.size;
    if (daysLogged === 0) return { daysLogged, avg: null as null | Record<"calories" | "proteinG" | "carbsG" | "fatG", number> };
    const totals = [...byDay.values()].reduce(
      (acc, d) => ({
        calories: acc.calories + d.calories, proteinG: acc.proteinG + d.proteinG,
        carbsG: acc.carbsG + d.carbsG, fatG: acc.fatG + d.fatG,
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
    return {
      daysLogged,
      avg: {
        calories: totals.calories / daysLogged,
        proteinG: totals.proteinG / daysLogged,
        carbsG: totals.carbsG / daysLogged,
        fatG: totals.fatG / daysLogged,
      },
    };
  };

  const a = bucket(rowsA);
  const b = bucket(rowsB);

  const entries: CompareEntry[] = [
    // Calories/carbs/fat: "neutral" — cutting vs. bulking makes "more/less
    // is better" a diet-phase judgment the app can't assert. Protein:
    // "increase" — conventional muscle-retention heuristic, matches PRD
    // mockup's "Protein 121g → 168g +47 ✓" (only row shown with a checkmark).
    buildEntry({ key: "nutrition:calories", label: "Calories", units: "kcal", valueA: a.avg?.calories ?? null, valueB: b.avg?.calories ?? null, direction: "neutral" }),
    buildEntry({ key: "nutrition:protein", label: "Protein", units: "g", valueA: a.avg?.proteinG ?? null, valueB: b.avg?.proteinG ?? null, direction: "increase" }),
    buildEntry({ key: "nutrition:carbs", label: "Carbs", units: "g", valueA: a.avg?.carbsG ?? null, valueB: b.avg?.carbsG ?? null, direction: "neutral" }),
    buildEntry({ key: "nutrition:fat", label: "Fat", units: "g", valueA: a.avg?.fatG ?? null, valueB: b.avg?.fatG ?? null, direction: "neutral" }),
  ];

  return { windowDays: WINDOW_DAYS, daysLoggedA: a.daysLogged, daysLoggedB: b.daysLogged, entries };
}

// ─────────────────────────────────────────────────────────────────────────
// hasAnyDataA
// ─────────────────────────────────────────────────────────────────────────

function computeHasAnyDataA(
  goalsSection: GoalCompareSection[],
  strengthEntries: CompareEntry[],
  baselineEntries: CompareEntry[],
  bodyEntries: CompareEntry[],
  countersSection: CountersSection,
  nutritionSection: NutritionCompareSection,
): boolean {
  const goalHasA = goalsSection.some(
    (g) => (g.readiness?.valueA ?? null) !== null || g.targets.some((t) => t.valueA !== null),
  );
  const strengthHasA = strengthEntries.some((e) => e.valueA !== null);
  const baselineHasA = baselineEntries.some((e) => e.valueA !== null);
  const bodyHasA = bodyEntries.some((e) => e.valueA !== null);
  // Cumulative counters ALWAYS have a numeric valueA (0 when no workouts
  // logged yet) — exclude the trivial "0 as of A" case so it doesn't falsely
  // flip hasAnyDataA to true.
  const cumulativeHasA = countersSection.cumulative.some((e) => e.valueA !== null && e.valueA !== 0);
  const nutritionHasA = nutritionSection.daysLoggedA > 0;
  return goalHasA || strengthHasA || baselineHasA || bodyHasA || cumulativeHasA || nutritionHasA;
}
