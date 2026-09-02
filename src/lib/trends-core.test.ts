// src/lib/trends-core.test.ts — pure-function unit tests, no mocks (the
// compare-core.test.ts style). Covers the G1 acceptance items: the TDEE
// direction test, all FIVE gate reasons, unlogged-day exclusion, the
// kcal:null/mealCount:3 day, DST bucketing, coverage on every path, and the
// §4.2 worked-sample fixture.

import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  KCAL_TREND_WINDOW_DAYS,
  MAX_DAILY_ROWS,
  aggregateWindow,
  buildDailySeries,
  buildKcalTrend,
  linearSlope,
  macroShares,
  sampleEvenly,
  sliceWindow,
  trailingMeanSeries,
  type DailyPoint,
  type MacroTargets,
  type WindowBounds,
} from "@/lib/trends-core";
// Test-only import: the core itself is import-free; the DST cases build their
// day grid with the REAL calendar helpers, exactly as trends-data does.
import { addDays, dateKey, parseDateKey } from "@/lib/calendar-core";

const T0 = 1_754_000_000_000; // arbitrary fixed epoch base — never Date.now()

function key(i: number): string {
  return `d${String(i).padStart(3, "0")}`;
}

function pt(i: number, over: Partial<DailyPoint> = {}): DailyPoint {
  return {
    t: T0 + i * DAY_MS,
    dateKey: key(i),
    label: "",
    weight: null,
    kcal: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    mealCount: 0,
    activeKcal: null,
    basalKcal: null,
    steps: null,
    ...over,
  };
}

/** n-day grid with per-index overrides. */
function series(n: number, overrides: Record<number, Partial<DailyPoint>> = {}): DailyPoint[] {
  return Array.from({ length: n }, (_, i) => pt(i, overrides[i] ?? {}));
}

/** WindowBounds spanning exactly the series' own extent (the common case). */
function boundsOf(points: DailyPoint[]): WindowBounds {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return { fromT: first.t, toT: last.t, fromKey: first.dateKey, toKey: last.dateKey };
}

/** aggregateWindow over the series' own extent — bounds === the data grid. */
function aggSelf(
  points: DailyPoint[],
  opts?: { targets?: MacroTargets | null },
): ReturnType<typeof aggregateWindow> {
  return aggregateWindow(points, boundsOf(points), opts);
}

// ── linearSlope ──────────────────────────────────────────────────────────────

describe("linearSlope", () => {
  it("returns null for fewer than 2 points", () => {
    expect(linearSlope([])).toBeNull();
    expect(linearSlope([{ t: T0, value: 150 }])).toBeNull();
  });

  it("returns null when every point shares one instant (zero x-variance)", () => {
    expect(
      linearSlope([
        { t: T0, value: 150 },
        { t: T0, value: 152 },
      ]),
    ).toBeNull();
  });

  it("recovers an exact per-day slope from collinear points", () => {
    const points = [0, 1, 2, 3].map((i) => ({ t: T0 + i * DAY_MS, value: 150 - 0.25 * i }));
    expect(linearSlope(points)).toBeCloseTo(-0.25, 10);
  });
});

// ── buildDailySeries ─────────────────────────────────────────────────────────

