// src/lib/progress-data.ts
//
// The /progress assembler — everything the "Frequency Stack, Ruled" page
// renders, built on the As-Of Snapshot Table (progress-asof.ts) so the whole
// page costs a fixed handful of bounded scans instead of a per-cursor
// fan-out (report §4.6: legacy ~956 → ~12 issued; 3-member Program ~445 →
// ~14; measured numbers pinned by progress-data.test.ts).
//
// Three tenant shapes (report §4.2):
//   Z zero-row  — no active goals: hero + records zero-state + EmptyState.
//   L legacy    — goals, no Program: the SAME stack, minus Program-only keys.
//     Nothing structural is lost; the stack just gets shorter (the
//     direction's central claim — and the zero-Program tenant now gets the
//     sampled-cursor treatment instead of the unsampled serial series, A15).
//   P program   — member strips + band + metrics lid + (gated) effort.
//
// R9: achieved members are FROZEN — parseCompletionSnapshot only, never a
// recompute. UXR-PV-51: a member's series domain clamps to max(createdAt,
// program start).
//
// Server-only.

import { addDays, endOfDay, startOfDay, startOfWeekMonday, USER_TZ } from "@/lib/calendar-core";
import { getDb } from "@/lib/db";
import { getActiveProgram, getActiveProgramMembership } from "@/lib/program";
import { getRotationOwnerGoal } from "@/lib/goal-focus";
import { parseCompletionSnapshot } from "@/lib/goal-completion-core";
import { assignGoalIdentities, type GoalIdentity } from "@/lib/goal-identity";
import { computeReadiness, type ReadinessSnapshot } from "@/lib/readiness";
import {
  buildAsOfTable,
  buildCurrentOverrides,
  buildStartOverrides,
  type AsOfTable,
} from "@/lib/progress-asof";
import {
  groupMetricRows,
  nonMemberGoals,
  resolveProgressPrimaryGoals,
  PROGRESS_SERIES_MAX_POINTS,
  type ProgramMetricRow,
} from "@/lib/progress-program";
import {
  baselineSummariesFromRows,
  getBaselineScheduleForPlan,
  canonicalExerciseName,
  type ScheduledBaseline,
  type CheckpointStatus,
} from "@/lib/records";
import {
  buildRecordsFeed,
  derivePrEvents,
  type RecordFeedItem,
} from "@/lib/progress-records";
import {
  rollingMatrix,
  rollingParamsFromTargets,
  type RollingSlot,
} from "@/lib/rolling-metrics";
import { BODY_METRICS, resolveBodyMetric, ROLLING_DEFAULT_WINDOW } from "@/lib/metrics-registry";
import type { GoalTarget, RollingParams } from "@/lib/goal-targets";
import type { ProgramTemplate } from "@/lib/program-template";
import type { GoalStripModel } from "@/components/progress/GoalStrip";
import type { SeamStripTrack } from "@/components/progress/SeamStrip";
import type { NextReading } from "@/components/progress/NextReadings";
import type { BaselineCardRow } from "@/components/progress/BaselinesCard";
import type { BodyCompositionModel } from "@/components/progress/BodyCompositionCard";
import type { BodyMetricLidRow } from "@/components/progress/BodyMetricsLid";
import type { MilestoneModel } from "@/components/progress/MilestoneCard";
import type { ProgramBlockSegment } from "@/components/program/ProgramBlockBand";

export type EffortRow = { id: string; label: string; xp: number };
export type EffortModel = {
  rows: EffortRow[];
  windowStartKey: string;
  windowEndKey: string;
};

export type SeamStripData = {
  goalId: string;
  exercise: string;
  window: number;
  slots: RollingSlot[];
  tracks: SeamStripTrack[];
  untimedSessionCount: number;
  retestWeeks: number[] | null;
};

