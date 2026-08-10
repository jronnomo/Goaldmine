"use client";

// MetricWindowChart — the per-metric Program-window series on /progress
// (#292, program-views.md §7.4). Recharts stays a client-only leaf; /progress
// is the one deep surface where axes + tooltip belong.
//
// Shared-metric grammar (UXR-PV-44 + task brief): ONE series — drawn in
// var(--foreground) when the metric is shared (the line belongs to neither
// goal; tinting it either goal's hue would be a lie), var(--accent) when a
// single goal claims it — plus one ReferenceLine PER claiming goal's target,
// in the exact muted-dashed idiom ReadinessChart already ships.
//
// Two-metric overlay defaults to SMALL MULTIPLES (UXR-PV-46): each metric
// renders its own stacked panel sharing the page column — this component is
// one panel and never draws a second axis.

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

export type MetricWindowPoint = { date: string; value: number };
export type MetricTargetLine = { value: number; label: string };

export function MetricWindowChart({
  points,
  units,
  targetLines,
  shared,
  ariaLabel,
  "data-testid": testId,
}: {
  points: MetricWindowPoint[];
  units: string;
  targetLines: MetricTargetLine[];
  /** More than one goal claims this metric — neutral foreground series. */
  shared: boolean;
  ariaLabel: string;
  "data-testid"?: string;
}) {
  // Same guard as ReadinessChart (UXR-GCU-49): Recharts' 1500ms mount
  // animation must respect prefers-reduced-motion.
  const reduce = usePrefersReducedMotion();

  const formatted = points.map((p) => ({
    ...p,
    label: new Date(p.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  // Y domain must keep every target line visible, not just the data.
  const values = [
    ...points.map((p) => p.value),
    ...targetLines.map((t) => t.value),
  ];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = Math.max((maxVal - minVal) * 0.1, 2); // BodyMetricsSection padding pattern
  const domain: [number, number] = [minVal - pad, maxVal + pad];

  return (
    <div className="h-40" role="img" aria-label={ariaLabel} data-testid={testId}>
      <div aria-hidden="true" className="w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={formatted} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={domain}
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => String(Math.round(v * 10) / 10)}
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value) => [`${value} ${units}`, ""]}
            />
            {targetLines.map((t, i) => (
              <ReferenceLine
                key={`${t.label}-${i}`}
                y={t.value}
                stroke="var(--muted)"
                strokeDasharray="4 4"
                label={{
                  value: `${t.value}`,
                  fill: "var(--muted)",
                  fontSize: 11,
                  // Coincident targets (the shared-floor case) alternate ends
                  // so neither label hides the other.
                  position: i % 2 === 0 ? "insideLeft" : "insideRight",
                }}
              />
            ))}
            <Line
              type="monotone"
              dataKey="value"
              stroke={shared ? "var(--foreground)" : "var(--accent)"}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={!reduce}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
