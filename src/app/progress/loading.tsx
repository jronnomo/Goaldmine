// Loading skeleton for /progress — server component (no "use client" needed).
// Renders pulsing card-shaped blocks while readiness/weight/records data loads.

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="h-7 w-28 rounded bg-[var(--border)] animate-pulse" aria-hidden="true" />

      {/* Recap-link pill */}
      <div
        className="min-h-[64px] rounded-xl border border-[var(--border)] animate-pulse"
        aria-hidden="true"
      >
        <div className="h-full w-full p-4 flex items-center">
          <div className="h-4 w-2/3 rounded bg-[var(--border)]" />
        </div>
      </div>

      {/* Readiness card */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/3 rounded bg-[var(--border)] mb-4" />
        <div className="h-10 w-24 rounded bg-[var(--border)] mb-4" />
        <div className="h-40 w-full rounded bg-[var(--border)] mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-[var(--border)]" />
          <div className="h-3 w-3/4 rounded bg-[var(--border)]" />
        </div>
      </div>

      {/* Weight card */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/4 rounded bg-[var(--border)] mb-4" />
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="h-16 rounded-lg bg-[var(--border)]" />
          <div className="h-16 rounded-lg bg-[var(--border)]" />
          <div className="h-16 rounded-lg bg-[var(--border)]" />
        </div>
        <div className="h-32 w-full rounded bg-[var(--border)]" />
      </div>

      {/* Records card */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-2/5 rounded bg-[var(--border)] mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-[var(--border)]" />
          <div className="h-3 w-5/6 rounded bg-[var(--border)]" />
          <div className="h-3 w-4/6 rounded bg-[var(--border)]" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
