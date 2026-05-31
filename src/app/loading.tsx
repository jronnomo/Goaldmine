// Root loading skeleton — server component (no "use client" needed).
// Renders pulsing card-shaped blocks while page data loads.

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* Pulse blocks mimicking Card shapes */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/3 rounded bg-[var(--border)] mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-[var(--border)]" />
          <div className="h-3 w-5/6 rounded bg-[var(--border)]" />
          <div className="h-3 w-4/6 rounded bg-[var(--border)]" />
        </div>
      </div>

      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/4 rounded bg-[var(--border)] mb-4" />
        <div className="h-24 w-full rounded bg-[var(--border)]" />
      </div>

      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-2/5 rounded bg-[var(--border)] mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-[var(--border)]" />
          <div className="h-3 w-3/4 rounded bg-[var(--border)]" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
