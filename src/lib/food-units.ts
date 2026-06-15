/**
 * food-units.ts — Pure, client-safe unit + macro recalculation helpers.
 *
 * No "use server". No Prisma. Safe to import in browser and server modules.
 *
 * Architecture note: this module is imported by MealComposer (client bundle) and
 * food-actions.ts (server). BUILTINS is already in the client bundle via the
 * food-resolve-local.ts import chain — no new bundle weight.
 *
 * DEVIATION from blueprint §1.2 `defaultUnitForQuery` step 3:
 *   Blueprint says "snapshot's default portion (via BUILTINS slug lookup)".
 *   ItemFoodSnapshot does not carry the builtin slug, and foodId is the library
 *   UUID (not the barcode), making a BUILTINS reverse-lookup ambiguous (multiple
 *   builtins share portion key sets like small/medium/large).
 *   Implementation: steps 2 and 3 both return portions[0].key (the first defined
 *   piece unit). Users can override via the unit <select>. The tsx test does not
 *   cover this function; downstream callers can pass an explicit unit to bypass it.
 */

import type { FoodMacros, MacroKey, LibraryFood } from "@/lib/food-types";
import type { NutritionItem, ItemFoodSnapshot } from "@/lib/nutrition-log-ops";
import { scaleMacros } from "@/lib/food-resolve-local";
import { BUILTINS } from "@/lib/food-builtins";
import { MACRO_KEYS } from "@/lib/food-types";
import type { ParsedFoodQuery } from "@/lib/food-parse";

// MacroValues mirrors the component type; defined locally to avoid circular import.
type MacroValues = Partial<Record<MacroKey, number | null>>;

// Grams per avoirdupois ounce.
const OZ_TO_G = 28.3495;

// ── UnitOption ────────────────────────────────────────────────────────────────

/** A selectable unit for a food-resolved item. */
export type UnitOption = {
  key: string;         // "g" | "oz" | "serving" | <portion key>
  label: string;       // "gram" | "oz" | "serving" | "large egg white (33 g)"
  gramsEach?: number;  // grams per piece unit; undefined for g/oz/serving
};

// ── unitsForFood ──────────────────────────────────────────────────────────────

/**
 * Build unit options from a food snapshot.
 *
 * 100g basis: always includes "g" and "oz"; plus one option per portions[] entry.
 * serving basis: only "serving". g/oz NOT offered (no density table; servingSize
 *   is free text per PRD §3.3).
 */
export function unitsForFood(snapshot: ItemFoodSnapshot): UnitOption[] {
  if (snapshot.basis === "serving") {
    return [{ key: "serving", label: "serving" }];
  }

  // 100g basis
  const opts: UnitOption[] = [
    { key: "g",  label: "gram" },
    { key: "oz", label: "oz" },
  ];
  for (const p of snapshot.portions) {
    opts.push({ key: p.key, label: p.label, gramsEach: p.grams });
  }
  return opts;
}

// ── recalcItemMacros ──────────────────────────────────────────────────────────

/**
 * Recalculate macros for a single structured item.
 *
 * Returns null when:
 *   - item.source is undefined (freehand/legacy item)
 *   - item.amount is not a positive finite number (contributes zero to sum)
 *   - item.unit is not recognized in the food's valid unit set
 *
 * Never throws. Return null = item contributes zero to sumStructuredMacros.
 *
 * Rounding: delegates entirely to scaleMacros (calories/sodiumMg → int; others → 1dp).
 */
export function recalcItemMacros(item: NutritionItem): FoodMacros | null {
  const { source, amount, unit } = item;
  if (!source) return null;
  if (amount == null || !isFinite(amount) || amount <= 0) return null;
  if (!unit) return null;

  const { basis, perBasis, portions } = source;

  if (basis === "serving") {
    if (unit !== "serving") return null;
    return scaleMacros(perBasis, amount);
  }

  // basis === "100g"
  let grams: number;
  if (unit === "g") {
    grams = amount;
  } else if (unit === "oz") {
    grams = amount * OZ_TO_G;
  } else {
    // Portion key
    const portion = portions.find((p) => p.key === unit);
    if (!portion) return null; // unrecognized unit (stale snapshot)
    grams = amount * portion.grams;
  }

  const servings = grams / 100;
  return scaleMacros(perBasis, servings);
}

