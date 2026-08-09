// src/lib/goal-completion.ts
//
// Server completion cores — the IO layer for goal completion/reopen. Uses
// getDb() (Goal + Plan are scoped models). Pairs with src/lib/goal-completion-core.ts
// (pure snapshot/retrospective types + buildCompletionSnapshot/parseCompletionSnapshot),
// which has NO Prisma imports.
//
// Dual-caller contract (mirrors goal-core.ts): plain async helpers, no "use server"
// directive, importable from both server actions (goal-actions.ts) AND MCP tool
// registrations (tools.ts).

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { dateKey } from "@/lib/calendar";
import { computeReadiness } from "@/lib/readiness";
import { computeGoalFeasibility } from "@/lib/rarity";
import { parseCoachFeasibility } from "@/lib/rarity-core";
import { goalAchievedXp } from "@/lib/game/rules";
import type { GoalTarget } from "@/lib/goal-targets";
import {
  buildCompletionSnapshot,
  parseCompletionSnapshot,
  type BuildCompletionSnapshotInputs,
  type GoalCompletionSnapshot,
} from "@/lib/goal-completion-core";

// ---------------------------------------------------------------------------
// Shared "public" Goal shape returned by the cores below — deliberately
// selected (never the raw Prisma row) so userId can never leak through this
// module's return values.
// ---------------------------------------------------------------------------

export type CompletionGoalRow = {
  id: string;
  objective: string;
  kind: string;
  status: string;
  completedAt: Date | null;
  isFocus: boolean;
  active: boolean;
  createdAt: Date;
  targetDate: Date | null;
};

const GOAL_SELECT = {
  id: true,
  objective: true,
  kind: true,
  status: true,
  completedAt: true,
  isFocus: true,
  active: true,
  createdAt: true,
  targetDate: true,
} as const;

// Defensive shape guard for Goal.targets (mirrors rarity.ts's local parseTargets) —
// old/malformed rows fail closed to an empty target list rather than throwing.
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

// ---------------------------------------------------------------------------
// computeCompletionSnapshot
// ---------------------------------------------------------------------------
// Fetches the goal + its latest plan, computes live readiness + feasibility
// AS OF completedAt, and assembles the versioned GoalCompletionSnapshot via
// the pure buildCompletionSnapshot. Called by completeGoalCore BEFORE the
// goal is mutated — the snapshot must reflect live state, not the
// already-archived goal.
//
// R7 (binding, architecture-blueprint-v2.md): computeReadiness receives
// completedAt RAW. resolveMetricValue applies endOfDay(asOf) internally
// (goal-targets.ts) — pre-wrapping here would double-apply the cutoff.
// ---------------------------------------------------------------------------

export async function computeCompletionSnapshot(
  goalId: string,
  completedAt: Date,
): Promise<GoalCompletionSnapshot> {
  const db = await getDb();

  const goal = await db.goal.findUnique({
    where: { id: goalId },
    select: {
      objective: true,
      kind: true,
      createdAt: true,
      targetDate: true,
      targets: true,
      coachFeasibility: true,
    },
  });
  if (!goal) throw new Error("Goal not found");

  // "Latest plan" — most-recently-created, regardless of active state (mirrors
  // the latest-plan idiom already used in goal-core.ts's setFocusGoalCore /
  // setPlanActiveCore). Plan-less goals (kind="project", or a fitness someday
  // goal never upgraded) get plan: null → xpBasis falls back to floor(daysElapsed/7).
  const plan = await db.plan.findFirst({
    where: { goalId },
    orderBy: { createdAt: "desc" },
    select: { id: true, startedOn: true, weeks: true },
  });

  const targets = parseGoalTargets(goal.targets);

  // Zero-target goal → readiness null, no target rows (PRD §Edge Cases).
  let readiness: GoalCompletionSnapshot["readiness"] = null;
  let targetRows: BuildCompletionSnapshotInputs["targets"] = [];

  if (targets.length > 0) {
    const snap = await computeReadiness(targets, completedAt, goalId);
    readiness = {
      score: snap.score,
      rawScore: snap.rawScore,
      ceiling: snap.ceiling,
      coverage: snap.coverage,
      openGateCount: snap.openGateCount,
    };
    // breakdown already carries per-target current/start/progress resolved as
    // of completedAt — reuse it directly instead of re-resolving each metric.
    targetRows = snap.breakdown.map((b) => ({
      metric: b.target.metric,
      label: b.target.label,
      units: b.target.units,
      start: b.start,
      final: b.current,
      target: b.target.target,
      progress: b.progress,
    }));
  }

  const feasibility = await computeGoalFeasibility(
    { id: goalId, targetDate: goal.targetDate, targets: goal.targets, kind: goal.kind },
    { now: completedAt },
  );
  const coachFeasibility = parseCoachFeasibility(goal.coachFeasibility);

  const draft = buildCompletionSnapshot({
    goal: { objective: goal.objective, kind: goal.kind, createdAt: goal.createdAt },
    completedAt,
    completedDateKey: dateKey(completedAt),
    capturedAt: new Date(),
    readiness,
    targets: targetRows,
    feasibilityTierAtCompletion: feasibility.tier,
    coachFeasibilityTier: coachFeasibility?.tier ?? null,
    plan: plan
      ? { planId: plan.id, weeksTotal: plan.weeks, startedOn: plan.startedOn }
      : { planId: null, weeksTotal: null, startedOn: null },
    // Placeholder — buildCompletionSnapshot derives xpBasis {weeks, targetsMet}
    // internally; the real award is computed just below from THAT derived
    // basis so this call site never duplicates the weeks/targetsMet math.
    xpAwardedAtCompletion: 0,
  });

  const xpAwardedAtCompletion = goalAchievedXp(draft.xpBasis.weeks, draft.xpBasis.targetsMet);

  return { ...draft, xpAwardedAtCompletion };
}

