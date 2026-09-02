// CONTRACT STUB — Stream C replaces this file's bodies (blueprint §2.6).
/* eslint-disable @typescript-eslint/no-unused-vars -- throwing stub bodies;
   Stream C's real implementations use every parameter. Remove with the stubs. */
//
// src/lib/trends-core.ts — pure trends math for /trends and get_trend_window.
// Pure, client-safe: zero imports of any kind; no Date.now(), no new Date(),
// no locale/TZ calls. MacroTargets is re-declared locally (structurally
// identical to DayMacros) to keep the module import-free.

export const KCAL_PER_LB = 3500;
export const MIN_WINDOW_DAYS_FOR_TDEE = 7;
export const MIN_NUTRITION_DAYS_FOR_TDEE = 5;
export const MIN_NUTRITION_COVERAGE = 0.5;      // DC3 ruling — patched G1 §4.4
export const MIN_WEIGH_INS_FOR_TDEE = 2;
export const MIN_WEIGH_IN_SPAN_DAYS = 7;
export const MIN_PLAUSIBLE_TDEE = 800;          // DC3 ruling — below this, null + "implausible_result"
export const DAY_MS = 86_400_000;
export const KCAL_TREND_WINDOW_DAYS = 7;        // trailing window for the calorie mean line
export const MAX_DAILY_ROWS = 400;              // MCP daily-series cap (G1 §4.2)
export const DENSE_DAY_THRESHOLD = 180;         // DC2 ruling — above this many visible days, bars become lines

export type MacroTargets = { calories: number; proteinG: number; carbsG: number; fatG: number };

export type DailyPoint = {
  t: number;            // epoch ms at USER_TZ midnight (server-computed via parseDateKey)
  dateKey: string;
  label: string;        // formatted SERVER-side in USER_TZ ("Aug 3")
  weight: number | null;        // day MEAN of non-null weigh-ins, 1dp — null = no weigh-in
  kcal: number | null;          // day SUM of non-null calories — null = calorie-unlogged day
  proteinG: number | null; carbsG: number | null; fatG: number | null;   // same per-field rule
  mealCount: number;            // NutritionLog row count for the day (can be >0 while kcal is null)
  activeKcal: number | null; basalKcal: number | null; steps: number | null;
};

// FIVE reasons (DC3 ruling; patched G1 §4.4). Note: G1 §4.2's prose at line
// ~160 still enumerates only the original three — the patched §4.4 wins; the
// stale enumeration is recorded in §11 so nobody files it as drift.
export type TdeeGateReason =
  | "window_too_short"
  | "insufficient_nutrition_days"
  | "insufficient_nutrition_coverage"
  | "insufficient_weigh_ins"
  | "implausible_result";

export type MacroShares = { protein: number; carbs: number; fat: number }; // integer %, kcal-weighted

