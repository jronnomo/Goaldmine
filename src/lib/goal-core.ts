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
import { addDays } from "@/lib/calendar";
import { scaffoldPlanFromTemplate, weeksBetween } from "@/lib/plan";

export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date | null; // null = someday goal (no calendar pin); defaults to 12-week plan
  notes?: string | null;
  kind?: "fitness" | "project";
  copyFromGoalId?: string | null;
  targets?: GoalTarget[] | null;
  legend?: Legend;
}

export interface CreateGoalCoreResult {
  goal: { id: string };
  planId: string;
}

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

  let targets: GoalTarget[] | null = input.targets ?? null;
  if (!targets && copyFromGoalId) {
    const source = await prisma.goal.findUnique({ where: { id: copyFromGoalId } });
    if (source && source.targets) {
      targets = source.targets as unknown as GoalTarget[];
    }
  }

  const now = new Date();
  // null targetDate = someday goal; default to 12 weeks (84 days).
  const weeks = targetDate ? weeksBetween(now, targetDate) : 12;
  const endsOn = targetDate ?? addDays(now, 84);

  // v2 — Concern H audit (recorded in PR notes): scaffoldPlanFromTemplate(1)
  // does NOT throw; weeksBetween clamps weeks to a minimum of 1, and
  // scaffoldPlanFromTemplate handles weeks=1 gracefully (returns a 1-phase,
  // 1-week template). Guard intentionally left commented out.
  // if (weeks < 2) throw new Error("targetDate too soon — need at least 2 weeks");

  const planTemplate = scaffoldPlanFromTemplate(weeks);

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
    return tx.goal.create({
      data: {
        objective,
        targetDate,
        notes: normalizedNotes,
        targets: targets ?? undefined,
        kind: input.kind ?? "fitness",
        active: true,
        isFocus: shouldBecomeFocus,
        ...(legendForCreate === undefined ? {} : { legend: legendForCreate }),
        plans: {
          create: {
            name: `${objective} — ${weeks}-week plan`,
            startedOn: now,
            endsOn,
            weeks,
            active: true,
            planJson: planTemplate as unknown as object,
            revisions: {
              create: {
                triggerSource: "manual",
                summary: "Initial plan from program template",
                reasoning: `Scaffolded from the program template, scaled to ${weeks} weeks across ${planTemplate.phases.length} phases.`,
                snapshotJson: planTemplate as unknown as object,
              },
            },
          },
        },
      },
      include: { plans: { select: { id: true } } },
    });
  });

  const planId = created.plans[0]?.id ?? "";
  return { goal: { id: created.id }, planId };
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
