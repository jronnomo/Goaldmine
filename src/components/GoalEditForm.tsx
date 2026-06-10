"use client";

import { useState, useTransition } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { TargetsBuilder } from "@/components/TargetsBuilder";
import { copyTargetsFromGoal, deleteGoal, updateGoal } from "@/lib/goal-actions";

type Defaults = {
  objective: string;
  targetDate: string;
  notes: string;
  status: string;
  targets: string;
};

export type CopySource = {
  id: string;
  objective: string;
  targetDate: string;
  targetCount: number;
};

export function GoalEditForm({
  id,
  defaultValues,
  copySources,
}: {
  id: string;
  defaultValues: Defaults;
  copySources: CopySource[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copyFromGoalId, setCopyFromGoalId] = useState<string>("");

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
        <span className="text-sm font-medium">Target date <span className="text-[var(--muted)] font-normal">(optional — leave blank for a someday goal)</span></span>
        <input
          type="date"
          name="targetDate"
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

      {copySources.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
          <p className="text-sm font-medium">Import targets from another goal</p>
          <p className="text-xs text-[var(--muted)]">
            Replaces the builder rows above with a copy of another goal&apos;s targets. Reload the page to see the updated rows.
          </p>
          <div className="flex gap-2">
            <select
              value={copyFromGoalId}
              onChange={(e) => setCopyFromGoalId(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            >
              <option value="">— Pick a goal —</option>
              {copySources.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.objective} ({g.targetCount} target{g.targetCount === 1 ? "" : "s"})
                </option>
              ))}
            </select>
            <ConfirmButton
              label="Apply"
              confirmLabel="Confirm replace"
              disabled={pending || !copyFromGoalId}
              variant="accent"
              onConfirm={() =>
                startTransition(async () => {
                  try {
                    await copyTargetsFromGoal(id, copyFromGoalId);
                    window.location.reload();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                })
              }
              className="shrink-0 whitespace-nowrap rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-[var(--accent)] transition disabled:opacity-50"
            />
          </div>
        </div>
      )}

      {/* Friendly targets builder — renders a hidden <input name="targets"> in sync */}
      <TargetsBuilder
        defaultTargetsJson={defaultValues.targets}
        alwaysEmit
      />

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
        <ConfirmButton
          label="Delete"
          confirmLabel="Delete goal · confirm"
          disabled={pending}
          variant="danger"
          onConfirm={() =>
            startTransition(async () => {
              try {
                await deleteGoal(id);
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
  );
}
