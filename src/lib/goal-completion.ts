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
import { computeReadiness, computeReadinessSeriesSampled } from "@/lib/readiness";
import { computeGoalFeasibility } from "@/lib/rarity";
import { parseCoachFeasibility } from "@/lib/rarity-core";
import { goalAchievedXp } from "@/lib/game/rules";
import { computeGameStateFresh } from "@/lib/game/engine";
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
  // Zero-target goal → no series either (nothing to sample against);
  // undefined here means buildCompletionSnapshot omits the field entirely
  // (goal-completion-core.ts's spread-when-defined), same as a legacy row.
  let readinessSeries: BuildCompletionSnapshotInputs["readinessSeries"];

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

    // Freeze the readiness-over-time arc at completion time (S2/REQ-002) —
    // sampled + batched so a multi-year goal doesn't pay an unbounded query
    // cost here. weekEnd (Date) → dateKey (USER_TZ string) for the snapshot.
    const series = await computeReadinessSeriesSampled(goal.createdAt, targets, completedAt, goalId);
    readinessSeries = series.map((p) => ({ dateKey: dateKey(p.weekEnd), score: p.score }));
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
    readinessSeries,
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
  /**
   * The enriched snapshot (with `ceremony` attached) when the post-tx
   * best-effort write below succeeds; otherwise the plain snapshot as
   * written inside the transaction (ceremony absent — see `ceremony`'s
   * doc comment on GoalCompletionSnapshot). Always matches what's actually
   * persisted in the DB at the moment this function returns.
   */
  snapshot: GoalCompletionSnapshot;
  /**
   * The goal.achieved badge/level diff (REQ-008/V5) — ALWAYS populated
   * (independent of whether the second write above succeeded), since both
   * halves of the diff are just in-memory computeGameStateFresh() reads.
   * tools.ts's complete_goal reads badgesUnlocked/levelBefore/levelAfter
   * from here instead of running its own pre/post pair.
   */
  ceremony: { badgesUnlocked: Array<{ id: string; name: string }>; levelBefore: number; levelAfter: number };
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

  // Pre-state for the badge/level diff (REQ-008/V5) — also BEFORE mutation,
  // for the same reason: badge predicates and level must reflect the world
  // as it was right before this goal became achieved. Cache gotcha (binding,
  // architecture-blueprint-v2.md): computeGameState is React-cache()d — a
  // before/after diff in one request would return the SAME memoized state
  // twice. Must use the uncached computeGameStateFresh export (moved here
  // from tools.ts's complete_goal handler — this is now the single call site).
  const preState = await computeGameStateFresh();

  const { goal, planDeactivatedIds } = await db.$transaction(async (tx) => {
    // Sequential top-level calls — NEVER nested relation writes (gotcha §B.10).
    // Writes the snapshot WITHOUT `ceremony` — the diff below can only be
    // computed once this transaction has actually committed (the badge
    // predicates read the just-archived goal + its goal.achieved XP event).
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

  // ── Ceremony capture (REQ-008/V5) — two-step write ──────────────────────
  // Post-state can only be read AFTER the transaction above commits. The
  // diff itself (badgesUnlocked/levelBefore/levelAfter) is a pure in-memory
  // comparison of two already-fetched GameState objects — it cannot fail —
  // so it's computed unconditionally and always returned via `ceremony`,
  // regardless of whether the second write below succeeds.
  const postState = await computeGameStateFresh();
  const preUnlockedIds = new Set(
    preState.badges.filter((b) => b.dateKey !== null).map((b) => b.def.id),
  );
  const badgesUnlocked = postState.badges
    .filter((b) => b.dateKey !== null && !preUnlockedIds.has(b.def.id))
    .map((b) => ({ id: b.def.id, name: b.def.name }));
  const ceremony = { badgesUnlocked, levelBefore: preState.level, levelAfter: postState.level };

  // Persisting the diff onto the snapshot is a SEPARATE, best-effort write —
  // one extra db.goal.update outside the transaction (documented deviation:
  // the alternative, holding the transaction open across the post-state
  // read, would serialize this request behind computeGameStateFresh's ~10
  // all-time queries for no benefit — the completion itself is already
  // durable at this point). A failure here must NEVER fail an
  // already-committed completion — it just means this goal's persisted
  // snapshot has no `ceremony` field, identical to a legacy pre-capture row
  // (isolate-drop parse, goal-completion-core.ts). The IN-MEMORY result
  // returned to the caller mirrors whatever actually landed in the DB.
  let persistedSnapshot: GoalCompletionSnapshot = snapshot;
  try {
    const enriched: GoalCompletionSnapshot = { ...snapshot, ceremony };
    await db.goal.update({
      where: { id: goalId },
      data: { completionSnapshot: enriched as unknown as Prisma.InputJsonValue },
    });
    persistedSnapshot = enriched;
  } catch {
    // Swallow — see the comment above. The completion already succeeded;
    // don't turn a ceremony-capture hiccup into a failed complete_goal call.
  }

  return {
    goal,
    snapshot: persistedSnapshot,
    ceremony,
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
