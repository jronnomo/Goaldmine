"use client";

import { useState, useTransition } from "react";
import { clearDayOverride, upsertDayOverrideFromForm } from "@/lib/day-actions";

export function DayOverrideForm({
  dateKey,
  defaults,
  hasOverride,
}: {
  dateKey: string;
  defaults: { workoutJson: string; nutritionText: string; mobilityText: string; notes: string };
  hasOverride: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await upsertDayOverrideFromForm(dateKey, fd);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <details>
        <summary className="text-sm font-medium cursor-pointer">Workout JSON</summary>
        <textarea
          name="workoutJson"
          rows={12}
          defaultValue={defaults.workoutJson}
          placeholder="Leave blank to use the rotation default."
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs font-mono resize-y"
        />
      </details>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Nutrition (override)</span>
        <textarea
          name="nutritionText"
          rows={3}
          defaultValue={defaults.nutritionText}
          placeholder="Anything different for today's eating? Leave blank for phase default."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Mobility (override)</span>
        <textarea
          name="mobilityText"
          rows={3}
          defaultValue={defaults.mobilityText}
          placeholder="Skip / extend / modify the daily routine for today."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes</span>
        <input
          name="notes"
          defaultValue={defaults.notes}
          placeholder="Why the override?"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
      </label>

      {error && (
        <p className="text-sm text-red-500 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : hasOverride ? "Update override" : "Save override"}
        </button>
        {hasOverride && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm("Remove this day's override and revert to the rotation?")) return;
              startTransition(async () => {
                try {
                  await clearDayOverride(dateKey);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              });
            }}
            className="rounded-lg border border-red-500/40 text-red-500 px-3 py-2 text-sm"
          >
            Clear
          </button>
        )}
      </div>
    </form>
  );
}
