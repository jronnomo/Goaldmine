// src/lib/nutrition-merge.ts
// Pure merge rules for appending a just-composed meal draft into an EXISTING
// NutritionLog row (#295 — append-to-existing-meal vs new-meal choice), plus
// the append-target detection the composer's choice UI derives from.
//
// Client- AND server-safe: no Prisma, no React. The server action
// (appendNutrition in workout-actions.ts) is the only writer; it must go
// through THIS module so items and the macro columns are always written
// together in one full-row update — the project gotcha ("nutrition has two
// edit paths") is that items[]-only writes desync the stored macro totals.

import type { NutritionItem } from "@/lib/nutrition-log-ops";

/** The six macro columns on NutritionLog; null = "not recorded". */
export type MealMacros = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
};

export const MEAL_MACRO_KEYS = [
  "calories",
  "proteinG",
  "carbsG",
  "fatG",
  "fiberG",
  "sodiumMg",
] as const satisfies readonly (keyof MealMacros)[];

/**
 * Per-field macro merge: summed only when BOTH sides recorded a value,
 * otherwise null. A macro column states the WHOLE row's total — once items
 * with no recorded value for a field are folded in, any number would misstate
 * the combined meal, so the honest value is "unknown" (null). This mirrors
 * updateNutrition's parseMacros convention (empty field ⇒ null) and the app's
 * macro-honesty rules elsewhere (stale-flag, untested=0).
 *
 * 0 is a recorded value, not an absence: 0 + 5 = 5.
 */
export function mergeMacroField(
  a: number | null,
  b: number | null,
): number | null {
  return a != null && b != null ? a + b : null;
}

/** Apply mergeMacroField across all six macro columns independently. */
export function mergeMealMacros(a: MealMacros, b: MealMacros): MealMacros {
  return {
    calories: mergeMacroField(a.calories, b.calories),
    proteinG: mergeMacroField(a.proteinG, b.proteinG),
    carbsG: mergeMacroField(a.carbsG, b.carbsG),
    fatG: mergeMacroField(a.fatG, b.fatG),
    fiberG: mergeMacroField(a.fiberG, b.fiberG),
    sodiumMg: mergeMacroField(a.sodiumMg, b.sodiumMg),
  };
}

/**
 * Items concatenated — existing row's items first, appended draft's after.
 * Structured fields (amount/unit/source) pass through untouched so food-
 * resolved items keep live macro recalc in the edit composer. Non-mutating.
 */
export function mergeMealItems(
  existing: NutritionItem[],
  appended: NutritionItem[],
): NutritionItem[] {
  return [...existing, ...appended];
}

/**
 * Notes: both present ⇒ joined with a newline (existing first); one present ⇒
 * that one; neither ⇒ null. Whitespace-only strings count as absent (the
 * actions already `.trim() || null` their inputs; this keeps the helper safe
 * for raw row values too).
 */
export function mergeMealNotes(
  existing: string | null,
  appended: string | null,
): string | null {
  const a = existing?.trim() || null;
  const b = appended?.trim() || null;
  if (a && b) return `${a}\n${b}`;
  return a ?? b;
}

/** Everything the merge covers. date/mealType are intentionally NOT here — an
 *  append never moves or re-slots the existing meal. */
export type MealDraft = {
  items: NutritionItem[];
  macros: MealMacros;
  notes: string | null;
};

/** Full merge: items concatenated, macros per-field summed-or-nulled, notes joined. */
export function mergeMealDraft(existing: MealDraft, appended: MealDraft): MealDraft {
  return {
    items: mergeMealItems(existing.items, appended.items),
    macros: mergeMealMacros(existing.macros, appended.macros),
    notes: mergeMealNotes(existing.notes, appended.notes),
  };
}

// ── Append-target detection (#295) ──────────────────────────────────────────

/**
 * Compact, serializable stub of an already-logged NutritionLog row, threaded
 * from the hosting component (which already fetched the day's logs server-side)
 * into MealComposer — no client fetch. Powers the append-vs-separate choice.
 */
export type ExistingMealStub = {
  id: string;
  /** USER_TZ dateKey ("YYYY-MM-DD") of the row's date. */
  dateKey: string;
  mealType: string;
  /** items.length — 0 for macros-only "custom entry" rows. */
  itemCount: number;
  /** ISO timestamp — picks the most recent row when a slot has several. */
  dateISO: string;
};

/**
 * The row an "Add to existing" choice would append into: same USER_TZ day AND
 * same meal slot as the composed draft; when several rows already fragment the
 * slot, the most recent wins (ISO strings compare lexicographically). Null ⇒
 * no choice UI — the composer logs a separate entry exactly as before.
 */
export function findAppendTarget(
  stubs: ExistingMealStub[] | undefined,
  composedDateKey: string,
  mealType: string,
): ExistingMealStub | null {
  if (!stubs || stubs.length === 0) return null;
  let best: ExistingMealStub | null = null;
  for (const s of stubs) {
    if (s.dateKey !== composedDateKey || s.mealType !== mealType) continue;
    if (best === null || s.dateISO > best.dateISO) best = s;
  }
  return best;
}
