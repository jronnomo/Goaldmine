"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importStrongWorkout } from "@/lib/workout-actions";

export function ImportForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            const id = await importStrongWorkout(fd);
            router.push(`/workouts/${id}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <textarea
        name="raw"
        required
        rows={14}
        placeholder="Paste your workout txt here…"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm font-mono resize-y min-h-[260px]"
      />
      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2.5 font-medium disabled:opacity-50"
      >
        {pending ? "Parsing…" : "Parse + save"}
      </button>
    </form>
  );
}
