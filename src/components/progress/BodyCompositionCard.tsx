// src/components/progress/BodyCompositionCard.tsx
//
// Manifest key 12 (G3) — the page's ONLY Recharts mount, always-open, owned
// by the primary goal's weightLb/bodyFatPct target (R21: Recharts capped at
// 2, never inside a lid; on this manifest it lands on one — zero on day 1,
// when it degrades to a Tier-2 strip at zero readings).
//
// A2 fixed by construction (UXR-PROG-80): the series is the BOUNDED-DESC
// measurement scan reversed (never take:180 asc), and Start is the TRUE
// first-ever reading from its own findFirst — so Current is current and the
// Δ is honest for the first time.
//
// A10 fixed (UXR-PROG-81): tick labels are formatted on the SERVER in
// USER_TZ and passed through WeightChart's label escape hatch — no
// toLocaleDateString(undefined,…) divergence between SSR and hydration.
//
// UXR-PV-26 (UXR-PROG-78): the body-fat honesty caption — logged but not
// scored counts as 0 at its weight.
//
// Server component (WeightChart is the client leaf).

import { Card } from "@/components/Card";
import { StatTile } from "@/components/StatTile";
import { WeightChart } from "@/components/WeightChart";
import { USER_TZ } from "@/lib/calendar-core";

export type BodyCompositionModel = {
  /** Chart points asc — server-formatted labels included. */
  weights: { date: string; weight: number; label: string }[];
  current: { value: number; date: Date } | null;
  /** TRUE first-ever reading (its own findFirst asc). */
  start: { value: number; date: Date } | null;
  /** Owning goal's weightLb target — rendered as an off-scale footer marker. */
  weightTarget: { value: number; direction?: "decrease" | "increase" } | null;
  bodyFat: {
    latest: { value: number; date: Date } | null;
    /** True when a bodyFatPct target exists but scores null (start unset). */
    loggedNotScored: boolean;
    targetWeightPct: number | null;
  } | null;
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

export function BodyCompositionCard({ model }: { model: BodyCompositionModel }) {
  const { weights, current, start, bodyFat, weightTarget } = model;

  if (weights.length === 0) {
    // Degrades to a Tier-2 strip at zero readings (manifest note) — no
    // Recharts mounts on day 1.
    return (
      <section
        id="body"
        data-testid="body-composition"
        className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm scroll-mt-16"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Body composition
        </span>
        <p className="mt-1 text-sm text-[var(--muted)]">
          No reading yet — log a weigh-in and this fills in.
        </p>
      </section>
    );
  }

  const delta = current && start ? current.value - start.value : null;
  const ariaLabel =
    current && delta !== null
      ? `Weight trend, latest ${current.value} lb, ${delta < 0 ? "down" : delta > 0 ? "up" : "unchanged"} ${Math.abs(delta).toFixed(1)} from start`
      : "Weight trend";

  return (
    <Card id="body" data-testid="body-composition" title="Body composition" className="scroll-mt-16">
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <StatTile label="Current" value={current ? `${fmt(current.value)} lb` : "—"} />
        <StatTile label="Start" value={start ? `${fmt(start.value)} lb` : "—"} />
        <StatTile
          label="Δ"
          value={delta !== null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} lb` : "—"}
        />
      </div>
      <WeightChart data={weights} ariaLabel={ariaLabel} target={weightTarget} />
      {bodyFat && bodyFat.latest && (
        <p className="mt-2 text-xs text-[var(--muted)]" data-testid="bodyfat-line">
          Body fat {fmt(bodyFat.latest.value)}% · {dateFmt.format(bodyFat.latest.date)}
          {bodyFat.loggedNotScored && bodyFat.targetWeightPct !== null && (
            <span data-testid="bodyfat-not-scored">
              {" "}
              — logged but not scored yet; it counts as 0 at weight {bodyFat.targetWeightPct}.
            </span>
          )}
        </p>
      )}
    </Card>
  );
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));
}
