// src/components/trends/TrendsRailCaption.tsx — the answer echo at the
// gesture site (R11). After a drag the panel that answers the question is
// ~600px below the user's thumb and updates silently; this caption carries
// the window, its coverage, and the maintenance headline (or its withheld
// reason) right at the rail — and it re-evaluates LIVE during the drag (R12),
// which is the feature's best teaching moment: a user dragging a 4-day window
// watches "Maintenance needs at least 7 days. This window is 4." appear while
// their finger is still down, and widening it brings the number back.
//
// It reads the SAME WindowAggregate the panel does — no second arithmetic
// path, so caption and panel cannot disagree (UXR-TRENDS-16).
//
// ⚑66: `Clear` is SUPPRESSED while the window is gated — the gate sentence
// otherwise shares its line with a 64px control and wraps to a fourth caption
// line, overrunning the fold in the one state R12 calls the feature's best
// teaching moment. A sub-7-day window is one the user is still adjusting;
// tap-to-clear (and the fallback form's clear) still work.
//
// Client-by-inheritance; directive-free.

import { RAIL_PER_DAY_MAX_DAYS } from "@/components/trends/TrendsRail";
import { tdeeGateCopy } from "@/components/trends/gate-copy";
import type { WindowAggregate } from "@/lib/trends-core";

function fmtKcal(n: number): string {
  return n.toLocaleString("en-US");
}

export function TrendsRailCaption({
  aggregate,
  committed,
  dragging,
  fromLabel,
  toLabel,
  onClear,
}: {
  aggregate: WindowAggregate;
  committed: boolean;
  dragging: boolean;
  /** Server-formatted display labels for the aggregate's window edges. */
  fromLabel: string;
  toLabel: string;
  onClear: () => void;
}) {
  const { window: win, nutrition, coverage, energy } = aggregate;
  const scoped = committed || dragging;
  const gate = tdeeGateCopy(aggregate);
  const byWeek = win.days > RAIL_PER_DAY_MAX_DAYS ? " · by week" : "";

  const headline = scoped
    ? `${fromLabel} → ${toLabel} · ${win.days} ${win.days === 1 ? "day" : "days"} · ${nutrition.loggedDays} of ${coverage.totalDays} logged${
        nutrition.avgKcal !== null ? ` · ${fmtKcal(nutrition.avgKcal)} kcal/day` : ""
      }${byWeek}`
    : `${win.days} days · ${nutrition.loggedDays} of ${coverage.totalDays} days logged${byWeek} · drag either way to scope`;

  // ⚑66: no Clear while gated (or mid-drag — there is nothing to clear yet).
  const showClear = committed && !dragging && gate === null;

  return (
    <div data-testid="trends-rail-caption">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--muted)] seam-date-label">{headline}</p>
        {showClear && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 flex h-11 -my-2 items-center rounded-full border border-[var(--border)] px-3 text-xs text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Clear
          </button>
        )}
      </div>
      {/* The maintenance headline or its withheld reason — R12's live line.
          The number is --foreground; a gate sentence stays muted. */}
      <p className="mt-0.5 text-[11px]">
        {energy.observedTdee !== null ? (
          <span className="text-[var(--foreground)]">
            Maintenance {fmtKcal(energy.observedTdee)} kcal/day
          </span>
        ) : gate ? (
          <span className="text-[var(--muted)] seam-date-label">{gate.line1}</span>
        ) : null}
      </p>
    </div>
  );
}
