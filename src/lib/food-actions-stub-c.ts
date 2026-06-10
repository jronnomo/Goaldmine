/**
 * food-actions-stub-c.ts — Stub for Stream C form development.
 * Returns 2 fixture foods. recordFoodUse is a no-op.
 * Plain async functions (NO "use server") — safe to import in server components.
 *
 * INTEGRATION: swap every import of this module to @/lib/food-actions
 */

import type { LibraryFood } from "@/lib/food-types";

const FIXTURE_FOODS: LibraryFood[] = [
  {
    id: "stub-oikos",
    barcode: "0036632080769",
    name: "Oikos Triple Zero Greek Yogurt",
    brand: "Danone",
    servingSize: "150 g",
    basis: "serving",
    perServing: {
      calories: 120,
      proteinG: 17,
      carbsG: 9,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 65,
    },
  },
  {
    id: "stub-pb",
    barcode: "0051500750988",
    name: "Creamy Peanut Butter",
    brand: "Jif",
    servingSize: "2 tbsp (32 g)",
    basis: "serving",
    perServing: {
      calories: 190,
      proteinG: 7,
      carbsG: 7,
      fatG: 16,
      fiberG: 1,
      sodiumMg: 135,
    },
  },
];

/** Returns top foods by usage (fixture: 2 items). */
export async function getQuickPickFoods(): Promise<LibraryFood[]> {
  return FIXTURE_FOODS;
}

/** Records a food use — no-op in stub. */
export async function recordFoodUse(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _id: string
): Promise<void> {
  // no-op — stub; real implementation bumps usageCount in FoodLibrary
}
