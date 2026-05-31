"use client";

import { useState } from "react";
import { logNutrition } from "@/lib/workout-actions";
import { useFormFeedback } from "@/lib/use-form-feedback";
import { MacroInputs } from "@/components/MacroInputs";

const MEAL_TYPES = [
  { value: "preworkout", label: "Preworkout" },
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "snack", label: "Snack" },
  { value: "postworkout", label: "Postworkout" },
  { value: "dinner", label: "Dinner" },
] as const;

type MealType = (typeof MEAL_TYPES)[number]["value"];

function defaultMeal(): MealType {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 17) return "snack";
  return "dinner";
}

export function LogNutritionForm() {
  const { pending, error, saved, formRef, submit } = useFormFeedback();
  const [mealType, setMealType] = useState<MealType>(defaultMeal());

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(logNutrition, {
          successMsg: "✓ Meal logged",
          onSuccess: () => setMealType(defaultMeal()),
        });
      }}
      className="flex flex-col gap-2"
    >
      <select
        name="mealType"
        value={mealType}
        onChange={(e) => setMealType(e.target.value as MealType)}
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      >
        {MEAL_TYPES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <textarea
        name="items"
        required
        rows={3}
        placeholder={"One item per line. Optional qty after a |\n97% beef | 8 oz\nKroger hamburger buns | 1\nCheddar cheese | 2 slices\nFrozen mixed vegetables | 1 cup"}
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y min-h-[96px] font-mono"
      />
      <input
        type="text"
        name="notes"
        placeholder="meal notes (optional)"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      <MacroInputs />
      {/* Reserved height prevents layout shift whether saved, error, or empty */}
      <p className="text-xs min-h-[1rem]" aria-live="polite">
        {saved && <span className="text-[var(--success)]">{saved}</span>}
        {error && !saved && <span className="text-[var(--danger)]">{error}</span>}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
      >
        {pending ? "Saving…" : "Log meal"}
      </button>
    </form>
  );
}
