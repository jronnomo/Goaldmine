// src/components/trends/TrendsBoard.tsx — THE client island for /trends
// (REQ-010; blueprint §5 — exactly ONE "use client" directive across
// src/app/trends + src/components/trends lives HERE).
//
// Owns: range/window/macro-mode state (primitives only — React Compiler
// discipline, per WeightChart's comment), the C2 lazy-anchor drag handlers,
// and URL sync via window.history.replaceState (DC1 — never the Next router's
// replace/refresh hooks: a router-level replace here would refetch the whole
// RSC payload on every drag commit, violating the zero-round-trip criterion).
// Semantics (DC7): reload restores the window, the link is shareable, and
// BACK LEAVES THE PAGE — window changes deliberately create no history
// entries. That is by design, not a bug.
//
// R12: the rail caption reads a LIVE aggregate that re-evaluates during the
// drag (pure, client-side, zero queries) — a user dragging a 4-day window
// watches the gate close while their finger is still down. The panel reads
// only the COMMITTED aggregate, so it never re-computes mid-gesture; both
// read the same aggregateWindow path, so they cannot disagree.

"use client";

import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { TrendChartStack } from "@/components/trends/TrendChartStack";
import { TrendsRail } from "@/components/trends/TrendsRail";
import { TrendsRailCaption } from "@/components/trends/TrendsRailCaption";
import { WindowFallbackForm } from "@/components/trends/WindowFallbackForm";
import { WindowPanel } from "@/components/trends/WindowPanel";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import {
  DAY_MS,
  aggregateWindow,
  buildKcalTrend,
  sliceWindow,
  trailingMeanSeries,
  type DailyPoint,
  type MacroTargets,
  type WindowBounds,
} from "@/lib/trends-core";
import { buildWeightSeries, pickTicks, type ResolvedPoint } from "@/lib/weight-chart-core";

type RangeKey = "30d" | "90d" | "all";

const RANGES: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
];

/** Drag slop in px — px-first, not day-first (UXR-TRENDS-23): 2 days is only
 *  ~6px at 90d, so the pixel test dominates at every range. */
const DRAG_SLOP_PX = 10;
/** Vertical drift beyond this (with a sub-2-day horizontal span) cancels the
 *  drag — a mostly-vertical touch drift must not become a tap-clear. */
const VERTICAL_DRIFT_PX = 30;

export type TrendsBoardProps = {
  points: DailyPoint[];
  targets: MacroTargets | null;
  rangeKey: RangeKey;
  initialWindow: { fromT: number; toT: number } | null;
  /** Server-computed requested-window starts for the fixed chips (see
   *  TrendsPageData.rangeStarts) — a chip's honest window is the last N
   *  calendar days ending today even when history is shorter, and the client
   *  does no Date/TZ math of its own. */
  rangeStarts: Record<"30d" | "90d", { t: number; key: string; label: string }>;
};

