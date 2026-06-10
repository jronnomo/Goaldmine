"use client";

import { useState, useTransition } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteNutrition, updateNutrition } from "@/lib/workout-actions";
import { MacroInputs, type MacroDefaults, type MacroValues } from "@/components/MacroInputs";
import type { LibraryFood } from "@/lib/food-types";
import { useFoodComposer } from "@/components/useFoodComposer";

const MEAL_TYPES = [
  { value: "preworkout", label: "Preworkout" },
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "snack", label: "Snack" },
  { value: "postworkout", label: "Postworkout" },
  { value: "dinner", label: "Dinner" },
] as const;

export function EditNutritionForm({
  id,
  defaults,
  quickPickFoods,
}: {
  id: string;
  defaults: {
    mealType: string;
    itemsText: string;
    notes: string;
    date: string;
    macros?: MacroDefaults;
  };
  quickPickFoods?: LibraryFood[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Controlled items + macros so the food composer can append to them.
  const [itemsText, setItemsText] = useState(defaults.itemsText);
  const [macros, setMacros] = useState<MacroValues>({
    calories: defaults.macros?.calories ?? null,
    proteinG: defaults.macros?.proteinG ?? null,
    carbsG: defaults.macros?.carbsG ?? null,
    fatG: defaults.macros?.fatG ?? null,
    fiberG: defaults.macros?.fiberG ?? null,
    sodiumMg: defaults.macros?.sodiumMg ?? null,
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

  return (
    // Fragment: <form> + sheet side-by-side.
    // sheet (ScanFoodSheet) is outside the form so none of its buttons
    // can ever trigger form submission.
    <>
      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            try {
              await updateNutrition(id, fd);
            } catch (e) {
              if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Meal</span>
          <select
            name="mealType"
            defaultValue={defaults.mealType}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
          >
            {MEAL_TYPES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {/* Food composer controls — chips row + estimate field + strip.
            All buttons inside are type="button"; none can submit this form.
            Rendered ABOVE the items textarea so chip/scan adds are visible. */}
        {controls}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Items</span>
          <textarea
            name="items"
            required
            rows={5}
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
            placeholder="One item per line. Optional qty after a |"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Date</span>
          <input
            type="datetime-local"
            name="date"
            defaultValue={defaults.date}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            name="notes"
            rows={2}
            defaultValue={defaults.notes}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
          />
        </label>

        {/* MacroInputs — controlled so composer can sum into them */}
        <MacroInputs
          values={macros}
          onChange={(key, val) => setMacros((prev) => ({ ...prev, [key]: val }))}
        />

        {error && (
          <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {/* The ONLY type=submit in this form */}
          <button
            type="submit"
            disabled={pending}
            className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Delete meal · confirm"
            disabled={pending}
            variant="danger"
            onConfirm={() =>
              startTransition(async () => {
                try {
                  await deleteNutrition(id);
                } catch (e) {
                  if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
                  setError(e instanceof Error ? e.message : String(e));
                }
              })
            }
            className="rounded-lg border border-[var(--danger)]/40 text-[var(--danger)] px-3 py-2 text-sm"
          />
        </div>
      </form>

      {/* ScanFoodSheet overlay — sibling of <form>, outside its DOM subtree.
          Fixed-inset-0 overlay; none of its buttons can submit the edit form. */}
      {sheet}
    </>
  );
}
