"use client";

import { useState, useTransition } from "react";
import { applyPlanRevisionFromForm } from "@/lib/plan-actions";

export function ReviseForm({
  planId,
  noteId,
  currentSnapshot,
}: {
  planId: string;
  noteId: string | null;
  currentSnapshot: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await applyPlanRevisionFromForm(planId, fd);
          } catch (e) {
            if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      {noteId && <input type="hidden" name="triggerNoteId" value={noteId} />}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Summary (one-liner)</span>
        <input
          name="summary"
          required
          maxLength={200}
          placeholder="Insert deload week 5; shift Phase 2 by one week"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Reasoning</span>
        <textarea
          name="reasoning"
          rows={5}
          placeholder="Why this change? If applied by Claude, paste Claude's reasoning here so the audit trail is preserved."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Snapshot JSON (full plan after revision)</span>
        <textarea
          name="snapshot"
          required
          rows={18}
          defaultValue={currentSnapshot}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs font-mono resize-y"
        />
        <span className="text-xs text-[var(--muted)]">
          Edit the JSON to reflect the post-revision plan. Cascading week/phase shifts go here.
          Leave unchanged to record a no-op revision (e.g. logging a coaching conversation that
          didn&apos;t require structural edits).
        </span>
      </label>

      {error && (
        <p className="text-sm text-red-500 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2.5 font-medium disabled:opacity-50"
      >
        {pending ? "Applying…" : "Apply revision"}
      </button>
    </form>
  );
}