// ---------------------------------------------------------------------------
// completeGoalCore
// ---------------------------------------------------------------------------

export type CompleteGoalCoreResult = {
  goal: CompletionGoalRow;
  snapshot: GoalCompletionSnapshot;
  /** Whether the goal held focus immediately before completion (isFocus is
   *  unconditionally cleared by this call). */
  focusReleased: boolean;
  /** Plan ids that were active and got deactivated by this call. */
  planDeactivatedIds: string[];
  /** Other status="active" goals, for the coach's set_active_goal covenant. */
  remainingActiveGoals: Array<{ id: string; objective: string; kind: string }>;
};

export async function completeGoalCore(
  goalId: string,
  date?: Date,
): Promise<CompleteGoalCoreResult> {
  const db = await getDb();

  // ── Guards (in order) ────────────────────────────────────────────────────
  const existing = await db.goal.findUnique({
    where: { id: goalId },
    select: { id: true, status: true, createdAt: true, isFocus: true },
  });
  if (!existing) throw new Error("Goal not found");
  if (existing.status === "achieved") {
    throw new Error(
      "This goal is already completed — use reopen_goal to reverse it before completing it again.",
    );
  }

  const completedAt = date ?? new Date();
  const now = new Date();
  // Future check + createdAt check compare USER_TZ dateKeys, not raw Date
  // instants — a same-day backdate at a different time-of-day must not error.
  if (dateKey(completedAt) > dateKey(now)) {
    throw new Error("Completion date cannot be in the future.");
  }
  if (dateKey(completedAt) < dateKey(existing.createdAt)) {
    throw new Error("Completion date cannot be before the goal was created.");
  }

  // Snapshot computed BEFORE mutation — must read live (not-yet-archived) state.
  const snapshot = await computeCompletionSnapshot(goalId, completedAt);

  const { goal, planDeactivatedIds } = await db.$transaction(async (tx) => {
    // Sequential top-level calls — NEVER nested relation writes (gotcha §B.10).
    const updatedGoal = await tx.goal.update({
      where: { id: goalId },
      data: {
        status: "achieved",
        completedAt,
        completionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        isFocus: false,
        active: false,
      },
      select: GOAL_SELECT,
    });

    // Capture the ids of the plans about to be deactivated (updateMany itself
    // returns only a count, not rows) — read-then-write, both top-level tx calls.
    const activePlans = await tx.plan.findMany({
      where: { goalId, active: true },
      select: { id: true },
    });
    await tx.plan.updateMany({
      where: { goalId, active: true },
      data: { active: false },
    });

    return { goal: updatedGoal, planDeactivatedIds: activePlans.map((p) => p.id) };
  });

  const remainingActiveGoals = await db.goal.findMany({
    where: { status: "active", id: { not: goalId } },
    select: { id: true, objective: true, kind: true },
  });

  return {
    goal,
    snapshot,
    focusReleased: existing.isFocus,
    planDeactivatedIds,
    remainingActiveGoals,
  };
}

// ---------------------------------------------------------------------------
// reopenGoalCore
// ---------------------------------------------------------------------------

export type ReopenGoalCoreResult = {
  goal: CompletionGoalRow;
  discardedSnapshot: GoalCompletionSnapshot | null;
  /**
   * `hadFocus` is deliberately OMITTED here — see the comment at the return
   * statement below for why.
   */
  hints: { latestPlanId: string | null };
};

export async function reopenGoalCore(goalId: string): Promise<ReopenGoalCoreResult> {
  const db = await getDb();

  // "Latest plan" for the hint — read outside the transaction; it's advisory
  // (the coach may offer to resume it), not part of the write's atomicity.
  const latestPlan = await db.plan.findFirst({
    where: { goalId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const { goal, discardedSnapshot } = await db.$transaction(async (tx) => {
    // Guard + mutate inside the same transaction (mirrors goal-core.ts's
    // setGoalTrackedCore) so a concurrent reopen/complete can't race the check.
    const existing = await tx.goal.findUnique({
      where: { id: goalId },
      select: { id: true, status: true, completionSnapshot: true },
    });
    if (!existing) throw new Error("Goal not found");
    if (existing.status !== "achieved") {
      throw new Error("This goal is not completed — nothing to reopen.");
    }

    const discardedSnapshot = parseCompletionSnapshot(existing.completionSnapshot);

    const updatedGoal = await tx.goal.update({
      where: { id: goalId },
      data: {
        status: "active",
        completedAt: null,
        completionSnapshot: Prisma.JsonNull,
        active: true,
        // retrospective intentionally NOT included — R10 (binding): the
        // post-goal reflection is human-authored and survives reopen AND
        // re-completion. completeGoalCore likewise never touches it.
      },
      select: GOAL_SELECT,
    });

    return { goal: updatedGoal, discardedSnapshot };
  });

  return {
    goal,
    discardedSnapshot,
    // hadFocus deliberately dropped from hints (deviation from the PRD's
    // `hints: {latestPlanId, hadFocus}` shape — documented pragmatic call):
    // completeGoalCore unconditionally sets isFocus=false at completion time,
    // so by the time a goal reaches reopenGoalCore its isFocus is ALWAYS
    // false — there is no live signal left to read, and the snapshot type
    // (goal-completion-core.ts, Stage 0, out of this track's scope) doesn't
    // carry a wasFocus field either. Returning `hadFocus: false` would
    // misleadingly assert "this goal never held focus" when the true answer
    // is "unknown" — worse than omitting the key. latestPlanId remains fully
    // recoverable and is kept.
    hints: { latestPlanId: latestPlan?.id ?? null },
  };
}