export type ProgressPageData = {
  shape: "zero" | "legacy" | "program";
  now: Date;
  hero: {
    contextLine: string | null;
    showProgramPill: boolean;
  };
  band: {
    blocks: ProgramBlockSegment[];
    caption: string | null;
    dayNumber: number | null;
    srBlockLine: string | null;
  } | null;
  seamStrip: SeamStripData | null;
  goalStrips: { identity: GoalIdentity | null; model: GoalStripModel }[];
  nextReadings: NextReading[];
  recordsFeed: RecordFeedItem[];
  /** Stage-4 gated (UXR-PROG-44 ⚑: ships only with the perf spine's PR). */
  effort: EffortModel | null;
  baselines: { rows: BaselineCardRow[]; totalScheduled: number | null } | null;
  bodyComposition: BodyCompositionModel | null;
  metrics: ProgramMetricRow[];
  bodyMetrics: BodyMetricLidRow[];
  project: { goalId: string; mrr: { date: string; value: number; tooltip: string }[] | null } | null;
  milestone: MilestoneModel | null;
};

// ── The 18-key manifest, literal source order (UXR-PROG-47) ─────────────────
// No priority field, no runtime sort — presence predicates only. The page
// maps keys to nodes in this exact order; this pure derivation exists so the
// order + predicates are unit-testable without rendering.
export function manifestKeys(d: ProgressPageData): string[] {
  const keys: string[] = [];
  const push = (k: string, present: boolean) => {
    if (present) keys.push(k);
  };

  push("hero", true);
  // Sections counted for the jump row: keys 3–16 that will render.
  const sectionCount =
    Number(d.band !== null) +
    Number(d.seamStrip !== null) +
    d.goalStrips.length +
    Number(d.nextReadings.length > 0) +
    1 + // records always renders
    Number(d.effort !== null) +
    Number(d.baselines !== null) +
    Number(d.bodyComposition !== null) +
    Number(d.metrics.length > 0) +
    Number(d.bodyMetrics.length > 0) +
    Number(d.project !== null) +
    Number(d.milestone !== null);
  push("jump", d.shape !== "zero" && sectionCount >= 5);
  push("program-band", d.band !== null);
  push("rule-repeatability", d.seamStrip !== null); // mirrors key 5 — a rule may never point at emptiness
  push("repeatability", d.seamStrip !== null);
  for (const s of d.goalStrips) push(`goal-strip-${s.model.goal.id}`, true);
  push("next-readings", d.nextReadings.length > 0);
  push("records", true); // always — the zero-state is honest
  push("rule-effort", d.effort !== null); // mirrors key 10
  push("effort", d.effort !== null);
  push("baselines", d.baselines !== null);
  push("body-composition", d.bodyComposition !== null);
  push("metrics", d.metrics.length > 0);
  push("body-metrics", d.bodyMetrics.length > 0);
  push("burn-down", d.project !== null);
  push("milestone", d.milestone !== null);
  // recap-cta: manifest-is-non-empty — a zero-row invited user must not get
  // an export CTA above the coach pointer (fixes A14 in miniature).
  push("recap-cta", d.shape !== "zero");
  push("empty", d.shape === "zero");
  return keys;
}

// ── Series cursors (mirrors computeReadinessSeriesSampled's stepping) ───────
export function seriesCursors(start: Date, until: Date, maxPoints: number): Date[] {
  const cursors: Date[] = [];
  const first = addDays(startOfWeekMonday(start), 6); // first Sunday end
  let cursor = first;
  while (cursor <= until) {
    cursors.push(new Date(cursor));
    cursor = addDays(cursor, 7);
  }
  if (cursors.length === 0 || cursors.at(-1)!.getTime() < until.getTime() - 24 * 3600 * 1000) {
    cursors.push(new Date(until));
  }
  if (cursors.length > maxPoints) {
    const stride = Math.ceil(cursors.length / maxPoints);
    const sampled = cursors.filter((_, i) => i % stride === 0);
    if (sampled.at(-1)!.getTime() !== cursors.at(-1)!.getTime()) sampled.push(cursors.at(-1)!);
    return sampled;
  }
  return cursors;
}

/** Σ(w·p)/Σ(w) over TESTED targets only (UXR-PV-25). Null when none tested. */
export function measuredScoreOf(snapshot: ReadinessSnapshot): number | null {
  const tested = snapshot.breakdown.filter((b) => b.progress !== null);
  const wsum = tested.reduce((s, b) => s + (b.target.weight ?? 0), 0);
  if (tested.length === 0 || wsum === 0) return null;
  const weighted = tested.reduce((s, b) => s + (b.target.weight ?? 0) * (b.progress ?? 0), 0);
  return Math.round((weighted / wsum) * 100);
}

