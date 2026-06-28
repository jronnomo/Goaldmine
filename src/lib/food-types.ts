/**
 * food-types.ts — Cross-stream type contract for the food library feature.
 * No Prisma imports. No "use server". Safe to import in both client and server modules.
 */

/** All six macro field names (matches parseMacros() keys in workout-actions.ts). */
export const MACRO_KEYS = [
  "calories",
  "proteinG",
  "carbsG",
  "fatG",
  "fiberG",
  "sodiumMg",
] as const;

export type MacroKey = (typeof MACRO_KEYS)[number];

/**
 * Per-serving macro snapshot.
 * Nulls mean the value was absent/non-finite in the source — never fabricated.
 * calories and sodiumMg are integers; protein/carbs/fat/fiber are 1-decimal floats.
 */
export type FoodMacros = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
};

/**
 * A food entry from the personal library (DB row shape, minus Prisma internals).
 * name and brand are guaranteed pipe-free (normalizer strips | on ingest).
 */
export type LibraryFood = {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  servingSize: string | null;
  /** "serving" = per-label serving; "100g" = no serving data, per-100g basis */
  basis: "serving" | "100g";
  perServing: FoodMacros;
  /** Explicitly pinned into the quick-pick chip row (independent of usage ranking). */
  isFavorite?: boolean;
  /** Last-logged portion amount — seeds the ScanFoodSheet stepper on re-add. */
  lastAmount?: number | null;
  /** Last-logged portion unit ("g" | "oz" | "serving" | <portion key>). */
  lastUnit?: string | null;
};

/**
 * Result of a barcode lookup (library hit or OFF fetch).
 * Never throws to the client — error is surfaced as status:"error".
 */
export type BarcodeLookupResult =
  | { status: "found"; food: LibraryFood; fromLibrary: boolean }
  | { status: "not_found" }
  | { status: "error"; message?: string };

/**
 * Payload produced by ScanFoodSheet.onAdd → consumed by LogNutritionForm.handleAdd.
 *
 * chipSource (required boolean):
 *   true  = food came from a chip tap (ScanFoodSheet opened with initialFood prop);
 *           LogNutritionForm MUST call recordFoodUse fire-and-forget.
 *   false = food came from a camera/manual scan; lookupBarcode already bumped usageCount;
 *           LogNutritionForm MUST NOT call recordFoodUse (would double-count).
 */
export type AddFoodPayload = {
  food: LibraryFood;
  /** Positive float, 0.5-step increments, minimum 0.5, maximum 20 */
  servings: number;
  /** Whether this add originated from a quick-pick chip tap (vs a barcode scan). */
  chipSource: boolean;
};