export type WindowAggregate = {
  window: { from: string | null; to: string | null; days: number };  // dateKeys; null only for empty input
  nutrition: {
    loggedDays: number;                       // days with kcal !== null
    avgKcal: number | null;                   // Math.round; null when loggedDays === 0
    avgProteinG: number | null;               // Math.round over days where proteinG !== null
    avgCarbsG: number | null;
    avgFatG: number | null;
    macroSharePct: MacroShares | null;        // from the three avgs (4/4/9 kcal-weighted); null if any avg null or total 0
    proteinPerLb: number | null;              // avgProteinG / weight.last.value, 2dp; null when either side missing
  };
  weight: {
    first: { dateKey: string; value: number } | null;   // first/last day WITH a reading in the window
    last:  { dateKey: string; value: number } | null;
    deltaLb: number | null;                   // last − first, 1dp; null when readingDays < 2
    ratePerWeekLb: number | null;             // deltaLb / window.days * 7, 2dp (PRD-sample-faithful —
                                              // divides by the WINDOW length, not the reading span;
                                              // comment this in code); null when deltaLb null
    readingDays: number;                      // distinct days with weight !== null
  };
  energy: {
    observedTdee: number | null;              // Math.round(avgKcal − slope * KCAL_PER_LB); null when gated
    observedTdeeReason: TdeeGateReason | null;// non-null exactly when observedTdee is null and gating applies
    measuredTdee: number | null;              // Math.round(mean of activeKcal+basalKcal over measuredDays); null when measuredDays === 0
    measuredDays: number;                     // days where BOTH activeKcal and basalKcal are non-null
    gap: number | null;                       // measuredTdee − observedTdee; null unless both non-null
    balancePerDay: number | null;             // Math.round(avgKcal − observedTdee); null when observedTdee null
  };
  adherence: {
    targetKcal: number;
    deltaKcal: number;                        // avgKcal − targetKcal (Math.round)
    deltaProteinG: number; deltaCarbsG: number; deltaFatG: number;
  } | null;                                   // null when opts.targets is null/absent OR avgKcal is null
  coverage: {
    totalDays: number;        // === window.days === points.length (full day grid)
    nutritionDays: number;    // === nutrition.loggedDays
    weightDays: number;       // === weight.readingDays
    healthDays: number;       // days with ANY of activeKcal/basalKcal/steps non-null
    mealsNoMacroDays: number; // days where mealCount > 0 && kcal === null — feeds the
                              // "7 meals logged, 0 with macros" coverage copy (G1 §6);
                              // additive vs the §4.2 sample, Tech-Lead-seen
  };
};

export function buildDailySeries(input: {
  /** Full day grid, ascending, one entry per calendar day — built SERVER-side via addDays/parseDateKey/Intl. */
  days: Array<{ t: number; dateKey: string; label: string }>;
  weights: Array<{ dateKey: string; weightLb: number }>;                 // one per Measurement row
  nutrition: Array<{ dateKey: string; calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null }>; // one per NutritionLog row
  health: Array<{ dateKey: string; source: string; createdAtMs: number; activeKcal: number | null; basalKcal: number | null; steps: number | null }>; // one per HealthDaily row
}): DailyPoint[] {
  throw new Error("stub — Stream C implements (REQ-006)");
}

export function sliceWindow(points: DailyPoint[], fromT: number, toT: number): DailyPoint[] {
  return points.filter((p) => p.t >= fromT && p.t <= toT);
}

/** Least-squares slope in value-units per DAY over (t, value); null for < 2 points. Use t/DAY_MS as x internally. */
export function linearSlope(points: Array<{ t: number; value: number }>): number | null {
  throw new Error("stub — Stream C implements (REQ-006)");
}

export function aggregateWindow(
  points: DailyPoint[],
  opts?: { targets?: MacroTargets | null },
): WindowAggregate {
  throw new Error("stub — Stream C implements (REQ-006)");
}

/**
 * Per-grid-day trailing mean of get(p) over the days where it is non-null,
 * within the trailing KCAL_TREND_WINDOW_DAYS window (inclusive). null when no
 * contributing day falls in the window — the line breaks naturally after 7+
 * quiet days with connectNulls={false} and stays continuous across 1–2 day
 * gaps. Aligned index-for-index with `points`. Compute over the FULL series,
 * slice afterwards, so the leftmost visible day carries a real trailing mean.
 * Backs both the calorie trend and the dense-range macro lines (DC2).
 */
export function trailingMeanSeries(
  points: DailyPoint[],
  get: (p: DailyPoint) => number | null,
): Array<number | null> {
  throw new Error("stub — Stream C implements (REQ-006)");
}

/** Convenience: trailingMeanSeries(points, p => p.kcal). */
export function buildKcalTrend(points: DailyPoint[]): Array<number | null> {
  throw new Error("stub — Stream C implements (REQ-006)");
}

/** Integer % by kcal weight (p*4, c*4, f*9). null when total is 0. */
export function macroShares(proteinG: number, carbsG: number, fatG: number): MacroShares | null {
  throw new Error("stub — Stream C implements (REQ-006)");
}

/** Even sampling to at most `max` points, always keeping first and last. Pure. */
export function sampleEvenly<T>(points: T[], max: number): T[] {
  throw new Error("stub — Stream C implements (REQ-006)");
}
