"use client";

import { useMemo, useState, useTransition } from "react";
import { logBaseline } from "@/lib/workout-actions";

type KnownTest = { name: string; units: string; protocol: string; dayOfWeek: number };

const OTHER_LITERAL = "__other__";

const OTHER = "__other__";

export function LogBaselineForm({
  knownTests,
  presetName,
  presetUnits,
}: {
  knownTests: KnownTest[];
  presetName: string | null;
  presetUnits: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = presetName && knownTests.some((t) => t.name === presetName) ? presetName : presetName ? OTHER : (knownTests[0]?.name ?? OTHER);
  const [selected, setSelected] = useState<string>(initial);
  const [customName, setCustomName] = useState<string>(presetName && initial === OTHER ? presetName : "");

  const selectedTest = useMemo(
    () => knownTests.find((t) => t.name === selected) ?? null,
    [knownTests, selected],
  );

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          // Resolve the actual test name to submit.
          if (selected === OTHER) {
            fd.set("testName", customName.trim());
          } else {
            fd.set("testName", selected);
          }
          try {
            await logBaseline(fd);
          } catch (e) {
            if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Test</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        >
          {knownTests.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.units})
            </option>
          ))}
          <option value={OTHER}>Other (custom)…</option>
        </select>
        {selectedTest && selected !== OTHER_LITERAL && (
          <p className="text-xs text-[var(--muted)] italic mt-1">{selectedTest.protocol}</p>
        )}
      </label>

      {selected === OTHER && (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Custom test name</span>
          <input
            type="text"
            required
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
          />
        </label>
      )}

      <div className="flex gap-2">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-sm font-medium">Value</span>
          <input
            type="number"
            name="value"
            step="any"
            required
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 w-28">
          <span className="text-sm font-medium">Units</span>
          <input
            type="text"
            name="units"
            required
            defaultValue={selectedTest?.units ?? presetUnits ?? ""}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Date</span>
        <input
          type="date"
          name="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes (optional)</span>
        <textarea
          name="notes"
          rows={3}
          placeholder="Conditions, how it felt, anything Claude should know."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

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
        {pending ? "Saving…" : "Save baseline"}
      </button>
    </form>
  );
}
