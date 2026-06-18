// Plain async helpers for Goal mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/goal-actions.ts) AND MCP route handlers / tool
// registrations (src/lib/mcp/tools.ts). Adding the directive would constrain
// it to server-action call sites only and break the MCP path.
//
// Validation guards live here as defensive contract checks; the form caller
// in goal-actions.ts also pre-checks for UI-friendly error messages.
//
// Dual-caller contract:
//   - Server actions (goal-actions.ts) call these cores and then add revalidatePath.
//   - MCP tools (tools.ts) call these cores directly — no revalidatePath needed
//     because /goals, /character are force-dynamic and MCP writes don't need
//     Next.js cache invalidation.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { GoalTarget } from "@/lib/goal-targets";
import type { Legend } from "@/lib/legend";
import { dateKey } from "@/lib/calendar";
import { scaffoldPlanFromTemplate, weeksBetween } from "@/lib/plan";
import type { RarityTier } from "@/lib/rarity-core";
import { canonicalExerciseName } from "@/lib/records";

export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date | null; // null = someday goal (no calendar pin, no plan scaffolded)
  notes?: string | null;
  kind?: "fitness" | "project";
  copyFromGoalId?: string | null;
  targets?: GoalTarget[] | null;
  legend?: Legend;
  /** Seed the coach feasibility override from the intake interview.
   *  Stored in the exact set_goal_feasibility shape:
   *  { tier, rationale, assessedAt: ISO, assessedBy: "coach" }
   */
  coachFeasibility?: { tier: RarityTier; rationale: string } | null;
  /** Canonical exercise names that count as training this goal.
   *  Canonicalized via canonicalExerciseName on write. */
  attributionHints?: string[] | null;
}

export interface CreateGoalCoreResult {
  goal: { id: string };
  /** null for someday goals (targetDate === null — no plan scaffolded). */
  planId: string | null;
}

// ---------------------------------------------------------------------------
// Private scaffold helper — single code path shared by createGoalCore AND
// ensurePlanForGoalCore so the two callers can never drift.
// ---------------------------------------------------------------------------

interface ScaffoldPlanArgs {
  objective: string;
  weeks: number;
  startedOn: Date;
  endsOn: Date;
}

interface ScaffoldPlanData {
  name: string;
  startedOn: Date;
  endsOn: Date;
  weeks: number;
  active: boolean;
  planJson: object;
  revisions: {
    create: {
      triggerSource: string;
      summary: string;
      reasoning: string;
      snapshotJson: object;
    };
  };
}