describe("buildDailySeries", () => {
  const days = [0, 1, 2].map((i) => ({ t: T0 + i * DAY_MS, dateKey: key(i), label: `L${i}` }));

  it("a day of 3 macro-less meals is kcal:null with mealCount:3 (G1 edge table)", () => {
    const out = buildDailySeries({
      days,
      weights: [],
      nutrition: [
        { dateKey: key(0), calories: null, proteinG: null, carbsG: null, fatG: null },
        { dateKey: key(0), calories: null, proteinG: null, carbsG: null, fatG: null },
        { dateKey: key(0), calories: null, proteinG: null, carbsG: null, fatG: null },
      ],
      health: [],
    });
    expect(out[0]).toMatchObject({ kcal: null, mealCount: 3 });
    expect(out[1]).toMatchObject({ kcal: null, mealCount: 0 });
  });

  it("sums each macro field independently over its non-null rows only", () => {
    const out = buildDailySeries({
      days,
      weights: [],
      nutrition: [
        { dateKey: key(1), calories: 600, proteinG: null, carbsG: 50, fatG: null },
        { dateKey: key(1), calories: null, proteinG: 30, carbsG: null, fatG: null },
        { dateKey: key(1), calories: 400, proteinG: 20, carbsG: null, fatG: null },
      ],
      health: [],
    });
    expect(out[1]).toMatchObject({
      kcal: 1000,
      proteinG: 50,
      carbsG: 50,
      fatG: null, // all-null field stays null — never zero-filled
      mealCount: 3,
    });
  });

  it("weight is the day MEAN of readings at 1dp", () => {
    const out = buildDailySeries({
      days,
      weights: [
        { dateKey: key(0), weightLb: 158.4 },
        { dateKey: key(0), weightLb: 157.9 },
      ],
      nutrition: [],
      health: [],
    });
    expect(out[0]!.weight).toBe(158.2); // mean 158.15 → 1dp
  });

  it("health merge: manual beats apple_health per field; same source resolves last-created", () => {
    const out = buildDailySeries({
      days,
      weights: [],
      nutrition: [],
      health: [
        {
          dateKey: key(0),
          source: "apple_health",
          createdAtMs: 1,
          activeKcal: 600,
          basalKcal: 2100,
          steps: 9000,
        },
        {
          dateKey: key(0),
          source: "apple_health",
          createdAtMs: 2,
          activeKcal: 650,
          basalKcal: null,
          steps: null,
        },
        // Manual wins activeKcal despite the older createdAtMs; its null steps
        // does NOT blank the apple value — the merge is per-field.
        {
          dateKey: key(0),
          source: "manual",
          createdAtMs: 0,
          activeKcal: 480,
          basalKcal: null,
          steps: null,
        },
      ],
    });
    expect(out[0]).toMatchObject({ activeKcal: 480, basalKcal: 2100, steps: 9000 });
  });

  it("rows outside the day grid are ignored", () => {
    const out = buildDailySeries({
      days,
      weights: [{ dateKey: "d999", weightLb: 100 }],
      nutrition: [{ dateKey: "d999", calories: 1, proteinG: null, carbsG: null, fatG: null }],
      health: [],
    });
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.weight === null && p.kcal === null)).toBe(true);
  });
});

// ── sliceWindow ──────────────────────────────────────────────────────────────

describe("sliceWindow", () => {
  it("is inclusive on both bounds", () => {
    const points = series(5);
    const out = sliceWindow(points, T0 + 1 * DAY_MS, T0 + 3 * DAY_MS);
    expect(out.map((p) => p.dateKey)).toEqual([key(1), key(2), key(3)]);
  });
});

// ── aggregateWindow: the §4.2 worked sample ──────────────────────────────────