// ── sumStructuredMacros ───────────────────────────────────────────────────────

/**
 * Sum recalcItemMacros over every item WITH source.
 * Items without source contribute zero (freehand/legacy items — not an error).
 *
 * Returns FoodMacros with all keys initialized to 0 (never null from this function).
 */
export function sumStructuredMacros(items: NutritionItem[]): FoodMacros {
  const acc: FoodMacros = {
    calories: 0,
    proteinG: 0,
    carbsG:   0,
    fatG:     0,
    fiberG:   0,
    sodiumMg: 0,
  };
  for (const item of items) {
    const m = recalcItemMacros(item);
    if (!m) continue;
    for (const k of MACRO_KEYS) {
      const v = m[k];
      if (v != null) acc[k] = (acc[k] ?? 0) + v;
    }
  }
  return acc;
}

// ── recomposeMacros ───────────────────────────────────────────────────────────

/**
 * Recompose the meal total from a new structured sum + residual.
 *
 * Per-key rounding matches scaleMacros house rules:
 *   calories, sodiumMg → Math.round (integer)
 *   proteinG, carbsG, fatG, fiberG → Math.round(v * 10) / 10 (1 decimal place)
 *
 * Both structuredSum and residual may have null/undefined per key → treated as 0.
 * This is the B-1 fix: full re-sum with per-key precision, not blanket Math.round.
 */
export function recomposeMacros(
  structuredSum: FoodMacros,
  residual: MacroValues,
): MacroValues {
  const result: MacroValues = {};
  for (const k of MACRO_KEYS) {
    const s = structuredSum[k] ?? 0;
    const r = residual[k] ?? 0;
    const total = s + r;
    if (k === "calories" || k === "sodiumMg") {
      result[k] = Math.round(total);
    } else {
      result[k] = Math.round(total * 10) / 10;
    }
  }
  return result;
}

// ── defaultUnitForQuery ───────────────────────────────────────────────────────

/**
 * Choose the default unit for a newly-added food.
 *
 * Logic (in order):
 *   1. If parsed.sizeWord matches a portion key exactly → that portion key.
 *   2. If snapshot has portions and parsed.count > 1 → first portion key.
 *   3. If snapshot has portions → first portion key (see module-level DEVIATION note).
 *   4. For 100g basis → "g". For serving basis → "serving".
 *
 * parsed may be null (chip/scan paths without a text query).
 */
export function defaultUnitForQuery(
  parsed: Pick<ParsedFoodQuery, "count" | "sizeWord"> | null,
  snapshot: ItemFoodSnapshot,
): string {
  const { portions, basis } = snapshot;

  if (parsed?.sizeWord) {
    const match = portions.find((p) => p.key === parsed.sizeWord);
    if (match) return match.key;
  }

  if (portions.length > 0 && parsed != null && parsed.count > 1) {
    return portions[0].key;
  }

  if (portions.length > 0) {
    // Blueprint: "snapshot's default portion (via BUILTINS slug lookup)".
    // DEVIATION: snapshot doesn't store the builtin slug; return portions[0].key.
    // See module-level note for full rationale.
    return portions[0].key;
  }

  return basis === "serving" ? "serving" : "g";
}

// ── buildQtyDisplay ───────────────────────────────────────────────────────────

/** Build the display qty string: "7 × large egg white (33 g)", "200 g", "1.5 oz". */
export function buildQtyDisplay(
  amount: number,
  unit: string,
  snapshot: ItemFoodSnapshot,
): string {
  if (unit === "g") return `${amount} g`;
  if (unit === "oz") return `${amount} oz`;
  if (unit === "serving") return amount === 1 ? "1 serving" : `${amount} servings`;

  // Portion key
  const portion = snapshot.portions.find((p) => p.key === unit);
  if (!portion) return `${amount} × ${unit}`;

  const label = portion.label.replace(/^\d+\s*/, ""); // strip leading "1 "
  return `${amount} × ${label}`;
}

// ── buildItemSnapshot ─────────────────────────────────────────────────────────

