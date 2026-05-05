"use client";

import { useRef, useState, useTransition } from "react";
import { logBaselineInline } from "@/lib/workout-actions";

export function LogBaselineInlineForm({
  testName,
  units,
}: {
  testName: string;
  units: string;
}) {
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
            await logBaselineInline(fd);
            formRef.current?.reset();
          } catch (e) {
            if (e instanceof Error && e.message === "NEXT_REDIRECT") return;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex items-center gap-2 mt-1"
    >
      <input type="hidden" name="testName" value={testName} />
      <input type="hidden" name="units" value={units} />
      <input
        type="number"
        name="value"
        step="any"
        required
        placeholder={units}
        className="w-24 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm tabular-nums"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-3 py-1 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "…" : "Log"}
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </form>
  );
}
