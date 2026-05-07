"use client";

import Link from "next/link";
import { useTransition } from "react";
import { resolveAllPendingNotes, resolveNote } from "@/lib/note-actions";

export type PendingNote = {
  id: string;
  date: Date;
  body: string;
  type: string;
};

export function PendingNotes({
  notes,
  goalId,
}: {
  notes: PendingNote[];
  goalId: string;
}) {
  const [pending, startTransition] = useTransition();

  if (notes.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No pending notes. New audibles, journals, and feedback land here for review.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          Have Claude fold them into a revision, or mark resolved if no plan change is needed.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Resolve all ${notes.length} pending notes?`)) return;
            startTransition(() => resolveAllPendingNotes());
          }}
          className="text-xs rounded-full border border-[var(--border)] px-2 py-1 hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-[var(--accent)] disabled:opacity-50 shrink-0"
        >
          Resolve all
        </button>
      </div>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li
            key={n.id}
            className="rounded-lg border border-[var(--border)] p-3 text-sm space-y-1"
          >
            <div className="flex justify-between gap-2 items-baseline">
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                {n.type}
              </span>
              <span className="text-xs text-[var(--muted)]">
                {new Date(n.date).toLocaleString()}
              </span>
            </div>
            <p className="whitespace-pre-wrap">{n.body}</p>
            <div className="flex items-center justify-between gap-2 pt-1">
              <Link
                href={`/goals/${goalId}/revise?noteId=${n.id}`}
                className="text-xs text-[var(--accent)]"
              >
                Apply revision from this note →
              </Link>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => resolveNote(n.id))}
                className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                Mark resolved
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
