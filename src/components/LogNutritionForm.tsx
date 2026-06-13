"use client";

import { MealComposer } from "@/components/MealComposer";
import type { LibraryFood } from "@/lib/food-types";
import {
  mergeFoodIntoForm,
  mergeEstimateIntoForm,
} from "@/components/useFoodComposer";

// Re-export pure helpers so any existing external consumers keep working.
export { mergeFoodIntoForm, mergeEstimateIntoForm };

/**
 * Thin wrapper preserving the LogNutritionForm entry points (Nutrition page,
 * LogLauncher, NutritionToday). The shared MealComposer is the real component —
 * see UXR-meal-edit-02 (single shared create|edit spine).
 */
export function LogNutritionForm({
  quickPickFoods,
}: {
  quickPickFoods?: LibraryFood[];
}) {
  return <MealComposer mode="create" quickPickFoods={quickPickFoods} />;
}
