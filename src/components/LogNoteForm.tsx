"use client";

import { useRef, useTransition } from "react";
import { logNote } from "@/lib/workout-actions";

export function LogNoteForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await logNote(fd);
          formRef.current?.reset();
        })
      }
      className="flex flex-col gap-2"
    >
      <textarea
        name="body"
        required
        rows={3}
        placeholder="How did it feel? Audibles, soreness, energy…"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base resize-y min-h-[72px]"
      />
      <div className="flex gap-2 items-center">
        <select
          name="type"
          defaultValue="journal"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        >
          <option value="journal">Journal</option>
          <option value="audible">Audible</option>
          <option value="feedback">Feedback</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save note"}
        </button>
      </div>
    </form>
  );
}
