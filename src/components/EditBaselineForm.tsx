"use client";

import { useState, useTransition } from "react";
import { deleteBaselineRow, updateBaseline } from "@/lib/workout-actions";

export function EditBaselineForm({
  id,
  testName,
  defaults,
}: {
  id: string;
  testName: string;
  defaults: { value: string; units: string; date: string; notes: string };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await updateBaseline(id, fd);
          } catch (e) {
            if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <div>
        <p className="text-sm font-medium">Test</p>
        <p className="text-sm text-[var(--muted)]">{testName}</p>
      </div>

      <div className="flex gap-2">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-sm font-medium">Value</span>
          <input
            type="number"
            name="value"
            step="any"
            required
            defaultValue={defaults.value}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 w-28">
          <span className="text-sm font-medium">Units</span>
          <input
            type="text"
            name="units"
            required
            defaultValue={defaults.units}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Date</span>
        <input
          type="date"
          name="date"
          defaultValue={defaults.date}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={defaults.notes}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
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
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm("Delete this result? This cannot be undone.")) return;
            startTransition(async () => {
              try {
                await deleteBaselineRow(id);
              } catch (e) {
                if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
                setError(e instanceof Error ? e.message : String(e));
              }
            });
          }}
          className="rounded-lg border border-red-500/40 text-red-500 px-3 py-2 text-sm"
        >
          Delete
        </button>
      </div>
    </form>
  );
}
