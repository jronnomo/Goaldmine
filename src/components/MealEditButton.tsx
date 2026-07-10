"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { MealComposer } from "@/components/MealComposer";
import { deleteNutrition } from "@/lib/workout-actions";
import { toDatetimeLocalValue } from "@/lib/calendar-core";
import type { LibraryFood } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";
import { MEAL_LABELS } from "@/lib/nutrition-macros";
import type { MealSlot } from "@/lib/nutrition-plan";

export type MealEditButtonMeal = {
  id: string;
  mealType: string;
  items: NutritionItem[];
  notes: string | null;
  dateISO: string;
  macros: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  };
  plannedTarget?: number;
};

export function MealEditButton({
  meal,
  quickPickFoods,
  buttonClassName,
  buttonLabel = "Edit",
  onMutated,
}: {
  meal: MealEditButtonMeal;
  quickPickFoods?: LibraryFood[];
  buttonClassName?: string;
  buttonLabel?: string;
  /** Called after a save or delete lands — lets the host (e.g. LogLauncher's
   *  self-fetch) refetch its list. Optional; NutritionToday passes none. */
  onMutated?: () => void;
}) {
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  // Close first (same as today — no visible change to the instant-close UX),
  // THEN await the write, THEN notify the host. Ordering matters: firing
  // onMutated before the DB write lands would let a refetch race the delete
  // and flash the "deleted" meal back (see architecture-critique.md C2).
  async function handleDeleted() {
    close();
    await deleteNutrition(meal.id);
    onMutated?.();
  }

  const label = MEAL_LABELS[meal.mealType as MealSlot] ?? meal.mealType;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          buttonClassName ??
          "min-h-[44px] -my-2 text-xs text-[var(--accent)]"
        }
      >
        {buttonLabel}
      </button>

      <BottomSheet
        open={open}
        onClose={close}
        title={`Edit · ${label}`}
      >
        {open && (
          <div className="px-4 pb-4 pt-3">
            <MealComposer
              mode="edit"
              id={meal.id}
              defaults={{
                mealType: meal.mealType,
                items: meal.items,
                notes: meal.notes ?? "",
                date: toDatetimeLocalValue(new Date(meal.dateISO)),
                macros: meal.macros,
              }}
              quickPickFoods={quickPickFoods}
              plannedTarget={meal.plannedTarget}
              onSaved={() => {
                onMutated?.();
                close();
              }}
              onDeleted={() => {
                void handleDeleted();
              }}
            />
          </div>
        )}
      </BottomSheet>
    </>
  );
}
