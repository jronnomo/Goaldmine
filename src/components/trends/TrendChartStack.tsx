// src/components/trends/TrendChartStack.tsx — three synced charts + drag brush
// (REQ-010). Client-by-inheritance under TrendsBoard; deliberately
// directive-free so "one island" stays greppable.
//
// R1 — one Card, three panels, one axis: hairline-separated panels, x tick
// labels on the BOTTOM (macros) chart only; the upper two use a hidden XAxis
// (a hidden axis still applies its domain).
// R2 — gutter alignment is ARITHMETIC: identical margin, one fixed
// YAxis width={40} on all three, one explicit numeric domain, one shared
// ticks array, interval={0}. If any of the five differ, the axes do not line
// up and the "one instrument" claim is false.
// R3/R4 (⚑2) — the macro stack is POSITIONALLY encoded: fixed band order
// protein bottom → carbs middle → fat top, never re-sorted; hues are the
// app's shipped P/C/F convention (FoodLibraryManager) — protein --target /
// carbs --success / fat --accent — NOT the blueprint's placeholder
// (--accent↔--warning is 1.01:1, the palette's worst pair). Card-stroke
// separators make the boundaries hard; in-place right-edge P/C/F labels are
// mandatory; a grayscale screenshot must lose nothing.
// R6 — a day with no logged calories renders NO MARK (null ⇒ no bar); the
// rail carries the second absence channel.
// Heights are ⚑1's h-48 / h-32 / h-10 — NOT the blueprint's h-52/h-44/h-40,
// which overrun the 737px fold and push the rail below it.

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  DENSE_DAY_THRESHOLD,
  macroShares,
  type DailyPoint,
} from "@/lib/trends-core";
import type { WeightRow } from "@/lib/weight-chart-core";

type BrushState = {
  activeLabel?: unknown;
  activeCoordinate?: { x: number; y: number };
};

type BrushEvent = {
  clientX?: number;
  clientY?: number;
  touches?: ArrayLike<{ clientX: number; clientY: number }>;
  changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
} | null;

export type TrendChartStackProps = {
  visible: DailyPoint[];
  kcalTrend: Array<number | null>;
  proteinTrend: Array<number | null>;
  carbsTrend: Array<number | null>;
  fatTrend: Array<number | null>;
  weightRows: WeightRow[];
  weightDomain: [number, number];
  domainFromT: number;
  domainToT: number;
  ticks: number[];
  labelByTime: Map<number, string>;
  macroMode: "g" | "pct";
  onMacroModeChange: (m: "g" | "pct") => void;
  targetKcal: number | null;
  dragFromT: number | null;
  dragToT: number | null;
  dragDays: number | null;
  onBrushDown: () => void;
  onBrushMove: (s: BrushState | null, e?: BrushEvent) => void;
  onBrushUp: (s?: BrushState | null, e?: BrushEvent) => void;
  onBrushLeave: () => void;
  reduceMotion: boolean;
};

// Identical on all three charts (R2). margin.right 14 leaves ~8px for the
// mandatory in-place P/C/F labels (UXR-TRENDS-63 — this is what pins plot
// width at 272).
const CHART_MARGIN = { top: 8, right: 14, left: 0, bottom: 0 };
const Y_AXIS_WIDTH = 40;
// pan-y keeps vertical page scroll alive during a horizontal brush;
// pinch-zoom stays permitted (UXR-TRENDS-61 — plain pan-y is a WCAG 1.4.4
// problem on an analysis surface). Must be correct when the finger lands —
// touch-action changes mid-gesture have no effect.
const TOUCH_ACTION = { touchAction: "pan-y pinch-zoom" } as const;

const kcalTickFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

