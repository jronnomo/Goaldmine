import { z } from "zod";

export const MEAL_SLOTS = [
  "preworkout",
  "breakfast",
  "lunch",
  "snack",
  "postworkout",
  "dinner",
] as const;

export type MealSlot = (typeof MEAL_SLOTS)[number];

const PlannedMealItemShape = z.object({
  name: z.string().min(1).describe("Dish or food item, e.g. 'HelloFresh Mexican-Spiced Chicken Bowls', 'oatmeal with berries'"),
  qty: z.string().optional().describe("Free-form quantity, e.g. '1 serving', '8 oz', '1 cup'"),
  notes: z.string().optional(),
});

export const PlannedMealMacrosShape = z.object({
  calories: z.number().nonnegative().optional(),
  proteinG: z.number().nonnegative().optional(),
  carbsG: z.number().nonnegative().optional(),
  fatG: z.number().nonnegative().optional(),
  sodiumMg: z.number().nonnegative().optional(),
  fiberG: z.number().nonnegative().optional(),
});

// Shared macro shape for both planned meals and logged-meal macros.
export type NutritionMacros = z.infer<typeof PlannedMealMacrosShape>;

// The macro column names on NutritionLog / PlannedMeal.macros, fixed order —
// handy for summing and for building Prisma data objects.
export const MACRO_KEYS = [
  "calories",
  "proteinG",
  "carbsG",
  "fatG",
  "fiberG",
  "sodiumMg",
] as const;

export const PlannedMealShape = z.object({
  items: z.array(PlannedMealItemShape).min(1),
  macros: PlannedMealMacrosShape.optional(),
  notes: z.string().optional().describe("Meal-level note, e.g. 'Pre-race carb-load'"),
});

export type PlannedMeal = z.infer<typeof PlannedMealShape>;

// Per-slot PATCH semantics: omit a slot to leave it unchanged, set it to null
// to clear that slot, pass an object to replace it. Top-level null on the
// whole `nutritionPlan` field clears every slot at once.
export const NutritionPlanShape = z.object({
  preworkout: PlannedMealShape.nullish(),
  breakfast: PlannedMealShape.nullish(),
  lunch: PlannedMealShape.nullish(),
  snack: PlannedMealShape.nullish(),
  postworkout: PlannedMealShape.nullish(),
  dinner: PlannedMealShape.nullish(),
});

export type NutritionPlanInput = z.infer<typeof NutritionPlanShape>;

// Stored shape: same keys, but the *absence* of a key means "no plan for this
// slot" (vs. the input shape where absence means "leave alone"). This is what
// resolveDay surfaces and what the UI consumes.
export type NutritionPlan = {
  [K in MealSlot]?: PlannedMeal;
};

// Coerce arbitrary JSON loaded from Prisma into a typed NutritionPlan,
// dropping anything that doesn't parse. Used by resolveDay and the UI so a
// malformed row never crashes rendering.
export function parseStoredNutritionPlan(raw: unknown): NutritionPlan | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: NutritionPlan = {};
  for (const slot of MEAL_SLOTS) {
    const v = (raw as Record<string, unknown>)[slot];
    if (v == null) continue;
    const parsed = PlannedMealShape.safeParse(v);
    if (parsed.success) out[slot] = parsed.data;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Apply a PATCH-style NutritionPlanInput to an existing stored plan.
// - patch is null → return null (caller clears the column)
// - slot omitted from patch → keep existing
// - slot === null in patch → drop that slot
// - slot is an object → replace that slot
// Returns null when the result has zero slots, so the column gets cleared
// instead of storing an empty `{}`.
export function applyNutritionPlanPatch(
  existing: NutritionPlan | null,
  patch: NutritionPlanInput | null | undefined,
): NutritionPlan | null {
  if (patch === undefined) return existing;
  if (patch === null) return null;
  const merged: NutritionPlan = { ...(existing ?? {}) };
  for (const slot of MEAL_SLOTS) {
    if (!(slot in patch)) continue;
    const v = patch[slot];
    if (v == null) delete merged[slot];
    else merged[slot] = v;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}