describe("aggregateWindow — G1 §4.2 worked-sample fixture", () => {
  // 10-day window Aug 3 → Aug 12. Weigh-ins on 6 days, engineered so the
  // least-squares slope is EXACTLY −0.18 lb/day while first/last pin
  // 158.4 → 156.6 (Δ −1.8). Nutrition on 7 days averaging exactly 2410.
  // Health on all 10 days summing to a 2890 measured TDEE.
  const augKey = (i: number) => `2026-08-${String(3 + i).padStart(2, "0")}`;
  const weightByIdx: Record<number, number> = {
    0: 158.4,
    2: 157.9,
    4: 157.31,
    5: 158.0,
    7: 157.15,
    9: 156.6,
  };
  const kcalByIdx: Record<number, number> = {
    0: 2400,
    1: 2500,
    2: 2300,
    3: 2450,
    4: 2350,
    5: 2470,
    6: 2400,
  };
  const points: DailyPoint[] = Array.from({ length: 10 }, (_, i) =>
    pt(i, {
      dateKey: augKey(i),
      weight: weightByIdx[i] ?? null,
      kcal: kcalByIdx[i] ?? null,
      mealCount: kcalByIdx[i] !== undefined ? 1 : 0,
      activeKcal: 700,
      basalKcal: 2190,
    }),
  );
  const targets: MacroTargets = { calories: 2300, proteinG: 180, carbsG: 200, fatG: 76 };
  const agg = aggSelf(points, { targets });

  it("window + coverage", () => {
    expect(agg.window).toEqual({ from: "2026-08-03", to: "2026-08-12", days: 10 });
    expect(agg.coverage).toEqual({
      totalDays: 10,
      nutritionDays: 7,
      weightDays: 6,
      healthDays: 10,
      mealsNoMacroDays: 0,
    });
  });

  it("avgKcal 2410 over the 7 logged days", () => {
    expect(agg.nutrition.loggedDays).toBe(7);
    expect(agg.nutrition.avgKcal).toBe(2410);
  });

  it("weight: Δ −1.8, rate −1.26/wk (window-days divisor), 6 reading days", () => {
    expect(agg.weight.first).toEqual({ dateKey: "2026-08-03", value: 158.4 });
    expect(agg.weight.last).toEqual({ dateKey: "2026-08-12", value: 156.6 });
    expect(agg.weight.deltaLb).toBe(-1.8);
    expect(agg.weight.ratePerWeekLb).toBe(-1.26); // −1.8 / 10 * 7
    expect(agg.weight.readingDays).toBe(6);
  });

  it("energy: observed 3040, measured 2890, gap −150, balance −630", () => {
    expect(agg.energy.observedTdee).toBe(3040); // 2410 − (−0.18 × 3500)
    expect(agg.energy.observedTdeeReason).toBeNull();
    expect(agg.energy.measuredTdee).toBe(2890); // 700 + 2190 over 10 days
    expect(agg.energy.measuredDays).toBe(10);
    expect(agg.energy.gap).toBe(-150); // 2890 − 3040
    expect(agg.energy.balancePerDay).toBe(-630); // 2410 − 3040
  });

  it("adherence vs the 2300-kcal plan", () => {
    expect(agg.adherence).not.toBeNull();
    expect(agg.adherence!.targetKcal).toBe(2300);
    expect(agg.adherence!.deltaKcal).toBe(110);
  });
});

// ── aggregateWindow: TDEE direction (non-negotiable) ─────────────────────────

describe("aggregateWindow — TDEE sign convention", () => {
  it("a NEGATIVE weight slope (losing) yields observedTdee > avgKcal", () => {
    // 14 days, all logged at 2500 kcal, weight falling 0.1 lb/day.
    const points = series(
      14,
      Object.fromEntries(
        Array.from({ length: 14 }, (_, i) => [
          i,
          { kcal: 2500, mealCount: 1, weight: 160 - 0.1 * i },
        ]),
      ),
    );
    const agg = aggSelf(points);
    expect(agg.energy.observedTdeeReason).toBeNull();
    expect(agg.energy.observedTdee).not.toBeNull();
    expect(agg.energy.observedTdee!).toBeGreaterThan(agg.nutrition.avgKcal!);
    expect(agg.energy.observedTdee).toBe(2850); // 2500 + 0.1 × 3500
    expect(agg.energy.balancePerDay).toBe(-350);
  });
});

// ── aggregateWindow: the FIVE gate reasons ───────────────────────────────────

