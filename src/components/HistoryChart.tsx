"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type HistoryPoint = { date: string; value: number; tooltip?: string; label?: string };

export function HistoryChart({
  data,
  units,
  domain = ["dataMin", "dataMax"],
  ariaLabel,
}: {
  data: HistoryPoint[];
  units: string;
  domain?: [number | string, number | string];
  ariaLabel?: string;
}) {
  const formatted = data.map((p) => ({
    ...p,
    label: p.label ?? new Date(p.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  const computedLabel =
    ariaLabel ??
    (formatted.length > 0
      ? `History chart, ${formatted.length} ${formatted.length === 1 ? "point" : "points"}${units ? ` (${units})` : ""}`
      : "History chart, no data");

  return (
    <div className="h-48" role="img" aria-label={computedLabel}>
      <div aria-hidden="true" className="w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, _name, item) => {
                const tooltip = (item.payload as { tooltip?: string } | undefined)?.tooltip;
                return [tooltip ?? `${value} ${units}`, ""];
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
