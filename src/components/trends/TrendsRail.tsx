// src/components/trends/TrendsRail.tsx — THE RAIL (R7): the day-by-day data
// availability band under the shared axis, doubling as the committed-window
// readout. Plain divs + one repeating-linear-gradient, following the
// SeamStrip / CeilingRule precedent that fixed marks are divs, not SVG.
// Client-by-inheritance (rendered by TrendsBoard); directive-free.
//
// Two 8px availability lanes (WEIGH-INS, MEALS) over a 5px committed-window
// track. Lane states — TWO, not three (R8): `full` = solid var(--accent);
// `partial` (meals logged, macro columns null — the T5 case) = half-height +
// the -45deg hatch already shipped at CeilingRule, where it already means
// "this zone is excluded from the number". `absent` is a HOLE over a 1px
// border/40 baseline, NOT an encoding — --border is 1.59:1 light / 1.39:1
// dark against --card and fails the 3:1 graphical minimum, which is exactly
// why the coverage sentence is load-bearing rather than redundant.
//
// R9: per-day columns only while px/day ≥ 3 (plot width is pinned at 272 —
// UXR-TRENDS-63 — so that is ≤ 90 visible days); beyond that the rail
// aggregates to WEEKS and the caption says so. The buckets reuse the charts'
// own day grid (the `visible` slice), never a re-derived one.
//
// aria-hidden throughout — the coverage sentence is the accessible
// equivalent (plain DOM text, structurally in sync). The visible band is
// ~24px but sits inside a 44px row: visible height and target height are
// deliberately different (UXR-TRENDS-52).

import type { DailyPoint } from "@/lib/trends-core";

/** Per-day rendering threshold: floor(272px plot / 3px-per-day) = 90 days.
 *  Shared with the caption's "· by week" annotation. */
export const RAIL_PER_DAY_MAX_DAYS = 90;

// The exact hatch gradient shipped at CeilingRule.tsx — vocabulary reuse,
// not invention.
const HATCH =
  "repeating-linear-gradient(-45deg, var(--muted) 0px, var(--muted) 1px, transparent 1px, transparent 4px)";

type CellState = "full" | "partial" | "absent";

function laneCells(
  visible: DailyPoint[],
  stateOf: (p: DailyPoint) => CellState,
): CellState[] {
  if (visible.length <= RAIL_PER_DAY_MAX_DAYS) return visible.map(stateOf);
  // Weekly buckets: a week is `full` when any of its days carries data,
  // `partial` when the best it holds is a partial day. Availability shape at
  // week grain — the caption carries the "by week" disclosure.
  const cells: CellState[] = [];
  for (let i = 0; i < visible.length; i += 7) {
    const bucket = visible.slice(i, i + 7).map(stateOf);
    cells.push(
      bucket.includes("full") ? "full" : bucket.includes("partial") ? "partial" : "absent",
    );
  }
  return cells;
}

function Lane({
  cells,
  testId,
}: {
  cells: CellState[];
  testId: string;
}) {
  return (
    <div className="relative h-2" data-testid={testId}>
      {/* absent = a hole over this 1px baseline (R8 — not an encoding) */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/40" />
      <div className="absolute inset-0 flex">
        {cells.map((state, i) =>
          state === "full" ? (
            <div key={i} className="flex-1 bg-[var(--accent)]" />
          ) : state === "partial" ? (
            <div key={i} className="flex-1 flex flex-col justify-end">
              {/* Half-height + hatch — at 90d this degrades to a solid fleck
                  (one ~3px column vs a ~5px gradient period); the conditional
                  coverage line carries the count (UXR-TRENDS-14). */}
              <div className="h-1" style={{ backgroundImage: HATCH, backgroundColor: "color-mix(in srgb, var(--muted) 25%, transparent)" }} />
            </div>
          ) : (
            <div key={i} className="flex-1" />
          ),
        )}
      </div>
    </div>
  );
}

export function TrendsRail({
  visible,
  committed,
}: {
  visible: DailyPoint[];
  committed: boolean;
}) {
  const weighCells = laneCells(visible, (p) => (p.weight !== null ? "full" : "absent"));
  const mealCells = laneCells(visible, (p) =>
    p.kcal !== null ? "full" : p.mealCount > 0 ? "partial" : "absent",
  );

  return (
    // 44px pointer row; the visible band inside is ~24px.
    <div className="flex min-h-[44px] -my-2 items-center" aria-hidden="true" data-testid="trends-rail">
      <div className="flex w-full">
        {/* Lane labels live in the charts' 40px y-gutter. Short forms overhang
            it by ~0.7px at the 11px muted floor — ⚑64: accepted (sub-pixel at
            1×, invisible at 2×/3×). Dark-mode override per the
            "coal is unforgiving" pattern (seam-date-label). */}
        <div className="w-10 shrink-0 flex flex-col justify-between py-px pr-0.5 text-right">
          <span className="seam-date-label text-[11px] leading-none">WEIGH</span>
          <span className="seam-date-label text-[11px] leading-none">MEALS</span>
        </div>
        {/* Spans exactly plotWidth: the gutter above + the charts' 14px right
            margin below reproduce the plot box by construction. */}
        <div className="flex-1 mr-[14px]">
          <Lane cells={weighCells} testId="trends-rail-lane-weighins" />
          <div className="h-0.5" />
          <Lane cells={mealCells} testId="trends-rail-lane-meals" />
          {/* The committed-window track. R10: the committed window is a DOMAIN
              change, so the visible rail spans exactly the window — the
              segment reads full-width, bounded by the CeilingRule "stile"
              end-caps (--accent-soft has no edge; the window's BOUNDARIES are
              the fact being communicated). */}
          <div className="relative mt-1 h-[5px]" data-testid="trends-rail-track">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border)]/40" />
            {committed && (
              <>
                <div className="absolute inset-0 rounded-sm bg-[var(--accent)]" />
                <div className="absolute -top-0.5 -bottom-0.5 left-0 w-0.5 bg-[var(--foreground)]" />
                <div className="absolute -top-0.5 -bottom-0.5 right-0 w-0.5 bg-[var(--foreground)]" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