describe("aggregateWindow — TDEE gates (five reasons, first failure wins)", () => {
  it("window_too_short below 7 days, even fully logged", () => {
    const points = series(
      5,
      Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [i, { kcal: 2400, mealCount: 1, weight: 158 - 0.1 * i }]),
      ),
    );
    const agg = aggSelf(points);
    expect(agg.energy.observedTdee).toBeNull();
    expect(agg.energy.observedTdeeReason).toBe("window_too_short");
  });

  it("insufficient_nutrition_days below 5 logged days", () => {
    const points = series(10, {
      0: { kcal: 2400, mealCount: 1, weight: 158 },
      3: { kcal: 2300, mealCount: 1 },
      6: { kcal: 2500, mealCount: 1 },
      9: { kcal: 2400, mealCount: 1, weight: 157 },
    });
    const agg = aggSelf(points);
    expect(agg.energy.observedTdee).toBeNull();
    expect(agg.energy.observedTdeeReason).toBe("insufficient_nutrition_days");
  });

  it("insufficient_nutrition_coverage: 90-day window with exactly 5 logged days passes the absolute gate but fails the ratio", () => {
    // 5 ≥ MIN_NUTRITION_DAYS_FOR_TDEE, but 5/90 ≈ 6% coverage — the exact
    // dishonesty the DC3 ruling exists to prevent.
    const overrides: Record<number, Partial<DailyPoint>> = {
      0: { kcal: 2400, mealCount: 1, weight: 158 },
      20: { kcal: 2300, mealCount: 1 },
      40: { kcal: 2500, mealCount: 1 },
      60: { kcal: 2400, mealCount: 1 },
      89: { kcal: 2450, mealCount: 1, weight: 156 },
    };
    const agg = aggSelf(series(90, overrides));
    expect(agg.nutrition.loggedDays).toBe(5);
    expect(agg.energy.observedTdee).toBeNull();
    expect(agg.energy.observedTdeeReason).toBe("insufficient_nutrition_coverage");
  });

  it("insufficient_weigh_ins with a single weigh-in", () => {
    const points = series(
      10,
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [i, { kcal: 2400, mealCount: 1 }]),
      ),
    );
    points[4] = { ...points[4]!, weight: 158 };
    const agg = aggSelf(points);
    expect(agg.energy.observedTdeeReason).toBe("insufficient_weigh_ins");
    expect(agg.weight.deltaLb).toBeNull(); // Δ shows "—", not 0
    expect(agg.weight.ratePerWeekLb).toBeNull();
  });

  it("insufficient_weigh_ins when 2 readings span fewer than 7 days", () => {
    const points = series(
      10,
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [i, { kcal: 2400, mealCount: 1 }]),
      ),
    );
    points[0] = { ...points[0]!, weight: 158 };
    points[5] = { ...points[5]!, weight: 157.4 }; // span 5 grid days < 7
    const agg = aggSelf(points);
    expect(agg.energy.observedTdeeReason).toBe("insufficient_weigh_ins");
  });

  it("implausible_result: a computed TDEE under 800 kcal returns null, never a number (DC3)", () => {
    // Rapid gain over a short window: slope ≈ +1.11 lb/day drives
    // 2000 − 3888 ≈ −1889 kcal — a negative "Maintenance" must never render.
    const points = series(
      10,
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          i,
          { kcal: 2000, mealCount: 1, weight: 150 + (10 / 9) * i },
        ]),
      ),
    );
    const agg = aggSelf(points);
    expect(agg.energy.observedTdee).toBeNull();
    expect(agg.energy.observedTdeeReason).toBe("implausible_result");
    expect(agg.energy.gap).toBeNull();
    expect(agg.energy.balancePerDay).toBeNull();
  });
});

// ── aggregateWindow: the denominator is the REQUESTED window (QA C-2 fix) ────

