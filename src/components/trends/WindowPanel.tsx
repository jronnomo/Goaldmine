// src/components/trends/WindowPanel.tsx — pure presentation of a
// WindowAggregate (REQ-010). Directive-free; formats for display but NEVER
// re-rounds (rounding lives only in aggregateWindow — that is what keeps the
// page byte-identical to get_trend_window).
//
// R13 — maintenance is a LEDGER, not a facing pair: observed is the lead
// numeral with a derivation sentence; Apple is an additional ROW; the gap a
// third row existing only when both do. A pair has a visible hole when one
// side is missing; a ledger just has fewer rows — and with HealthDaily empty
// for every user today, the one-number form is the DEFAULT, not degraded.
// ⚑3 — "From Apple Health", never "Measured": a wearable's active-energy
// figure is a model output; the field name `measuredTdee` stays.
// R14 — never --danger for a negative number: a deficit is not an error.
// Negatives render --foreground with an explicit − (U+2212).
// UXR-TRENDS-54 — no display serif: a window average is a state over a span,
// not a moment. 30px sans + tabular-nums.

import Link from "next/link";
import { Card } from "@/components/Card";
import { StatTile } from "@/components/StatTile";
import { CoverageLine } from "@/components/trends/CoverageLine";
import { tdeeGateCopy } from "@/components/trends/gate-copy";
import type { WindowAggregate } from "@/lib/trends-core";

const MINUS = "−";

function fmtInt(n: number): string {
  return n < 0 ? `${MINUS}${Math.abs(n).toLocaleString("en-US")}` : n.toLocaleString("en-US");
}

function signedInt(n: number): string {
  return n < 0 ? `${MINUS}${Math.abs(n).toLocaleString("en-US")}` : `+${n.toLocaleString("en-US")}`;
}

function signedFixed(n: number, dp: number): string {
  return n < 0 ? `${MINUS}${Math.abs(n).toFixed(dp)}` : `+${n.toFixed(dp)}`;
}

/** The observed↔Apple disagreement copy (UXR-TRENDS-28) — the gap is framed
 *  as the finding, not a contradiction, so the reader investigates instead of
 *  picking the flattering number. */
function gapCopy(gap: number): string {
  if (gap === 0) return "Apple's number and your logging agree over this window.";
  const n = Math.abs(gap).toLocaleString("en-US");
  return gap < 0
    ? `Apple measures ${n} kcal/day below what your logging implies. That usually means intake is logged low, or Apple is under-counting movement it can't see. Neither number is wrong on its own — the gap is the thing to watch.`
    : `Apple measures ${n} kcal/day above what your logging implies. That usually means some eating went unlogged, or Apple is over-counting movement. Neither number is wrong on its own — the gap is the thing to watch.`;
}

