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
import { parseItemsText } from "@/lib/items-text";
import { userTzWallClockToUTC } from "@/lib/calendar";
import { parseStoredItems } from "@/lib/nutrition-log-ops";
import type { NutritionItem } from "@/lib/nutrition-log-ops";

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

// Items textarea parsing now lives in the shared, server-safe @/lib/items-text
// module (parseItemsText) so the meal edit UI and these actions stay in lockstep.

// Parse the `name="date"` hidden field. The composer submits a USER_TZ
// wall-clock "YYYY-MM-DDTHH:MM" (via toDatetimeLocalValue), so it MUST be
// interpreted in USER_TZ — `new Date(dateStr)` parses datetime-local strings as
// server-local/UTC and shifts the meal by the TZ offset (UXR-meal-edit-11).
// When the field is absent (quick create with no When picker), "now" is correct.
function parseUserTzDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    return userTzWallClockToUTC(
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
    );
  }
  // Unexpected shape — fall back to permissive parse (validated by caller).
  return new Date(dateStr);
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
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const dateStr = (form.get("date") as string | null)?.trim();

  if (!MEAL_TYPES.has(mealType)) throw new Error("Invalid meal type");

  // itemsJson is the authoritative structured channel (carries amount/unit/source);
  // falls back to the text `items` field for rawMode / legacy paths.
  const itemsJsonRaw = form.get("itemsJson") as string | null;
  let items: NutritionItem[];
  if (itemsJsonRaw) {
    try {
      items = parseStoredItems(JSON.parse(itemsJsonRaw));
    } catch {
      items = parseItemsText(String(form.get("items") ?? ""));
    }
  } else {
    items = parseItemsText(String(form.get("items") ?? ""));
  }
  if (items.length === 0) throw new Error("List at least one food item");

  const date = parseUserTzDate(dateStr);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  await prisma.nutritionLog.create({
    data: { date, mealType, items, notes, ...parseMacros(form) },
  });

  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/nutrition");
}

// De-redirected for in-place use (UXR-meal-edit-12): the BottomSheet host awaits
// this, then closes the sheet over the (already-revalidated) list at the same
// scroll position — no navigation. The full-page /nutrition/[id]/edit fallback
// navigates back to /nutrition at the page/client level (EditNutritionForm's
// onSaved), NOT via a redirect baked into this shared action.
export async function updateNutrition(id: string, form: FormData) {
  const mealType = String(form.get("mealType") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const dateStr = (form.get("date") as string | null)?.trim();

  if (!MEAL_TYPES.has(mealType)) throw new Error("Invalid meal type");

  // itemsJson is the authoritative structured channel (carries amount/unit/source);
  // falls back to the text `items` field for rawMode / legacy paths.
  const itemsJsonRaw = form.get("itemsJson") as string | null;
  let items: NutritionItem[];
  if (itemsJsonRaw) {
    try {
      items = parseStoredItems(JSON.parse(itemsJsonRaw));
    } catch {
      items = parseItemsText(String(form.get("items") ?? ""));
    }
  } else {
    items = parseItemsText(String(form.get("items") ?? ""));
  }
  if (items.length === 0) throw new Error("List at least one food item");

  const date = parseUserTzDate(dateStr);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  await prisma.nutritionLog.update({
    where: { id },
    data: { mealType, items, notes, date, ...parseMacros(form) },
  });

  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/nutrition");
  return { ok: true as const };
}

// Deleted-meal snapshot — everything restoreNutrition needs to re-create the row.
export type NutritionSnapshot = {
  mealType: string;
  items: NutritionItem[];
  notes: string | null;
  /** Original instant as an ISO string (a real UTC instant, not a wall clock). */
  dateISO: string;
  macros: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  };
};

// De-redirected (UXR-meal-edit-12): returns the deleted row's snapshot so the
// optimistic-delete/Undo flow (UXR-meal-edit-13) can restore it. Navigation for
// the full-page fallback is handled by EditNutritionForm's onDeleted.
export async function deleteNutrition(id: string): Promise<NutritionSnapshot> {
  const row = await prisma.nutritionLog.delete({ where: { id } });
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/nutrition");
  return {
    mealType: row.mealType,
    items: parseStoredItems(row.items),
    notes: row.notes,
    dateISO: row.date.toISOString(),
    macros: {
      calories: row.calories,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      fiberG: row.fiberG,
      sodiumMg: row.sodiumMg,
    },
  };
}

// Re-create a deleted meal from a snapshot (UXR-meal-edit-13). A new row id is
// fine — it restores the *meal*, not its identity. dateISO is a real instant, so
// it round-trips through `new Date()` without TZ reparse.
//
// NOTE (polish slice): the Undo flow is now TRULY non-destructive — NutritionList
// defers the deleteNutrition commit behind the Undo window and simply un-hides on
// Undo, so it no longer calls restoreNutrition. Kept as a safety fallback / a
// generic re-create helper (e.g. an MCP-driven restore); not currently referenced
// by the UI.
export async function restoreNutrition(snap: NutritionSnapshot) {
  if (!MEAL_TYPES.has(snap.mealType)) throw new Error("Invalid meal type");
  const date = new Date(snap.dateISO);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  await prisma.nutritionLog.create({
    data: {
      date,
      mealType: snap.mealType,
      items: snap.items,
      notes: snap.notes,
      ...snap.macros,
    },
  });

  revalidatePath("/");
  revalidatePath("/nutrition");
  return { ok: true as const };
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