/**
 * Build an ItemFoodSnapshot from a LibraryFood at add time.
 *
 * portions[]: if food.barcode starts with "builtin:", look up BUILTINS for the slug's
 *             portions[]. Otherwise [].
 * perBasis: food.perServing directly (already the correct per-basis value regardless
 *           of basis type — LibraryFood.perServing is per 100g for basis="100g" and
 *           per 1 serving for basis="serving").
 */
export function buildItemSnapshot(food: LibraryFood): ItemFoodSnapshot {
  let portions: ItemFoodSnapshot["portions"] = [];
  if (food.barcode?.startsWith("builtin:")) {
    const slug = food.barcode.slice(8);
    const builtin = BUILTINS.find((b) => b.slug === slug);
    portions = builtin?.portions ?? [];
  }
  return {
    basis:    food.basis,
    perBasis: food.perServing,
    portions,
    foodId:   food.id,
    brand:    food.brand,
  };
}

// ── addFoodMacros ─────────────────────────────────────────────────────────────

/**
 * Return the new MacroValues total after adding food at the given servings count.
 * Extracted from mergeFoodIntoForm (S-6 fix) so useFoodComposer can compute the
 * macro update without building the full text line.
 *
 * Does NOT construct the text line — that is the caller's responsibility.
 */
export function addFoodMacros(
  current: MacroValues,
  food: LibraryFood,
  servings: number,
): MacroValues {
  const added = scaleMacros(food.perServing, servings);
  const result: MacroValues = {};
  for (const k of MACRO_KEYS) {
    const cv = current[k] ?? 0;
    const av = added[k];
    if (av != null) {
      result[k] = cv + av;
    } else {
      result[k] = current[k] ?? null;
    }
  }
  return result;
}

// ── deriveAmountFromServings ──────────────────────────────────────────────────

/**
 * Given a servings multiplier (relative to perBasis) and a resolved default
 * unit, produce the amount value shown in the amount input.
 *
 * Used on the chip/scan add path where servings is known but the unit has just
 * been chosen by defaultUnitForQuery.
 *
 * Rounding:
 *   "g"   → servings × 100 (no rounding; grams can be fractional)
 *   "oz"  → Math.round((servings × 100 / OZ_TO_G) × 10) / 10  (1dp)
 *   piece → Math.max(1, Math.round((servings × 100) / portion.grams))
 *   "serving" (serving-basis) → servings
 */
export function deriveAmountFromServings(
  servings: number,
  unit: string,
  snapshot: ItemFoodSnapshot,
): number {
  if (snapshot.basis === "serving") return servings;

  if (unit === "g") return servings * 100;
  if (unit === "oz") return Math.round((servings * 100 / OZ_TO_G) * 10) / 10;

  const portion = snapshot.portions.find((p) => p.key === unit);
  if (portion) {
    return Math.max(1, Math.round((servings * 100) / portion.grams));
  }
  // Unknown unit fallback
  return servings * 100;
}

// ── deriveAmountFromEstimate ──────────────────────────────────────────────────

/**
 * Derive the amount for a newly-added food from the estimate result + parsed query.
 * Used by useFoodComposer.handleEstimateAdd.
 *
 *   piece unit  → parsedQuery.count ?? 1  (query count = piece count)
 *   "g"         → parsedQuery.grams ?? Math.round(est.servings × 100)
 *   "serving"   → est.servings
 *   "oz"        → Math.round((servings × 100 / OZ_TO_G) × 10) / 10
 */
export function deriveAmountFromEstimate(
  estServings: number,
  unit: string,
  snapshot: ItemFoodSnapshot,
  parsedQuery: Pick<ParsedFoodQuery, "count" | "grams"> | null,
): number {
  if (snapshot.basis === "serving") return estServings;

  if (unit === "oz") {
    return Math.round((estServings * 100 / OZ_TO_G) * 10) / 10;
  }
  if (unit === "g") {
    return parsedQuery?.grams ?? Math.round(estServings * 100);
  }

  // Piece unit
  const isPortionKey = snapshot.portions.some((p) => p.key === unit);
  if (isPortionKey) {
    return parsedQuery?.count ?? 1;
  }

  // Unknown unit — fall back to grams
  return Math.round(estServings * 100);
}
