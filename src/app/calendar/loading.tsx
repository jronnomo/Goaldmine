// Loading skeleton for /calendar — server component (no "use client" needed).
// Renders pulsing card-shaped blocks while the month grid and summary data load.

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* Header row: title + pill */}
      <div className="flex items-center justify-between" aria-hidden="true">
        <div className="h-7 w-28 rounded bg-[var(--border)] animate-pulse" />
        <div className="h-10 w-24 rounded-full bg-[var(--border)] animate-pulse" />
      </div>

      {/* Month-nav row */}
      <div className="flex items-center justify-between" aria-hidden="true">
        <div className="h-10 w-20 rounded bg-[var(--border)] animate-pulse" />
        <div className="h-5 w-28 rounded bg-[var(--border)] animate-pulse" />
        <div className="h-10 w-20 rounded bg-[var(--border)] animate-pulse" />
      </div>

      {/* Calendar grid card */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="aspect-square rounded bg-[var(--border)]" />
          ))}
        </div>
      </div>

      {/* Legend card */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/3 rounded bg-[var(--border)] mb-4" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-4 rounded bg-[var(--border)]" />
          <div className="h-4 rounded bg-[var(--border)]" />
          <div className="h-4 rounded bg-[var(--border)]" />
          <div className="h-4 rounded bg-[var(--border)]" />
          <div className="h-4 rounded bg-[var(--border)]" />
          <div className="h-4 rounded bg-[var(--border)]" />
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-2" aria-hidden="true">
        <div className="h-16 rounded-lg bg-[var(--border)] animate-pulse" />
        <div className="h-16 rounded-lg bg-[var(--border)] animate-pulse" />
        <div className="h-16 rounded-lg bg-[var(--border)] animate-pulse" />
        <div className="h-16 rounded-lg bg-[var(--border)] animate-pulse" />
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
