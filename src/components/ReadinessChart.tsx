"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; score: number };

export function ReadinessChart({ data, targetDate }: { data: Point[]; targetDate?: string }) {
  const formatted = data.map((p) => ({
    ...p,
    label: new Date(p.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="readinessFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [`${value}/100`, "Readiness"]}
          />
          {targetDate && (
            <ReferenceLine
              x={new Date(targetDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
              stroke="var(--muted)"
              strokeDasharray="4 4"
              label={{ value: "target", fill: "var(--muted)", fontSize: 11 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="score"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#readinessFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
