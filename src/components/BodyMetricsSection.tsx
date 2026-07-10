// Async server component — do NOT add "use client".
// Queries BodyMetric rows and renders one Chart card per tracked key.

import { Card } from "@/components/Card";
import { HistoryChart } from "@/components/HistoryChart";
import type { HistoryPoint } from "@/components/HistoryChart";
import { getDb } from "@/lib/db";
import { BODY_METRICS, resolveBodyMetric } from "@/lib/metrics-registry";

export async function BodyMetricsSection() {
  const db = await getDb();
  const rows = await db.bodyMetric.findMany({
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  if (rows.length === 0) return null;

  // Group by key, preserving insertion-order of first-seen keys
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = grouped.get(row.key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.key, [row]);
    }
  }

  // Sort: registry keys first (BODY_METRICS order), then ad-hoc keys alphabetically
  const registryOrder = new Map(BODY_METRICS.map((m, i) => [m.key, i]));
  const orderedKeys = [...grouped.keys()].sort((a, b) => {
    const ia = registryOrder.get(a) ?? Infinity;
    const ib = registryOrder.get(b) ?? Infinity;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });

  return (
    <>
      {orderedKeys.map((key) => {
        const keyRows = grouped.get(key)!;
        // Latest row by our asc-sort = last element (highest date, then highest createdAt)
        const latestRow = keyRows.at(-1)!;
        const { label, units, normalRange } = resolveBodyMetric(key, latestRow.unit);

        const data: HistoryPoint[] = keyRows.map((r) => ({
          date: r.date.toISOString(),
          value: r.value,
          tooltip: `${r.value} ${units}`.trim(),
        }));

        // Compute explicit padded domain to avoid Recharts collapsing flat/single-point series
        const values = keyRows.map((r) => r.value);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = maxVal - minVal;
        // Pad by 10% of range, minimum 2 units (so single-point series has visible Y space)
        const pad = Math.max(range * 0.1, 2);

        // Expand bounds to cover normalRange so the reference band is always visible
        let lo = minVal - pad;
        let hi = maxVal + pad;
        if (normalRange?.min !== undefined) lo = Math.min(lo, normalRange.min);
        if (normalRange?.max !== undefined) hi = Math.max(hi, normalRange.max);

        let domain: [number, number];
        if (units === "%") {
          // Clamp percentage series to sensible 0–100 range with small breathing room
          domain = [Math.max(0, lo), Math.min(100, hi)];
        } else {
          domain = [lo, hi];
        }

        return (
          <Card key={key} title={label}>
            <HistoryChart data={data} units={units} domain={domain} ariaLabel={`${label} trend chart`} />
            {data.length === 1 && (
              <p className="text-xs text-[var(--muted)] mt-2">
                Trend appears with more readings.
              </p>
            )}
          </Card>
        );
      })}
    </>
  );
}
