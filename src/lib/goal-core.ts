// Plain async helper for creating Goal + Plan + initial PlanRevision.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/goal-actions.ts) AND MCP route handlers / tool
// registrations (src/lib/mcp/tools.ts). Adding the directive would constrain
// it to server-action call sites only and break the MCP path.
//
// Validation guards live here as defensive contract checks; the form caller
// in goal-actions.ts also pre-checks for UI-friendly error messages.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { GoalTarget } from "@/lib/goal-targets";
import type { Legend } from "@/lib/legend";
import { scaffoldPlanFromTemplate, weeksBetween } from "@/lib/plan";

export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date;
  notes?: string | null;
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
  if (Number.isNaN(targetDate.getTime())) throw new Error("invalid targetDate");

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
  const weeks = weeksBetween(now, targetDate);

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

  // A new goal takes over focus: prior goals and their plans are deactivated
  // in the same transaction so Today/Calendar (which read active=true) start
  // reflecting the new goal immediately. Use setActiveGoal to switch back.
  const created = await prisma.$transaction(async (tx) => {
    await tx.goal.updateMany({ data: { active: false } });
    await tx.plan.updateMany({ data: { active: false } });
    return tx.goal.create({
      data: {
        objective,
        targetDate,
        notes: normalizedNotes,
        targets: targets ?? undefined,
        ...(legendForCreate === undefined ? {} : { legend: legendForCreate }),
        plans: {
          create: {
            name: `${objective} — ${weeks}-week plan`,
            startedOn: now,
            endsOn: targetDate,
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
