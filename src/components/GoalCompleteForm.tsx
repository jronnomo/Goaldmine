"use client";

import { useState, useTransition } from "react";
import { completeGoal } from "@/lib/goal-actions";

/**
 * "Complete" card on an active goal's detail page (REQ-011). Clones
 * GoalEditForm's useTransition + inline-error idiom. `defaultDateKey` is
 * computed server-side (USER_TZ) and passed in — this is a client component,
 * so it cannot import the server-only @/lib/calendar itself.
 */
export function GoalCompleteForm({
  id,
  defaultDateKey,
}: {
  id: string;
  defaultDateKey: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(defaultDateKey);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await completeGoal(id, fd);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Completion date</span>
        <input
          type="date"
          name="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <p className="text-xs text-[var(--muted)]">
        Archives this goal: releases focus, pauses its plan, removes it from the calendar. Reversible.
      </p>

      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-[44px] rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
      >
        {pending ? "Completing…" : "Mark complete 🏆"}
      </button>
    </form>
  );
}