export function WindowPanel({
  aggregate,
  committed,
  anyHealthData,
  fromLabel,
  toLabel,
}: {
  aggregate: WindowAggregate;
  committed: boolean;
  /** Whether ANY health rows exist in the full series — drives the /import
   *  affordance, independent of this window's coverage. */
  anyHealthData: boolean;
  fromLabel: string;
  toLabel: string;
}) {
  const { window: win, nutrition, weight, energy, adherence, coverage } = aggregate;
  const gate = tdeeGateCopy(aggregate);

  // A dragged window containing nothing COMMITS and says so — refusing the
  // user's own gesture is worse than showing an honest hole (UXR-TRENDS-49).
  const windowEmpty =
    coverage.nutritionDays === 0 && coverage.weightDays === 0 && coverage.healthDays === 0;

  return (
    <Card data-testid="trends-window-panel">
      <p className="text-sm font-medium">
        {fromLabel} → {toLabel} · {win.days} {win.days === 1 ? "day" : "days"}
      </p>

      {/* Coverage FIRST — above the averages it qualifies (UXR-TRENDS-32). */}
      <div className="mt-1">
        <CoverageLine coverage={coverage} />
      </div>

      {committed && windowEmpty ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          Nothing was logged in this window. Drag a wider one, or clear it to see everything.
        </p>
      ) : (
        <>
          {/* Δ and rate show "—", never 0, below 2 reading days. */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatTile
              label="avg kcal"
              value={nutrition.avgKcal !== null ? fmtInt(nutrition.avgKcal) : "—"}
            />
            <StatTile
              label="Δ lb"
              value={weight.deltaLb !== null ? signedFixed(weight.deltaLb, 1) : "—"}
            />
            <StatTile
              label="lb/wk"
              value={
                weight.ratePerWeekLb !== null ? signedFixed(weight.ratePerWeekLb, 2) : "—"
              }
            />
          </div>

          {(nutrition.avgProteinG !== null ||
            nutrition.avgCarbsG !== null ||
            nutrition.avgFatG !== null) && (
            <div className="mt-3 text-sm">
              <p className="tabular-nums">
                Protein {nutrition.avgProteinG ?? "—"}g · Carbs {nutrition.avgCarbsG ?? "—"}g ·
                Fat {nutrition.avgFatG ?? "—"}g
              </p>
              {nutrition.macroSharePct && (
                <p className="text-xs text-[var(--muted)] tabular-nums">
                  {nutrition.macroSharePct.protein}% / {nutrition.macroSharePct.carbs}% /{" "}
                  {nutrition.macroSharePct.fat}%
                </p>
              )}
              {nutrition.proteinPerLb !== null && (
                <p className="text-xs text-[var(--muted)] tabular-nums">
                  {nutrition.proteinPerLb.toFixed(2)} g protein per lb of bodyweight
                </p>
              )}
            </div>
          )}

          {/* ── MAINTENANCE — the ledger ─────────────────────────────────── */}
          <div className="mt-4" data-testid="trends-maintenance-block">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              Maintenance
            </p>

            {energy.observedTdee !== null ? (
              <div className="mt-1">
                <p className="text-xs text-[var(--muted)]">Observed maintenance</p>
                <p className="text-[30px] leading-tight font-semibold tabular-nums">
                  {fmtInt(energy.observedTdee)} <span className="text-sm font-normal">kcal/day</span>
                </p>
                {nutrition.avgKcal !== null && weight.ratePerWeekLb !== null && (
                  <p className="text-xs text-[var(--muted)]">
                    From your {fmtInt(nutrition.avgKcal)} kcal/day average and{" "}
                    {weight.ratePerWeekLb < 0 ? MINUS : ""}
                    {Math.abs(weight.ratePerWeekLb).toFixed(2)} lb/week over this window.
                  </p>
                )}
              </div>
            ) : gate ? (
              // A withheld number is never "—" and never greyed: the eyebrow
              // stays, the numeral is replaced by two sentences that name the
              // threshold AND the actual value (UXR-TRENDS-30).
              <div className="mt-1" data-testid="trends-maintenance-gated">
                <p className="text-sm">{gate.line1}</p>
                <p className="text-xs text-[var(--muted)]">{gate.line2}</p>
              </div>
            ) : null}

            {energy.measuredTdee !== null && (
              <div className="mt-2 border-t border-[var(--border)] pt-2 space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  {/* ⚑3: neutral sourcing label — never "Measured". */}
                  <span className="text-[var(--muted)]">From Apple Health</span>
                  <span className="tabular-nums">{fmtInt(energy.measuredTdee)} kcal/day</span>
                </div>
                {energy.gap !== null && (
                  <>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-[var(--muted)]">Gap</span>
                      {/* gap = measured − observed (⚑4 — pinned by Stream C's
                          fixture; every sentence of the copy depends on it). */}
                      <span className="tabular-nums">{fmtInt(energy.gap)} kcal/day</span>
                    </div>
                    <p className="text-xs text-[var(--muted)]">{gapCopy(energy.gap)}</p>
                  </>
                )}
              </div>
            )}

            {energy.balancePerDay !== null && (
              <div className="mt-2 space-y-0.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-[var(--muted)]">Balance</span>
                  <span className="tabular-nums">{fmtInt(energy.balancePerDay)} kcal/day</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {energy.balancePerDay === 0
                    ? "You ate at maintenance."
                    : `You ate ${Math.abs(energy.balancePerDay).toLocaleString("en-US")} kcal/day ${
                        energy.balancePerDay < 0 ? "under" : "over"
                      } maintenance.`}
                </p>
              </div>
            )}

            {!anyHealthData && (
              // The block is COMPLETE without Apple data — no gap row, no
              // empty column, no placeholder (UXR-TRENDS-29). One muted line
              // closes the loop to the companion feature.
              <p className="mt-2 text-xs text-[var(--muted)]">
                <Link
                  href="/import"
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
                >
                  Import Apple Health to see measured burn →
                </Link>
              </p>
            )}
          </div>

          {/* ── Adherence — ships relabeled (late ruling): the target is
              TODAY'S plan target applied across the window, and the copy says
              so honestly. A per-date historical target is a cross-tenant read
              (PlanDayOverride is unscoped) and is deliberately not attempted.
              null targets (the common case) ⇒ the block self-nulls. ───────── */}
          {adherence !== null && (
            <div className="mt-4">
              <p className="text-sm font-medium tabular-nums">
                vs current plan target ({fmtInt(adherence.targetKcal)} kcal)
              </p>
              <p className="text-xs text-[var(--muted)]">
                Compared against today&apos;s plan target — not each day&apos;s plan at the
                time.
              </p>
              <p className="mt-1 text-sm tabular-nums">
                {signedInt(adherence.deltaKcal)} kcal · {signedInt(adherence.deltaProteinG)}g
                protein · {signedInt(adherence.deltaCarbsG)}g carbs ·{" "}
                {signedInt(adherence.deltaFatG)}g fat
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
