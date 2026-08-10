// Loading skeleton for /program — server component (house idiom, mirrors
// progress/loading.tsx). The page is a plain awaited server component
// (UXR-PV-90 rejected: no Suspense/streaming), so this route-level fallback
// is the only pending-state feedback while readiness series compute.

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-[var(--border)] animate-pulse" aria-hidden="true" />
          <div className="h-4 w-56 rounded bg-[var(--border)] animate-pulse" aria-hidden="true" />
        </div>
        <div className="h-8 w-20 rounded-lg bg-[var(--border)] animate-pulse" aria-hidden="true" />
      </div>

      {/* Window card (block band) */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-1.5 w-full rounded-full bg-[var(--border)] mb-3" />
        <div className="h-3 w-40 rounded bg-[var(--border)]" />
      </div>

      {/* Member goal cards */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
          aria-hidden="true"
        >
          <div className="h-4 w-3/4 rounded bg-[var(--border)] mb-4" />
          <div className="h-10 w-24 rounded bg-[var(--border)] mb-3" />
          <div className="h-1.5 w-full rounded-full bg-[var(--border)] mb-3" />
          <div className="space-y-2">
            <div className="h-3 w-2/3 rounded bg-[var(--border)]" />
            <div className="h-3 w-1/2 rounded bg-[var(--border)]" />
          </div>
        </div>
      ))}

      <span className="sr-only">Loading…</span>
    </div>
  );
}
