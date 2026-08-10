// src/lib/progress-program.ts
//
// Server assembly for the /progress Program extension (#292): one live
// readiness arc per active Program member goal, frozen completionSnapshot
// arcs for achieved members still attached to the Program, and a per-metric
// Program-window series for every DISTINCT target metric across the active
// member goals (docs/ux-research/program-views.md §7.4).
//
// R9 (binding): the achieved branch below NEVER calls computeReadiness /
// computeReadinessSeriesSampled — it parses the frozen completionSnapshot
// exactly like goal-story.ts's achieved branch (that file, and compare.ts's
// existing R9 exemption, are read-only references here — not modified).
//
// Readiness math is CONSUMED, not modified: live member arcs go through the
// same computeReadiness / computeReadinessSeriesSampled path /program and
// the goal's own page use, so the numbers stay byte-identical for the same
// inputs. Sampling knobs per UXR-PV-52 (⚠ tuning): maxPoints 26 [20–52],
// batchSize 4 (down from the default 8 so N member goals don't thrash the
// connection pool).

import { dateKey, endOfDay, startOfDay } from "@/lib/calendar";
import { getDb } from "@/lib/db";
import { getActiveProgramMembership } from "@/lib/program";
import { parseCompletionSnapshot } from "@/lib/goal-completion-core";
import {
  computeReadiness,
  computeReadinessSeriesSampled,
  type TargetProgress,
} from "@/lib/readiness";
import { getBaselineHistory } from "@/lib/records";
import { getLogMetricSeries } from "@/lib/metric-series";
import { METRIC_BY_ID } from "@/lib/metrics-registry";
import type { GoalTarget } from "@/lib/goal-targets";

export const PROGRESS_SERIES_MAX_POINTS = 26; // UXR-PV-52 ⚠[20–52]
export const PROGRESS_SERIES_BATCH_SIZE = 4; // UXR-PV-52: default 8 → 3–4 per goal

/** One member goal's arc card — live (active) or frozen (achieved, R9). */
export type MemberGoalArc = {
  goal: {
    id: string;
    objective: string;
    kind: string;
    status: string;
    targetDate: string | null; // ISO
  };
  mode: "live" | "frozen";
  score: number | null;
  /** Live only — null on the frozen branch (a completed goal's gates are moot). */
  coverage: { tested: number; total: number } | null;
  openGateCount: number | null;
  /** {date, score} — ISO or dateKey strings; both parse via new Date(). */
  series: { date: string; score: number }[];
  /** Frozen only: the completionSnapshot's completedDateKey. */
  frozenAsOf: string | null;
  /** Live only — feeds ReadinessBreakdown; [] on the frozen branch. */
  breakdown: TargetProgress[];
  missingCount: number;
  targetsTotal: number;
};

/** One goal's stake in a metric — computed from the goal's own live
 *  readiness breakdown (0 extra queries; §7.4 "Data"). */
export type MetricClaim = {
  goalId: string;
  objective: string;
  target: number;
  start: number | null;
  current: number | null;
  progress: number | null;
  weight: number;
  direction: "increase" | "decrease";
  gating: boolean;
  /** start === target — a hold-the-line target. Cliff semantics: full credit
   *  at the floor, zero below it (UXR-PV-27/45 — status readout, never a bar). */
  maintenance: boolean;
};

export type ProgramMetricRow = {
  metricKey: string;
  label: string;
  units: string;
  /**
   * Program-window series points, or null when no shipped history helper
   * exists for this metric family (hike:* aggregates, workout:count,
   * exercise:*) — those rows render headline numbers only.
   */
  points: { date: string; value: number }[] | null;
  claims: MetricClaim[];
  /** One reference line per claiming goal (task brief: ReferenceLine each). */
  targetLines: { value: number; label: string }[];
};

export type ProgressProgramData = {
  program: {
    name: string;
    startedOnKey: string;
    endsOnKey: string | null;
    /** min(endsOn, today) — the per-metric window's right edge. */
    windowEndKey: string;
  };
  memberGoalIds: string[];
  arcs: MemberGoalArc[];
  metrics: ProgramMetricRow[];
};

/**
 * Pure: the active goals that keep rendering through the existing
 * readiness-by-goal loop. memberIds === null (no active Program) returns the
 * INPUT ARRAY REFERENCE untouched — the zero-Program /progress render stays
 * byte-identical (#292 regression AC).
 */
export function nonMemberGoals<T extends { id: string }>(
  goals: T[],
  memberIds: string[] | null,
): T[] {
  if (memberIds === null) return goals;
  const members = new Set(memberIds);
  return goals.filter((g) => !members.has(g.id));
}

