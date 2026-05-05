"use client";

import { useState, useTransition } from "react";
import { deleteNutrition, updateNutrition } from "@/lib/workout-actions";

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
}: {
  id: string;
  defaults: { mealType: string; itemsText: string; notes: string; date: string };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
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

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Items</span>
        <textarea
          name="items"
          required
          rows={5}
          defaultValue={defaults.itemsText}
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

      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm("Delete this meal log? This cannot be undone.")) return;
            startTransition(async () => {
              try {
                await deleteNutrition(id);
              } catch (e) {
                if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
                setError(e instanceof Error ? e.message : String(e));
              }
            });
          }}
          className="rounded-lg border border-[var(--danger)]/40 text-[var(--danger)] px-3 py-2 text-sm"
        >
          Delete
        </button>
      </div>
    </form>
  );
}
