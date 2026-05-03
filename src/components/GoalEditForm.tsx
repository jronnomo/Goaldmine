"use client";

import { useState, useTransition } from "react";
import { deleteGoal, resetGoalToMtElbertDefaults, updateGoal } from "@/lib/goal-actions";

type Defaults = {
  objective: string;
  targetDate: string;
  notes: string;
  status: string;
  targets: string;
};

export function GoalEditForm({ id, defaultValues }: { id: string; defaultValues: Defaults }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await updateGoal(id, fd);
          } catch (e) {
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
          defaultValue={defaultValues.objective}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Target date</span>
        <input
          type="date"
          name="targetDate"
          required
          defaultValue={defaultValues.targetDate}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Status</span>
        <select
          name="status"
          defaultValue={defaultValues.status}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        >
          <option value="active">Active</option>
          <option value="achieved">Achieved</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes</span>
        <textarea
          name="notes"
          rows={4}
          defaultValue={defaultValues.notes}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium flex items-center justify-between">
          Targets (JSON)
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                !confirm(
                  "Replace the current targets with the research-grounded Mt. Elbert defaults? Any custom edits will be lost.",
                )
              ) {
                return;
              }
              startTransition(async () => {
                try {
                  await resetGoalToMtElbertDefaults(id);
                  // The page will revalidate; refresh to pull updated defaults into the textarea.
                  window.location.reload();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              });
            }}
            className="text-xs text-[var(--accent)] font-normal underline-offset-2 hover:underline"
          >
            Apply Mt. Elbert defaults
          </button>
        </span>
        <textarea
          name="targets"
          rows={10}
          defaultValue={defaultValues.targets}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs font-mono resize-y"
        />
        <span className="text-xs text-[var(--muted)]">
          Array of <code>{`{ metric, label, target, weight, units, direction, rationale? }`}</code>. Weights should sum to ~1.
        </span>
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
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm("Delete this goal? This cannot be undone.")) {
              startTransition(async () => {
                try {
                  await deleteGoal(id);
                } catch (e) {
                  if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
                  setError(e instanceof Error ? e.message : String(e));
                }
              });
            }
          }}
          className="rounded-lg border border-red-500/40 text-red-500 px-3 py-2 text-sm"
        >
          Delete
        </button>
      </div>
    </form>
  );
}
