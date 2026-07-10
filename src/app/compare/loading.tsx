// Loading skeleton for /compare — server component (no "use client" needed).
// Note: compare's date-range form is a native GET submit (full document reload),
// so this skeleton is the first paint on both same-route nav and initial load.

export default function Loading() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      {/* Hero span */}
      <div
        className="h-20 rounded-2xl border border-[var(--border)] bg-[var(--card)] animate-pulse"
        aria-hidden="true"
      />

      {/* Goal chips */}
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        <div className="h-8 w-16 rounded-full bg-[var(--border)] animate-pulse" />
        <div className="h-8 w-16 rounded-full bg-[var(--border)] animate-pulse" />
        <div className="h-8 w-16 rounded-full bg-[var(--border)] animate-pulse" />
        <div className="h-8 w-16 rounded-full bg-[var(--border)] animate-pulse" />
      </div>

      {/* Date-range form card */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="flex items-end gap-2">
          <div className="h-10 flex-1 rounded-lg bg-[var(--border)]" />
          <div className="h-10 flex-1 rounded-lg bg-[var(--border)]" />
          <div className="h-10 w-24 rounded-lg bg-[var(--border)]" />
        </div>
      </div>

      {/* Section card 1 */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/3 rounded bg-[var(--border)] mb-4" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-16 rounded-lg bg-[var(--border)]" />
          <div className="h-16 rounded-lg bg-[var(--border)]" />
          <div className="h-16 rounded-lg bg-[var(--border)]" />
        </div>
      </div>

      {/* Section card 2 */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/3 rounded bg-[var(--border)] mb-4" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-16 rounded-lg bg-[var(--border)]" />
          <div className="h-16 rounded-lg bg-[var(--border)]" />
          <div className="h-16 rounded-lg bg-[var(--border)]" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
