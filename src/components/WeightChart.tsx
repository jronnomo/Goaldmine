// WeightChart — the weigh-in log.
//
// Rebuilt from a categorical-axis line-with-a-dot-on-every-point, which had
// three problems at 50 readings on a phone: the dots merged into a bead
// chain that swallowed the line, the y-axis gutter (width 40 with a -16 left
// margin) clipped the leading digit off every tick, and — worst — the x-axis
// was keyed on the DISPLAY LABEL, so a 40-day silence between weigh-ins
// rendered exactly as wide as a 1-day interval.
//
// Now: a real time scale, raw readings demoted to recessive dots, a trailing
// 7-day mean as the hero line (daily weight is mostly water), the line broken
// across quiet stretches, and range chips to zoom in. All of the arithmetic
// lives in the pure, unit-tested `weight-chart-core` — this file is the
// Recharts shell.
//
// Two invariants worth not breaking:
//   - Tick labels come from the SERVER-formatted `label` on each point,
//     reached via a timestamp→label map. Nothing here formats a date on the
//     client: toLocaleDateString(undefined, …) resolves locale/TZ differently
//     at SSR (UTC on Vercel) than at hydration (UXR-PROG-81 / A10).
//   - The mount animation stays behind the reduced-motion guard (A20).

"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import {
  TREND_WINDOW_DAYS,
  buildWeightSeries,
  resolvePoints,
  spanDays,
  type WeightPoint,
} from "@/lib/weight-chart-core";

export type Point = WeightPoint;

type Range = { key: string; label: string; days: number | null };
const RANGES: Range[] = [
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
];

