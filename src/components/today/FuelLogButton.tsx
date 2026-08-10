"use client";

// The FuelRail's one-tap log affordance — the only client island the
// today-page-ia reorder adds (sanctioned by UXR-TIA-30). It does NOT host a
// composer: it opens the existing BottomNav Log sheet (which now defaults to
// the meal panel), so the write surface stays single and bottom-edge
// (UXR-TIA-12 — the rail itself remains a wayfinding <Link>, not the trigger).

import { OPEN_LOG_SHEET_EVENT } from "@/lib/log-sheet-events";

export function FuelLogButton() {
  return (
    <button
      type="button"
      data-testid="today-fuel-log"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_LOG_SHEET_EVENT))}
      className="shrink-0 self-center min-h-[44px] px-1 text-sm font-medium text-[var(--accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      Log meal
    </button>
  );
}
