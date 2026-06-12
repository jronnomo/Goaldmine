"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  appendBaselineToDayWorkout,
  removeBaselineFromDayWorkout,
  syncBaselineUpdateToWorkout,
} from "@/lib/baseline-workout";
import { prisma } from "@/lib/db";
import { parseStrongWorkout } from "@/lib/parsers/strong";
import { createWorkoutCore } from "@/lib/workout-core";

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
  revalidatePath("/progress");
  revalidatePath("/stats");
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
  revalidatePath("/journal");
}

// Inline-row variant of logBaseline used by Today's BaselineBlockCard. Same
// underlying writes as logBaseline — just no redirect, so the user stays on
// the page they were on (typically Today) and the checkmark renders in place.
export async function logBaselineInline(form: FormData) {
  const testName = String(form.get("testName") ?? "").trim();
  const value = Number(form.get("value"));
  const units = String(form.get("units") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;

  if (!testName) throw new Error("Test name is required");
  if (!Number.isFinite(value)) throw new Error("Value must be a number");
  if (!units) throw new Error("Units are required");

  const date = new Date();
  await prisma.baseline.create({ data: { testName, value, units, date, notes } });
  await appendBaselineToDayWorkout({ testName, value, units, date, notes });

  revalidatePath("/");
  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(testName)}`);
  revalidatePath("/stats");
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
  await appendBaselineToDayWorkout({ testName, value, units, date, notes });

  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(testName)}`);
  revalidatePath("/stats");
  revalidatePath("/history");
  revalidatePath("/");
  redirect(`/baselines/test/${encodeURIComponent(testName)}`);
}

export async function updateBaseline(id: string, form: FormData) {
  const value = Number(form.get("value"));
  const units = String(form.get("units") ?? "").trim();
  const dateStr = (form.get("date") as string | null)?.trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;

  if (!Number.isFinite(value)) throw new Error("Value must be a number");
  if (!units) throw new Error("Units are required");

  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  const before = await prisma.baseline.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.baseline.update({
    where: { id },
    data: { value, units, date, notes },
  });
  await syncBaselineUpdateToWorkout({
    testName: updated.testName,
    oldDate: before.date,
    oldValue: before.value,
    newDate: updated.date,
    newValue: updated.value,
    newUnits: updated.units,
    newNotes: updated.notes,
  });

  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(updated.testName)}`);
  revalidatePath("/stats");
  revalidatePath("/history");
  revalidatePath("/");
  redirect(`/baselines/test/${encodeURIComponent(updated.testName)}`);
}

export async function deleteBaselineRow(id: string) {
  const row = await prisma.baseline.findUniqueOrThrow({ where: { id } });
  await prisma.baseline.delete({ where: { id } });
  await removeBaselineFromDayWorkout({ testName: row.testName, date: row.date });
  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(row.testName)}`);
  revalidatePath("/stats");
  revalidatePath("/history");
  revalidatePath("/");
  redirect(`/baselines/test/${encodeURIComponent(row.testName)}`);
}

const MEAL_TYPES = new Set([
  "preworkout",
  "postworkout",
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);

type NutritionItem = { name: string; qty?: string; notes?: string };

// Each line is "name | qty | notes" (qty/notes optional). Blank lines skipped.
function parseItemsTextarea(raw: string): NutritionItem[] {
  const out: NutritionItem[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [namePart, qtyPart, notesPart] = trimmed.split("|").map((p) => p.trim());
    if (!namePart) continue;
    out.push({
      name: namePart,
      ...(qtyPart ? { qty: qtyPart } : {}),
      ...(notesPart ? { notes: notesPart } : {}),
    });
  }
  return out;
}

// Parse the 6 optional macro inputs. Empty → null (lets an edit clear a value);
// non-numeric / negative → null.
function parseMacros(form: FormData) {
  const read = (key: string): number | null => {
    const raw = String(form.get(key) ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    calories: read("calories"),
    proteinG: read("proteinG"),
    carbsG: read("carbsG"),
    fatG: read("fatG"),
    fiberG: read("fiberG"),
    sodiumMg: read("sodiumMg"),
  };
}

export async function logNutrition(form: FormData) {
  const mealType = String(form.get("mealType") ?? "").trim();
  const itemsRaw = String(form.get("items") ?? "");
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const dateStr = (form.get("date") as string | null)?.trim();

  if (!MEAL_TYPES.has(mealType)) throw new Error("Invalid meal type");
  const items = parseItemsTextarea(itemsRaw);
  if (items.length === 0) throw new Error("List at least one food item");

  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  await prisma.nutritionLog.create({
    data: { date, mealType, items, notes, ...parseMacros(form) },
  });

  revalidatePath("/");
  revalidatePath("/nutrition");
}

export async function updateNutrition(id: string, form: FormData) {
  const mealType = String(form.get("mealType") ?? "").trim();
  const itemsRaw = String(form.get("items") ?? "");
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const dateStr = (form.get("date") as string | null)?.trim();

  if (!MEAL_TYPES.has(mealType)) throw new Error("Invalid meal type");
  const items = parseItemsTextarea(itemsRaw);
  if (items.length === 0) throw new Error("List at least one food item");

  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  await prisma.nutritionLog.update({
    where: { id },
    data: { mealType, items, notes, date, ...parseMacros(form) },
  });

  revalidatePath("/");
  revalidatePath("/nutrition");
  redirect("/nutrition");
}

export async function deleteNutrition(id: string) {
  await prisma.nutritionLog.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/nutrition");
  redirect("/nutrition");
}

export async function importStrongWorkout(form: FormData) {
  const raw = (form.get("raw") as string | null) ?? "";
  if (!raw.trim()) throw new Error("Paste a workout to import");

  const parsed = parseStrongWorkout(raw);
  // Migrate to createWorkoutCore — behavior unchanged; recordsSet is ignored
  // here since the Strong import path doesn't surface PR strips (MCP path does).
  const { id } = await createWorkoutCore({
    title: parsed.title,
    startedAt: parsed.startedAt,
    status: "completed",
    source: "strong.app",
    sourceUrl: parsed.sourceUrl,
    exercises: parsed.exercises.map((ex) => ({
      name: ex.name,
      equipment: ex.equipment ?? null,
      orderIndex: ex.orderIndex,
      sets: ex.sets.map((s) => ({
        setIndex: s.setIndex,
        reps: s.reps ?? null,
        weightLb: s.weightLb ?? null,
        durationSec: s.durationSec ?? null,
      })),
    })),
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/workouts/${id}`);
  return id;
}