describe("aggregateWindow — denominator derives from the requested bounds, not the points present", () => {
  // The flagship failure this pins: a user with 10 days of history asks about
  // a 30-day window. The honest answer is "10 of 30 days logged" — never
  // "10 of 10". Data rides on grid days 20..29; every data day is fully
  // logged and the two weigh-ins span 9 grid days, so ONLY the coverage
  // ratio (10/30 < MIN_NUTRITION_COVERAGE) withholds the TDEE — exactly the
  // gate the page used to skip when it counted its own points as the
  // denominator while get_trend_window counted the requested window.
  const overrides: Record<number, Partial<DailyPoint>> = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      20 + i,
      {
        kcal: 2400,
        mealCount: 1,
        ...(i === 0 ? { weight: 158 } : {}),
        ...(i === 9 ? { weight: 157 } : {}),
      },
    ]),
  );
  const windowBounds: WindowBounds = {
    fromT: T0,
    toT: T0 + 29 * DAY_MS,
    fromKey: key(0),
    toKey: key(29),
  };
  // Tool-shaped points: the full 30-day grid, empty leading days included —
  // what fetchDailyPoints builds when given an explicit `from`.
  const toolPoints = series(30, overrides);
  // Page-shaped points: the grid starts at the first day WITH data — what
  // fetchDailyPoints builds with no `from` (the /trends full-history grid).
  const pagePoints = toolPoints.slice(20);
  const toolAgg = aggregateWindow(toolPoints, windowBounds);
  const pageAgg = aggregateWindow(pagePoints, windowBounds);

  it("10 days of data over a 30-day window reports totalDays 30 / nutritionDays 10 and gates on insufficient_nutrition_coverage", () => {
    expect(toolAgg.coverage.totalDays).toBe(30);
    expect(toolAgg.coverage.nutritionDays).toBe(10);
    expect(toolAgg.window).toEqual({ from: key(0), to: key(29), days: 30 });
    expect(toolAgg.energy.observedTdee).toBeNull();
    expect(toolAgg.energy.observedTdeeReason).toBe("insufficient_nutrition_coverage");
  });

  it("page-shaped and tool-shaped points produce IDENTICAL aggregates for identical bounds", () => {
    // The screen and the coach agree by construction, not by discipline.
    expect(pageAgg).toEqual(toolAgg);
  });

  it("averages still divide by contributing days — the wider denominator never dilutes them", () => {
    expect(toolAgg.nutrition.loggedDays).toBe(10);
    expect(toolAgg.nutrition.avgKcal).toBe(2400); // NOT 800 (24000/30)
  });

  it("self-slices: points outside the bounds never join the window", () => {
    // Narrow the request to exactly the data span: fully covered, so the
    // TDEE computes — from the SAME full-grid array.
    const narrow = aggregateWindow(toolPoints, {
      fromT: T0 + 20 * DAY_MS,
      toT: T0 + 29 * DAY_MS,
      fromKey: key(20),
      toKey: key(29),
    });
    expect(narrow.coverage).toMatchObject({ totalDays: 10, nutritionDays: 10 });
    expect(narrow.energy.observedTdeeReason).toBeNull();
    expect(narrow.energy.observedTdee).not.toBeNull();
  });
});

// ── aggregateWindow: exclusion, coverage paths, adherence, proteinPerLb ──────

describe("aggregateWindow — averages exclude unlogged days", () => {
  it("divides by contributing days, never totalDays", () => {
    const points = series(10, {
      2: { kcal: 1000, mealCount: 1 },
      7: { kcal: 2000, mealCount: 1 },
    });
    const agg = aggSelf(points);
    expect(agg.nutrition.avgKcal).toBe(1500); // NOT 300 (3000/10)
    expect(agg.nutrition.loggedDays).toBe(2);
  });

  it("returns all-null nutrition (not zeros) for a window with no logs", () => {
    const agg = aggSelf(series(10));
    expect(agg.nutrition.avgKcal).toBeNull();
    expect(agg.nutrition.avgProteinG).toBeNull();
    expect(agg.nutrition.macroSharePct).toBeNull();
  });
});