export function TrendChartStack({
  visible,
  kcalTrend,
  proteinTrend,
  carbsTrend,
  fatTrend,
  weightRows,
  weightDomain,
  domainFromT,
  domainToT,
  ticks,
  labelByTime,
  macroMode,
  onMacroModeChange,
  targetKcal,
  dragFromT,
  dragToT,
  dragDays,
  onBrushDown,
  onBrushMove,
  onBrushUp,
  onBrushLeave,
  reduceMotion,
}: TrendChartStackProps) {
  // UXR-TRENDS-44: the mount draw runs once (380ms ease-out — the library
  // default 1500ms "ease" overhangs the 920ms house budget AND is a third,
  // unsanctioned easing); re-scopes must NOT replay the path draw (Recharts
  // re-triggers whenever `data` identity changes), so the flag flips off via
  // the animation's own onAnimationEnd — an event callback, not an effect.
  const [mountedOnce, setMountedOnce] = useState(false);
  const onMountAnimationEnd = () => setMountedOnce(true);
  const animate = !reduceMotion && !mountedOnce;

  const dense = visible.length > DENSE_DAY_THRESHOLD; // DC2 ruling
  const barSize = Math.min(12, Math.max(2, Math.floor(320 / Math.max(1, visible.length))));
  const dragging = dragFromT !== null && dragToT !== null;

  // One merged row set for the calorie + macro charts, aligned index-for-index
  // with the trend slices.
  const rows = useMemo(
    () =>
      visible.map((p, i) => {
        // pct mode maps each day through macroShares, null-safe: a day missing
        // any macro renders NO bands (absence, never a partial invention).
        const shares =
          p.proteinG !== null && p.carbsG !== null && p.fatG !== null
            ? macroShares(p.proteinG, p.carbsG, p.fatG)
            : null;
        return {
          ...p,
          kcalTrend: kcalTrend[i] ?? null,
          proteinTrend: proteinTrend[i] ?? null,
          carbsTrend: carbsTrend[i] ?? null,
          fatTrend: fatTrend[i] ?? null,
          pctProtein: shares ? shares.protein : null,
          pctCarbs: shares ? shares.carbs : null,
          pctFat: shares ? shares.fat : null,
          // Dense-mode pct lines: shares over the trailing means.
          pctProteinTrend: null as number | null,
          pctCarbsTrend: null as number | null,
          pctFatTrend: null as number | null,
        };
      }),
    [visible, kcalTrend, proteinTrend, carbsTrend, fatTrend],
  );

  const denseRows = useMemo(() => {
    if (!dense || macroMode !== "pct") return rows;
    return rows.map((r) => {
      const shares =
        r.proteinTrend !== null && r.carbsTrend !== null && r.fatTrend !== null
          ? macroShares(r.proteinTrend, r.carbsTrend, r.fatTrend)
          : null;
      return {
        ...r,
        pctProteinTrend: shares ? shares.protein : null,
        pctCarbsTrend: shares ? shares.carbs : null,
        pctFatTrend: shares ? shares.fat : null,
      };
    });
  }, [rows, dense, macroMode]);

  const hasWeight = weightRows.some((r) => r.weight !== null);
  const hasKcal = visible.some((p) => p.kcal !== null);
  const hasMacros = visible.some(
    (p) => p.proteinG !== null || p.carbsG !== null || p.fatG !== null,
  );

  const fromLabel = labelByTime.get(domainFromT) ?? "";
  const toLabel = labelByTime.get(domainToT) ?? "";

  const lastWeight = [...weightRows].reverse().find((r) => r.weight !== null);
  const weightLabel = hasWeight
    ? `Weight, ${fromLabel} to ${toLabel}. Latest reading ${lastWeight?.weight ?? ""} lb.`
    : `Weight, ${fromLabel} to ${toLabel}. No weigh-ins in this range.`;

  const loggedKcalDays = visible.filter((p) => p.kcal !== null).length;
  const caloriesLabel = hasKcal
    ? `Calories per day, ${fromLabel} to ${toLabel}. ${loggedKcalDays} logged ${loggedKcalDays === 1 ? "day" : "days"}.`
    : `Calories per day, ${fromLabel} to ${toLabel}. No meals logged in this range.`;
  const macrosLabel = hasMacros
    ? `Macro composition per day (protein, carbs, fat), ${fromLabel} to ${toLabel}, in ${macroMode === "g" ? "grams" : "percent of calories"}.`
    : `Macro composition, ${fromLabel} to ${toLabel}. No macros logged in this range.`;

  // Shared brush wiring — mouse + touch, ONE logic path (C2). v3 signature:
  // state first, event second.
  const brushProps = {
    onMouseDown: onBrushDown,
    onMouseMove: (s: BrushState | null, e: BrushEvent) => onBrushMove(s, e),
    onMouseUp: (s: BrushState | null, e: BrushEvent) => onBrushUp(s, e),
    onMouseLeave: onBrushLeave,
    onTouchStart: onBrushDown,
    onTouchMove: (s: BrushState | null, e: BrushEvent) => onBrushMove(s, e),
    onTouchEnd: (s: BrushState | null, e: BrushEvent) => onBrushUp(s, e),
  };

  // In-progress selection: token fill on EVERY chart (the Recharts default is
  // light-gray hex — off-palette in both themes). The fill composites to ≈1.1:1, so the
  // 2px --accent edge verticals carry 100% of the meaning (UXR-TRENDS-20).
  const selection = (withLabels: boolean) =>
    dragging ? (
      <>
        <ReferenceArea
          x1={dragFromT!}
          x2={dragToT!}
          fill="var(--accent)"
          fillOpacity={0.12}
          stroke="none"
        />
        <ReferenceLine
          x={dragFromT!}
          stroke="var(--accent)"
          strokeWidth={2}
          label={
            withLabels
              ? {
                  value: labelByTime.get(dragFromT!) ?? "",
                  position: "insideTopLeft",
                  fontSize: 11,
                  fill: "var(--foreground)",
                }
              : undefined
          }
        />
        <ReferenceLine
          x={dragToT!}
          stroke="var(--accent)"
          strokeWidth={2}
          label={
            withLabels
              ? {
                  value: labelByTime.get(dragToT!) ?? "",
                  position: "insideTopRight",
                  fontSize: 11,
                  fill: "var(--foreground)",
                }
              : undefined
          }
        />
      </>
    ) : null;

  const hiddenXAxis = (
    <XAxis dataKey="t" type="number" domain={[domainFromT, domainToT]} ticks={ticks} hide />
  );

  const panelHead = (title: string, right: React.ReactNode) => (
    <div className="flex items-center justify-between mb-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </span>
      {right}
    </div>
  );

  const emptyNote = (text: string) => (
    <p className="absolute inset-0 flex items-center justify-center text-xs text-[var(--muted)] pointer-events-none">
      {text}
    </p>
  );

  return (
    <div>
      {/* ── WEIGHT — the hero, h-48 (the shipped HistoryChart height) ──────── */}
      <div data-testid="trends-weight-panel" role="img" aria-label={weightLabel}>
        <div aria-hidden="true">
          {panelHead(
            "Weight",
            // The day-count pill: during a drag the right-rail swaps lb → the
            // live day count — the user is landing on a DURATION.
            <span className="text-[10px] text-[var(--muted)] tabular-nums">
              {dragging && dragDays !== null ? `⌈ ${dragDays} days ⌉` : "lb"}
            </span>,
          )}
          <div className="h-48 relative" style={TOUCH_ACTION}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weightRows} margin={CHART_MARGIN} {...brushProps}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {hiddenXAxis}
                <YAxis
                  domain={weightDomain}
                  allowDecimals={false}
                  stroke="var(--muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={Y_AXIS_WIDTH}
                />
                {/* Raw readings as recessive dots — 0.70 alpha, the honest
                    floor (the shipped 0.55 fails the 3:1 graphical minimum —
                    T4; this surface is compliant from the start). */}
                <Line
                  dataKey="weight"
                  stroke="none"
                  dot={{ r: 2, fill: "var(--muted)", fillOpacity: 0.7, stroke: "none" }}
                  activeDot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
                <Line
                  dataKey="trend"
                  type="monotone"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={animate}
                  animationDuration={380}
                  animationEasing="ease-out"
                  onAnimationEnd={onMountAnimationEnd}
                />
                {selection(true)}
              </ComposedChart>
            </ResponsiveContainer>
            {!hasWeight && emptyNote("No weigh-ins in this range.")}
          </div>
        </div>
      </div>

      {/* ── CALORIES — a strip: a shape and a target line, 2 y-ticks ───────── */}
      <div
        className="border-t border-[var(--border)] mt-1.5 pt-1.5"
        data-testid="trends-calories-panel"
        role="img"
        aria-label={caloriesLabel}
      >
        <div aria-hidden="true">
          {panelHead(
            "Calories",
            <span className="text-[10px] text-[var(--muted)]">kcal</span>,
          )}
          <div className="h-28 relative" style={TOUCH_ACTION}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={CHART_MARGIN} {...brushProps}>
                {hiddenXAxis}
                <YAxis
                  stroke="var(--muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={Y_AXIS_WIDTH}
                  tickCount={2}
                  tickFormatter={kcalTickFmt}
                />
                {/* Dense ranges (>180 visible days) drop the bars — ~4,500 SVG
                    rects re-rendering on every drag move is not shippable on a
                    phone (DC2). The trend line carries the shape. */}
                {!dense && (
                  <Bar
                    dataKey="kcal"
                    fill="var(--accent)"
                    fillOpacity={0.45}
                    isAnimationActive={false}
                    barSize={barSize}
                  />
                )}
                <Line
                  dataKey="kcalTrend"
                  type="monotone"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={animate}
                  animationDuration={380}
                  animationEasing="ease-out"
                  onAnimationEnd={onMountAnimationEnd}
                />
                {/* The plan-target line (G2 graft): dash + horizontality are
                    the discriminator — accent↔target is 1.16:1, hue does zero
                    work here. */}
                {targetKcal !== null && (
                  <ReferenceLine
                    y={targetKcal}
                    stroke="var(--target)"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                )}
                {selection(false)}
              </ComposedChart>
            </ResponsiveContainer>
            {!hasKcal && emptyNote("No meals logged in this range.")}
          </div>
        </div>
      </div>

      {/* ── MACROS — positional ribbon, h-10, no y-axis labels ─────────────── */}
      <div
        className="border-t border-[var(--border)] mt-1.5 pt-1.5"
        data-testid="trends-macros-panel"
        role="img"
        aria-label={macrosLabel}
      >
        <div aria-hidden="true">
          {panelHead(
            "Macros",
            // The g ⇄ % toggle changes the SCALE, never the ENCODING (R5).
            // Radiogroup + roving tabindex (the DayWorkoutEditor idiom), ≥44px.
            <div
              role="radiogroup"
              aria-label="Macro scale"
              className="flex gap-1"
              data-testid="trends-macro-toggle"
            >
              {(["g", "pct"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={macroMode === m}
                  tabIndex={macroMode === m ? 0 : -1}
                  onClick={() => onMacroModeChange(m)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      onMacroModeChange(m === "g" ? "pct" : "g");
                      e.preventDefault();
                    }
                  }}
                  className={`min-h-11 min-w-11 -my-2 rounded-lg px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    macroMode === m
                      ? "border border-[var(--accent)] text-[var(--accent)]"
                      : "border border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {m === "g" ? "g" : "%"}
                </button>
              ))}
            </div>,
          )}
          {/* h-[70px] = the ⚑1 ribbon budget (h-10 / 40px of bands) PLUS the
              30px shared axis this bottom chart alone carries — the axis is
              its own manifest key (3d), not part of the ribbon's 40. */}
          <div className="h-[64px] relative" style={TOUCH_ACTION} data-testid="trends-shared-axis">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={denseRows} margin={CHART_MARGIN} {...brushProps}>
                {/* The SHARED AXIS — rendered once, on the bottom chart only.
                    Same dataKey/type/domain/ticks as the hidden axes above. */}
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[domainFromT, domainToT]}
                  ticks={ticks}
                  tickFormatter={(t: number) => labelByTime.get(t) ?? ""}
                  stroke="var(--muted)"
                  fontSize={11}
                  height={24}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  interval={0}
                />
                <YAxis
                  domain={macroMode === "pct" ? [0, 100] : ["auto", "auto"]}
                  width={Y_AXIS_WIDTH}
                  tick={false}
                  tickLine={false}
                  axisLine={false}
                />
                {!dense && (
                  <>
                    {/* Fixed band order — protein BOTTOM, carbs middle, fat
                        top (render order = stack order). Card-stroke
                        separators harden the 1.05–1.16:1 adjacent pairs. */}
                    <Bar
                      dataKey={macroMode === "g" ? "proteinG" : "pctProtein"}
                      stackId="m"
                      fill="var(--target)"
                      fillOpacity={0.7}
                      stroke="var(--card)"
                      strokeWidth={1}
                      isAnimationActive={false}
                      barSize={barSize}
                    />
                    <Bar
                      dataKey={macroMode === "g" ? "carbsG" : "pctCarbs"}
                      stackId="m"
                      fill="var(--success)"
                      fillOpacity={0.7}
                      stroke="var(--card)"
                      strokeWidth={1}
                      isAnimationActive={false}
                      barSize={barSize}
                    />
                    <Bar
                      dataKey={macroMode === "g" ? "fatG" : "pctFat"}
                      stackId="m"
                      fill="var(--accent)"
                      fillOpacity={0.7}
                      stroke="var(--card)"
                      strokeWidth={1}
                      isAnimationActive={false}
                      barSize={barSize}
                    />
                  </>
                )}
                {dense && (
                  <>
                    <Line
                      dataKey={macroMode === "g" ? "proteinTrend" : "pctProteinTrend"}
                      type="monotone"
                      stroke="var(--target)"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey={macroMode === "g" ? "carbsTrend" : "pctCarbsTrend"}
                      type="monotone"
                      stroke="var(--success)"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey={macroMode === "g" ? "fatTrend" : "pctFatTrend"}
                      type="monotone"
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </>
                )}
                {selection(false)}
              </ComposedChart>
            </ResponsiveContainer>
            {/* In-place right-edge band labels — MANDATORY (R3, the ≤4-series
                direct-labelling rule; no legend). They name the fixed ORDER
                (top fat, middle carbs, bottom protein), which is the identity
                channel; hue is recall only. Lives in the 14px right margin. */}
            <div className="absolute right-0 top-2 bottom-[24px] flex flex-col justify-between items-end pointer-events-none">
              <span className="text-[11px] leading-none text-[var(--accent)]">F</span>
              <span className="text-[11px] leading-none text-[var(--success)]">C</span>
              <span className="text-[11px] leading-none text-[var(--target)]">P</span>
            </div>
            {!hasMacros && emptyNote(hasKcal ? "No macros logged in this range." : "No meals logged in this range.")}
          </div>
          {dense && (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Drag or set dates to zoom in for daily bars.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