function buildPlanData(args: ScaffoldPlanArgs): ScaffoldPlanData {
  const planTemplate = scaffoldPlanFromTemplate(args.weeks);
  return {
    name: `${args.objective} — ${args.weeks}-week plan`,
    startedOn: args.startedOn,
    endsOn: args.endsOn,
    weeks: args.weeks,
    active: true,
    planJson: planTemplate as unknown as object,
    revisions: {
      create: {
        triggerSource: "manual",
        summary: "Initial plan from program template",
        reasoning: `Scaffolded from the program template, scaled to ${args.weeks} weeks across ${planTemplate.phases.length} phases.`,
        snapshotJson: planTemplate as unknown as object,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// createGoalCore
// ---------------------------------------------------------------------------

export async function createGoalCore(
  input: CreateGoalCoreInput,
): Promise<CreateGoalCoreResult> {
  const { objective, targetDate, copyFromGoalId } = input;

  // v2 — Concern A: defensive guards inside core. Form callers also pre-check
  // for UI-friendly messages; this is the contract boundary for any caller.
  if (!objective.trim()) throw new Error("objective required");
  if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("invalid targetDate");

  // v2 — Concern K: normalize notes to null when blank. Form already does
  // this; MCP callers may pass "" which would otherwise round-trip as empty
  // string.
  const normalizedNotes = input.notes?.trim() || null;

  // Plans are scaffolded from the FITNESS program template (baseline week + phases),
  // so only fitness goals get one. Project (and any non-fitness) goals track via
  // metrics + scheduled items — scaffolding a fitness plan onto them bleeds a default
  // baseline battery onto the calendar (see the rhino.the.grey regression, 2026-06-18).
  const kind = input.kind ?? "fitness";

  let targets: GoalTarget[] | null = input.targets ?? null;
  if (!targets && copyFromGoalId) {
    const source = await prisma.goal.findUnique({ where: { id: copyFromGoalId } });
    if (source && source.targets) {
      targets = source.targets as unknown as GoalTarget[];
    }
  }

  // Canonicalize attributionHints on write
  const attributionHints: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    input.attributionHints == null
      ? undefined
      : input.attributionHints.length === 0
        ? Prisma.JsonNull
        : (input.attributionHints.map((h) => canonicalExerciseName(h)) as unknown as Prisma.InputJsonValue);

  // Serialize coachFeasibility into the exact set_goal_feasibility shape
  const coachFeasibilityValue: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    input.coachFeasibility === null
      ? Prisma.JsonNull
      : input.coachFeasibility === undefined
        ? undefined
        : ({
            tier: input.coachFeasibility.tier,
            rationale: input.coachFeasibility.rationale,
            assessedAt: new Date().toISOString(),
            assessedBy: "coach",
          } as unknown as Prisma.InputJsonValue);

  // Legend handling: undefined → omit; [] → JsonNull (= reset to default);
  // non-empty → cast to InputJsonValue.
  const legendForCreate: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    input.legend === undefined
      ? undefined
      : input.legend.length === 0
        ? Prisma.JsonNull
        : (input.legend as unknown as Prisma.InputJsonValue);

  // A new goal becomes active (tracked) and becomes the focus ONLY when no
  // other goal already has isFocus=true. This prevents stealing focus from an
  // existing focused goal. Use setFocusGoal to explicitly switch focus.
  // (Replaces the old behavior of deactivating all other goals + plans globally.)
  const created = await prisma.$transaction(async (tx) => {
    const existingFocusCount = await tx.goal.count({ where: { isFocus: true } });
    const shouldBecomeFocus = existingFocusCount === 0;

    // D1 someday-no-plan: only scaffold a plan when targetDate is set.
    // kind-gate: only fitness goals scaffold a (fitness-template) plan.
    const plansCreate = targetDate !== null && kind === "fitness"
      ? {
          create: (() => {
            const now = new Date();
            const weeks = weeksBetween(now, targetDate);
            const endsOn = targetDate;
            return buildPlanData({ objective, weeks, startedOn: now, endsOn });
          })(),
        }
      : undefined;

    return tx.goal.create({
      data: {
        objective,
        targetDate,
        notes: normalizedNotes,
        targets: targets ?? undefined,
        kind,
        active: true,
        isFocus: shouldBecomeFocus,
        ...(legendForCreate === undefined ? {} : { legend: legendForCreate }),
        ...(coachFeasibilityValue === undefined ? {} : { coachFeasibility: coachFeasibilityValue }),
        ...(attributionHints === undefined ? {} : { attributionHints }),
        ...(plansCreate ? { plans: plansCreate } : {}),
      },
      include: { plans: { select: { id: true } } },
    });
  });

  const planId = created.plans[0]?.id ?? null;
  return { goal: { id: created.id }, planId };
}

// ---------------------------------------------------------------------------
// ensurePlanForGoalCore
// ---------------------------------------------------------------------------
// D2 dated-upgrade: zero plans ⇒ scaffold + initial PlanRevision (created:true);
// any plan exists (even paused) ⇒ no-op (created:false).
// Called from MCP update_goal handler AND UI updateGoal action when a non-null
// date is set.
// ---------------------------------------------------------------------------

export interface EnsurePlanResult {
  planId: string | null;
  created: boolean;
}

export async function ensurePlanForGoalCore(
  goalId: string,
  targetDate: Date,
): Promise<EnsurePlanResult> {
  // kind-gate: plans are fitness-template-based, so only fitness goals scaffold one.
  // Checked before the past-date guard so a non-fitness goal never throws on a stale
  // date for a plan it would never get. (rhino.the.grey regression, 2026-06-18.)
  const kindRow = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { kind: true },
  });
  if (!kindRow) throw new Error(`Goal ${goalId} not found`);
  if (kindRow.kind !== "fitness") {
    return { planId: null, created: false };
  }

  // H2 guard (upgrade path only): cannot scaffold a plan for a date already in the past.
  // Today is valid (targetKey === nowKey) — weeksBetween floors at 1 so a same-day upgrade
  // gets a 1-week plan rather than throwing. This guards only ensurePlanForGoalCore, not
  // createGoalCore's dated creation path.
  const nowKey = dateKey(new Date());
  const targetKey = dateKey(targetDate);
  if (targetKey < nowKey) {
    throw new Error(
      `targetDate is in the past (${targetKey}) — update the date or leave the goal as someday.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.plan.findFirst({
      where: { goalId },
      select: { id: true },
    });
    if (existing) {
      return { planId: existing.id, created: false };
    }

    const goal = await tx.goal.findUnique({
      where: { id: goalId },
      select: { objective: true },
    });
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const now = new Date();
    const weeks = weeksBetween(now, targetDate);
    const planData = buildPlanData({ objective: goal.objective, weeks, startedOn: now, endsOn: targetDate });

    const plan = await tx.plan.create({
      data: {
        goalId,
        ...planData,
      },
      select: { id: true },
    });

    return { planId: plan.id, created: true };
  });
}

// ---------------------------------------------------------------------------
// setGoalTrackedCore
// ---------------------------------------------------------------------------
// Toggle a goal's tracked (active) state.
// Guard: the focus goal cannot be untracked — switch focus to another goal
// first. Error message is intentionally identical to the goal-actions.ts
// caller so the MCP surface and the UI surface give the same error text.
// ---------------------------------------------------------------------------

export interface SetGoalTrackedCoreResult {
  id: string;
  active: boolean;
}

export async function setGoalTrackedCore(
  id: string,
  tracked: boolean,
): Promise<SetGoalTrackedCoreResult> {
  return prisma.$transaction(async (tx) => {
    const goal = await tx.goal.findUnique({
      where: { id },
      select: { id: true, isFocus: true },
    });
    if (!goal) throw new Error("Goal not found");
    if (!tracked && goal.isFocus) {
      throw new Error(
        "Cannot untrack the focus goal — switch focus to another goal first.",
      );
    }
    const updated = await tx.goal.update({
      where: { id },
      data: { active: tracked },
      select: { id: true, active: true },
    });
    return { id: updated.id, active: updated.active };
  });
}

// ---------------------------------------------------------------------------
// setPlanActiveCore
// ---------------------------------------------------------------------------
// Pause (active=false) or Resume (active=true) the goal's plan.
// Pause = set the goal's active plan to active=false (silences retest-marker
//   generation). Resume = re-activate the most-recent plan (mirror
//   setFocusGoal's latest-plan idiom).
// Guard: the focus goal's plan cannot be paused — UXR-62B-03.
// No new schema column: active=false IS the paused state; existing
//   active:true filters in getActiveGoalsWithPlans + goal-events already
//   silence a paused plan for free.
// Returns the planId that was activated/deactivated, or null when there was
//   no plan to resume (defensive no-op path — UI should not offer Resume then).
// ---------------------------------------------------------------------------

export interface SetPlanActiveCoreResult {
  goalId: string;
  planId: string | null;
  active: boolean;
}

export async function setPlanActiveCore(
  goalId: string,
  active: boolean,
): Promise<SetPlanActiveCoreResult> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { id: true, isFocus: true },
  });
  if (!goal) throw new Error("Goal not found");
  // Guard: cannot pause the focus goal's plan — switch focus first
  if (!active && goal.isFocus) {
    throw new Error(
      "Cannot pause the focus goal's plan — switch focus to another goal first.",
    );
  }

  if (!active) {
    // Pause: deactivate all active plans for this goal
    await prisma.plan.updateMany({
      where: { goalId, active: true },
      data: { active: false },
    });
    return { goalId, planId: null, active: false };
  } else {
    // Resume: re-activate the most-recent plan (mirror setFocusGoal's latest-plan idiom).
    // Wrap findFirst + updateMany + update in a transaction so the "at most one active
    // plan" invariant holds under concurrent writes.
    return prisma.$transaction(async (tx) => {
      const latest = await tx.plan.findFirst({
        where: { goalId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!latest) return { goalId, planId: null, active: true }; // No plan at all — defensive no-op; UI should not offer Resume then
      // Ensure at most one active plan (deactivate others first)
      await tx.plan.updateMany({
        where: { goalId, id: { not: latest.id } },
        data: { active: false },
      });
      await tx.plan.update({
        where: { id: latest.id },
        data: { active: true },
      });
      return { goalId, planId: latest.id, active: true };
    });
  }
}

// ---------------------------------------------------------------------------
// setFocusGoalCore
// ---------------------------------------------------------------------------
// Switch which goal drives Today/Calendar (Goal.isFocus — exactly one at a
// time). Extracted from the setFocusGoal server action so the MCP
// set_active_goal tool (project-tools.ts) shares the same transaction.
// Focus ⇒ active-plan invariant: the target goal is set active=true and its
// most-recent plan is re-activated — focusing a goal also resumes its paused
// plan. Other goals stay tracked (active untouched); only isFocus moves.
// ---------------------------------------------------------------------------

export interface SetFocusGoalCoreResult {
  previousFocusGoalId: string | null;
  goal: { id: string; kind: string; objective: string };
}

export async function setFocusGoalCore(id: string): Promise<SetFocusGoalCoreResult> {
  const oldFocus = await prisma.goal.findFirst({ where: { isFocus: true }, select: { id: true } });

  const goal = await prisma.$transaction(async (tx) => {
    const target = await tx.goal.findUnique({
      where: { id },
      select: { id: true, kind: true, objective: true },
    });
    if (!target) throw new Error(`Goal not found: ${id}`);

    // 1. Clear isFocus on all goals.
    await tx.goal.updateMany({ data: { isFocus: false } });

    // 2. Set isFocus + ensure active on the target goal.
    //    (A previously untracked goal that receives focus becomes tracked again.)
    await tx.goal.update({ where: { id }, data: { isFocus: true, active: true } });

    // 3. Ensure target goal has exactly one active plan (the latest).
    //    OTHER goals' plans are NOT touched — they stay active.
    const latest = await tx.plan.findFirst({
      where: { goalId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latest) {
      await tx.plan.updateMany({
        where: { goalId: id, id: { not: latest.id } },
        data: { active: false },
      });
      await tx.plan.update({ where: { id: latest.id }, data: { active: true } });
    }

    return target;
  });

  return { previousFocusGoalId: oldFocus?.id ?? null, goal };
}