describe("aggregateWindow — coverage on every path", () => {
  it("a window holding no points still returns full coverage, with the bounds-derived denominator", () => {
    const agg = aggregateWindow([], {
      fromT: T0,
      toT: T0 + 9 * DAY_MS,
      fromKey: key(0),
      toKey: key(9),
    });
    expect(agg.window).toEqual({ from: key(0), to: key(9), days: 10 });
    expect(agg.coverage).toEqual({
      totalDays: 10,
      nutritionDays: 0,
      weightDays: 0,
      healthDays: 0,
      mealsNoMacroDays: 0,
    });
    expect(agg.energy.observedTdee).toBeNull();
    // The 10-day window passes the length gate; zero logged days fails gate 2.
    expect(agg.energy.observedTdeeReason).toBe("insufficient_nutrition_days");
    expect(agg.adherence).toBeNull();
  });

  it("an empty sub-7-day window gates window_too_short off the bounds alone", () => {
    const agg = aggregateWindow([], {
      fromT: T0,
      toT: T0 + 2 * DAY_MS,
      fromKey: key(0),
      toKey: key(2),
    });
    expect(agg.window).toEqual({ from: key(0), to: key(2), days: 3 });
    expect(agg.coverage.totalDays).toBe(3);
    expect(agg.energy.observedTdeeReason).toBe("window_too_short");
  });

  it("mealsNoMacroDays counts meals-logged-but-macro-less days", () => {
    const points = series(10, {
      1: { mealCount: 2 }, // kcal null, meals logged
      2: { mealCount: 1 },
      3: { kcal: 2400, mealCount: 1 },
    });
    const agg = aggSelf(points);
    expect(agg.coverage.mealsNoMacroDays).toBe(2);
    expect(agg.coverage.nutritionDays).toBe(1);
  });

  it("healthDays counts days with ANY health field; measuredDays needs BOTH kcal fields", () => {
    const points = series(10, {
      0: { steps: 8000 },
      1: { activeKcal: 600 },
      2: { activeKcal: 600, basalKcal: 2100 },
    });
    const agg = aggSelf(points);
    expect(agg.coverage.healthDays).toBe(3);
    expect(agg.energy.measuredDays).toBe(1);
    expect(agg.energy.measuredTdee).toBe(2700);
  });
});

describe("aggregateWindow — adherence gating and proteinPerLb", () => {
  const targets: MacroTargets = { calories: 2300, proteinG: 180, carbsG: 200, fatG: 76 };

  it("adherence is null without targets AND null without any logged kcal", () => {
    const logged = series(8, { 0: { kcal: 2400, mealCount: 1 } });
    expect(aggSelf(logged).adherence).toBeNull();
    expect(aggSelf(logged, { targets: null }).adherence).toBeNull();
    expect(aggSelf(series(8), { targets }).adherence).toBeNull();
  });

  it("proteinPerLb = avgProteinG / last weigh-in, 2dp; null when either side is missing", () => {
    const points = series(10, {
      0: { weight: 158.4 },
      3: { kcal: 2400, proteinG: 168, mealCount: 1 },
      9: { weight: 156.6 },
    });
    const agg = aggSelf(points);
    expect(agg.nutrition.proteinPerLb).toBe(1.07); // 168 / 156.6
    expect(aggSelf(series(10, { 3: { proteinG: 168, mealCount: 1 } })).nutrition.proteinPerLb).toBeNull();
    expect(aggSelf(series(10, { 0: { weight: 158.4 } })).nutrition.proteinPerLb).toBeNull();
  });
});

// ── trailingMeanSeries / buildKcalTrend ──────────────────────────────────────

describe("trailingMeanSeries", () => {
  it("averages the non-null days inside the 7-day trailing window, index-aligned", () => {
    const points = series(10, {
      0: { kcal: 1000, mealCount: 1 },
      2: { kcal: 2000, mealCount: 1 },
    });
    const trend = trailingMeanSeries(points, (p) => p.kcal);
    expect(trend).toHaveLength(10);
    expect(trend[0]).toBe(1000);
    expect(trend[1]).toBe(1000); // day 1 is null; window [0..1] still holds day 0
    expect(trend[2]).toBe(1500); // (1000 + 2000) / 2
    expect(trend[6]).toBe(1500); // window [0..6] still contains both
    expect(trend[7]).toBe(2000); // day 0 aged out of the 7-day window
    expect(trend[8]).toBe(2000);
    expect(trend[9]).toBeNull(); // window [3..9] has no contributing day — line breaks
  });

  it("computing over the full series then slicing keeps a real mean on the leftmost visible day", () => {
    const points = series(10, {
      0: { kcal: 1000, mealCount: 1 },
      2: { kcal: 2000, mealCount: 1 },
    });
    const full = trailingMeanSeries(points, (p) => p.kcal);
    // A window starting at index 2 still sees the trailing history before it.
    const sliced = full.slice(2);
    expect(sliced[0]).toBe(1500);
  });

  it("buildKcalTrend is the kcal convenience wrapper", () => {
    const points = series(5, { 1: { kcal: 2100, mealCount: 1 } });
    expect(buildKcalTrend(points)).toEqual(trailingMeanSeries(points, (p) => p.kcal));
    expect(KCAL_TREND_WINDOW_DAYS).toBe(7);
  });
});

