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

/** Minimum logged-meal shape for the fallback-aware day sum. */
export type LoggedMealMacrosLike = {
  mealType: string;
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
};

const MACRO4 = ["calories", "proteinG", "carbsG", "fatG"] as const;

/**
 * Fallback-aware day total — THE single source for any "so far today" figure
 * that must agree with the Nutrition detail (UXR-TIA-09, BLOCKING; approved
 * sign-off): a slot whose logged meals recorded **no** macros at all inherits
 * that slot's *planned* macros instead of contributing zero.
 *
 * Semantics (kept byte-identical to the day-total math NutritionToday shipped
 * before extraction — do not "simplify" these rules apart):
 *  - Slots iterate MEAL_SLOTS; a log row with an unknown mealType is dropped.
 *  - A slot contributes only when it has ≥1 logged meal.
 *  - Per-field logged sum: a field counts when ANY meal in the slot recorded
 *    it (summed across the meals that did). Unrecorded fields contribute 0 —
 *    there is NO per-field plan fallback (a protein-only log does not borrow
 *    planned calories).
 *  - Only when NO meal in the slot recorded ANY of the four fields does the
 *    whole slot fall back to `plan[slot].macros`.
 *
 * Both `FuelRail` and `NutritionToday` call this, so the Today strip and the
 * nutrition detail can never print two contradicting day totals.
 */
export function sumLoggedDayMacrosWithPlanFallback(
  logs: LoggedMealMacrosLike[],
  plan: NutritionPlan | null | undefined,
): DayMacros {
  const acc: DayMacros = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const slot of MEAL_SLOTS) {
    const meals = logs.filter((l) => l.mealType === slot);
    if (meals.length === 0) continue;

    const slotTotals: DayMacros = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    let anyFieldLogged = false;
    for (const key of MACRO4) {
      for (const m of meals) {
        const v = m[key];
        if (v != null) {
          slotTotals[key] += v;
          anyFieldLogged = true;
        }
      }
    }

    if (anyFieldLogged) {
      acc.calories += slotTotals.calories;
      acc.proteinG += slotTotals.proteinG;
      acc.carbsG += slotTotals.carbsG;
      acc.fatG += slotTotals.fatG;
    } else {
      const planned = plan?.[slot]?.macros;
      if (planned) {
        acc.calories += planned.calories ?? 0;
        acc.proteinG += planned.proteinG ?? 0;
        acc.carbsG += planned.carbsG ?? 0;
        acc.fatG += planned.fatG ?? 0;
      }
    }
  }
  return acc;
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

/** Minimum per-item macro snapshot shape (NutritionItem.itemMacros). */
export type ItemMacrosLike = {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
};

/**
 * Compact per-item macro line for logged-meal item rows —
 * "226 cal · 41P · 3C · 5F", absent fields skipped, rounded for the muted
 * inline readout. null when the snapshot has none of the four headline
 * fields (row renders exactly as before).
 */
export function formatItemMacroLine(m: ItemMacrosLike | undefined): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.calories != null) parts.push(`${Math.round(m.calories)} cal`);
  if (m.proteinG != null) parts.push(`${Math.round(m.proteinG)}P`);
  if (m.carbsG != null) parts.push(`${Math.round(m.carbsG)}C`);
  if (m.fatG != null) parts.push(`${Math.round(m.fatG)}F`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
