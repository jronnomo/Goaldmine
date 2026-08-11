// src/components/progress/MetricsLid.tsx
//
// Manifest key 13 — the Program-window metrics as a Tier-3 lid. Digest states
// the MEASURED count, never the row count ("5 of 14 measured", never
// "14 metrics") — the same honesty rule as "a 0 that means unmeasured must
// never render as a 0."
//
// R21: NO Recharts inside a lid (ResponsiveContainer in a closed <details>
// measures 0×0) — the body is claim rows only, text + the shipped cliff
// status readout for maintenance claims. Charts for these metrics live on
// their own goal pages.
//
// Self-nulls on zero rows (stadium node). Server component.

import { CollapsibleCard } from "@/components/CollapsibleCard";
import type { MetricClaim, ProgramMetricRow } from "@/lib/progress-program";

const fmtVal = (v: number | null): string =>
  v === null ? "—" : Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));

export function MetricsLid({ metrics }: { metrics: ProgramMetricRow[] }) {
  if (metrics.length === 0) return null;
  const measured = metrics.filter((m) => m.claims.some((c) => c.current !== null)).length;
  return (
    <CollapsibleCard
      title="Program metrics"
      variant="lid"
      defaultOpen={false}
      digest={`${measured} of ${metrics.length} measured`}
      data-testid="metrics-lid"
      className="scroll-mt-16"
    >
      <div className="divide-y divide-[var(--border)]">
        {metrics.map((row) => (
          <div key={row.metricKey} className="py-2" data-testid={`metrics-lid-row-${row.metricKey}`}>
            <div className="flex items-baseline gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</p>
              {row.claims.length > 1 && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  shared by {row.claims.length} goals
                </span>
              )}
            </div>
            {row.claims.map((c) => (
              <ClaimLine key={c.goalId} claim={c} units={row.units} />
            ))}
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}

function ClaimLine({ claim, units }: { claim: MetricClaim; units: string }) {
  if (claim.maintenance) {
    const holding =
      claim.current !== null &&
      (claim.direction === "decrease" ? claim.current <= claim.target : claim.current >= claim.target);
    return (
      <p className="mt-0.5 text-xs tabular-nums">
        <span className="truncate">{claim.objective}</span>{" "}
        {claim.current === null ? (
          <span className="text-[var(--muted)]">not tested</span>
        ) : (
          <span
            className={`font-semibold uppercase tracking-wide ${holding ? "text-[var(--success)]" : "text-[var(--warning)]"}`}
          >
            {holding ? `holding ${fmtVal(claim.current)}` : `below floor · ${fmtVal(claim.current)}`}
          </span>
        )}
      </p>
    );
  }
  return (
    <p className="mt-0.5 text-xs text-[var(--muted)] tabular-nums">
      {claim.objective}: {fmtVal(claim.start)} → {fmtVal(claim.current)} / {fmtVal(claim.target)}{" "}
      {units}
      {claim.gating && <span> · gate</span>}
    </p>
  );
}
