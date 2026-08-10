"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  appendBaselineToDayWorkout,
  removeBaselineFromDayWorkout,
  syncBaselineUpdateToWorkout,
} from "@/lib/baseline-workout";
import { getDb } from "@/lib/db";
import { parseStrongWorkout } from "@/lib/parsers/strong";
import { createWorkoutCore } from "@/lib/workout-core";
import { parseItemsText } from "@/lib/items-text";
import {
  parseDateKey,
  startOfDay,
  dateKey,
  parseDatetimeLocalValue,
} from "@/lib/calendar";
import { normalizeMetricKey, BODY_METRIC_BY_KEY } from "@/lib/metrics-registry";
import { parseStoredItems } from "@/lib/nutrition-log-ops";
import type { NutritionItem } from "@/lib/nutrition-log-ops";
import { mergeMealDraft } from "@/lib/nutrition-merge";

export async function logMeasurement(form: FormData) {
  const weightLb = Number(form.get("weightLb"));
  const notes = (form.get("notes") as string | null)?.trim() || null;

  if (!Number.isFinite(weightLb) || weightLb <= 0) {
    throw new Error("Weight must be a positive number");
  }

  const db = await getDb();
  await db.measurement.create({
    data: {
      date: new Date(),
      weightLb,
      notes,
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/progress");
}

export async function logBodyMetric(form: FormData) {
  const rawKey = String(form.get("key") ?? "").trim();
  const key = normalizeMetricKey(rawKey);
  const value = Number(form.get("value"));
  const unit = (form.get("unit") as string | null)?.trim() || null;
  const dateStr = (form.get("date") as string | null)?.trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;

  if (!key) throw new Error("Metric is required");
  if (!Number.isFinite(value)) throw new Error("Value must be a number");

  const date = dateStr ? parseDateKey(dateStr) : startOfDay(new Date());
  const resolvedUnit = unit ?? BODY_METRIC_BY_KEY.get(key)?.units ?? null;

  const db = await getDb();
  await db.bodyMetric.create({
    data: { date, key, value, unit: resolvedUnit, notes, source: "manual" },
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/progress");
}

export async function logNote(form: FormData) {
  const body = (form.get("body") as string | null)?.trim();
  const type = ((form.get("type") as string | null) ?? "journal").trim();

  if (!body) throw new Error("Note body is required");

  const db = await getDb();
  await db.note.create({
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
  const db = await getDb();
  await db.baseline.create({ data: { testName, value, units, date, notes } });
  await appendBaselineToDayWorkout({ testName, value, units, date, notes });

  revalidatePath("/");
  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(testName)}`);
  revalidatePath("/progress");
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

  const db = await getDb();
  await db.baseline.create({
    data: { testName, value, units, date, notes },
  });
  await appendBaselineToDayWorkout({ testName, value, units, date, notes });

  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(testName)}`);
  revalidatePath("/progress");
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

  const db = await getDb();
  const before = await db.baseline.findUniqueOrThrow({ where: { id } });
  const updated = await db.baseline.update({
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
  revalidatePath("/progress");
  revalidatePath("/history");
  revalidatePath("/");
  redirect(`/baselines/test/${encodeURIComponent(updated.testName)}`);
}

export async function deleteBaselineRow(id: string) {
  const db = await getDb();
  const row = await db.baseline.findUniqueOrThrow({ where: { id } });
  await db.baseline.delete({ where: { id } });
  await removeBaselineFromDayWorkout({ testName: row.testName, date: row.date });
  revalidatePath("/baselines");
  revalidatePath(`/baselines/test/${encodeURIComponent(row.testName)}`);
  revalidatePath("/progress");
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
// When the field is absent (quick create with no When picker), "now" is
// correct. The actual parse delegates to calendar-core's parseDatetimeLocalValue
// (this file is "use server" — all its exports must be async functions, so the
// pure regex parse lives there instead, where it's unit-testable).
function parseUserTzDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  return parseDatetimeLocalValue(dateStr);
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
  // Macros-only "custom" meals are valid: items may be empty when at least one
  // macro value was entered. (Callers also validate client-side — thrown Errors
  // here are redacted to a generic digest message in production.)
  const macros = parseMacros(form);
  if (items.length === 0 && !Object.values(macros).some((v) => v != null)) {
    throw new Error("Add at least one item, or enter macros");
  }

  const date = parseUserTzDate(dateStr);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  const db = await getDb();
  await db.nutritionLog.create({
    data: { date, mealType, items, notes, ...macros },
  });

  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/nutrition");
  // #294: the day-detail page has its own log entry point (defaultDate-seeded
  // MealComposer), so a backfilled/pre-planned meal must bust that exact day's
  // route too — "/", "layout" covers pages nested under the root layout in
  // theory, but this route is dynamic-per-day, so revalidate it explicitly.
  revalidatePath(`/days/${dateKey(date)}`);
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
  // Same macros-only rule as logNutrition: empty items OK when macros present.
  const macros = parseMacros(form);
  if (items.length === 0 && !Object.values(macros).some((v) => v != null)) {
    throw new Error("Add at least one item, or enter macros");
  }

  const date = parseUserTzDate(dateStr);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  const db = await getDb();
  await db.nutritionLog.update({
    where: { id },
    data: { mealType, items, notes, date, ...macros },
  });

  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/nutrition");
  revalidatePath(`/days/${dateKey(date)}`); // #294 — see logNutrition
  return { ok: true as const };
}

// #295 (B4c): fold a just-composed meal INTO an existing NutritionLog row for
// the same USER_TZ day + meal slot, instead of creating a duplicate row.
//
// This is deliberately the updateNutrition-style path (project gotcha:
// "nutrition has two edit paths") — ONE full-row write carries items and the
// macro columns together, so they can never desync the way the items[]-only
// nutrition_log_ops path would.
//
// Merge rules live in the pure, unit-tested @/lib/nutrition-merge:
//   items  — concatenated (existing row's first);
//   macros — per-field: summed when BOTH sides recorded it, else null (once
//            unrecorded items are folded in, any number would misstate the
//            combined meal — honest unknown, mirroring parseMacros' empty⇒null);
//   notes  — joined with a newline when both present.
//
// The existing row is re-read here (tenant-scoped) rather than trusted from
// the client, so a stale threaded copy can never clobber edits made elsewhere
// between render and submit.
export async function appendNutrition(existingId: string, form: FormData) {
  const mealType = String(form.get("mealType") ?? "").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const dateStr = (form.get("date") as string | null)?.trim();

  if (!MEAL_TYPES.has(mealType)) throw new Error("Invalid meal type");

  // Same itemsJson-authoritative / text-fallback parse as logNutrition.
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
  // Same macros-only rule as logNutrition: empty items OK when macros present.
  const macros = parseMacros(form);
  if (items.length === 0 && !Object.values(macros).some((v) => v != null)) {
    throw new Error("Add at least one item, or enter macros");
  }

  const date = parseUserTzDate(dateStr);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");

  const db = await getDb();
  // Tenant-scoped findUnique — resolves to null for another user's row.
  const existing = await db.nutritionLog.findUnique({ where: { id: existingId } });
  if (!existing) {
    throw new Error("That meal no longer exists — log it as a separate entry");
  }
  // The choice UI matched on (day, slot); if either drifted between render and
  // submit (row edited/moved elsewhere), appending would silently put food on
  // the wrong meal — refuse instead of guessing.
  if (existing.mealType !== mealType || dateKey(existing.date) !== dateKey(date)) {
    throw new Error("That meal changed — log it as a separate entry");
  }

  const merged = mergeMealDraft(
    {
      items: parseStoredItems(existing.items),
      macros: {
        calories: existing.calories,
        proteinG: existing.proteinG,
        carbsG: existing.carbsG,
        fatG: existing.fatG,
        fiberG: existing.fiberG,
        sodiumMg: existing.sodiumMg,
      },
      notes: existing.notes,
    },
    { items, macros, notes },
  );

  // date + mealType intentionally untouched: appending folds food into the
  // existing meal — its slot and timestamp stay put.
  await db.nutritionLog.update({
    where: { id: existingId },
    data: { items: merged.items, notes: merged.notes, ...merged.macros },
  });

  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/nutrition");
  revalidatePath(`/days/${dateKey(existing.date)}`); // #294 — see logNutrition
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
  const db = await getDb();
  const row = await db.nutritionLog.delete({ where: { id } });
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/nutrition");
  revalidatePath(`/days/${dateKey(row.date)}`); // #294 — see logNutrition
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

  const db = await getDb();
  await db.nutritionLog.create({
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
