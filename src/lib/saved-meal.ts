// src/lib/saved-meal.ts
// Pure helpers for logging a NutritionLog from a SavedMeal reference (#275).
//
// A SavedMeal stores items + (optional) macros describing `defaultServings`
// worth of the meal. When log_nutrition is called with savedMealId, the logged
// meal is derived by scaling the stored macros by `servings ÷ defaultServings`
// and annotating item qty strings when that factor ≠ 1, so the item list stays
// human-readable AND honest about how much was actually eaten.
//
// No Prisma imports — keep this file pure and unit-testable (convention:
// mirrors readiness.ts / rarity-core.ts purity).

import { MACRO_KEYS, type NutritionMacros } from "@/lib/nutrition-plan";

/** Same shape as NutritionLog.items rows (the simple, hand-entered form). */
export type SavedMealItem = { name: string; qty?: string; notes?: string };

/**
 * Defensive parse of SavedMeal.items (Json column). Mirrors
 * nutrition-log-ops' parseStoredItems posture: skip malformed rows rather
 * than throw, never trust stored Json blindly.
 */
export function parseSavedMealItems(raw: unknown): SavedMealItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedMealItem[] = [];
  for (const v of raw) {
    if (v == null || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    out.push({
      name: r.name,
      qty: typeof r.qty === "string" ? r.qty : undefined,
      notes: typeof r.notes === "string" ? r.notes : undefined,
    });
  }
  return out;
}

/** Defensive parse of SavedMeal.macros (Json? column) into NutritionMacros. */
export function parseSavedMealMacros(raw: unknown): NutritionMacros | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of MACRO_KEYS) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? (out as NutritionMacros) : undefined;
}

/**
 * Scale factor for a saved-meal log: servings ÷ defaultServings.
 * The stored items/macros describe `defaultServings` worth of the meal, so
 * eating `servings` servings multiplies the stored macros by this factor.
 * A non-positive defaultServings (bad data) is treated as 1.
 */
export function savedMealScaleFactor(servings: number, defaultServings: number): number {
  const denom = defaultServings > 0 ? defaultServings : 1;
  return servings / denom;
}

/** Trim a factor for display: "2", "0.5", "1.33" (never "2.00"). */
function formatFactor(f: number): string {
  return Number.isInteger(f) ? String(f) : String(Number(f.toFixed(2)));
}

/** Round a scaled macro to one decimal (keeps 6.5 F × 2 = 13, not 13.000001). */
function round1(n: number): number {
  return Number(n.toFixed(1));
}

/** Multiply every present macro field by `factor`, rounded to 1 decimal. */
export function scaleSavedMealMacros(
  macros: NutritionMacros | undefined,
  factor: number,
): NutritionMacros | undefined {
  if (!macros) return undefined;
  const out: Record<string, number> = {};
  for (const k of MACRO_KEYS) {
    const v = macros[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = round1(v * factor);
  }
  return Object.keys(out).length > 0 ? (out as NutritionMacros) : undefined;
}

/**
 * Annotate item qty strings when the scale factor ≠ 1 so the logged item list
 * stays human-readable while making the scaling visible:
 *   { qty: "1 brookie" }, factor 2   → { qty: "1 brookie ×2" }
 *   { (no qty) },        factor 0.5 → { qty: "×0.5 of saved qty" }
 * Factor 1 returns copies untouched (the stored items already describe
 * exactly what was eaten).
 */
export function annotateItemsForFactor(items: SavedMealItem[], factor: number): SavedMealItem[] {
  if (factor === 1) return items.map((i) => ({ ...i }));
  const marker = `×${formatFactor(factor)}`;
  return items.map((i) => ({
    ...i,
    qty: i.qty ? `${i.qty} ${marker}` : `${marker} of saved qty`,
  }));
}

export type DerivedSavedMealLog = {
  items: SavedMealItem[];
  macros: NutritionMacros | undefined;
  factor: number;
};

/**
 * Derive the loggable items + macros for `servings` servings of a SavedMeal
 * row (raw Json columns in, clean scaled values out).
 */
export function deriveSavedMealLog(
  meal: { items: unknown; macros: unknown; defaultServings: number },
  servings: number,
): DerivedSavedMealLog {
  const factor = savedMealScaleFactor(servings, meal.defaultServings);
  return {
    items: annotateItemsForFactor(parseSavedMealItems(meal.items), factor),
    macros: scaleSavedMealMacros(parseSavedMealMacros(meal.macros), factor),
    factor,
  };
}
