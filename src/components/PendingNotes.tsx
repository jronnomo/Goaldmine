import Link from "next/link";

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
  if (notes.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No notes since the last revision. When you log audibles, journals, or feedback, they
        appear here for review.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        These notes haven&apos;t been folded into the plan yet. Open Claude in claude.ai (Phase 3 MCP),
        or use the form to record a manual revision capturing how the note changes the plan.
      </p>
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
            <Link
              href={`/goals/${goalId}/revise?noteId=${n.id}`}
              className="text-xs text-[var(--accent)] inline-block mt-1"
            >
              Apply revision from this note →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