export type WeightTarget = {
  value: number;
  /** "decrease" (default) | "increase" — decides how "to go" reads. */
  direction?: "decrease" | "increase";
};

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function WeightChart({
  data,
  ariaLabel,
  target,
  units = "lb",
}: {
  data: Point[];
  ariaLabel?: string;
  /** Owning goal's weight target. Rendered as an off-scale footer marker —
   *  never a to-scale line, which would squash the real movement (a 143 lb
   *  target under 154–161 lb readings doubles the y-domain). */
  target?: WeightTarget | null;
  units?: string;
}) {
  // Recharts' 1500ms mount animation ran under prefers-reduced-motion.
  // useSyncExternalStore server snapshot is false → hydration-clean.
  const reduce = usePrefersReducedMotion();

  const all = useMemo(() => resolvePoints(data), [data]);

  const span = spanDays(all);
  // Only offer ranges that would actually slice something off.
  const ranges = RANGES.filter((r) => r.days === null || span > r.days + 5);
  const showRanges = ranges.length > 1;
  // Opens on the full history: the Current/Start/Δ tiles beside this chart are
  // computed over all readings, so a cropped default would silently disagree
  // with them. The chips are there to zoom IN.
  const [rangeKey, setRangeKey] = useState("all");
  // Resolved to a PRIMITIVE window length rather than the Range object: the
  // React Compiler bails out of memoizing this component if a useMemo
  // dependency is an object it can't prove is stable.
  const activeKey = ranges.some((r) => r.key === rangeKey) ? rangeKey : "all";
  const activeDays = RANGES.find((r) => r.key === activeKey)?.days ?? null;

  const { rows, visible, domain, ticks } = useMemo(
    () => buildWeightSeries(all, activeDays),
    [all, activeDays],
  );

  const labelByTime = useMemo(
    () => new Map(all.map((p) => [p.t, p.label])),
    [all],
  );

  const last = visible.at(-1) ?? null;
  const lastTrend = rows.filter((r) => r.trend !== null).at(-1) ?? null;

  const first = visible[0] ?? null;
  const delta = first && last ? last.weight - first.weight : null;
  const computedLabel =
    ariaLabel ??
    (last && first
      ? `Weight trend, ${visible.length} ${visible.length === 1 ? "reading" : "readings"} from ${first.label} to ${last.label}. Latest ${fmt(last.weight)} ${units}, ${
          delta === null || delta === 0
            ? "unchanged"
            : `${delta < 0 ? "down" : "up"} ${Math.abs(delta).toFixed(1)} ${units}`
        } over the window.`
      : "Weight trend chart, no data");

  const toGo = target && last ? last.weight - target.value : null;
  const decreasing = (target?.direction ?? "decrease") === "decrease";
  const targetMet = toGo !== null && (decreasing ? toGo <= 0 : toGo >= 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2.5 text-[10px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--muted)] opacity-60"
            />
            readings
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block w-3 h-0.5 rounded-full bg-[var(--accent)]"
            />
            {TREND_WINDOW_DAYS}-day avg
          </span>
        </div>
        <div className="flex items-center gap-1">
          {showRanges &&
            ranges.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangeKey(r.key)}
                aria-pressed={r.key === activeKey}
                /* T3 fix (trends run, ⚑ UXR-TRENDS-55): the old px-2 py-1
                   computed to ≈21px — under the 44px touch minimum — and had
                   no focus ring. h-11 + focus-visible ring, same visual idiom. */
                className={`flex h-11 items-center rounded-full px-3 text-[11px] leading-none border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  r.key === activeKey
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {r.label}
              </button>
            ))}
        </div>
      </div>

      <div className="h-52" role="img" aria-label={computedLabel}>
        <div aria-hidden="true" className="w-full h-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
              {/* Solid hairlines, horizontal only — dashes read as a threshold. */}
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                ticks={ticks}
                tickFormatter={(t: number) => labelByTime.get(t) ?? ""}
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval={0}
              />
              <YAxis
                domain={domain}
                allowDecimals={false}
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={34}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(t) => labelByTime.get(Number(t)) ?? ""}
                formatter={(value, name) => {
                  if (value === null || value === undefined) return [];
                  const v = Number(value);
                  return name === "trend"
                    ? [`${v.toFixed(1)} ${units}`, `${TREND_WINDOW_DAYS}-day avg`]
                    : [`${fmt(v)} ${units}`, "Reading"];
                }}
              />
              {/* Raw readings sit UNDER the trend as recessive dots. They are not
                  connected: with a 40-day gap in the series, a connecting line
                  across it would draw data that does not exist.
                  T4 fix (trends run, ⚑ UXR-TRENDS-56): 0.55 composited to
                  2.33:1 light / 2.48:1 dark — under the 3:1 non-text
                  graphical minimum. 0.70 is the honest floor (≈0.68 L / 0.66 D). */}
              <Line
                dataKey="weight"
                stroke="none"
                dot={{ r: 2, fill: "var(--muted)", fillOpacity: 0.7, stroke: "none" }}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
              />
              {/* The trend is the hero: a trailing 7-day mean over an honest
                  time axis, broken across quiet stretches. */}
              <Line
                dataKey="trend"
                type="monotone"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={!reduce}
              />
              {lastTrend && (
                <ReferenceDot
                  x={lastTrend.t}
                  y={lastTrend.trend as number}
                  r={4}
                  fill="var(--accent)"
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {target && (
        <p className="mt-1.5 text-[11px] text-[var(--muted)]" data-testid="weight-target-marker">
          <svg
            aria-hidden="true"
            viewBox="0 0 8 6"
            className="inline-block w-2 h-1.5 mr-1 align-baseline fill-[var(--accent)]"
          >
            <path d="M0 0h8L4 6z" />
          </svg>
          {fmt(target.value)} {units} target
          {toGo !== null &&
            (targetMet
              ? " · reached"
              : ` · ${Math.abs(toGo).toFixed(1)} ${units} to ${decreasing ? "go" : "gain"}`)}
          <span className="ml-1 opacity-70">(off scale)</span>
        </p>
      )}
    </div>
  );
}
