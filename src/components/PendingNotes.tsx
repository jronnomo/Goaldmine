"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
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
        <ConfirmButton
          label="Resolve all"
          confirmLabel="Resolve all · confirm"
          disabled={pending}
          variant="accent"
          onConfirm={() => startTransition(() => resolveAllPendingNotes())}
          className="text-xs rounded-full border border-[var(--border)] px-2 py-1 hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-[var(--accent)] disabled:opacity-50 shrink-0"
        />
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
            <div className="pt-1">
              <div className="flex items-center gap-3">
                <Link
                  href={`/goals/${goalId}/revise?noteId=${n.id}`}
                  className="inline-flex items-center min-h-[44px] text-xs text-[var(--accent)]"
                >
                  Apply revision →
                </Link>
                <Link
                  href={`/goals?objective=${encodeURIComponent(n.body.slice(0, 200))}#new-goal`}
                  className="inline-flex items-center min-h-[44px] text-xs text-[var(--accent)]"
                >
                  Promote to goal →
                </Link>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => resolveNote(n.id))}
                  className="inline-flex items-center min-h-[44px] text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  Mark resolved
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