// Defensive shape guard for Goal.targets (Json) — same hand-copied guard as
// goal-story.ts / rarity.ts parseTargets (repo convention: mirror, don't
// introduce a new cross-file dependency).
function parseGoalTargets(raw: unknown): GoalTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is GoalTarget =>
      t !== null &&
      typeof t === "object" &&
      typeof (t as Record<string, unknown>).metric === "string" &&
      typeof (t as Record<string, unknown>).label === "string" &&
      typeof (t as Record<string, unknown>).units === "string" &&
      typeof (t as Record<string, unknown>).direction === "string" &&
      typeof (t as Record<string, unknown>).target === "number" &&
      typeof (t as Record<string, unknown>).weight === "number",
  );
}

/** Pure: shape a metric claim from a goal's readiness breakdown row. */
export function claimFromBreakdown(
  goalId: string,
  objective: string,
  b: TargetProgress,
): MetricClaim {
  return {
    goalId,
    objective,
    target: b.target.target,
    start: b.start,
    current: b.current,
    progress: b.progress,
    weight: b.target.weight,
    direction: b.target.direction,
    gating: b.target.gating === true,
    maintenance: b.start !== null && b.start === b.target.target,
  };
}

/**
 * Pure: group the active member goals' breakdown rows into per-metric rows —
 * one row per DISTINCT metric key, claims in member order. Points are filled
 * in by the async resolver afterwards.
 */
export function groupMetricRows(
  liveGoals: {
    goalId: string;
    objective: string;
    breakdown: TargetProgress[];
  }[],
): (ProgramMetricRow & { firstClaim: { goalId: string; target: GoalTarget } })[] {
  const rows = new Map<
    string,
    ProgramMetricRow & { firstClaim: { goalId: string; target: GoalTarget } }
  >();
  for (const g of liveGoals) {
    for (const b of g.breakdown) {
      const key = b.target.metric;
      let row = rows.get(key);
      if (!row) {
        const spec = METRIC_BY_ID.get(key);
        row = {
          metricKey: key,
          label: spec?.label ?? b.target.label,
          units: spec?.units ?? b.target.units,
          points: null,
          claims: [],
          targetLines: [],
          firstClaim: { goalId: g.goalId, target: b.target },
        };
        rows.set(key, row);
      }
      row.claims.push(claimFromBreakdown(g.goalId, g.objective, b));
      row.targetLines.push({ value: b.target.target, label: g.objective });
    }
  }
  return [...rows.values()];
}

/**
 * Program-window series for one metric, via the shipped history helpers only
 * (task brief: resolve series where helpers exist — measurements for
 * weightLb/bodyFatPct, getBaselineHistory for baseline:*, getLogMetricSeries
 * for log:*). Everything else → null (headline-only row).
 */
async function resolveWindowSeries(
  metricKey: string,
  firstClaim: { goalId: string; target: GoalTarget },
  windowStart: Date,
  windowEnd: Date,
): Promise<{ date: string; value: number }[] | null> {
  const gte = startOfDay(windowStart);
  const lte = endOfDay(windowEnd);

  if (metricKey === "weightLb" || metricKey === "bodyFatPct") {
    const db = await getDb();
    const rows = await db.measurement.findMany({
      where: { date: { gte, lte }, [metricKey]: { not: null } },
      orderBy: { date: "asc" },
      select: { date: true, weightLb: true, bodyFatPct: true },
    });
    return rows.map((r) => ({
      date: r.date.toISOString(),
      value: (metricKey === "weightLb" ? r.weightLb : r.bodyFatPct)!,
    }));
  }

  if (metricKey.startsWith("baseline:")) {
    const history = await getBaselineHistory(metricKey.slice("baseline:".length));
    return history
      .filter((h) => h.date >= gte && h.date <= lte)
      .map((h) => ({ date: h.date.toISOString(), value: h.value }));
  }

  if (metricKey.startsWith("log:")) {
    const series = await getLogMetricSeries(firstClaim.target, firstClaim.goalId);
    const startKey = dateKey(windowStart);
    const endKey = dateKey(windowEnd);
    return series.points
      .filter((p) => {
        const k = dateKey(new Date(p.date));
        return k >= startKey && k <= endKey;
      })
      .map((p) => ({ date: p.date, value: p.value }));
  }

  return null; // hike:* / workout:count / exercise:* — no shipped series helper
}

/**
 * Full assembly. Returns null when the user has no active Program (or an
 * active Program with zero renderable member goals) — the /progress page
 * then renders exactly its pre-#292 markup.
 */
