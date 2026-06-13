"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { MealComposer } from "@/components/MealComposer";
import { deleteNutrition } from "@/lib/workout-actions";
import { toDatetimeLocalValue } from "@/lib/calendar-core";
import type { LibraryFood } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";

const MEAL_LABELS: Record<string, string> = {
  preworkout: "Preworkout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  postworkout: "Postworkout",
  dinner: "Dinner",
};

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
}: {
  meal: MealEditButtonMeal;
  quickPickFoods?: LibraryFood[];
  buttonClassName?: string;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  const label = MEAL_LABELS[meal.mealType] ?? meal.mealType;

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
              onSaved={close}
              onDeleted={() => {
                void deleteNutrition(meal.id);
                close();
              }}
            />
          </div>
        )}
      </BottomSheet>
    </>
  );
}
