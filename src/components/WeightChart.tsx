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

type Point = { date: string; weight: number };

export function WeightChart({ data, ariaLabel }: { data: Point[]; ariaLabel?: string }) {
  const formatted = data.map((p) => ({
    ...p,
    label: new Date(p.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  const computedLabel =
    ariaLabel ??
    (formatted.length > 0
      ? `Weight trend chart, ${formatted.length} ${formatted.length === 1 ? "entry" : "entries"} from ${formatted[0]!.label} to ${formatted.at(-1)!.label}`
      : "Weight trend chart, no data");

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
              domain={["dataMin - 2", "dataMax + 2"]}
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
              formatter={(value) => [`${value} lb`, "Weight"]}
            />
            <Line
              type="monotone"
              dataKey="weight"
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
