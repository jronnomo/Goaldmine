"use client";

// Root error boundary — required to be a client component by Next.js 16.
// IMPORTANT: Next 16.2.4 passes unstable_retry (not reset) for re-fetching
// server components. The reset prop only clears client error state and does
// NOT re-fetch. Use unstable_retry for the "Try again" button.

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="max-w-md mx-auto p-4 flex flex-col items-center justify-center min-h-[40vh] text-center gap-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm w-full">
        <p className="text-2xl mb-2" aria-hidden="true">
          😬
        </p>
        <h2 className="text-lg font-semibold mb-1">Something went sideways</h2>
        <p className="text-sm text-[var(--muted)] mb-4">
          {"Don't sweat it — your data is safe. Give it another try or come back in a moment."}
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--muted)] mb-4 font-mono">
            ref: {error.digest}
          </p>
        )}
        <button
          onClick={() => unstable_retry()}
          className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-6 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
