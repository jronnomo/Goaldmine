"use client";

import { useState, useTransition } from "react";
import { createGoal } from "@/lib/goal-actions";
import { MT_ELBERT_DEFAULT_TARGETS } from "@/lib/goal-targets";

export function GoalCreateForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [useDefaults, setUseDefaults] = useState(true);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await createGoal(fd);
          } catch (e) {
            // redirect() throws NEXT_REDIRECT — let it propagate.
            if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Objective</span>
        <input
          name="objective"
          required
          maxLength={200}
          placeholder="Summit Mt. Elbert via Black Cloud Trail"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Target date</span>
        <input
          type="date"
          name="targetDate"
          required
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes (Claude can read these)</span>
        <textarea
          name="notes"
          rows={4}
          placeholder="Any context, constraints, or sub-goals you want me to remember when coaching toward this."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          name="useDefaults"
          checked={useDefaults}
          onChange={(e) => setUseDefaults(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Use Mt. Elbert default readiness targets
          <span className="block text-xs text-[var(--muted)]">
            {MT_ELBERT_DEFAULT_TARGETS.length} weighted targets covering aerobic base, leg endurance,
            mobility, leg strength, hike volume, and body weight. You can edit these on the goal detail page later.
          </span>
        </span>
      </label>

      {error && (
        <p className="text-sm text-red-500 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2.5 font-medium disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create goal"}
      </button>
    </form>
  );
}
