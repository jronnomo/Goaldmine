// src/components/progress/BodyMetricsLid.tsx
//
// Manifest key 14 — BodyMetric rows as a Tier-3 lid. Replaces the unbounded
// BodyMetricsSection (A5: one full Card + 192px Recharts per distinct key,
// ungated, wedged mid-page).
//
// UXR-PROG-53 (R21): a closed <details> measures Recharts at 0×0 — the lid
// body degrades to SeamLine + a text delta per key, NEVER HistoryChart.
// UXR-PROG-97: rows arrive BOUNDED (take + windowed) from the assembler.
//
// Self-nulls on zero rows. Server component.

import { CollapsibleCard } from "@/components/CollapsibleCard";
import { SeamLine } from "@/components/SeamLine";
import { USER_TZ } from "@/lib/calendar-core";

export type BodyMetricLidRow = {
  key: string;
  label: string;
  units: string;
  /** Values asc by date (bounded window). */
  values: number[];
  latest: { value: number; date: Date };
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1))));

export function BodyMetricsLid({ rows }: { rows: BodyMetricLidRow[] }) {
  if (rows.length === 0) return null;
  const latestOverall = rows.reduce<Date | null>(
    (acc, r) => (acc === null || r.latest.date > acc ? r.latest.date : acc),
    null,
  );
  return (
    <CollapsibleCard
      title="Body metrics"
      variant="lid"
      defaultOpen={false}
      digest={`${rows.length} tracked${latestOverall ? ` · latest ${dateFmt.format(latestOverall)}` : ""}`}
      data-testid="body-metrics-lid"
      className="scroll-mt-16"
    >
      <div className="divide-y divide-[var(--border)]">
        {rows.map((r) => {
          const first = r.values[0];
          const delta = first !== undefined ? r.latest.value - first : null;
          return (
            <div key={r.key} className="flex items-center gap-2 py-2" data-testid={`body-metric-row-${r.key}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.label}</p>
                <p className="text-xs text-[var(--muted)] tabular-nums">
                  {fmt(r.latest.value)} {r.units} · {dateFmt.format(r.latest.date)}
                  {delta !== null && r.values.length >= 2 && (
                    <span>
                      {" "}· {delta > 0 ? "+" : ""}
                      {fmt(delta)} over {r.values.length} readings
                    </span>
                  )}
                </p>
              </div>
              {r.values.length >= 2 && (
                <SeamLine
                  points={r.values}
                  ariaLabel={`${r.label} trend, ${r.values.length} readings, latest ${fmt(r.latest.value)} ${r.units}`}
                  data-testid={`body-metric-seamline-${r.key}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}
