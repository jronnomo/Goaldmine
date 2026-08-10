"use client";

import { MealComposer } from "@/components/MealComposer";
import type { LibraryFood } from "@/lib/food-types";
import type { DayMacros } from "@/lib/nutrition-macros";
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
  trackedSoFar,
  dayTarget,
  onLogged,
  defaultDate,
}: {
  quickPickFoods?: LibraryFood[];
  libraryFoods?: LibraryFood[];
  trackedSoFar?: DayMacros;
  dayTarget?: DayMacros | null;
  /** Called after a create-mode log lands (post-revalidatePath). Lets the host
   *  (e.g. LogLauncher's self-fetch) refetch its "Logged today" list without
   *  requiring the sheet to close — see architecture-critique.md C1. */
  onLogged?: () => void;
  /** Pre-seed the composer's date/time control to this dateKey ("YYYY-MM-DD")
   *  instead of "now" — see MealComposer's `defaultDate` (#294). */
  defaultDate?: string;
}) {
  return (
    <MealComposer
      mode="create"
      quickPickFoods={quickPickFoods}
      libraryFoods={libraryFoods}
      trackedSoFar={trackedSoFar}
      dayTarget={dayTarget}
      onLogged={onLogged}
      defaultDate={defaultDate}
    />
  );
}
