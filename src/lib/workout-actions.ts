"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseStrongWorkout } from "@/lib/parsers/strong";

export async function logMeasurement(form: FormData) {
  const weightLb = Number(form.get("weightLb"));
  const restingHrRaw = form.get("restingHr");
  const restingHr = restingHrRaw ? Number(restingHrRaw) : null;
  const notes = (form.get("notes") as string | null)?.trim() || null;

  if (!Number.isFinite(weightLb) || weightLb <= 0) {
    throw new Error("Weight must be a positive number");
  }

  await prisma.measurement.create({
    data: {
      date: new Date(),
      weightLb,
      restingHr,
      notes,
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
}

export async function logNote(form: FormData) {
  const body = (form.get("body") as string | null)?.trim();
  const type = ((form.get("type") as string | null) ?? "journal").trim();

  if (!body) throw new Error("Note body is required");

  await prisma.note.create({
    data: {
      date: new Date(),
      body,
      type,
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
}

export async function logBaseline(form: FormData) {
  const testName = String(form.get("testName") ?? "").trim();
  const value = Number(form.get("value"));
  const units = String(form.get("units") ?? "").trim();
  const dateStr = (form.get("date") as string | null)?.trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;

  if (!testName) throw new Error("Test name is required");
  if (!Number.isFinite(value)) throw new Error("Value must be a number");
  if (!units) throw new Error("Units are required");

  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  await prisma.baseline.create({
    data: { testName, value, units, date, notes },
  });

  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(testName)}`);
  revalidatePath("/stats");
  revalidatePath("/");
  redirect(`/baselines/test/${encodeURIComponent(testName)}`);
}

export async function importStrongWorkout(form: FormData) {
  const raw = (form.get("raw") as string | null) ?? "";
  if (!raw.trim()) throw new Error("Paste a workout to import");

  const parsed = parseStrongWorkout(raw);
  const created = await prisma.workout.create({
    data: {
      title: parsed.title,
      startedAt: parsed.startedAt,
      status: "completed",
      source: "strong.app",
      sourceUrl: parsed.sourceUrl,
      exercises: {
        create: parsed.exercises.map((ex) => ({
          name: ex.name,
          equipment: ex.equipment,
          orderIndex: ex.orderIndex,
          sets: {
            create: ex.sets.map((s) => ({
              setIndex: s.setIndex,
              reps: s.reps ?? null,
              weightLb: s.weightLb ?? null,
              durationSec: s.durationSec ?? null,
            })),
          },
        })),
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/workouts/${created.id}`);
  return created.id;
}
