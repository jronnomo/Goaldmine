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
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

type Point = { date: string; score: number };

export function ReadinessChart({
  data,
  targetDate,
  ariaLabel,
  frozen = false,
}: {
  data: Point[];
  targetDate?: string;
  ariaLabel?: string;
  /**
   * #292 / UXR-PV-47: a completed goal's frozen (R9) arc — stroke-only
   * var(--muted), NO fill, NEVER dashed (dashed means provisional in this
   * app; frozen is the most certain data we have). Default false keeps the
   * live rendering byte-identical for every existing consumer.
   */
  frozen?: boolean;
}) {
  // UXR-GCU-49 (goal-celebration-upgrade.md §7.1/§8.3): Recharts' default
  // 1500ms mount animation was live and unguarded on every consumer of this
  // component (/progress, the Story card, and now the Assay's readiness
  // delta) — a real a11y bug independent of the ceremony feature itself.
  const reduce = usePrefersReducedMotion();

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
      ? `Readiness trend chart, ${formatted.length} points${
          targetDate
            ? `, target ${new Date(targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
            : ""
        }`
      : "Readiness trend chart, no data");

  return (
    <div
      className="h-48"
      role="img"
      aria-label={computedLabel}
      // Only stamped on the frozen variant — the live path emits no new
      // attribute, keeping existing consumers' markup byte-identical.
      {...(frozen ? { "data-arc-variant": "frozen" } : {})}
    >
      <div aria-hidden="true" className="w-full h-full">
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
              stroke={frozen ? "var(--muted)" : "var(--accent)"}
              strokeWidth={frozen ? 1 : 2}
              fill={frozen ? "none" : "url(#readinessFill)"}
              {...(frozen ? { fillOpacity: 0 } : {})}
              isAnimationActive={!reduce}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