export function TrendsBoard({
  points,
  targets,
  rangeKey: initialRangeKey,
  initialWindow,
  rangeStarts,
}: TrendsBoardProps) {
  const reduce = usePrefersReducedMotion();

  // ── state: primitives only ─────────────────────────────────────────────────
  const [rangeKey, setRangeKey] = useState<RangeKey>(initialRangeKey);
  const [winFromT, setWinFromT] = useState<number | null>(initialWindow?.fromT ?? null);
  const [winToT, setWinToT] = useState<number | null>(initialWindow?.toT ?? null);
  const [dragAnchorT, setDragAnchorT] = useState<number | null>(null);
  const [dragCurrentT, setDragCurrentT] = useState<number | null>(null);
  const [macroMode, setMacroMode] = useState<"g" | "pct">("g");
  const [dip, setDip] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  // refs — no re-render needed
  const dragArmed = useRef(false);
  const dragCancelled = useRef(false);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const dipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── grid lookups (server-computed t's and labels; no client Date math) ─────
  const labelByTime = useMemo(() => new Map(points.map((p) => [p.t, p.label])), [points]);
  const keyByTime = useMemo(() => new Map(points.map((p) => [p.t, p.dateKey])), [points]);
  const timeByKey = useMemo(() => new Map(points.map((p) => [p.dateKey, p.t])), [points]);
  // Grid labels PLUS the range starts' — a chip window can start before the
  // first data day, where no grid point (hence no grid label) exists.
  const labelByKey = useMemo(() => {
    const m = new Map(points.map((p) => [p.dateKey, p.label]));
    for (const rs of Object.values(rangeStarts)) if (!m.has(rs.key)) m.set(rs.key, rs.label);
    return m;
  }, [points, rangeStarts]);
  const labelOfKey = (k: string | null): string => (k ? (labelByKey.get(k) ?? k) : "");

  /** Snap an arbitrary t (e.g. a gap-break midpoint row on the weight chart)
   *  to the nearest grid day. Index arithmetic over USER_TZ midnights — a DST
   *  ±1h offset cannot move the rounded index. */
  const snapToGrid = (t: number): number => {
    if (points.length === 0) return t;
    const idx = Math.min(
      points.length - 1,
      Math.max(0, Math.round((t - points[0]!.t) / DAY_MS)),
    );
    return points[idx]!.t;
  };

  // ── outer range → visible slice ────────────────────────────────────────────
  // The grid is one point per calendar day, so "last N days" is index math —
  // DST-safe, no Date construction.
  const outerStart = (key: RangeKey): number => {
    const days = RANGES.find((r) => r.key === key)!.days;
    if (days === null || points.length <= days) return points[0]!.t;
    return points[points.length - days]!.t;
  };

  const committed = winFromT !== null && winToT !== null;

  const visible = useMemo(() => {
    if (winFromT !== null && winToT !== null) return sliceWindow(points, winFromT, winToT);
    const days = RANGES.find((r) => r.key === rangeKey)!.days;
    if (days === null || points.length <= days) return points;
    return points.slice(points.length - days);
  }, [points, rangeKey, winFromT, winToT]);

  const domainFromT = visible[0]?.t ?? 0;
  const domainToT = visible[visible.length - 1]?.t ?? 1;

  // ── trend series: computed over the FULL series, sliced afterwards, so the
  //    leftmost visible day carries a real trailing mean ─────────────────────
  const kcalTrendFull = useMemo(() => buildKcalTrend(points), [points]);
  const proteinTrendFull = useMemo(
    () => trailingMeanSeries(points, (p) => p.proteinG),
    [points],
  );
  const carbsTrendFull = useMemo(() => trailingMeanSeries(points, (p) => p.carbsG), [points]);
  const fatTrendFull = useMemo(() => trailingMeanSeries(points, (p) => p.fatG), [points]);

  // visible is always a contiguous slice of the grid, so index math suffices.
  const startIdx = useMemo(() => {
    if (visible.length === 0 || points.length === 0) return 0;
    return Math.round((visible[0]!.t - points[0]!.t) / DAY_MS);
  }, [visible, points]);

  const kcalTrend = useMemo(
    () => kcalTrendFull.slice(startIdx, startIdx + visible.length),
    [kcalTrendFull, startIdx, visible.length],
  );
  const proteinTrend = useMemo(
    () => proteinTrendFull.slice(startIdx, startIdx + visible.length),
    [proteinTrendFull, startIdx, visible.length],
  );
  const carbsTrend = useMemo(
    () => carbsTrendFull.slice(startIdx, startIdx + visible.length),
    [carbsTrendFull, startIdx, visible.length],
  );
  const fatTrend = useMemo(
    () => fatTrendFull.slice(startIdx, startIdx + visible.length),
    [fatTrendFull, startIdx, visible.length],
  );

  // ── weight series (DC4: reuse weight-chart-core's MATH, not a WeightChart
  //    transplant) — DailyPoint → ResolvedPoint mapped DIRECTLY (never via
  //    resolvePoints, which re-parses dateKeys as UTC midnight and would shift
  //    this chart's t-basis ~7h off the other two, misaligning the brush) ────
  const weightFull = useMemo<ResolvedPoint[]>(
    () =>
      points
        .filter((p) => p.weight !== null)
        .map((p) => ({ t: p.t, weight: p.weight!, label: p.label })),
    [points],
  );
  // Trend computed over the FULL series (the core's own full-then-slice
  // doctrine), so /trends agrees with /progress on overlapping dates.
  const fullSeries = useMemo(() => buildWeightSeries(weightFull, null), [weightFull]);
  const weightRows = useMemo(
    () => fullSeries.rows.filter((r) => r.t >= domainFromT && r.t <= domainToT),
    [fullSeries, domainFromT, domainToT],
  );
  // y-domain recomputed over the WINDOWED readings with the core's exact
  // formula ([floor(min)−1, ceil(max)+1]) — windowDays can't express [from,to].
  const weightDomain = useMemo<[number, number]>(() => {
    const vals = weightFull
      .filter((p) => p.t >= domainFromT && p.t <= domainToT)
      .map((p) => p.weight);
    if (vals.length === 0) return [0, 1];
    return [Math.floor(Math.min(...vals)) - 1, Math.ceil(Math.max(...vals)) + 1];
  }, [weightFull, domainFromT, domainToT]);

  // Shared ticks — computed ONCE over the visible grid days (R2).
  const ticks = useMemo(
    () =>
      pickTicks(
        visible.map((p) => ({ t: p.t, weight: 0, label: p.label })),
        4,
      ),
    [visible],
  );

  // ── aggregates: ONE arithmetic path (aggregateWindow) for panel + caption ──
  // The bounds are the REQUESTED window, not the slice of points that happens
  // to exist inside it (QA C-2): a committed window is its own request; a
  // fixed chip requests the last N calendar days ending today — even when
  // history is shorter, so a 10-day history on the 30d chip reads "10 of 30"
  // and gates exactly as get_trend_window's identical call would. "All" is the
  // one range whose request IS the data extent. aggregateWindow self-slices,
  // so it takes the full series plus these bounds.
  const windowBounds = useMemo<WindowBounds>(() => {
    const last = points[points.length - 1]!;
    if (winFromT !== null && winToT !== null) {
      // Committed windows are grid-snapped by construction — both keys exist.
      return {
        fromT: winFromT,
        toT: winToT,
        fromKey: keyByTime.get(winFromT)!,
        toKey: keyByTime.get(winToT)!,
      };
    }
    const days = RANGES.find((r) => r.key === rangeKey)!.days;
    if (days === null) {
      return { fromT: points[0]!.t, toT: last.t, fromKey: points[0]!.dateKey, toKey: last.dateKey };
    }
    // rangeStarts' t is parseDateKey-built exactly like the grid's, so when
    // the start day exists in the grid the two are identical values.
    const rs = rangeStarts[rangeKey as "30d" | "90d"];
    return { fromT: rs.t, toT: last.t, fromKey: rs.key, toKey: last.dateKey };
  }, [points, rangeKey, winFromT, winToT, keyByTime, rangeStarts]);

  const aggregate = useMemo(
    () => aggregateWindow(points, windowBounds, { targets }),
    [points, windowBounds, targets],
  );

  const dragging = dragAnchorT !== null && dragCurrentT !== null;
  // R12: the caption's live aggregate — re-evaluated during the drag. Pure and
  // client-side; zero queries, zero fetches. Drag bounds are grid-snapped, so
  // their dateKeys always exist.
  const liveAggregate = useMemo(() => {
    if (dragAnchorT === null || dragCurrentT === null) return aggregate;
    const a = snapToGrid(Math.min(dragAnchorT, dragCurrentT));
    const b = snapToGrid(Math.max(dragAnchorT, dragCurrentT));
    return aggregateWindow(
      points,
      { fromT: a, toT: b, fromKey: keyByTime.get(a)!, toKey: keyByTime.get(b)! },
      { targets },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregate, dragAnchorT, dragCurrentT, points, targets]);

  const anyHealthData = useMemo(
    () => points.some((p) => p.activeKcal !== null || p.basalKcal !== null || p.steps !== null),
    [points],
  );

  // ── URL sync — history.replaceState ONLY (DC1/DC7) ─────────────────────────
  const syncUrl = (key: RangeKey, fromT: number | null, toT: number | null) => {
    const qs = new URLSearchParams({ range: key });
    if (fromT !== null && toT !== null) {
      const fromKey = keyByTime.get(fromT);
      const toKey = keyByTime.get(toT);
      if (fromKey && toKey) {
        qs.set("from", fromKey);
        qs.set("to", toKey);
      }
    }
    window.history.replaceState(null, "", `/trends?${qs.toString()}`);
  };

  const runDip = () => {
    // UXR-TRENDS-42/43: the domain swap is SYNCHRONOUS (it already happened by
    // the time this runs — state drives it); the opacity dip runs underneath
    // and is suppressed under reduced motion. Never gate the swap on
    // transitionend.
    if (reduce) return;
    if (dipTimer.current) clearTimeout(dipTimer.current);
    setDip(true);
    dipTimer.current = setTimeout(() => setDip(false), 200);
  };

  const resetDrag = () => {
    setDragAnchorT(null);
    setDragCurrentT(null);
    startY.current = null;
    startX.current = null;
  };

  const clearWindow = () => {
    if (winFromT === null && winToT === null) return;
    setWinFromT(null);
    setWinToT(null);
    syncUrl(rangeKey, null, null);
    setLiveMessage(""); // announce on COMMIT only (UXR-TRENDS-24)
    runDip();
  };

  const commitWindow = (aRaw: number, bRaw: number) => {
    const a = snapToGrid(Math.min(aRaw, bRaw));
    const b = snapToGrid(Math.max(aRaw, bRaw));
    if (a >= b) {
      clearWindow();
      return;
    }
    // A window outside the active range escalates the chip to the smallest
    // containing range — pure client arithmetic (blueprint §5).
    let nextRange = rangeKey;
    for (const r of RANGES) {
      if (a >= outerStart(r.key)) {
        nextRange = r.key;
        break;
      }
      nextRange = "all";
    }
    setRangeKey(nextRange);
    setWinFromT(a);
    setWinToT(b);
    syncUrl(nextRange, a, b);
    const days = Math.round((b - a) / DAY_MS) + 1;
    setLiveMessage(
      `Window set: ${labelByTime.get(a) ?? ""} to ${labelByTime.get(b) ?? ""}, ${days} days.`,
    );
    runDip();
  };

  // ── the drag brush — C2-corrected design (blueprint §5, implement exactly).
  // The down handler NEVER reads activeLabel: at touchstart Recharts has not
  // computed it (RechartsWrapper.js:293 — only touchmove dispatches
  // touchEventAction), and any value present is the PREVIOUS gesture's stale
  // label, never cleared at touchend. The anchor initializes LAZILY on the
  // first move carrying a finite activeLabel. ────────────────────────────────
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

  // Recharts CLAMPS activeCoordinate to the plot area (verified by the
  // in-worktree smoke: on a vertical swipe its y froze at the plot's bottom
  // edge, the drift guard never tripped, and the swipe's touchend cleared the
  // committed window as a near-tap). The NATIVE event's touch coordinates are
  // therefore the primary source for the drift guard and the px-slop test;
  // activeCoordinate is only the fallback.
  const eventXY = (e: BrushEvent): { x: number | null; y: number | null } => {
    const touch = e?.touches?.[0] ?? e?.changedTouches?.[0];
    const x = touch?.clientX ?? e?.clientX;
    const y = touch?.clientY ?? e?.clientY;
    return {
      x: typeof x === "number" ? x : null,
      y: typeof y === "number" ? y : null,
    };
  };

  const handleBrushDown = () => {
    dragArmed.current = true;
    dragCancelled.current = false;
    startY.current = null;
    startX.current = null;
    setDragAnchorT(null);
    setDragCurrentT(null);
  };

  const handleBrushMove = (s: BrushState | null, e?: BrushEvent) => {
    if (!dragArmed.current || dragCancelled.current) return;
    const t = Number(s?.activeLabel);
    if (!Number.isFinite(t)) return; // outside plot area / not yet computed
    const xy = eventXY(e ?? null);
    if (dragAnchorT === null) {
      // LAZY anchor init — the first real position of THIS gesture.
      setDragAnchorT(t);
      setDragCurrentT(t);
      startY.current = xy.y ?? s?.activeCoordinate?.y ?? null;
      startX.current = xy.x ?? s?.activeCoordinate?.x ?? null;
      return;
    }
    // Vertical-drift guard: a mostly-vertical touch drift must not become a
    // tap-clear (the user would silently lose their committed window).
    const y = xy.y ?? s?.activeCoordinate?.y;
    if (
      startY.current != null &&
      y != null &&
      Math.abs(y - startY.current) > VERTICAL_DRIFT_PX &&
      Math.abs(t - dragAnchorT) < 2 * DAY_MS
    ) {
      dragCancelled.current = true;
      return;
    }
    setDragCurrentT(t);
  };

  const handleBrushUp = (s?: BrushState | null, e?: BrushEvent) => {
    const armed = dragArmed.current;
    dragArmed.current = false;
    if (!armed || dragCancelled.current) {
      resetDrag();
      return;
    }
    if (dragAnchorT === null) {
      // Pure tap — no move ever fired. Tap clears (PRD edge table).
      resetDrag();
      clearWindow();
      return;
    }
    const a = Math.min(dragAnchorT, dragCurrentT ?? dragAnchorT);
    const b = Math.max(dragAnchorT, dragCurrentT ?? dragAnchorT);
    // Px-first near-tap test (UXR-TRENDS-23): 2 days is ~6px at 90d — below
    // any sane slop — so the pixel span decides, with the day span as backstop.
    const x = eventXY(e ?? null).x ?? s?.activeCoordinate?.x;
    const dxPx = startX.current != null && x != null ? Math.abs(x - startX.current) : null;
    resetDrag();
    if ((dxPx !== null && dxPx < DRAG_SLOP_PX) || b - a < 2 * DAY_MS) clearWindow();
    else commitWindow(a, b);
  };

  const handleBrushLeave = () => {
    // mouseleave only — commits ONLY mid-drag (DC8: desktop drags die at
    // chart boundaries; documented behavior, not a bug. Touch is immune —
    // touch events stay bound to the start element).
    if (!dragArmed.current) return;
    if (dragAnchorT !== null && !dragCancelled.current) {
      handleBrushUp();
    } else {
      dragArmed.current = false;
      resetDrag(); // wandered out before any move — no clear
    }
  };

  // ── chips ──────────────────────────────────────────────────────────────────
  const ranges = RANGES.filter((r) => r.days === null || points.length > r.days + 5);
  const showChips = ranges.length > 1;

  const onChipTap = (key: RangeKey) => {
    setRangeKey(key);
    // Clear any window outside the new range (blueprint §5); a window inside
    // it is kept — the chip preps the range Clear returns to.
    if (winFromT !== null && winFromT < outerStart(key)) {
      setWinFromT(null);
      setWinToT(null);
      syncUrl(key, null, null);
    } else {
      syncUrl(key, winFromT, winToT);
    }
    runDip();
  };

  // ── fallback-form plumbing (dateKey string/index math only) ───────────────
  const minKey = points[0]!.dateKey;
  const maxKey = points[points.length - 1]!.dateKey;
  const presetFromKeys = {
    last7: points[Math.max(0, points.length - 7)]!.dateKey,
    last14: points[Math.max(0, points.length - 14)]!.dateKey,
    // thisMonthStart = lastKey.slice(0,7) + "-01", clamped to the grid.
    month: maxKey.slice(0, 7) + "-01" < minKey ? minKey : maxKey.slice(0, 7) + "-01",
  };

  const onFormCommit = (fromKey: string, toKey: string) => {
    // Clamp out-of-grid values to the grid edges (ISO keys compare
    // lexicographically), discard an empty result.
    let f = fromKey < minKey ? minKey : fromKey > maxKey ? maxKey : fromKey;
    let t = toKey < minKey ? minKey : toKey > maxKey ? maxKey : toKey;
    if (f > t) [f, t] = [t, f];
    const fromT = timeByKey.get(f);
    const toT = timeByKey.get(t);
    if (fromT === undefined || toT === undefined) return;
    commitWindow(fromT, toT);
  };

  const dragDays =
    dragAnchorT !== null && dragCurrentT !== null
      ? Math.round(Math.abs(dragCurrentT - dragAnchorT) / DAY_MS) + 1
      : null;

  const dipStyle = {
    opacity: dip ? 0.65 : 1,
    transition: reduce ? "none" : "opacity 190ms ease-out",
  };

  return (
    <div className="space-y-4">
      {showChips && (
        <div className="flex items-center gap-2" data-testid="trends-range-chips">
          {ranges.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onChipTap(r.key)}
              aria-pressed={r.key === rangeKey}
              className={`flex h-11 items-center rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                r.key === rangeKey
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--card)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* One Card, three panels, one axis (R1) — the rail and its caption live
          inside it, under the axis they index. */}
      <Card data-testid="trends-chart-card">
        <div style={dipStyle}>
          <TrendChartStack
            visible={visible}
            kcalTrend={kcalTrend}
            proteinTrend={proteinTrend}
            carbsTrend={carbsTrend}
            fatTrend={fatTrend}
            weightRows={weightRows}
            weightDomain={weightDomain}
            domainFromT={domainFromT}
            domainToT={domainToT}
            ticks={ticks}
            labelByTime={labelByTime}
            macroMode={macroMode}
            onMacroModeChange={setMacroMode}
            targetKcal={targets?.calories ?? null}
            dragFromT={dragging ? Math.min(dragAnchorT!, dragCurrentT!) : null}
            dragToT={dragging ? Math.max(dragAnchorT!, dragCurrentT!) : null}
            dragDays={dragDays}
            onBrushDown={handleBrushDown}
            onBrushMove={handleBrushMove}
            onBrushUp={handleBrushUp}
            onBrushLeave={handleBrushLeave}
            reduceMotion={reduce}
          />
          <TrendsRail visible={visible} committed={committed} />
          <TrendsRailCaption
            aggregate={liveAggregate}
            committed={committed}
            dragging={dragging}
            fromLabel={labelOfKey(liveAggregate.window.from)}
            toLabel={labelOfKey(liveAggregate.window.to)}
            onClear={clearWindow}
          />
        </div>
      </Card>

      <WindowFallbackForm
        rangeKey={rangeKey}
        fromKey={winFromT !== null ? (keyByTime.get(winFromT) ?? null) : null}
        toKey={winToT !== null ? (keyByTime.get(winToT) ?? null) : null}
        minKey={minKey}
        maxKey={maxKey}
        presetFromKeys={presetFromKeys}
        committed={committed}
        onCommit={onFormCommit}
        onClear={clearWindow}
      />

      <div
        style={{
          opacity: dip ? 0.75 : 1,
          transition: reduce ? "none" : "opacity 150ms ease-out",
        }}
      >
        <WindowPanel
          aggregate={aggregate}
          committed={committed}
          anyHealthData={anyHealthData}
          fromLabel={labelOfKey(aggregate.window.from)}
          toLabel={labelOfKey(aggregate.window.to)}
        />
      </div>

      {/* Announces the committed window on COMMIT only, never mid-drag
          (UXR-TRENDS-24; precedent CalendarMonth.tsx). */}
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
    </div>
  );
}