// Defensive Goal.targets shape guard (repo convention: mirror, don't import
// across module seams — same guard as progress-program.ts / rarity.ts).
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

type GoalRow = {
  id: string;
  objective: string;
  kind: string;
  status: string;
  isFocus: boolean;
  targetDate: Date | null;
  createdAt: Date;
  legend: unknown;
  targets: unknown;
  completionSnapshot: unknown;
};

/** Evaluate one live goal through the table: snapshot at now + score series. */
async function evaluateGoal(
  table: AsOfTable,
  goal: { id: string; targets: GoalTarget[] },
  seriesStart: Date,
  now: Date,
): Promise<{ snapshot: ReadinessSnapshot; series: number[] }> {
  const startOverrides = buildStartOverrides(table, goal);
  const cursors = seriesCursors(seriesStart, now, PROGRESS_SERIES_MAX_POINTS);
  const series: number[] = [];
  for (const c of cursors) {
    // Hazard B: currentOverrides rebuilt for EVERY cursor.
    const snap = await computeReadiness(goal.targets, c, goal.id, {
      currentOverrides: buildCurrentOverrides(table, goal, c),
      startOverrides,
    });
    series.push(snap.score);
  }
  const snapshot = await computeReadiness(goal.targets, now, goal.id, {
    currentOverrides: buildCurrentOverrides(table, goal, now),
    startOverrides,
  });
  return { snapshot, series };
}

/** The rolling targets of one goal grouped into ONE strip (same canonical
 *  exercise + window — the rollingMatrix merge guard). First group wins;
 *  a second distinct group is a future second strip, not a merge. */
export function stripTracksFor(goal: { targets: GoalTarget[] }): {
  exercise: string;
  window: number;
  tracks: { target: GoalTarget; params: RollingParams }[];
} | null {
  const rolling = goal.targets
    .map((t) => ({ target: t, params: t.metric.startsWith("rolling:") ? rollingParamsFromTargets(goal.targets, t.metric) : null }))
    .filter((x): x is { target: GoalTarget; params: RollingParams } => x.params !== null);
  if (rolling.length === 0) return null;
  const anchor = rolling[0]!.params;
  const exercise = canonicalExerciseName(anchor.exercise);
  const window = anchor.window ?? ROLLING_DEFAULT_WINDOW;
  const tracks = rolling
    .filter(
      (r) =>
        canonicalExerciseName(r.params.exercise) === exercise &&
        (r.params.window ?? ROLLING_DEFAULT_WINDOW) === window,
    )
    // Shallowest → deepest: the nested ladder order (minSeconds, then
    // hitsPerSession) — column rungs derive from this order.
    .sort(
      (a, b) =>
        a.params.minSeconds - b.params.minSeconds ||
        (a.params.hitsPerSession ?? 1) - (b.params.hitsPerSession ?? 1),
    );
  return { exercise, window, tracks };
}

/** Retest weeks for the strip's R24 footer — the plan template's baseline
 *  test whose canonical name matches the strip's exercise. */
export function retestWeeksFor(template: ProgramTemplate | null, exercise: string): number[] | null {
  if (!template?.baselineWeek) return null;
  const canonical = canonicalExerciseName(exercise);
  for (const day of template.baselineWeek) {
    for (const test of day.tests) {
      if (canonicalExerciseName(test.testName) === canonical) {
        const weeks = (test.retestWeeks ?? []).filter((w) => w > (test.initialWeek ?? 1));
        return weeks.length > 0 ? weeks : null;
      }
    }
  }
  return null;
}

function nextCheckpointOf(s: ScheduledBaseline) {
  return (
    s.checkpoints.find((c) => c.status === "overdue" || c.status === "due") ??
    s.checkpoints.find((c) => c.status === "upcoming") ??
    null
  );
}

