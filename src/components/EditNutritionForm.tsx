"use client";

import { MealComposer, type MealDefaults } from "@/components/MealComposer";
import type { LibraryFood } from "@/lib/food-types";

/**
 * Thin wrapper preserving the EditNutritionForm entry point (the full-page
 * /nutrition/[id]/edit route). The shared MealComposer is the real component —
 * see UXR-meal-edit-02. The de-redirect + BottomSheet host is the next slice;
 * for now the page stays full-page and updateNutrition's redirect is unchanged.
 */
export function EditNutritionForm({
  id,
  defaults,
  quickPickFoods,
}: {
  id: string;
  defaults: MealDefaults;
  quickPickFoods?: LibraryFood[];
}) {
  return (
    <MealComposer
      mode="edit"
      id={id}
      defaults={defaults}
      quickPickFoods={quickPickFoods}
    />
  );
}
