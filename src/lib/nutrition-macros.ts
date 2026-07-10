import type { NutritionPlan, MealSlot } from "@/lib/nutrition-plan";
import { MEAL_SLOTS } from "@/lib/nutrition-plan";

/**
 * Single source for meal-type display labels (#237), keyed to the canonical
 * MealSlot vocabulary so key completeness is compile-time enforced. Ordered
 * to match MEAL_SLOTS.
 */
export const MEAL_LABELS: Record<MealSlot, string> = {
  preworkout: "Preworkout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  postworkout: "Postworkout",
  dinner: "Dinner",
};

/** The four headline macros we display as "today so far" / "target". */
export type DayMacros = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/**
 * Sum the four headline macro fields across a list of logged nutrition rows.
 * null / undefined fields count as 0. This is "actual so far" with no
 * plan-target fallback — see NutritionToday for the fallback-aware variant.
 */
export function sumLoggedDayMacros(
  logs: Array<{
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
  }>,
): DayMacros {
  let calories = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  for (const log of logs) {
    calories += log.calories ?? 0;
    proteinG += log.proteinG ?? 0;
    carbsG += log.carbsG ?? 0;
    fatG += log.fatG ?? 0;
  }
  return { calories, proteinG, carbsG, fatG };
}

/**
 * Sum the planned macro targets across all slots in a NutritionPlan.
 * Returns all-zeros when plan is null / undefined.
 */
export function sumPlanTargetMacros(
  plan: NutritionPlan | null | undefined,
): DayMacros {
  let calories = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  if (plan) {
    for (const slot of MEAL_SLOTS) {
      const m = plan[slot]?.macros;
      if (!m) continue;
      calories += m.calories ?? 0;
      proteinG += m.proteinG ?? 0;
      carbsG += m.carbsG ?? 0;
      fatG += m.fatG ?? 0;
    }
  }
  return { calories, proteinG, carbsG, fatG };
}

/** Per-field remaining = max(0, target − soFar). */
export function remainingMacros(target: DayMacros, soFar: DayMacros): DayMacros {
  return {
    calories: Math.max(0, target.calories - soFar.calories),
    proteinG: Math.max(0, target.proteinG - soFar.proteinG),
    carbsG: Math.max(0, target.carbsG - soFar.carbsG),
    fatG: Math.max(0, target.fatG - soFar.fatG),
  };
}

/** True when any of the four headline fields is > 0. */
export function hasAnyMacros(m: DayMacros): boolean {
  return m.calories > 0 || m.proteinG > 0 || m.carbsG > 0 || m.fatG > 0;
}

/**
 * Format four headline macros as "NNN cal · NNNp · NNNc · NNNf".
 * Zero fields are omitted.
 */
export function formatDayMacros(m: DayMacros): string {
  const parts: string[] = [];
  if (m.calories > 0) parts.push(`${Math.round(m.calories)} cal`);
  if (m.proteinG > 0) parts.push(`${Math.round(m.proteinG)}p`);
  if (m.carbsG > 0) parts.push(`${Math.round(m.carbsG)}c`);
  if (m.fatG > 0) parts.push(`${Math.round(m.fatG)}f`);
  return parts.join(" · ");
}