export async function getProgressPageData(now: Date = new Date()): Promise<ProgressPageData> {
  const db = await getDb();

  // ── Resolution (cache()-deduped seams) ────────────────────────────────────
  const [resolution, membership, plan] = await Promise.all([
    getRotationOwnerGoal(),
    getActiveProgramMembership(),
    getActiveProgram(),
  ]);

  const activeGoals = (await db.goal.findMany({
    where: { active: true },
    orderBy:
      resolution.mode === "program"
        ? [{ targetDate: { sort: "asc", nulls: "last" } }]
        : [{ isFocus: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
    select: {
      id: true,
      objective: true,
      kind: true,
      status: true,
      isFocus: true,
      targetDate: true,
      createdAt: true,
      legend: true,
      targets: true,
      completionSnapshot: true,
    },
  })) as GoalRow[];

  const renderableMembers =
    membership?.memberGoals.filter((m) => m.status === "active" || m.status === "achieved") ?? [];
  const isProgram = membership !== null && renderableMembers.length > 0;

  // Member rows come from the goal table too (achieved members are inactive —
  // fetch any member rows the active list missed).
  const activeById = new Map(activeGoals.map((g) => [g.id, g]));
  const missingMemberIds = renderableMembers.map((m) => m.id).filter((id) => !activeById.has(id));
  const extraMemberRows =
    missingMemberIds.length > 0
      ? ((await db.goal.findMany({
          where: { id: { in: missingMemberIds } },
          select: {
            id: true,
            objective: true,
            kind: true,
            status: true,
            isFocus: true,
            targetDate: true,
            createdAt: true,
            legend: true,
            targets: true,
            completionSnapshot: true,
          },
        })) as GoalRow[])
      : [];
  const goalById = new Map([...activeGoals, ...extraMemberRows].map((g) => [g.id, g]));

  const shape: ProgressPageData["shape"] =
    isProgram ? "program" : activeGoals.length > 0 ? "legacy" : "zero";

  // Z short-circuit: the zero-row invited user's page is hero + the records
  // zero-state (NO numeral — the R11 carve-out: nothing was computed, so no
  // count is claimed) + the EmptyState. No scans, no feed, no zeros.
  if (shape === "zero") {
    return {
      shape,
      now,
      hero: { contextLine: null, showProgramPill: false },
      band: null,
      seamStrip: null,
      goalStrips: [],
      nextReadings: [],
      recordsFeed: [],
      effort: null,
      baselines: null,
      bodyComposition: null,
      metrics: [],
      bodyMetrics: [],
      project: null,
      milestone: null,
    };
  }

  // ── Which goals get strips, in which order ────────────────────────────────
  // P: members in membership order (identity slots), then non-member actives.
  // L: active goals as fetched. Z: none.
  const memberRows = renderableMembers
    .map((m) => goalById.get(m.id))
    .filter((g): g is GoalRow => g !== undefined);
  const stripGoals: GoalRow[] =
    shape === "program"
      ? [...memberRows, ...nonMemberGoals(activeGoals, renderableMembers.map((m) => m.id))]
      : shape === "legacy"
        ? activeGoals
        : [];

  const identities = assignGoalIdentities(
    (shape === "program" ? memberRows : stripGoals).map((g) => ({
      id: g.id,
      objective: g.objective,
      kind: g.kind,
      status: g.status,
      isFocus: g.isFocus,
      createdAt: g.createdAt,
      legend: g.legend,
    })),
  );
  const identityById = new Map(identities.map((i) => [i.goalId, i]));

  // ── The As-Of table: the page's metric families in ≤6 bounded scans ──────
  const liveGoals = stripGoals
    .filter((g) => g.status === "active")
    .map((g) => ({ id: g.id, targets: parseGoalTargets(g.targets) }));
  const table = await buildAsOfTable({
    goals: liveGoals,
    until: now,
    includeWorkoutScan: true, // the PR feed reads it even with no rolling targets
  });

  // ── Primary-goal gates (rotation owner / legacy focus) ────────────────────
  const { primaryGoal, primaryProjectGoal } = resolveProgressPrimaryGoals(
    stripGoals.map((g) => ({ id: g.id, kind: g.kind, isFocus: g.isFocus })),
    resolution,
  );
  const primaryRow = primaryGoal ? (goalById.get(primaryGoal.id) ?? null) : null;
  const primaryTargets = primaryRow ? parseGoalTargets(primaryRow.targets) : [];

  // ── Goal strips ────────────────────────────────────────────────────────────
  const programStart = membership?.startedOn ?? null;
  const goalStrips: ProgressPageData["goalStrips"] = [];
  for (const g of stripGoals) {
    const identity = identityById.get(g.id) ?? null;
    const base = {
      id: g.id,
      objective: g.objective,
      kind: g.kind,
      status: g.status,
      targetDate: g.targetDate,
    };
    if (g.status === "achieved") {
      // R9: frozen — parse, never recompute.
      const snap = parseCompletionSnapshot(g.completionSnapshot);
      goalStrips.push({
        identity,
        model: {
          goal: base,
          mode: "frozen",
          snapshot: null,
          series: (snap?.readinessSeries ?? []).map((p) => p.score),
          frozenScore: snap?.readiness?.score ?? null,
          frozenAsOfKey: snap?.completedDateKey ?? null,
          measuredScore: null,
        },
      });
      continue;
    }
    const targets = parseGoalTargets(g.targets);
    if (targets.length === 0) {
      goalStrips.push({
        identity,
        model: {
          goal: base,
          mode: "live",
          snapshot: null,
          series: null,
          frozenScore: null,
          frozenAsOfKey: null,
          measuredScore: null,
        },
      });
      continue;
    }
    // UXR-PV-51: clamp a member's series domain to the Program window.
    const seriesStart =
      programStart !== null && g.createdAt.getTime() < programStart.getTime() && shape === "program"
        ? programStart
        : g.createdAt;
    const { snapshot, series } = await evaluateGoal(table, { id: g.id, targets }, seriesStart, now);
    goalStrips.push({
      identity,
      model: {
        goal: base,
        mode: "live",
        snapshot,
        series,
        frozenScore: null,
        frozenAsOfKey: null,
        measuredScore: measuredScoreOf(snapshot),
      },
    });
  }

  // ── The Seam Strip (primary goal's rolling family) ────────────────────────
  let seamStrip: SeamStripData | null = null;
  if (primaryRow && primaryRow.status === "active") {
    const grouped = stripTracksFor({ targets: primaryTargets });
    if (grouped) {
      const matrix = rollingMatrix(
        table.workouts,
        grouped.exercise,
        grouped.window,
        grouped.tracks.map((t) => t.params),
      );
      const hitsByParams = new Map(matrix.rows.map((r) => [r.params, r.hits]));
      seamStrip = {
        goalId: primaryRow.id,
        exercise: grouped.exercise,
        window: grouped.window,
        slots: matrix.sessions,
        tracks: grouped.tracks.map((t) => ({
          metricKey: t.target.metric,
          label: t.target.label,
          gating: t.target.gating === true,
          target: t.target.target,
          hits: hitsByParams.get(t.params) ?? null,
          params: t.params,
        })),
        untimedSessionCount: matrix.untimedSessionCount,
        retestWeeks: retestWeeksFor(plan?.template ?? null, grouped.exercise),
      };
    }
  }

  // ── Baselines: ONE full scan powers summaries + feed + schedule ──────────
  const allBaselines = await db.baseline.findMany({
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      id: true,
      testName: true,
      units: true,
      value: true,
      capped: true,
      notes: true,
      date: true,
    },
  });
  const summaries = baselineSummariesFromRows(allBaselines);

  // Schedule (zero extra queries — prefetched rows).
  const schedule = plan
    ? await getBaselineScheduleForPlan(
        {
          planJson: plan.template,
          startedOn: plan.startedOn,
          weeks: plan.template?.totalWeeks ?? 0,
        },
        { now, prefetchedBaselines: allBaselines },
      )
    : null;

  // ── Next readings (key 7) ─────────────────────────────────────────────────
  const statusOrder: Record<CheckpointStatus, number> = { overdue: 0, due: 1, upcoming: 2, done: 3 };
  const nextReadings: NextReading[] = (schedule?.scheduled ?? [])
    .map((s) => ({ s, next: nextCheckpointOf(s) }))
    .filter(
      (x): x is { s: ScheduledBaseline; next: NonNullable<ReturnType<typeof nextCheckpointOf>> } =>
        x.next !== null && x.next.status !== "done",
    )
    .sort(
      (a, b) =>
        statusOrder[a.next.status] - statusOrder[b.next.status] ||
        a.next.targetDate.getTime() - b.next.targetDate.getTime(),
    )
    .map((x) => ({
      testName: x.s.testName,
      targetDate: x.next.targetDate,
      status: x.next.status as NextReading["status"],
    }));

  // ── Records feed (key 8): PRs from the SHARED scan + baselines + hikes ────
  const windowMs = 21 * 24 * 3600 * 1000;
  const hikes21d = await db.hike.findMany({
    where: { status: "completed", date: { gte: new Date(now.getTime() - windowMs), lte: endOfDay(now) } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { id: true, route: true, distanceMi: true, elevationFt: true, date: true },
  });
  const baselinesDesc = [...allBaselines].reverse();
  const recordsFeed = buildRecordsFeed({
    now,
    prEvents: derivePrEvents(table.workouts),
    baselines: allBaselines,
    priorBaselineValue: (testName, before) =>
      baselinesDesc.find((b) => b.testName === testName && b.date.getTime() < before.getTime())
        ?.value ?? null,
    hikes: hikes21d,
  });

  // ── Baselines card (key 11, G2) ───────────────────────────────────────────
  // Claims across live strip goals: weight (sort key), maintenance floors.
  const claimByTest = new Map<string, { weight: number; goals: number; maintenance: { floor: number; direction: string } | null }>();
  for (const g of liveGoals) {
    for (const t of g.targets) {
      if (!t.metric.startsWith("baseline:")) continue;
      const name = t.metric.slice("baseline:".length);
      const cur = claimByTest.get(name) ?? { weight: 0, goals: 0, maintenance: null };
      cur.weight = Math.max(cur.weight, t.weight ?? 0);
      cur.goals += 1;
      if (t.start !== undefined && t.start !== null && t.start === t.target) {
        cur.maintenance = { floor: t.target, direction: t.direction };
      }
      claimByTest.set(name, cur);
    }
  }
  const historyByTest = new Map<string, number[]>();
  const notesByTest = new Map<string, string | null>();
  for (const b of allBaselines) {
    const arr = historyByTest.get(b.testName) ?? [];
    arr.push(b.value);
    historyByTest.set(b.testName, arr);
    notesByTest.set(b.testName, b.notes ?? null); // asc scan → last write is latest
  }
  const baselineRows: BaselineCardRow[] = summaries.map((s) => {
    const claim = claimByTest.get(s.testName);
    const maintenance = claim?.maintenance
      ? {
          floor: claim.maintenance.floor,
          holding:
            claim.maintenance.direction === "decrease"
              ? s.latest.value <= claim.maintenance.floor
              : s.latest.value >= claim.maintenance.floor,
        }
      : null;
    return {
      testName: s.testName,
      units: s.units,
      latest: s.latest,
      earliest: s.earliest,
      count: s.count,
      history: historyByTest.get(s.testName) ?? [],
      capValue: s.latest.capped ? s.latest.value : null,
      weight: claim?.weight ?? 0,
      maintenance,
      notes: notesByTest.get(s.testName) ?? null,
      sharedByGoals: claim?.goals ?? 0,
    };
  });

  // ── Body composition (key 12) — G3: a PER-GOAL owner, never a homeless
  // tail card. The owner is the primary goal when it carries the target,
  // else the first live strip goal that does (for Phase 2A that is Goal 2 —
  // the ■ goal owns body composition while Goal 1 owns the rotation). This
  // also closes audit A24 by construction: a Program whose rotation owner
  // does not track weight no longer silently loses the card.
  const bodyOwner =
    primaryTargets.some((t) => t.metric === "weightLb" || t.metric === "bodyFatPct")
      ? { row: primaryRow!, targets: primaryTargets }
      : (() => {
          for (const g of liveGoals) {
            if (g.targets.some((t) => t.metric === "weightLb" || t.metric === "bodyFatPct")) {
              return { row: goalById.get(g.id)!, targets: g.targets };
            }
          }
          return null;
        })();
  const bodyFatTarget = bodyOwner?.targets.find((t) => t.metric === "bodyFatPct") ?? null;
  let bodyComposition: BodyCompositionModel | null = null;
  if (bodyOwner) {
    // A2 fixed by construction: bounded-DESC scan reversed + a TRUE start.
    const weightRowsDesc = table.measurements.filter((m) => m.weightLb !== null);
    const recent = weightRowsDesc.slice(0, 180).reverse();
    const trueStart = await db.measurement.findFirst({
      where: { weightLb: { not: null } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { date: true, weightLb: true },
    });
    const labelFmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: USER_TZ, // A10: labels formatted SERVER-side in the user's tz
    });
    const latestBf = table.measurements.find((m) => m.bodyFatPct !== null) ?? null;
    const ownerSnapshot = goalStrips.find((s) => s.model.goal.id === bodyOwner.row.id)?.model
      .snapshot;
    const bfBreakdown = ownerSnapshot?.breakdown.find((b) => b.target.metric === "bodyFatPct");
    bodyComposition = {
      weights: recent.map((m) => ({
        date: m.date.toISOString(),
        weight: m.weightLb!,
        label: labelFmt.format(m.date),
      })),
      current: recent.length > 0 ? { value: recent.at(-1)!.weightLb!, date: recent.at(-1)!.date } : null,
      start: trueStart ? { value: trueStart.weightLb!, date: trueStart.date } : null,
      bodyFat: bodyFatTarget
        ? {
            latest: latestBf ? { value: latestBf.bodyFatPct!, date: latestBf.date } : null,
            loggedNotScored: latestBf !== null && bfBreakdown?.progress == null,
            targetWeightPct: Math.round((bodyFatTarget.weight ?? 0) * 100),
          }
        : null,
    };
  }

  // ── Metrics lid (key 13) — pure regroup of live member breakdowns ────────
  const liveMemberBreakdowns = goalStrips
    .filter(
      (s) =>
        s.model.mode === "live" &&
        s.model.snapshot !== null &&
        renderableMembers.some((m) => m.id === s.model.goal.id),
    )
    .map((s) => ({
      goalId: s.model.goal.id,
      objective: s.model.goal.objective,
      breakdown: s.model.snapshot!.breakdown,
    }));
  const metrics: ProgramMetricRow[] =
    shape === "program"
      ? groupMetricRows(liveMemberBreakdowns).map((row) => ({
          metricKey: row.metricKey,
          label: row.label,
          units: row.units,
          points: row.points,
          claims: row.claims,
          targetLines: row.targetLines,
        }))
      : [];

  // ── Body metrics lid (key 14) — bounded (UXR-PROG-97) ─────────────────────
  const bmWindowStart =
    programStart !== null ? startOfDay(programStart) : addDays(startOfDay(now), -365);
  const bodyMetricRows = await db.bodyMetric.findMany({
    where: { date: { gte: bmWindowStart } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 400, // ⚠[200–800]
  });
  const bmGrouped = new Map<string, typeof bodyMetricRows>();
  for (const r of bodyMetricRows) {
    const arr = bmGrouped.get(r.key) ?? [];
    arr.push(r);
    bmGrouped.set(r.key, arr);
  }
  const registryOrder = new Map(BODY_METRICS.map((m, i) => [m.key, i]));
  const bodyMetrics: BodyMetricLidRow[] = [...bmGrouped.keys()]
    .sort((a, b) => {
      const ia = registryOrder.get(a) ?? Infinity;
      const ib = registryOrder.get(b) ?? Infinity;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    })
    .map((key) => {
      const rows = bmGrouped.get(key)!;
      const latest = rows.at(-1)!;
      const { label, units } = resolveBodyMetric(key, latest.unit);
      return {
        key,
        label,
        units,
        values: rows.map((r) => r.value),
        latest: { value: latest.value, date: latest.date },
      };
    });

  // ── Project keys (15) ─────────────────────────────────────────────────────
  let project: ProgressPageData["project"] = null;
  if (primaryProjectGoal) {
    const projTargets = parseGoalTargets(goalById.get(primaryProjectGoal.id)?.targets);
    const hasMrr = projTargets.some((t) => t.metric === "log:mrr");
    const mrr = hasMrr
      ? (
          await db.logEntry.findMany({
            where: { goalId: primaryProjectGoal.id, metric: "mrr", value: { not: null } },
            orderBy: [{ date: "asc" }, { id: "asc" }],
            select: { date: true, value: true },
          })
        ).map((r) => ({
          date: r.date.toISOString(),
          value: r.value!,
          tooltip: `$${r.value!.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
        }))
      : null;
    project = { goalId: primaryProjectGoal.id, mrr };
  }

  // ── Milestone (key 16) — FootageMarker highlight, never a notes regex ─────
  const marker = await db.footageMarker.findFirst({
    where: { highlight: true },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { id: true, date: true, kind: true, label: true, exerciseName: true },
  });
  let milestone: MilestoneModel | null = null;
  if (marker) {
    const dayMs = 24 * 3600 * 1000;
    const matched = marker.exerciseName
      ? allBaselines.find(
          (b) =>
            canonicalExerciseName(b.testName) === canonicalExerciseName(marker.exerciseName!) &&
            Math.abs(b.date.getTime() - marker.date.getTime()) <= dayMs,
        )
      : undefined;
    milestone = {
      label: marker.label,
      date: marker.date,
      kind: marker.kind,
      numeral: matched ? `${fmtShort(matched.value)} ${matched.units}` : null,
    };
  }

  // ── Hero + band ───────────────────────────────────────────────────────────
  let contextLine: string | null = null;
  let band: ProgressPageData["band"] = null;
  if (shape === "program" && membership) {
    const dayNumber = daysBetweenMidnights(membership.startedOn, now) + 1;
    const totalDays = membership.endsOn
      ? daysBetweenMidnights(membership.startedOn, membership.endsOn) + 1
      : null;
    const { blocks, currentLabel, weekIndex } = buildBandBlocks(plan, now);
    contextLine = [
      membership.name,
      currentLabel,
      totalDays !== null ? `day ${dayNumber} of ${totalDays}` : `day ${dayNumber}`,
    ]
      .filter(Boolean)
      .join(" · ");
    band = {
      blocks,
      caption:
        currentLabel && weekIndex !== null
          ? `${currentLabel} · week ${weekIndex}`
          : null,
      dayNumber,
      // UXR-PROG-101 ⚠: visible copy never says "Block N of M" (UXR-PV-31);
      // a screen-reader user cannot see the band that carries which-of-four,
      // so the sr-only line may.
      srBlockLine: (() => {
        const idx = blocks.findIndex((b) => b.current);
        return idx >= 0 ? `Block ${idx} of ${blocks.length}` : null;
      })(),
    };
  } else if (shape === "legacy" && primaryRow) {
    contextLine = primaryRow.targetDate
      ? `${primaryRow.objective} · target ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: USER_TZ }).format(primaryRow.targetDate)}`
      : primaryRow.objective;
  }

  return {
    shape,
    now,
    hero: { contextLine, showProgramPill: shape === "program" },
    band,
    seamStrip,
    goalStrips,
    nextReadings,
    recordsFeed,
    effort: null, // Stage 4 fills this (gated to the same PR as the spine)
    baselines: baselineRows.length > 0 ? { rows: baselineRows, totalScheduled: schedule?.scheduled.length ?? null } : null,
    bodyComposition,
    metrics,
    bodyMetrics,
    project,
    milestone,
  };
}

function fmtShort(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));
}

function daysBetweenMidnights(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / (24 * 3600 * 1000));
}

/** Proportional block segments from the plan's phases — mirrors
 *  program/page.tsx's buildBlockSegments (repo mirror convention). */
function buildBandBlocks(
  plan: Awaited<ReturnType<typeof getActiveProgram>>,
  now: Date,
): { blocks: ProgramBlockSegment[]; currentLabel: string | null; weekIndex: number | null } {
  if (!plan) return { blocks: [], currentLabel: null, weekIndex: null };
  const dayInPlan = daysBetweenMidnights(plan.startedOn, now);
  const totalWeeks = plan.template?.totalWeeks ?? 0;
  const weekIndex =
    dayInPlan >= 0 && dayInPlan < totalWeeks * 7 ? Math.floor(dayInPlan / 7) + 1 : null;
  const phases = Array.isArray(plan.template?.phases) ? plan.template.phases : [];
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const blocks = phases
    .filter((p) => Array.isArray(p?.weeks) && p.weeks.length > 0)
    .map((p) => {
      const minWeek = Math.min(...p.weeks);
      const startDay = (minWeek - 1) * 7;
      const days = p.weeks.length * 7;
      return {
        key: `${p.index}-${minWeek}`,
        label: p.name || `Block ${p.index}`,
        weight: days,
        fill: clamp01((dayInPlan + 1 - startDay) / days),
        current: weekIndex !== null && p.weeks.includes(weekIndex),
      };
    });
  const currentLabel = blocks.find((b) => b.current)?.label ?? null;
  return { blocks, currentLabel, weekIndex };
}
