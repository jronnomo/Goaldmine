"use client";

import { useState } from "react";
import { logNutrition } from "@/lib/workout-actions";
import { useFormFeedback } from "@/lib/use-form-feedback";
import { MacroInputs, type MacroValues } from "@/components/MacroInputs";
import type { LibraryFood } from "@/lib/food-types";
import {
  useFoodComposer,
  mergeFoodIntoForm,
  mergeEstimateIntoForm,
} from "@/components/useFoodComposer";

// Re-export pure helpers so any existing external consumers keep working.
export { mergeFoodIntoForm, mergeEstimateIntoForm };

// ── Types ──────────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function LogNutritionForm({
  quickPickFoods,
}: {
  quickPickFoods?: LibraryFood[];
}) {
  const { pending, error, saved, formRef, submit } = useFormFeedback();
  const [mealType, setMealType] = useState<MealType>(defaultMeal());

  // Controlled form state
  const [itemsText, setItemsText] = useState("");
  const [macros, setMacros] = useState<MacroValues>({
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fiberG: null,
    sodiumMg: null,
  });

  // Food composer hook — owns chips, scan, estimate UI + state.
  // controls go INSIDE the <form>; sheet goes OUTSIDE (sibling).
  const { controls, sheet } = useFoodComposer({
    itemsText,
    setItemsText,
    macros,
    setMacros,
    quickPickFoods,
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(logNutrition, {
          successMsg: "✓ Meal logged",
          onSuccess: () => {
            setMealType(defaultMeal());
            setItemsText("");
            setMacros({
              calories: null,
              proteinG: null,
              carbsG: null,
              fatG: null,
              fiberG: null,
              sodiumMg: null,
            });
            // quickPick (localAdditions) is NOT reset — chips persist for the next log
          },
        });
      }}
      className="flex flex-col gap-2"
    >
      {/* Meal type selector */}
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

      {/* Food composer controls — chips row + estimate field + strip.
          All buttons inside are type="button"; none can submit this form. */}
      {controls}

      {/* Items textarea — controlled */}
      <textarea
        name="items"
        required
        rows={3}
        value={itemsText}
        onChange={(e) => setItemsText(e.target.value)}
        placeholder={
          "One item per line. Optional qty after a |\n97% beef | 8 oz\nKroger hamburger buns | 1\nCheddar cheese | 2 slices\nFrozen mixed vegetables | 1 cup"
        }
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y min-h-[96px] font-mono"
      />

      {/* Notes — uncontrolled (reset clears it) */}
      <input
        type="text"
        name="notes"
        placeholder="meal notes (optional)"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />

      {/* MacroInputs — controlled */}
      <MacroInputs
        values={macros}
        onChange={(key, val) => setMacros((prev) => ({ ...prev, [key]: val }))}
      />

      {/* Feedback row */}
      <p className="text-xs min-h-[1rem]" aria-live="polite">
        {saved && <span className="text-[var(--success)]">{saved}</span>}
        {error && !saved && (
          <span className="text-[var(--danger)]">{error}</span>
        )}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
      >
        {pending ? "Saving…" : "Log meal"}
      </button>

    </form>

    {/* ScanFoodSheet overlay — rendered as a SIBLING of <form>, not a descendant.
        Its buttons can never submit the meal form even if a type attribute regresses.
        Fixed-inset-0 overlay; position outside the form is visually transparent. */}
    {sheet}
    </>
  );
}
