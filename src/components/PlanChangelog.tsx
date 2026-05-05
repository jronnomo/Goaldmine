import Link from "next/link";

export type ChangelogEntry = {
  id: string;
  createdAt: Date;
  triggerSource: string;
  summary: string;
  reasoning: string | null;
  triggerNote: { id: string; body: string; type: string; date: Date } | null;
};

export function PlanChangelog({ entries, goalId }: { entries: ChangelogEntry[]; goalId: string }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No revisions yet. The plan is the original scaffold.{" "}
        <Link href={`/goals/${goalId}/revise`} className="text-[var(--accent)]">
          Add a manual revision
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <li
          key={e.id}
          className="rounded-lg border border-[var(--border)] p-3 text-sm space-y-1"
        >
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/goals/${goalId}/revisions/${e.id}`} className="font-medium hover:text-[var(--accent)]">
              {e.summary}
            </Link>
            <span
              className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${badgeClass(e.triggerSource)}`}
            >
              {e.triggerSource}
            </span>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {new Date(e.createdAt).toLocaleString()}
          </p>
          {e.triggerNote && (
            <div className="mt-2 rounded-lg bg-[var(--background)] border border-[var(--border)] p-2">
              <p className="text-xs text-[var(--muted)] mb-0.5">
                Triggered by {e.triggerNote.type} · {new Date(e.triggerNote.date).toLocaleDateString()}
              </p>
              <p className="text-xs whitespace-pre-wrap line-clamp-3">{e.triggerNote.body}</p>
            </div>
          )}
          {e.reasoning && (
            <details className="mt-2">
              <summary className="text-xs text-[var(--accent)] cursor-pointer">Reasoning</summary>
              <p className="text-xs whitespace-pre-wrap mt-1 text-[var(--muted)]">
                {e.reasoning}
              </p>
            </details>
          )}
          <Link
            href={`/goals/${goalId}/revisions/${e.id}`}
            className="text-xs text-[var(--accent)] inline-block mt-1"
          >
            View before / after →
          </Link>
        </li>
      ))}
    </ul>
  );
}

function badgeClass(source: string): string {
  switch (source) {
    case "claude":
      return "border-[var(--accent)]/40 text-[var(--accent)]";
    case "note":
      return "border-[var(--warning)]/40 text-[var(--warning)]";
    default:
      return "border-[var(--border)] text-[var(--muted)]";
  }
}
