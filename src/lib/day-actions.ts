"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/calendar";
import { getActiveProgram } from "@/lib/program";

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
  }

  // If everything is null/empty, treat as "remove override".
  if (!workoutJson && !nutritionText && !mobilityText && !notes) {
    await prisma.planDayOverride.deleteMany({ where: { planId: program.id, date } });
  } else {
    await prisma.planDayOverride.upsert({
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
  await prisma.planDayOverride.deleteMany({ where: { planId: program.id, date } });
  revalidatePath("/calendar");
  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
}

export async function logNoteForDate(dateKey: string, form: FormData) {
  const body = (form.get("body") as string | null)?.trim();
  const type = (form.get("type") as string | null)?.trim() || "audible";
  if (!body) throw new Error("Note body is required");

  const targetDate = startOfDay(parseDateKey(dateKey));
  await prisma.note.create({
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

function parseDateKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
