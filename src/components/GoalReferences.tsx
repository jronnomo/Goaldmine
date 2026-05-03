"use client";

import { useState, useTransition } from "react";
import { addGoalReference, removeGoalReference, type GoalReference } from "@/lib/goal-actions";

export function GoalReferences({
  goalId,
  references,
}: {
  goalId: string;
  references: GoalReference[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"url" | "doc">("url");

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        Attach URLs (route reports, training research, AllTrails / 14ers.com / Strava activity links)
        or pasted document text. Claude reads these from claude.ai (via MCP) to refine your targets,
        weights, and rationale.
      </p>

      {references.length > 0 && (
        <ul className="space-y-2">
          {references.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-[var(--border)] p-3 text-sm space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {r.label ?? (r.kind === "url" ? "URL" : "Document")}
                  </p>
                  {r.kind === "url" ? (
                    <a
                      href={r.value}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--accent)] truncate block"
                    >
                      {r.value}
                    </a>
                  ) : (
                    <p className="text-xs text-[var(--muted)] line-clamp-3 whitespace-pre-wrap">
                      {r.value}
                    </p>
                  )}
                  <p className="text-xs text-[var(--muted)] mt-1">
                    Added {new Date(r.addedAt).toLocaleDateString()} · {r.kind}
                    {r.claudeSummary ? " · summarized" : ""}
                  </p>
                  {r.claudeSummary && (
                    <p className="text-xs italic text-[var(--muted)] mt-1 border-l-2 border-[var(--border)] pl-2">
                      {r.claudeSummary}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm("Remove this reference?")) return;
                    startTransition(() => removeGoalReference(goalId, r.id));
                  }}
                  className="text-xs text-[var(--muted)] hover:text-red-500 px-2"
                  aria-label="Remove reference"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            try {
              await addGoalReference(goalId, fd);
              (document.getElementById(`ref-form-${goalId}`) as HTMLFormElement | null)?.reset();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
        id={`ref-form-${goalId}`}
        className="space-y-2 pt-2 border-t border-[var(--border)]"
      >
        <div className="flex gap-2">
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "url" | "doc")}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="url">URL</option>
            <option value="doc">Doc / pasted text</option>
          </select>
          <input
            type="text"
            name="label"
            placeholder="label (optional)"
            className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
          />
        </div>
        {kind === "url" ? (
          <input
            type="url"
            name="value"
            required
            placeholder="https://…"
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        ) : (
          <textarea
            name="value"
            required
            rows={5}
            placeholder="Paste research excerpt, route description, training plan, etc."
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
          />
        )}
        {error && (
          <p className="text-xs text-red-500 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-[var(--accent)] transition disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add reference"}
        </button>
      </form>
    </div>
  );
}
