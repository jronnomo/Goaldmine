// src/components/DeleteReadingButton.tsx
// C2 (#150) — inline delete control for a single metric reading.
// "use client" — uses useTransition for a disabled/pending state while the
// server action runs. confirm() prevents accidental loss. Tiny, accessible.

"use client";

import { useTransition } from "react";
import { deleteMetricReading } from "@/lib/goal-actions";

interface DeleteReadingButtonProps {
  goalId: string;
  /** Bare metric key (no "log:" prefix) — matches LogEntry.metric. */
  metric: string;
  entryId: string;
}

export function DeleteReadingButton({ goalId, metric, entryId }: DeleteReadingButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("Delete this reading?")) return;
    startTransition(() => {
      deleteMetricReading(goalId, metric, entryId);
    });
  }

  return (
    <button
      type="button"
      aria-label="Delete this reading"
      disabled={isPending}
      onClick={handleClick}
      className="text-xs text-[var(--muted)] hover:text-red-500 disabled:opacity-50 ml-2 shrink-0 leading-none"
    >
      {isPending ? "…" : "×"}
    </button>
  );
}
