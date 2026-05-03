"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { ProgramTemplate } from "@/lib/program-template";

export type ApplyRevisionInput = {
  planId: string;
  triggerNoteId?: string | null;
  triggerSource: "manual" | "note" | "claude";
  summary: string;
  reasoning: string;
  /** Full plan template after this revision. Required. */
  snapshotJson: ProgramTemplate;
};

export async function applyPlanRevisionRaw(input: ApplyRevisionInput) {
  if (!input.summary.trim()) throw new Error("Summary is required");
  if (!input.snapshotJson) throw new Error("Snapshot JSON is required");

  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });

  const revision = await prisma.$transaction(async (tx) => {
    const r = await tx.planRevision.create({
      data: {
        planId: plan.id,
        triggerNoteId: input.triggerNoteId ?? null,
        triggerSource: input.triggerSource,
        summary: input.summary.trim(),
        reasoning: input.reasoning.trim() || null,
        snapshotJson: input.snapshotJson as unknown as object,
      },
    });
    await tx.plan.update({
      where: { id: plan.id },
      data: { planJson: input.snapshotJson as unknown as object },
    });
    return r;
  });

  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${plan.goalId}`);
  return revision.id;
}

/** Form-action shim used by the revise page. */
export async function applyPlanRevisionFromForm(planId: string, form: FormData) {
  const triggerNoteId = (form.get("triggerNoteId") as string | null) || null;
  const summary = String(form.get("summary") ?? "").trim();
  const reasoning = String(form.get("reasoning") ?? "").trim();
  const snapshotRaw = String(form.get("snapshot") ?? "").trim();

  if (!summary) throw new Error("Summary is required");
  if (!snapshotRaw) throw new Error("Snapshot JSON is required");

  let snapshot: ProgramTemplate;
  try {
    snapshot = JSON.parse(snapshotRaw) as ProgramTemplate;
  } catch (e) {
    throw new Error(`Invalid snapshot JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });

  await prisma.$transaction(async (tx) => {
    await tx.planRevision.create({
      data: {
        planId,
        triggerNoteId: triggerNoteId || null,
        triggerSource: triggerNoteId ? "note" : "manual",
        summary,
        reasoning: reasoning || null,
        snapshotJson: snapshot as unknown as object,
      },
    });
    await tx.plan.update({
      where: { id: planId },
      data: { planJson: snapshot as unknown as object },
    });
  });

  revalidatePath("/");
  revalidatePath(`/goals/${plan.goalId}`);
  redirect(`/goals/${plan.goalId}`);
}
