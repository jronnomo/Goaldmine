"use client";

import { useRef, useState, useTransition } from "react";
import { logNoteForDate } from "@/lib/day-actions";

export function DayNoteForm({ dateKey }: { dateKey: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await logNoteForDate(dateKey, fd);
            formRef.current?.reset();
          } catch (e) {
            if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-2"
    >
      <textarea
        name="body"
        required
        rows={4}
        placeholder="What should change for this day, and why? Claude reads this and proposes a revision."
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base resize-y"
      />
      <div className="flex gap-2 items-center">
        <select
          name="type"
          defaultValue="audible"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        >
          <option value="audible">Audible</option>
          <option value="journal">Journal</option>
          <option value="feedback">Feedback</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save note for this day"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-500 border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </form>
  );
}
