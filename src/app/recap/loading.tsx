// Loading skeleton for /recap — server component (no "use client" needed).
// Uses <main> to match the page's own wrapper (the only route of the five that isn't a <div>).

export default function Loading() {
  return (
    <main className="max-w-md mx-auto p-4 space-y-4">
      <div className="h-7 w-32 rounded bg-[var(--border)] animate-pulse" aria-hidden="true" />

      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/3 rounded bg-[var(--border)] mb-4" />
        <div className="h-64 w-full rounded bg-[var(--border)] mb-4" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-[var(--border)]" />
          <div className="h-3 w-3/4 rounded bg-[var(--border)]" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </main>
  );
}
