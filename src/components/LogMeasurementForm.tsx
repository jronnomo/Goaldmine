"use client";

import { useTransition } from "react";
import { logMeasurement } from "@/lib/workout-actions";

export function LogMeasurementForm({ latestWeight }: { latestWeight: number | null }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => startTransition(() => logMeasurement(fd))}
      className="flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <input
          type="number"
          name="weightLb"
          step="0.1"
          min="0"
          required
          placeholder="lbs"
          defaultValue={latestWeight ?? undefined}
          className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
        <input
          type="number"
          name="restingHr"
          min="0"
          placeholder="RHR"
          className="w-20 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </div>
      <input
        type="text"
        name="notes"
        placeholder="optional note"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
      >
        {pending ? "Saving…" : "Log weight"}
      </button>
    </form>
  );
}
