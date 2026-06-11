"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDateKey } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { createGoalCore } from "@/lib/goal-core";
import { isFlavorKey, legendForFlavor } from "@/lib/goal-flavors";
import type { GoalTarget } from "@/lib/goal-targets";

export type GoalReference = {
  id: string;
  kind: "url" | "doc";
  value: string;
  label?: string;
  addedAt: string;
  claudeSummary?: string;
};

function parseTargetsField(raw: FormDataEntryValue | null): GoalTarget[] | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("targets must be an array");
    return parsed as GoalTarget[];
  } catch (e) {
    throw new Error(`Invalid targets JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function createGoal(form: FormData) {
  const objective = String(form.get("objective") ?? "").trim();
  const targetDateStr = String(form.get("targetDate") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const copyFromGoalId = (form.get("copyFromGoalId") as string | null)?.trim() || null;

  // UI-friendly guards (kept). Core re-checks defensively.
  if (!objective) throw new Error("Objective is required");
  // targetDate is now optional — omitting it creates a someday goal.

  // v2 — Concern D: align with MCP path; both routes store USER_TZ midnight
  // via the calendar helper instead of `new Date(yyyy-mm-dd)` (which yields
  // UTC midnight, rendering one calendar cell early in MT). HTML
  // <input type="date"> returns yyyy-mm-dd; parseDateKey accepts that.
  // parseDateKey itself does NOT validate the format (it Number-coerces the
  // split parts), so the NaN guard below is retained to catch malformed input.
  const targetDate = targetDateStr ? parseDateKey(targetDateStr) : null;
  if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("Invalid target date");

  const targets = parseTargetsField(form.get("targets"));

  // Flavor picker → preset legend lookup. "custom" + unknown values pass null
  // (goal saves with legend: null; Claude proposes one in claude.ai per
  // server-instructions rule 11).
  const flavorRaw = (form.get("flavor") as string | null)?.trim() ?? "";
  const legend = isFlavorKey(flavorRaw) ? legendForFlavor(flavorRaw) : null;

  const { goal } = await createGoalCore({
    objective,
    targetDate,
    notes,
    copyFromGoalId,
    targets,
    legend: legend ?? undefined,
  });

  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/calendar");
  revalidatePath("/stats");
  redirect(`/goals/${goal.id}`);
}

export async function copyTargetsFromGoal(toId: string, fromId: string) {
  if (toId === fromId) throw new Error("Cannot copy a goal's targets onto itself");
  const source = await prisma.goal.findUniqueOrThrow({ where: { id: fromId } });
  await prisma.goal.update({
    where: { id: toId },
    data: { targets: source.targets ?? undefined },
  });
  revalidatePath(`/goals/${toId}`);
  revalidatePath("/stats");
}

export async function updateGoal(id: string, form: FormData) {
  const objective = String(form.get("objective") ?? "").trim();
  const targetDateStr = String(form.get("targetDate") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const status = String(form.get("status") ?? "active").trim();
  const targets = parseTargetsField(form.get("targets"));

  if (!objective) throw new Error("Objective is required");
  // targetDate is now optional — blank clears it (makes goal a someday goal).

  // v2 — Mirror createGoal: parseDateKey yields USER_TZ midnight, whereas
  // `new Date(yyyy-mm-dd)` yields UTC midnight which shifts one calendar cell
  // early in MT. parseDateKey doesn't validate format, so the NaN guard below
  // catches malformed input from a bugged or tampered form submission.
  const targetDate = targetDateStr ? parseDateKey(targetDateStr) : null;
  if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("Invalid target date");

  // status (active/achieved/abandoned) is lifecycle metadata. Goal.active is
  // the tracking flag; Goal.isFocus is which goal drives Today/Calendar.
  // They are independent — use setFocusGoal to change focus.
  await prisma.goal.update({
    where: { id },
    data: {
      objective,
      targetDate,
      notes,
      status,
      targets: targets ?? undefined,
    },
  });

  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  revalidatePath("/calendar");
  revalidatePath("/stats");
}

export async function setFocusGoal(id: string) {
  // Fetch old focus id before transaction so we can revalidate its detail page.
  const oldFocus = await prisma.goal.findFirst({ where: { isFocus: true }, select: { id: true } });
  const oldFocusId = oldFocus?.id ?? null;

  await prisma.$transaction(async (tx) => {
    const target = await tx.goal.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new Error("Goal not found");

    // 1. Clear isFocus on all goals.
    await tx.goal.updateMany({ data: { isFocus: false } });

    // 2. Set isFocus + ensure active on the target goal.
    //    (A previously untracked goal that receives focus becomes tracked again.)
    await tx.goal.update({ where: { id }, data: { isFocus: true, active: true } });

    // 3. Ensure target goal has exactly one active plan (the latest).
    //    OTHER goals' plans are NOT touched — they stay active.
    //    NOTE: NO global goal/plan deactivation — this is the core invariant change.
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
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  if (oldFocusId && oldFocusId !== id) revalidatePath(`/goals/${oldFocusId}`);
  revalidatePath("/stats");

  // Land the user on the calendar so the focus switch is visible immediately
  // (this matches the workflow of "select a goal, see its calendar").
  redirect("/calendar");
}

/** @deprecated Use setFocusGoal instead */
export const setActiveGoal = setFocusGoal;

export async function setGoalTracked(id: string, tracked: boolean) {
  await prisma.$transaction(async (tx) => {
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
    await tx.goal.update({ where: { id }, data: { active: tracked } });
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/stats");
  // No redirect — stays on /goals (pill action)
}

export async function deleteGoal(id: string) {
  await prisma.goal.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/stats");
  redirect("/goals");
}


export async function addGoalReference(id: string, form: FormData) {
  const kind = (form.get("kind") as string | null) === "doc" ? "doc" : "url";
  const value = String(form.get("value") ?? "").trim();
  const label = (form.get("label") as string | null)?.trim() || undefined;

  if (!value) throw new Error("Reference value is required");
  if (kind === "url" && !/^https?:\/\//i.test(value)) {
    throw new Error("URLs must start with http:// or https://");
  }

  const goal = await prisma.goal.findUniqueOrThrow({ where: { id } });
  const refs = (goal.references as unknown as GoalReference[] | null) ?? [];
  const next: GoalReference[] = [
    ...refs,
    {
      id: randomUUID(),
      kind,
      value,
      label,
      addedAt: new Date().toISOString(),
    },
  ];

  await prisma.goal.update({ where: { id }, data: { references: next } });
  revalidatePath(`/goals/${id}`);
}

export async function removeGoalReference(id: string, refId: string) {
  const goal = await prisma.goal.findUniqueOrThrow({ where: { id } });
  const refs = (goal.references as unknown as GoalReference[] | null) ?? [];
  const next = refs.filter((r) => r.id !== refId);
  await prisma.goal.update({ where: { id }, data: { references: next } });
  revalidatePath(`/goals/${id}`);
}

/**
 * Pause (active=false) or Resume (active=true) the goal's plan.
 * Pause = set the goal's active plan to active=false (silences retest-marker generation).
 * Resume = re-activate the most-recent plan (mirror setFocusGoal's latest-plan idiom).
 * Guard: the focus goal's plan cannot be paused — UXR-62B-03.
 * No new schema column: active=false IS the paused state; existing active:true filters
 * in getActiveGoalsWithPlans + goal-events already silence a paused plan for free.
 */
export async function setPlanActive(goalId: string, active: boolean) {
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
  } else {
    // Resume: re-activate the most-recent plan (mirror setFocusGoal's latest-plan idiom)
    const latest = await prisma.plan.findFirst({
      where: { goalId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest) return; // No plan at all — defensive no-op; UI should not offer Resume then
    // Ensure at most one active plan (deactivate others first)
    await prisma.plan.updateMany({
      where: { goalId, id: { not: latest.id } },
      data: { active: false },
    });
    await prisma.plan.update({
      where: { id: latest.id },
      data: { active: true },
    });
  }

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath(`/goals/${goalId}`);
  // No redirect — stays on current page
}
