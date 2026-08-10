"use client";

import { MealComposer } from "@/components/MealComposer";
import type { LibraryFood } from "@/lib/food-types";
import type { DayMacros } from "@/lib/nutrition-macros";
import type { ExistingMealStub } from "@/lib/nutrition-merge";
import type { SavedMealLite } from "@/lib/saved-meal";
import {
  mergeFoodIntoForm,
  mergeEstimateIntoForm,
} from "@/components/useFoodComposer";

// Re-export pure helpers so any existing external consumers keep working.
export { mergeFoodIntoForm, mergeEstimateIntoForm };

/**
 * Thin wrapper preserving the LogNutritionForm entry points.
 * New optional props are threaded from /nutrition page RSC to the
 * enriched MealComposer header (REQ-003/004).
 * All callers that pass no new props continue to work — props are optional,
 * MealComposer header degrades gracefully.
 */
export function LogNutritionForm({
  quickPickFoods,
  libraryFoods,
  savedMeals,
  trackedSoFar,
  dayTarget,
  onLogged,
  defaultDate,
  existingMeals,
}: {
  quickPickFoods?: LibraryFood[];
  libraryFoods?: LibraryFood[];
  /** Server-fetched SavedMeal quick-pick list (#296) — see MealComposer. */
  savedMeals?: SavedMealLite[];
  trackedSoFar?: DayMacros;
  dayTarget?: DayMacros | null;
  /** Called after a create-mode log lands (post-revalidatePath). Lets the host
   *  (e.g. LogLauncher's self-fetch) refetch its "Logged today" list without
   *  requiring the sheet to close — see architecture-critique.md C1. */
  onLogged?: () => void;
  /** Pre-seed the composer's date/time control to this dateKey ("YYYY-MM-DD")
   *  instead of "now" — see MealComposer's `defaultDate` (#294). */
  defaultDate?: string;
  /** Already-logged meal stubs for the append-vs-separate choice (#295) —
   *  see MealComposer's `existingMeals`. */
  existingMeals?: ExistingMealStub[];
}) {
  return (
    <MealComposer
      mode="create"
      quickPickFoods={quickPickFoods}
      libraryFoods={libraryFoods}
      savedMeals={savedMeals}
      trackedSoFar={trackedSoFar}
      dayTarget={dayTarget}
      onLogged={onLogged}
      defaultDate={defaultDate}
      existingMeals={existingMeals}
    />
  );
}