// ── macroShares ──────────────────────────────────────────────────────────────

describe("macroShares", () => {
  it("kcal-weighted integer shares (4/4/9)", () => {
    expect(macroShares(168, 240, 82)).toEqual({ protein: 28, carbs: 41, fat: 31 });
  });

  it("null when the kcal total is zero", () => {
    expect(macroShares(0, 0, 0)).toBeNull();
  });
});

// ── sampleEvenly ─────────────────────────────────────────────────────────────

describe("sampleEvenly", () => {
  it("returns the input untouched at or under the cap", () => {
    const points = series(10);
    expect(sampleEvenly(points, MAX_DAILY_ROWS)).toBe(points);
  });

  it("samples down to max, always keeping first and last, strictly ascending", () => {
    const points = series(365);
    const out = sampleEvenly(points, 100);
    expect(out).toHaveLength(100);
    expect(out[0]).toBe(points[0]);
    expect(out[99]).toBe(points[364]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t);
    }
  });
});

// ── DST — grid days built the way trends-data builds them ────────────────────

describe("DST windows (grid built via real calendar-core, as trends-data does)", () => {
  function gridDays(fromKey: string, toKey: string) {
    const days: Array<{ t: number; dateKey: string; label: string }> = [];
    for (let d = parseDateKey(fromKey); ; d = addDays(d, 1)) {
      const k = dateKey(d);
      if (k > toKey) break;
      days.push({ t: parseDateKey(k).getTime(), dateKey: k, label: "" });
    }
    return days;
  }

  it("a spring-forward window buckets to exactly n distinct days", () => {
    // 2026-03-08 is the US spring-forward date (America/Denver default).
    const days = gridDays("2026-03-05", "2026-03-12");
    expect(days).toHaveLength(8);
    expect(new Set(days.map((d) => d.dateKey)).size).toBe(8);
    for (let i = 1; i < days.length; i++) expect(days[i]!.t).toBeGreaterThan(days[i - 1]!.t);
  });

  it("a 7-calendar-day weigh-in span across spring-forward still passes the span gate", () => {
    // In raw ms this span is 7 days MINUS one hour (the 23-hour day), so a
    // t-difference gate would wrongly fail it; the grid-day span cannot.
    const days = gridDays("2026-03-05", "2026-03-12");
    const points = buildDailySeries({
      days,
      weights: [
        { dateKey: "2026-03-05", weightLb: 150.0 },
        { dateKey: "2026-03-12", weightLb: 149.3 },
      ],
      nutrition: ["2026-03-05", "2026-03-07", "2026-03-09", "2026-03-11", "2026-03-12"].map(
        (dk) => ({ dateKey: dk, calories: 2400, proteinG: 150, carbsG: 230, fatG: 80 }),
      ),
      health: [],
    });
    expect(points).toHaveLength(8);
    const agg = aggSelf(points);
    expect(agg.window.days).toBe(8);
    expect(agg.energy.observedTdeeReason).toBeNull();
    expect(agg.energy.observedTdee).not.toBeNull();
    expect(agg.energy.observedTdee!).toBeGreaterThan(agg.nutrition.avgKcal!); // losing ⇒ above intake
  });

  it("a fall-back window (25-hour day) also buckets one dateKey per day", () => {
    // 2026-11-01 is the US fall-back date.
    const days = gridDays("2026-10-29", "2026-11-04");
    expect(days).toHaveLength(7);
    expect(new Set(days.map((d) => d.dateKey)).size).toBe(7);
  });
});
