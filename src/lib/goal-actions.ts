"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  MT_ELBERT_DEFAULT_TARGETS,
  type GoalTarget,
} from "@/lib/goal-targets";

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

export async function resetGoalToMtElbertDefaults(id: string) {
  await prisma.goal.update({
    where: { id },
    data: { targets: MT_ELBERT_DEFAULT_TARGETS },
  });
  revalidatePath(`/goals/${id}`);
  revalidatePath("/stats");
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
