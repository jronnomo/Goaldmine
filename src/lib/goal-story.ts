// src/lib/goal-story.ts
//
// Server assembly (Stage B2, REQ-005) for the getGoalStory bundle — the
// time-aware retrospective view of a goal. Pairs with goal-story-core.ts's
// pure GoalStory type + clipToWindow/derivePhaseTimeline helpers (Stage A2).
// getDb() throughout (Goal/Plan/Hike are scoped models); this module is the
// ONLY IO layer both the trophy page's Story section (Stage B3) and the
// get_goal_story MCP tool (Stage C) call into — one code path, one story.
//
// R9 (binding, architecture-blueprint-v2.md): an ACHIEVED goal's readiness
// story is FROZEN at complete_goal time — computeReadiness /
// computeReadinessSeriesSampled are NEVER called on the achieved branch
// below, even when the snapshot fails to parse (the degraded case falls back
// to null/empty, never a live recompute). See the comment at the branch.

import { dateKey } from "@/lib/calendar";
import { getDb } from "@/lib/db";
import {
  clipToWindow,
  derivePhaseTimeline,
  type GoalStory,
} from "@/lib/goal-story-core";
import {
  parseCompletionSnapshot,
  type GoalCompletionSnapshot,
} from "@/lib/goal-completion-core";
import { computeReadiness, computeReadinessSeriesSampled } from "@/lib/readiness";
import type { GoalTarget } from "@/lib/goal-targets";
import { getBaselineHistory } from "@/lib/records";
import { getLogMetricSeries } from "@/lib/metric-series";
import type { ProgramTemplate } from "@/lib/program-template";

// Defensive shape guard for Goal.targets (Json) — same hand-copied guard as
// rarity.ts's parseTargets and goal-completion.ts's parseGoalTargets (no
// shared export exists across these call sites today; mirroring the existing
// pattern rather than introducing a new cross-file dependency here).
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

