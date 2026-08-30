// weight-chart-core — the properties the old weigh-in chart got wrong.
//
// The previous WeightChart plotted raw readings on a CATEGORICAL x-axis keyed
// on the display label, so: a 40-day silence rendered the same width as a
// 1-day interval, three readings on one date became three columns, and the
// line bridged straight across every gap. These tests pin the replacement.

import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  buildWeightSeries,
  isoLabel,
  pickTicks,
  resolvePoints,
  spanDays,
  trailingMean,
} from "@/lib/weight-chart-core";

const T0 = Date.parse("2026-05-03T12:00:00.000Z");
const at = (dayOffset: number) => new Date(T0 + dayOffset * DAY_MS).toISOString();

/** A daily series with a real 40-day gap — the founder's actual shape. */
function gappySeries() {
  const pts = [
    { date: at(0), weight: 159 },
    { date: at(1), weight: 158 },
    { date: at(2), weight: 157 },
    { date: at(3), weight: 158.6 },
    // 40-day silence
    { date: at(43), weight: 154.6 },
    { date: at(43.2), weight: 154.6 },
  ];
  return resolvePoints(pts);
}

describe("resolvePoints", () => {
  it("sorts ascending and drops unparseable rows", () => {
    const out = resolvePoints([
      { date: at(2), weight: 157 },
      { date: "not-a-date", weight: 999 },
      { date: at(0), weight: 159 },
    ]);
    expect(out.map((p) => p.weight)).toEqual([159, 157]);
  });

  it("prefers the caller's server-formatted label over the fallback", () => {
    const [p] = resolvePoints([{ date: at(0), weight: 159, label: "May 3" }]);
    expect(p!.label).toBe("May 3");
  });
});

describe("isoLabel — hydration safety", () => {
  it("reads the ISO string's own characters, never the runtime timezone", () => {
    // The whole point: no Date construction, so SSR-in-UTC and hydration in
    // America/Denver produce byte-identical text.
    expect(isoLabel("2026-05-03T23:59:59.000Z")).toBe("May 3");
    expect(isoLabel("2026-12-01T00:00:00.000Z")).toBe("Dec 1");
  });

  it("returns the input unchanged when it is not an ISO date", () => {
    expect(isoLabel("garbage")).toBe("garbage");
  });
});

describe("trailingMean — windowed by DATE, not by row count", () => {
  it("ignores readings older than the window even when they are adjacent rows", () => {
    // Two readings 40 days apart: the later one's 7-day mean is itself alone,
    // NOT the average of the last two rows.
    const pts = resolvePoints([
      { date: at(0), weight: 160 },
      { date: at(40), weight: 150 },
    ]);
    expect(trailingMean(pts, 1)).toBe(150);
  });

  it("averages every reading inside the window, including same-day duplicates", () => {
    const pts = resolvePoints([
      { date: at(0), weight: 160 },
      { date: at(0.5), weight: 158 },
      { date: at(1), weight: 156 },
    ]);
    expect(trailingMean(pts, 2)).toBeCloseTo(158, 6);
  });

  it("is inclusive of the point itself at index 0", () => {
    const pts = resolvePoints([{ date: at(0), weight: 159 }]);
    expect(trailingMean(pts, 0)).toBe(159);
  });
});

describe("buildWeightSeries — gaps break the line", () => {
  it("inserts exactly one null row inside a stretch longer than the gap threshold", () => {
    const { rows } = buildWeightSeries(gappySeries(), null);
    const breaks = rows.filter((r) => r.weight === null && r.trend === null);
    expect(breaks).toHaveLength(1);
    // It sits BETWEEN the two readings that straddle the silence.
    expect(breaks[0]!.t).toBeGreaterThan(T0 + 3 * DAY_MS);
    expect(breaks[0]!.t).toBeLessThan(T0 + 43 * DAY_MS);
  });

  it("does not break a densely sampled series", () => {
    const dense = resolvePoints(
      Array.from({ length: 10 }, (_, i) => ({ date: at(i), weight: 160 - i * 0.2 })),
    );
    expect(buildWeightSeries(dense, null).rows.every((r) => r.weight !== null)).toBe(true);
  });

  it("keeps every real reading — the break row is additive, not a replacement", () => {
    const pts = gappySeries();
    const { rows, visible } = buildWeightSeries(pts, null);
    expect(visible).toHaveLength(pts.length);
    expect(rows.filter((r) => r.weight !== null)).toHaveLength(pts.length);
  });
});

describe("buildWeightSeries — windowing", () => {
  it("computes the trend over full history, so the first visible point is not reset", () => {
    const pts = resolvePoints([
      { date: at(0), weight: 160 },
      { date: at(1), weight: 158 },
      { date: at(2), weight: 156 },
    ]);
    const windowed = buildWeightSeries(pts, 1);
    // Only at(1) and at(2) are visible, but at(2)'s trend still sees at(0).
    expect(windowed.visible).toHaveLength(2);
    expect(windowed.rows.at(-1)!.trend).toBeCloseTo(158, 6);
  });

  it("null windowDays means the full history", () => {
    const pts = gappySeries();
    expect(buildWeightSeries(pts, null).visible).toHaveLength(pts.length);
  });

  it("pads the y-domain one integer unit past the extremes", () => {
    const pts = resolvePoints([
      { date: at(0), weight: 154.4 },
      { date: at(1), weight: 161 },
    ]);
    expect(buildWeightSeries(pts, null).domain).toEqual([153, 162]);
  });

  it("survives an empty series without throwing", () => {
    const out = buildWeightSeries([], null);
    expect(out.rows).toEqual([]);
    expect(out.ticks).toEqual([]);
  });
});

describe("pickTicks — spread by time, snapped to real readings", () => {
  it("every tick is an actual reading timestamp, so its label is already formatted", () => {
    const pts = gappySeries();
    const times = new Set(pts.map((p) => p.t));
    for (const tick of pickTicks(pts)) expect(times.has(tick)).toBe(true);
  });

  it("always includes the first and last reading", () => {
    const pts = gappySeries();
    const ticks = pickTicks(pts);
    expect(ticks[0]).toBe(pts[0]!.t);
    expect(ticks.at(-1)).toBe(pts.at(-1)!.t);
  });

  it("spreads across the gap instead of bunching in the dense head", () => {
    // Index-spacing over this series would put 3 of 4 ticks in the first 3
    // days. Time-spacing must place at least one past the midpoint.
    const pts = gappySeries();
    const mid = (pts[0]!.t + pts.at(-1)!.t) / 2;
    expect(pickTicks(pts).some((t) => t > mid)).toBe(true);
  });

  it("never emits duplicates when readings are fewer than the tick budget", () => {
    const pts = resolvePoints([
      { date: at(0), weight: 159 },
      { date: at(1), weight: 158 },
    ]);
    const ticks = pickTicks(pts, 4);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("handles a single reading", () => {
    const pts = resolvePoints([{ date: at(0), weight: 159 }]);
    expect(pickTicks(pts)).toEqual([pts[0]!.t]);
  });
});

describe("spanDays", () => {
  it("is 0 for a single reading", () => {
    expect(spanDays(resolvePoints([{ date: at(0), weight: 159 }]))).toBe(0);
  });

  it("measures first-to-last, not reading count", () => {
    expect(spanDays(gappySeries())).toBeCloseTo(43.2, 5);
  });
});
