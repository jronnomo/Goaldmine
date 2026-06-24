"use client";

import { useState } from "react";
import { logBodyMetric } from "@/lib/workout-actions";
import { useFormFeedback } from "@/lib/use-form-feedback";
import { BODY_METRICS } from "@/lib/metrics-registry";

const CUSTOM_KEY = "__custom__";

export function LogBodyMetricForm() {
  const { pending, error, saved, formRef, submit } = useFormFeedback();
  const [selectedKey, setSelectedKey] = useState<string>(
    BODY_METRICS[0]?.key ?? CUSTOM_KEY,
  );

  const isCustom = selectedKey === CUSTOM_KEY;
  const registrySpec = BODY_METRICS.find((m) => m.key === selectedKey);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(logBodyMetric, {
          successMsg: "✓ Metric logged",
          onSuccess: () => setSelectedKey(BODY_METRICS[0]?.key ?? CUSTOM_KEY),
        });
      }}
      className="flex flex-col gap-2"
    >
      {/* Hidden key for registry picks so FormData carries it under "key" */}
      {!isCustom && <input type="hidden" name="key" value={selectedKey} />}

      <select
        value={selectedKey}
        onChange={(e) => setSelectedKey(e.target.value)}
        aria-label="Metric"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      >
        {BODY_METRICS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label} ({m.units})
          </option>
        ))}
        <option value={CUSTOM_KEY}>Custom…</option>
      </select>

      {/* Custom key + optional unit inputs — only shown when "Custom…" is selected */}
      {isCustom && (
        <div className="flex gap-2">
          <input
            type="text"
            name="key"
            required
            placeholder="metric key (e.g. grip_strength)"
            className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          <input
            type="text"
            name="unit"
            placeholder="unit (e.g. kg)"
            className="w-24 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="flex gap-2 items-center">
        <input
          type="number"
          name="value"
          step="any"
          required
          placeholder="value"
          className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
        {/* Show implied unit read-only for registry picks */}
        {!isCustom && registrySpec && (
          <span className="text-sm text-[var(--muted)] shrink-0 w-20 text-center">
            {registrySpec.units}
          </span>
        )}
      </div>

      <input
        type="date"
        name="date"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />

      <input
        type="text"
        name="notes"
        placeholder="notes (optional)"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />

      {/* Reserved height prevents layout shift whether saved, error, or empty */}
      <p className="text-xs min-h-[1rem]" aria-live="polite">
        {saved && <span className="text-[var(--success)]">{saved}</span>}
        {error && !saved && <span className="text-[var(--danger)]">{error}</span>}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
      >
        {pending ? "Saving…" : "Log metric"}
      </button>
    </form>
  );
}