export async function getProgressProgramData(
  now: Date = new Date(),
): Promise<ProgressProgramData | null> {
  const membership = await getActiveProgramMembership();
  if (!membership) return null;

  // Defensive status filter (program.ts type doc): render active + achieved
  // members; skip abandoned rows rather than surfacing them.
  const renderable = membership.memberGoals.filter(
    (m) => m.status === "active" || m.status === "achieved",
  );
  if (renderable.length === 0) return null;

  const db = await getDb();
  const goalRows = await db.goal.findMany({
    where: { id: { in: renderable.map((m) => m.id) } },
    select: {
      id: true,
      objective: true,
      kind: true,
      status: true,
      targetDate: true,
      createdAt: true,
      completedAt: true,
      targets: true,
      completionSnapshot: true,
    },
  });
  const byId = new Map(goalRows.map((g) => [g.id, g]));
  const ordered = renderable
    .map((m) => byId.get(m.id))
    .filter((g): g is NonNullable<typeof g> => g !== undefined);

  const windowStart = membership.startedOn;
  const windowEnd =
    membership.endsOn && membership.endsOn.getTime() < now.getTime()
      ? membership.endsOn
      : now;

  const arcs: MemberGoalArc[] = [];
  const liveGoals: { goalId: string; objective: string; breakdown: TargetProgress[] }[] = [];

  for (const g of ordered) {
    const goalLite = {
      id: g.id,
      objective: g.objective,
      kind: g.kind,
      status: g.status,
      targetDate: g.targetDate ? g.targetDate.toISOString() : null,
    };

    if (g.status === "achieved") {
      // ── R9: frozen only — never live-compute for an achieved goal ────────
      // (mirrors goal-story.ts's achieved branch; degraded parse falls back
      // to null/empty, never a recompute.)
      const snap = parseCompletionSnapshot(g.completionSnapshot);
      arcs.push({
        goal: goalLite,
        mode: "frozen",
        score: snap?.readiness?.score ?? null,
        coverage: null,
        openGateCount: null,
        series: (snap?.readinessSeries ?? []).map((p) => ({
          date: p.dateKey,
          score: p.score,
        })),
        frozenAsOf:
          snap?.completedDateKey ?? (g.completedAt ? dateKey(g.completedAt) : null),
        breakdown: [],
        missingCount: 0,
        targetsTotal: snap?.targetsTotal ?? 0,
      });
      continue;
    }

    // ── Live member goal ────────────────────────────────────────────────────
    const targets = parseGoalTargets(g.targets);
    if (targets.length === 0) {
      arcs.push({
        goal: goalLite,
        mode: "live",
        score: null,
        coverage: null,
        openGateCount: null,
        series: [],
        frozenAsOf: null,
        breakdown: [],
        missingCount: 0,
        targetsTotal: 0,
      });
      continue;
    }

    // UXR-PV-51: clamp the series domain to max(goalCreatedAt, program start)
    // — a member goal predating the Program keeps its pre-Program arc off
    // this Program-scoped surface.
    const seriesStart =
      g.createdAt.getTime() > windowStart.getTime() ? g.createdAt : windowStart;

    const [snapshot, series] = await Promise.all([
      computeReadiness(targets, now, g.id),
      computeReadinessSeriesSampled(seriesStart, targets, now, g.id, {
        maxPoints: PROGRESS_SERIES_MAX_POINTS,
        batchSize: PROGRESS_SERIES_BATCH_SIZE,
      }),
    ]);

    liveGoals.push({ goalId: g.id, objective: g.objective, breakdown: snapshot.breakdown });
    arcs.push({
      goal: goalLite,
      mode: "live",
      score: snapshot.score,
      coverage: snapshot.coverage,
      openGateCount: snapshot.openGateCount,
      series: series.map((p) => ({ date: p.weekEnd.toISOString(), score: p.score })),
      frozenAsOf: null,
      breakdown: snapshot.breakdown,
      missingCount: snapshot.missing.length,
      targetsTotal: targets.length,
    });
  }

  // ── Per-metric rows: DISTINCT metric across active member goals ──────────
  const grouped = groupMetricRows(liveGoals);
  const metrics: ProgramMetricRow[] = [];
  for (const row of grouped) {
    const { firstClaim, ...rest } = row;
    metrics.push({
      ...rest,
      points: await resolveWindowSeries(row.metricKey, firstClaim, windowStart, windowEnd),
    });
  }

  return {
    program: {
      name: membership.name,
      startedOnKey: dateKey(membership.startedOn),
      endsOnKey: membership.endsOn ? dateKey(membership.endsOn) : null,
      windowEndKey: dateKey(windowEnd),
    },
    memberGoalIds: ordered.map((g) => g.id),
    arcs,
    metrics,
  };
}
