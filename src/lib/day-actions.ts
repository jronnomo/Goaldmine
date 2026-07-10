"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma, getDb } from "@/lib/db";
import { parseDateKey, rotationBaselineNamesForDate, startOfDay } from "@/lib/calendar";
import { getActiveProgram } from "@/lib/program";
import { assertBaselineDecisionMade, assertDayTemplateWithinSize, assertValidDayTemplate } from "@/lib/day-template-validation";

export async function upsertDayOverrideFromForm(dateKey: string, form: FormData) {
  const workoutRaw = (form.get("workoutJson") as string | null)?.trim() || null;
  const nutritionText = (form.get("nutritionText") as string | null)?.trim() || null;
  const mobilityText = (form.get("mobilityText") as string | null)?.trim() || null;
  const notes = (form.get("notes") as string | null)?.trim() || null;

  const program = await getActiveProgram();
  if (!program) throw new Error("No active plan");

  const date = startOfDay(parseDateKey(dateKey));

  let workoutJson: unknown = null;
  if (workoutRaw) {
    try {
      workoutJson = JSON.parse(workoutRaw);
    } catch (e) {
      throw new Error(`Invalid workout JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Structural + size validation — same order and messages as the MCP path
    // (applyDayOverrideCore, tools.ts). Size first, then shape.
    assertDayTemplateWithinSize(workoutJson);
    assertValidDayTemplate(workoutJson);
  }

  // Audible-with-baselines guard: the dashboard form has no baselineTestNames
  // affordance yet (#235), so baselineInputProvided is always false here —
  // matches the MCP path's guard semantics for a caller that never touches
  // that field. settingWorkout mirrors the form's blank-vs-populated collapse:
  // a never-touched textarea and an explicit clear both parse to `null`
  // workoutJson, so both correctly skip the guard (nothing to audit when no
  // workout is being set).
  const existing = await prisma.planDayOverride.findUnique({ // non-scoped: plan override table
    where: { planId_date: { planId: program.id, date } },
  });
  assertBaselineDecisionMade({
    settingWorkout: workoutJson !== null,
    baselineInputProvided: false,
    existingBaselineTestNames: existing?.baselineTestNames,
    rotationBaselineNames: rotationBaselineNamesForDate(program, date),
    dateKey,
  });

  // If everything is null/empty, treat as "remove override".
  if (!workoutJson && !nutritionText && !mobilityText && !notes) {
    await prisma.planDayOverride.deleteMany({ where: { planId: program.id, date } }); // non-scoped: plan override table
  } else {
    await prisma.planDayOverride.upsert({ // non-scoped: plan override table
      where: { planId_date: { planId: program.id, date } },
      create: {
        planId: program.id,
        date,
        workoutJson: workoutJson ?? undefined,
        nutritionText,
        mobilityText,
        notes,
      },
      update: {
        workoutJson: workoutJson === null ? Prisma.JsonNull : (workoutJson as Prisma.InputJsonValue),
        nutritionText,
        mobilityText,
        notes,
      },
    });
  }

  revalidatePath("/calendar");
  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
}

export async function clearDayOverride(dateKey: string) {
  const program = await getActiveProgram();
  if (!program) throw new Error("No active plan");
  const date = startOfDay(parseDateKey(dateKey));
  await prisma.planDayOverride.deleteMany({ where: { planId: program.id, date } }); // non-scoped: plan override table
  revalidatePath("/calendar");
  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
}

export async function logNoteForDate(dateKey: string, form: FormData) {
  const body = (form.get("body") as string | null)?.trim();
  const type = (form.get("type") as string | null)?.trim() || "audible";
  if (!body) throw new Error("Note body is required");

  const targetDate = startOfDay(parseDateKey(dateKey));
  const db = await getDb();
  await db.note.create({
    data: {
      body,
      type,
      targetDate,
    },
  });
  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
  redirect(`/days/${dateKey}`);
}