export async function getGoalStory(goalId: string): Promise<GoalStory | null> {
  const db = await getDb();

  const goal = await db.goal.findUnique({
    where: { id: goalId },
    select: {
      id: true,
      objective: true,
      kind: true,
      status: true,
      createdAt: true,
      completedAt: true,
      targets: true,
      completionSnapshot: true,
    },
  });
  if (!goal) return null;

  const achieved = goal.status === "achieved";
  const now = new Date();
  const createdAtKey = dateKey(goal.createdAt);
  const completedDateKey = achieved && goal.completedAt ? dateKey(goal.completedAt) : null;
  const window = { startKey: createdAtKey, endKey: completedDateKey ?? dateKey(now) };

  // Goal.targets — the target DEFINITIONS (direction/weight/cumulative), used
  // below to drive both the live readiness computation (active goals) and the
  // kind-specific arc selection (baseline test names / log:* metrics), for
  // BOTH achieved and active goals — a completed goal's target definitions
  // don't change, only its readiness-over-time story gets frozen.
  const rawTargets = parseGoalTargets(goal.targets);

  let snapshot: GoalCompletionSnapshot | null = null;
  let readinessSeries: GoalStory["readinessSeries"] = null;
  let targets: GoalStory["targets"] = [];

  if (achieved) {
    // ── R9: frozen only — never live-compute for an achieved goal ─────────
    snapshot = parseCompletionSnapshot(goal.completionSnapshot);
    readinessSeries = snapshot?.readinessSeries ?? null;
    targets = snapshot?.targets ?? [];
  } else {
    // ── Active: live "story so far" ────────────────────────────────────────
    if (rawTargets.length > 0) {
      const live = await computeReadiness(rawTargets, now, goalId);
      // Shape mirrors buildCompletionSnapshot's breakdown→rows mapping
      // (goal-completion-core.ts) so the trophy page / tool see one shape
      // regardless of achieved-vs-active.
      targets = live.breakdown.map((b) => ({
        metric: b.target.metric,
        label: b.target.label,
        units: b.target.units,
        start: b.start,
        final: b.current,
        target: b.target.target,
        progress: b.progress,
        met: b.progress !== null && b.progress >= 1,
      }));

      // S2 (binding): sampled/parallelized series only — never the uncapped
      // computeReadinessSeries (that consumer stays the progress page).
      const series = await computeReadinessSeriesSampled(goal.createdAt, rawTargets, now, goalId);
      readinessSeries = series.map((p) => ({ dateKey: dateKey(p.weekEnd), score: p.score }));
    }
    // Zero-target active goal: targets stays [], readinessSeries stays null —
    // nothing to sample against (mirrors computeCompletionSnapshot's
    // zero-target branch).
  }

  // ── Timeline: latest plan regardless of active state (mirrors the
  // latest-plan idiom at goal-completion.ts:111 — an achieved goal's plan is
  // always deactivated by completeGoalCore, so "active:true" would find
  // nothing) ────────────────────────────────────────────────────────────────
  const plan = await db.plan.findFirst({
    where: { goalId },
    orderBy: { createdAt: "desc" },
    select: {
      name: true,
      startedOn: true,
      weeks: true,
      planJson: true,
      revisions: {
        orderBy: { createdAt: "asc" },
        select: { id: true, createdAt: true, triggerSource: true, summary: true, reasoning: true },
      },
    },
  });

  // planJson is a raw Json snapshot of the template — cast unvalidated, same
  // convention as ActiveProgramSnapshot in program.ts.
  const template = plan ? (plan.planJson as unknown as ProgramTemplate) : null;

  const timeline: GoalStory["timeline"] = plan
    ? {
        planName: plan.name,
        startedOnKey: dateKey(plan.startedOn),
        weeksTotal: plan.weeks,
        phases: derivePhaseTimeline(template!, plan.startedOn),
        // S5 (binding): intentionally triggerNote-FREE. This type crosses the
        // MCP tool boundary (get_goal_story), where triggerNoteId can point
        // at a private note type (standing_rule/review/open_item) —
        // leaky-reads-unsafe. The trophy page's full-fidelity changelog
        // (Stage B3's PlanChangelog, reading PlanRevision directly) is the
        // separate same-tenant view that DOES carry triggerNote. Two views,
        // one intentional fidelity split.
        revisions: plan.revisions.map((r) => ({
          id: r.id,
          createdAtKey: dateKey(r.createdAt),
          triggerSource: r.triggerSource,
          summary: r.summary,
          reasoning: r.reasoning,
        })),
      }
    : null;

  // ── Kind-specific arcs ──────────────────────────────────────────────────
  const baselineArcs: GoalStory["baselineArcs"] = [];
  let hikeArc: GoalStory["hikeArc"] = [];
  const metricArcs: GoalStory["metricArcs"] = [];

  if (goal.kind === "fitness") {
    const templateTestNames = template
      ? template.baselineWeek.flatMap((day) => day.tests.map((t) => t.testName))
      : [];
    const targetTestNames = rawTargets
      .filter((t) => t.metric.startsWith("baseline:"))
      .map((t) => t.metric.slice("baseline:".length));
    const testNames = [...new Set([...targetTestNames, ...templateTestNames])];

    for (const testName of testNames) {
      // S6 (binding, architecture-blueprint-v2.md): Baseline has no goalId
      // column — this is the user's FULL test history for `testName`,
      // clipped to the goal's window, the same user-global semantics
      // readiness itself already uses (goal-targets.ts's resolveMetricValue
      // for baseline:* metrics is equally goal-agnostic). Not a bug — the
      // clip is what scopes it to "this goal's era" of that test.
      const history = await getBaselineHistory(testName);
      const points = clipToWindow(
        history.map((h) => ({ dateKey: dateKey(h.date), value: h.value })),
        window,
      );
      if (points.length === 0) continue; // skip empty arcs
      baselineArcs.push({ testName, units: history[0]!.units, points });
    }

    // NO userId in select — this crosses the MCP tool boundary too.
    const hikes = await db.hike.findMany({
      where: { goalId },
      orderBy: { date: "asc" },
      select: {
        date: true,
        route: true,
        distanceMi: true,
        elevationFt: true,
        summitFt: true,
        packWeightLb: true,
        durationMin: true,
        status: true,
      },
    });
    hikeArc = clipToWindow(
      hikes.map((h) => ({
        dateKey: dateKey(h.date),
        route: h.route,
        distanceMi: h.distanceMi,
        elevationFt: h.elevationFt,
        summitFt: h.summitFt,
        packWeightLb: h.packWeightLb,
        durationMin: h.durationMin,
        status: h.status,
      })),
      window,
    );
  } else {
    const logTargets = rawTargets.filter((t) => t.metric.startsWith("log:"));
    for (const target of logTargets) {
      const series = await getLogMetricSeries(target, goalId);
      // Points are already ISO-dated (metric-series.ts) — clip by comparing
      // each point's dateKey against the window, rather than clipToWindow
      // (which expects a `dateKey` field, not `date`).
      const points = series.points.filter((p) => {
        const pk = dateKey(new Date(p.date));
        return pk >= window.startKey && pk <= window.endKey;
      });
      metricArcs.push({
        metric: target.metric,
        label: series.label,
        units: series.units,
        domain: series.domain,
        points,
      });
    }
  }

  return {
    goal: {
      id: goal.id,
      objective: goal.objective,
      kind: goal.kind,
      status: goal.status,
      createdAtKey,
      completedDateKey,
    },
    window,
    snapshot,
    readinessSeries,
    targets,
    baselineArcs,
    hikeArc,
    metricArcs,
    timeline,
  };
}
