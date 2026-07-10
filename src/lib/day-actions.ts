"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma, getDb } from "@/lib/db";
import { parseDateKey, rotationBaselineNamesForDate, startOfDay } from "@/lib/calendar";
import { getActiveProgram } from "@/lib/program";
import { assertBaselineDecisionMade, assertDayTemplateWithinSize, assertValidDayTemplate } from "@/lib/day-template-validation";

export async function upsertDayOverrideFromForm(dateKey: string, form: FormData) {
  // Tri-state workoutJson (#235 R1): the structured editor only renders the
  // hidden `workoutJson` input when the user actually touched the workout
  // (isTemplateDirty). Three distinct FormData states, not two:
  //   - field ABSENT entirely → untouched: skip the guard, don't touch the
  //     workoutJson column at all (a pure nutrition/mobility/notes save on a
  //     day with an existing workout override must leave that workout alone).
  //   - field present, blank → explicit wipe (today's semantics, unchanged).
  //   - field present, real JSON → full #234 pipeline (parse/size/shape/guard).
  const workoutFieldProvided = form.has("workoutJson");
  const workoutRaw = workoutFieldProvided ? ((form.get("workoutJson") as string | null) ?? "").trim() || null : null;
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
  // that field. settingWorkout is true only when the field was PROVIDED and
  // parsed to a real template — an absent field (untouched workout) and an
  // explicit blank (wipe) both correctly skip the guard (nothing to audit
  // when no workout is being set).
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

  // Delete-collapse must reason about the FINAL workout state, not the raw
  // local `workoutJson` var — when the field is absent, "no workout" isn't
  // true just because the local var is null; the existing row's workout (if
  // any) survives untouched. Without this, a nutrition-only save that blanks
  // the other three text fields on a day whose override has ONLY a workout
  // override would silently delete the whole row, destroying the untouched
  // workout (#235 R1).
  const finalWorkoutPresent = workoutFieldProvided ? workoutJson !== null : !!existing?.workoutJson;

  if (!finalWorkoutPresent && !nutritionText && !mobilityText && !notes) {
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
        // Omit the key entirely when the field wasn't provided so Prisma
        // leaves the existing workoutJson column untouched.
        ...(workoutFieldProvided
          ? { workoutJson: workoutJson === null ? Prisma.JsonNull : (workoutJson as Prisma.InputJsonValue) }
          : {}),
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
