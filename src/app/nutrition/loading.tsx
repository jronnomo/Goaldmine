// Loading skeleton for /nutrition — server component (no "use client" needed).
// DA note (#239): this skeleton also transiently covers /nutrition/[id]/edit via
// App Router loading.tsx nesting (that nested page has no skeleton of its own).
// The nutrition-list shape is a known, accepted mismatch for that rare edit route.

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="space-y-1" aria-hidden="true">
        <div className="h-7 w-32 rounded bg-[var(--border)] animate-pulse" />
        <div className="h-4 w-48 rounded bg-[var(--border)] animate-pulse" />
      </div>

      {/* Macro banner */}
      <div
        className="h-16 rounded-xl border border-[var(--border)] bg-[var(--card)] animate-pulse"
        aria-hidden="true"
      />

      {/* Meal card 1 */}
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

      {/* Meal card 2 */}
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

      {/* Form card */}
      <div
        className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
        aria-hidden="true"
      >
        <div className="h-5 w-1/4 rounded bg-[var(--border)] mb-4" />
        <div className="h-24 w-full rounded bg-[var(--border)]" />
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
