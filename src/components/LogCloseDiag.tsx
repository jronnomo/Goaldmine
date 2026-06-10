// TEMP-DIAG ─────────────────────────────────────────────────────────────────
// LogCloseDiag — tiny client component rendered at the top of the Today page.
// Reads localStorage["goaldmine.diag.logclose"] on mount and displays the last
// recorded Log-sheet close reason so it is visible on-device after reproducing
// the camera-triggered close bug. Remove this file + its import in page.tsx
// after the cause is confirmed.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";

type DiagEntry = {
  reason: string;
  at: string;
  pathname: string;
};

export function LogCloseDiag() {
  const [entry, setEntry] = useState<DiagEntry | null>(null);

  // Guard SSR: localStorage is only available in the browser. This effect runs
  // only on the client, after hydration, so it is safe to access localStorage.
  // setState here is intentional: localStorage is an external system we're
  // syncing into React state on mount (analogous to a one-shot subscription).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("goaldmine.diag.logclose");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setEntry(JSON.parse(raw) as DiagEntry);
    } catch { /* noop */ }
  }, []);

  if (!entry) return null;

  // Format the ISO timestamp as a short local time string for readability.
  const timeStr = (() => {
    try {
      return new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return entry.at;
    }
  })();

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-amber-300/60 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
      <span className="font-mono font-semibold shrink-0">diag:</span>
      <span className="flex-1 truncate">
        last Log close = <strong>{entry.reason}</strong> @ {timeStr} on {entry.pathname || "/"}
      </span>
      <button
        type="button"
        onClick={() => {
          try { localStorage.removeItem("goaldmine.diag.logclose"); } catch { /* noop */ }
          setEntry(null);
        }}
        className="shrink-0 underline hover:no-underline focus-visible:outline-none"
        aria-label="Clear diagnostic"
      >
        clear
      </button>
    </div>
  );
}
