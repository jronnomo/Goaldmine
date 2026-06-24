"use client";

import { logMeasurement } from "@/lib/workout-actions";
import { useFormFeedback } from "@/lib/use-form-feedback";

export function LogMeasurementForm({ latestWeight }: { latestWeight: number | null }) {
  const { pending, error, saved, formRef, submit } = useFormFeedback();

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(logMeasurement, {
          successMsg: "✓ Weight logged",
        });
      }}
      className="flex flex-col gap-2"
    >
      <input
        type="number"
        name="weightLb"
        step="0.1"
        min="0"
        required
        placeholder="lbs"
        defaultValue={latestWeight ?? undefined}
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
      />
      <input
        type="text"
        name="notes"
        placeholder="context on this weigh-in (optional)"
        title="Attached to this measurement only — e.g. 'morning, post-coffee, after a long hike'. Use &quot;Log a note&quot; below for free-form thoughts not tied to a weigh-in."
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
        {pending ? "Saving…" : "Log weight"}
      </button>
    </form>
  );
}
