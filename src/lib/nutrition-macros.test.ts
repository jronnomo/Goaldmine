// sumLoggedDayMacrosWithPlanFallback — the ONE fallback-aware day sum
// (UXR-TIA-09, BLOCKING sign-off). These tests pin the exact semantics the
// pre-extraction NutritionToday day-total math shipped, because FuelRail and
// the nutrition detail both render this figure and may never contradict.

import { describe, it, expect } from "vitest";
import {
  sumLoggedDayMacros,
  sumLoggedDayMacrosWithPlanFallback,
  type LoggedMealMacrosLike,
} from "@/lib/nutrition-macros";
import type { NutritionPlan } from "@/lib/nutrition-plan";

const plan: NutritionPlan = {
  breakfast: { items: [{ name: "eggs" }], macros: { calories: 500, proteinG: 40, carbsG: 30, fatG: 22 } },
  lunch: { items: [{ name: "bowl" }], macros: { calories: 700, proteinG: 50, carbsG: 60, fatG: 25 } },
  dinner: { items: [{ name: "steak" }], macros: { calories: 800, proteinG: 60, carbsG: 40, fatG: 35 } },
};

const meal = (mealType: string, m: Partial<LoggedMealMacrosLike> = {}): LoggedMealMacrosLike => ({
  mealType,
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  ...m,
});

describe("sumLoggedDayMacrosWithPlanFallback", () => {
  it("empty logs → all zeros (planned-but-unlogged slots contribute nothing)", () => {
    expect(sumLoggedDayMacrosWithPlanFallback([], plan)).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it("a macros-null logged meal in a planned slot inherits that slot's PLANNED macros (the fallback)", () => {
    const soFar = sumLoggedDayMacrosWithPlanFallback([meal("breakfast")], plan);
    expect(soFar).toEqual({ calories: 500, proteinG: 40, carbsG: 30, fatG: 22 });
    // …which is exactly where the plain sum and the fallback-aware sum diverge:
    expect(sumLoggedDayMacros([meal("breakfast")])).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it("recorded macros win for the slot — a second macros-null meal in the same slot adds nothing", () => {
    const soFar = sumLoggedDayMacrosWithPlanFallback(
      [meal("lunch", { calories: 650, proteinG: 45, carbsG: 55, fatG: 20 }), meal("lunch")],
      plan,
    );
    expect(soFar).toEqual({ calories: 650, proteinG: 45, carbsG: 55, fatG: 20 });
  });

  it("per-field logged sum with NO per-field plan fallback — a protein-only log does not borrow planned calories", () => {
    const soFar = sumLoggedDayMacrosWithPlanFallback([meal("dinner", { proteinG: 42 })], plan);
    expect(soFar).toEqual({ calories: 0, proteinG: 42, carbsG: 0, fatG: 0 });
  });

  it("sums a field across every meal in the slot that recorded it", () => {
    const soFar = sumLoggedDayMacrosWithPlanFallback(
      [
        meal("snack", { calories: 200, proteinG: 10 }),
        meal("snack", { calories: 150, fatG: 8 }),
      ],
      plan,
    );
    expect(soFar).toEqual({ calories: 350, proteinG: 10, carbsG: 0, fatG: 8 });
  });

  it("a logged meal in an UNplanned slot counts its recorded macros (no fallback available when macros-null)", () => {
    expect(
      sumLoggedDayMacrosWithPlanFallback([meal("preworkout", { calories: 120 })], plan),
    ).toEqual({ calories: 120, proteinG: 0, carbsG: 0, fatG: 0 });
    // macros-null in an unplanned slot → nothing to fall back to → 0.
    expect(sumLoggedDayMacrosWithPlanFallback([meal("preworkout")], plan)).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it("a log row with an unknown mealType is dropped (slot vocabulary is MEAL_SLOTS)", () => {
    expect(
      sumLoggedDayMacrosWithPlanFallback([meal("second-breakfast", { calories: 999 })], plan),
    ).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("null plan → recorded macros only, fallback silently unavailable", () => {
    const soFar = sumLoggedDayMacrosWithPlanFallback(
      [meal("breakfast"), meal("lunch", { calories: 640 })],
      null,
    );
    expect(soFar).toEqual({ calories: 640, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("mixed day (the founder shape): two macro'd meals + one estimate-only meal = logged sums + one plan fallback", () => {
    const soFar = sumLoggedDayMacrosWithPlanFallback(
      [
        meal("breakfast", { calories: 480, proteinG: 38, carbsG: 33, fatG: 20 }),
        meal("lunch", { calories: 720, proteinG: 52, carbsG: 63, fatG: 24 }),
        meal("dinner"), // logged, no macros → planned 800/60/40/35
      ],
      plan,
    );
    expect(soFar).toEqual({ calories: 2000, proteinG: 150, carbsG: 136, fatG: 79 });
  });
});
