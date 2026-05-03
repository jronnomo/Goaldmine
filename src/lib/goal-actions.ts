"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  MT_ELBERT_DEFAULT_TARGETS,
  type GoalTarget,
} from "@/lib/goal-targets";

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
  const useDefaults = form.get("useDefaults") === "on";

  if (!objective) throw new Error("Objective is required");
  if (!targetDateStr) throw new Error("Target date is required");
  const targetDate = new Date(targetDateStr);
  if (Number.isNaN(targetDate.getTime())) throw new Error("Invalid target date");

  const targets = useDefaults ? MT_ELBERT_DEFAULT_TARGETS : parseTargetsField(form.get("targets"));

  const goal = await prisma.goal.create({
    data: {
      objective,
      targetDate,
      notes,
      targets: targets ?? undefined,
    },
  });

  revalidatePath("/goals");
  revalidatePath("/stats");
  redirect(`/goals/${goal.id}`);
}

export async function updateGoal(id: string, form: FormData) {
  const objective = String(form.get("objective") ?? "").trim();
  const targetDateStr = String(form.get("targetDate") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const status = String(form.get("status") ?? "active").trim();
  const targets = parseTargetsField(form.get("targets"));

  if (!objective) throw new Error("Objective is required");
  if (!targetDateStr) throw new Error("Target date is required");

  await prisma.goal.update({
    where: { id },
    data: {
      objective,
      targetDate: new Date(targetDateStr),
      notes,
      status,
      active: status === "active",
      targets: targets ?? undefined,
    },
  });

  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  revalidatePath("/stats");
}

export async function deleteGoal(id: string) {
  await prisma.goal.delete({ where: { id } });
  revalidatePath("/goals");
  revalidatePath("/stats");
  redirect("/goals");
}
