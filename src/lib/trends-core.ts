// src/lib/trends-core.ts — pure trends math for /trends and get_trend_window.
// Pure, client-safe: zero imports of any kind; no Date.now(), no new Date(),
// no locale/TZ calls. MacroTargets is re-declared locally (structurally
// identical to DayMacros) to keep the module import-free.
//
// Rounding lives ONLY in aggregateWindow (per the WindowAggregate field
// comments) — this is what makes the /trends page and the MCP tool
// byte-identical. WindowPanel formats for display but never re-rounds.

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
// stale enumeration is recorded in blueprint §11 so nobody files it as drift.
export type TdeeGateReason =
  | "window_too_short"
  | "insufficient_nutrition_days"
  | "insufficient_nutrition_coverage"
  | "insufficient_weigh_ins"
  | "implausible_result";

export type MacroShares = { protein: number; carbs: number; fat: number }; // integer %, kcal-weighted

/**
 * The REQUESTED window's bounds — the honest denominator (QA C-2 fix).
 * `fromT`/`toT` are epoch ms at USER_TZ midnight of the window's first and
 * last day (inclusive), computed by the CALLER via parseDateKey (this module
 * stays import-free and does no Date/TZ work). `fromKey`/`toKey` are those
 * same days' dateKeys. aggregateWindow derives `window.days` and
 * `coverage.totalDays` from these bounds — never from how many grid points
 * happen to exist inside them — so a 30-day window over 10 days of history
 * reads "10 of 30", not "10 of 10". Both the /trends island and
 * get_trend_window pass their requested bounds through this one type, which
 * is what makes the page and the tool agree by construction.
 */
export type WindowBounds = {
  fromT: number;
  toT: number;
  fromKey: string;
  toKey: string;
};

export type WindowAggregate = {
  window: { from: string; to: string; days: number };  // the REQUESTED bounds' dateKeys + inclusive day count
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
    totalDays: number;        // === window.days — inclusive calendar days between the REQUESTED
                              // bounds (never points.length: grid points that happen to exist
                              // inside the window are the numerator's business, not the denominator's)
    nutritionDays: number;    // === nutrition.loggedDays
    weightDays: number;       // === weight.readingDays
    healthDays: number;       // days with ANY of activeKcal/basalKcal/steps non-null
    mealsNoMacroDays: number; // days where mealCount > 0 && kcal === null — feeds the
                              // "7 meals logged, 0 with macros" coverage copy (G1 §6);
                              // additive vs the §4.2 sample, Tech-Lead-seen
  };
};

// ── internal rounding helpers (aggregateWindow is the ONLY rounding site) ────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── series construction ──────────────────────────────────────────────────────

export function buildDailySeries(input: {
  /** Full day grid, ascending, one entry per calendar day — built SERVER-side via addDays/parseDateKey/Intl. */
  days: Array<{ t: number; dateKey: string; label: string }>;
  weights: Array<{ dateKey: string; weightLb: number }>;                 // one per Measurement row
  nutrition: Array<{ dateKey: string; calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null }>; // one per NutritionLog row
  health: Array<{ dateKey: string; source: string; createdAtMs: number; activeKcal: number | null; basalKcal: number | null; steps: number | null }>; // one per HealthDaily row
}): DailyPoint[] {
  // Bucket the row sets by dateKey. Rows whose dateKey is outside the grid
  // are simply never looked up — the grid alone defines the output days.
  const weightsByDay = new Map<string, number[]>();
  for (const w of input.weights) {
    const arr = weightsByDay.get(w.dateKey);
    if (arr) arr.push(w.weightLb);
    else weightsByDay.set(w.dateKey, [w.weightLb]);
  }

  const nutritionByDay = new Map<string, Array<(typeof input.nutrition)[number]>>();
  for (const n of input.nutrition) {
    const arr = nutritionByDay.get(n.dateKey);
    if (arr) arr.push(n);
    else nutritionByDay.set(n.dateKey, [n]);
  }

  const healthByDay = new Map<string, Array<(typeof input.health)[number]>>();
  for (const h of input.health) {
    const arr = healthByDay.get(h.dateKey);
    if (arr) arr.push(h);
    else healthByDay.set(h.dateKey, [h]);
  }

  // Per-field day sum over NON-NULL row values; null iff every row's value is
  // null or there are no rows. Never zero-fill: null never enters a sum, so a
  // day with 3 macro-less meals stays kcal:null while mealCount reads 3.
  type NutritionRow = (typeof input.nutrition)[number];
  const sumField = (
    rows: NutritionRow[] | undefined,
    field: "calories" | "proteinG" | "carbsG" | "fatG",
  ): number | null => {
    if (!rows) return null;
    let sum = 0;
    let any = false;
    for (const r of rows) {
      const v = r[field];
      if (v !== null) {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  };

  // HealthDaily per-field merge: source === "manual" wins over any other
  // source when both supply a non-null value; among rows of the SAME source,
  // last-created wins per field (createdAtMs) — this defines behavior for the
  // temporary duplicates the C4 fallback write path can produce.
  type HealthRow = (typeof input.health)[number];
  const mergeHealthField = (
    rows: HealthRow[] | undefined,
    field: "activeKcal" | "basalKcal" | "steps",
  ): number | null => {
    if (!rows) return null;
    let best: { manual: boolean; createdAtMs: number; value: number } | null = null;
    for (const r of rows) {
      const v = r[field];
      if (v === null) continue;
      const manual = r.source === "manual";
      if (
        best === null ||
        (manual && !best.manual) ||
        (manual === best.manual && r.createdAtMs > best.createdAtMs)
      ) {
        best = { manual, createdAtMs: r.createdAtMs, value: v };
      }
    }
    return best ? best.value : null;
  };

  return input.days.map((day) => {
    const dayWeights = weightsByDay.get(day.dateKey);
    let weight: number | null = null;
    if (dayWeights && dayWeights.length > 0) {
      let sum = 0;
      for (const w of dayWeights) sum += w;
      weight = round1(sum / dayWeights.length); // day MEAN of readings, 1dp
    }

    const dayNutrition = nutritionByDay.get(day.dateKey);
    const dayHealth = healthByDay.get(day.dateKey);

    return {
      t: day.t,
      dateKey: day.dateKey,
      label: day.label,
      weight,
      kcal: sumField(dayNutrition, "calories"),
      proteinG: sumField(dayNutrition, "proteinG"),
      carbsG: sumField(dayNutrition, "carbsG"),
      fatG: sumField(dayNutrition, "fatG"),
      mealCount: dayNutrition ? dayNutrition.length : 0,
      activeKcal: mergeHealthField(dayHealth, "activeKcal"),
      basalKcal: mergeHealthField(dayHealth, "basalKcal"),
      steps: mergeHealthField(dayHealth, "steps"),
    };
  });
}

export function sliceWindow(points: DailyPoint[], fromT: number, toT: number): DailyPoint[] {
  return points.filter((p) => p.t >= fromT && p.t <= toT);
}

/** Least-squares slope in value-units per DAY over (t, value); null for < 2 points. Use t/DAY_MS as x internally. */
export function linearSlope(points: Array<{ t: number; value: number }>): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.t / DAY_MS;
    sumY += p.value;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.t / DAY_MS - meanX;
    num += dx * (p.value - meanY);
    den += dx * dx;
  }
  if (den === 0) return null; // degenerate: all points at one instant
  return num / den;
}

// ── window aggregation ───────────────────────────────────────────────────────

export function aggregateWindow(
  points: DailyPoint[],
  bounds: WindowBounds,
  opts?: { targets?: MacroTargets | null },
): WindowAggregate {
  // Defensive normalization — never throw from pure math.
  const { fromT, toT, fromKey, toKey } =
    bounds.fromT <= bounds.toT
      ? bounds
      : { fromT: bounds.toT, toT: bounds.fromT, fromKey: bounds.toKey, toKey: bounds.fromKey };

  // Self-slice to the bounds so callers cannot desync "the points" from "the
  // window" — the aggregate is over exactly the requested window, whether the
  // caller hands the full series or a pre-sliced one.
  points = sliceWindow(points, fromT, toT);

  // THE denominator (QA C-2): the inclusive count of calendar days between
  // the requested bounds — pure integer arithmetic over the epoch-ms bounds.
  // Math.round absorbs the ±1h a DST transition puts between two USER_TZ
  // midnights; it must NOT be points.length, which counts only the grid days
  // that exist and would overstate coverage whenever the window extends past
  // the user's data (the "10 of 10" dishonesty this feature exists to kill).
  const totalDays = Math.round((toT - fromT) / DAY_MS) + 1;

  // Nutrition — averages divide by the count of CONTRIBUTING days, never
  // totalDays. Zero-filling is structurally impossible: null never enters a sum.
  let kcalSum = 0;
  let loggedDays = 0;
  let proteinSum = 0;
  let proteinDays = 0;
  let carbsSum = 0;
  let carbsDays = 0;
  let fatSum = 0;
  let fatDays = 0;
  let mealsNoMacroDays = 0;
  let healthDays = 0;
  let measuredSum = 0;
  let measuredDays = 0;

  for (const p of points) {
    if (p.kcal !== null) {
      kcalSum += p.kcal;
      loggedDays++;
    }
    if (p.proteinG !== null) {
      proteinSum += p.proteinG;
      proteinDays++;
    }
    if (p.carbsG !== null) {
      carbsSum += p.carbsG;
      carbsDays++;
    }
    if (p.fatG !== null) {
      fatSum += p.fatG;
      fatDays++;
    }
    if (p.mealCount > 0 && p.kcal === null) mealsNoMacroDays++;
    if (p.activeKcal !== null || p.basalKcal !== null || p.steps !== null) healthDays++;
    if (p.activeKcal !== null && p.basalKcal !== null) {
      measuredSum += p.activeKcal + p.basalKcal;
      measuredDays++;
    }
  }

  const avgKcal = loggedDays > 0 ? Math.round(kcalSum / loggedDays) : null;
  const avgProteinG = proteinDays > 0 ? Math.round(proteinSum / proteinDays) : null;
  const avgCarbsG = carbsDays > 0 ? Math.round(carbsSum / carbsDays) : null;
  const avgFatG = fatDays > 0 ? Math.round(fatSum / fatDays) : null;
  const macroSharePct =
    avgProteinG !== null && avgCarbsG !== null && avgFatG !== null
      ? macroShares(avgProteinG, avgCarbsG, avgFatG)
      : null;

  // Weight — first/last day WITH a reading; indices double as the calendar-day
  // span (the grid is one point per day).
  let firstIdx = -1;
  let lastIdx = -1;
  let readingDays = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.weight !== null) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
      readingDays++;
    }
  }
  const first =
    firstIdx >= 0
      ? { dateKey: points[firstIdx]!.dateKey, value: points[firstIdx]!.weight! }
      : null;
  const last =
    lastIdx >= 0 ? { dateKey: points[lastIdx]!.dateKey, value: points[lastIdx]!.weight! } : null;
  const deltaLb = readingDays >= 2 && first && last ? round1(last.value - first.value) : null;
  // PRD-sample-faithful: the rate divides by the WINDOW length (window.days),
  // not the first→last reading span — §4.2's worked sample (−1.8 over a
  // 10-day window → −1.26/wk) pins this. The reading-span alternative was
  // considered and deliberately not taken (blueprint §11).
  const ratePerWeekLb =
    deltaLb !== null && totalDays > 0 ? round2((deltaLb / totalDays) * 7) : null;

  const proteinPerLb =
    avgProteinG !== null && last !== null && last.value > 0
      ? round2(avgProteinG / last.value)
      : null;

  const measuredTdee = measuredDays > 0 ? Math.round(measuredSum / measuredDays) : null;

  // ── TDEE gates — first failure wins, exactly one reason (DC3 ruling) ───────
  let observedTdee: number | null = null;
  let observedTdeeReason: TdeeGateReason | null = null;
  if (totalDays < MIN_WINDOW_DAYS_FOR_TDEE) {
    observedTdeeReason = "window_too_short";
  } else if (loggedDays < MIN_NUTRITION_DAYS_FOR_TDEE) {
    observedTdeeReason = "insufficient_nutrition_days";
  } else if (loggedDays / totalDays < MIN_NUTRITION_COVERAGE) {
    observedTdeeReason = "insufficient_nutrition_coverage";
  } else if (
    readingDays < MIN_WEIGH_INS_FOR_TDEE ||
    // Reading span measured in GRID DAYS (index delta), not raw ms: the grid
    // is one point per calendar day, so lastIdx − firstIdx IS the calendar-day
    // span — and unlike a t-difference it cannot misjudge a 7-day span that
    // crosses a DST transition (23/25-hour days shift t by ±1h).
    lastIdx - firstIdx < MIN_WEIGH_IN_SPAN_DAYS
  ) {
    observedTdeeReason = "insufficient_weigh_ins";
  } else {
    // TDEE — transcribed from G1 §4.4, do not re-derive. slope is lb/day,
    // signed, NEGATIVE while losing. Energy balance gives
    // slope = (intake − TDEE) / KCAL_PER_LB, therefore:
    //   observedTdee = avgKcal − slope * KCAL_PER_LB
    // Losing weight (negative slope) must yield observedTdee > avgKcal.
    const slope = linearSlope(
      points.filter((p) => p.weight !== null).map((p) => ({ t: p.t, value: p.weight! })),
    );
    if (slope === null) {
      // Unreachable after the readingDays gate, but never let it fall through
      // to a fabricated number.
      observedTdeeReason = "insufficient_weigh_ins";
    } else {
      const computed = Math.round(avgKcal! - slope * KCAL_PER_LB);
      if (computed < MIN_PLAUSIBLE_TDEE) {
        // DC3: a negative (or absurdly low) "Maintenance" must never render.
        observedTdeeReason = "implausible_result";
      } else {
        observedTdee = computed;
      }
    }
  }

  const gap = measuredTdee !== null && observedTdee !== null ? measuredTdee - observedTdee : null;
  const balancePerDay =
    observedTdee !== null && avgKcal !== null ? Math.round(avgKcal - observedTdee) : null;

  const adherence =
    opts?.targets != null && avgKcal !== null
      ? {
          targetKcal: opts.targets.calories,
          deltaKcal: Math.round(avgKcal - opts.targets.calories),
          // Macro deltas treat a null macro average as 0 contribution — the
          // avgKcal gate above means macros are almost always logged alongside;
          // a rare macros-null window reads as "the full target short".
          deltaProteinG: Math.round((avgProteinG ?? 0) - opts.targets.proteinG),
          deltaCarbsG: Math.round((avgCarbsG ?? 0) - opts.targets.carbsG),
          deltaFatG: Math.round((avgFatG ?? 0) - opts.targets.fatG),
        }
      : null;

  return {
    // The REQUESTED bounds, verbatim — not the first/last grid point, which
    // would differ between a sparse series (page grid starting at first data)
    // and a full window grid (the tool's) for the same window.
    window: { from: fromKey, to: toKey, days: totalDays },
    nutrition: {
      loggedDays,
      avgKcal,
      avgProteinG,
      avgCarbsG,
      avgFatG,
      macroSharePct,
      proteinPerLb,
    },
    weight: { first, last, deltaLb, ratePerWeekLb, readingDays },
    energy: {
      observedTdee,
      observedTdeeReason,
      measuredTdee,
      measuredDays,
      gap,
      balancePerDay,
    },
    adherence,
    // coverage is present on EVERY return path, including a window holding no
    // points at all (all counts zero; totalDays still the bounds-derived span).
    coverage: {
      totalDays,
      nutritionDays: loggedDays,
      weightDays: readingDays,
      healthDays,
      mealsNoMacroDays,
    },
  };
}

// ── chart series helpers ─────────────────────────────────────────────────────

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
  const out: Array<number | null> = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, i - (KCAL_TREND_WINDOW_DAYS - 1));
    for (let j = start; j <= i; j++) {
      const v = get(points[j]!);
      if (v !== null) {
        sum += v;
        count++;
      }
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

/** Convenience: trailingMeanSeries(points, p => p.kcal). */
export function buildKcalTrend(points: DailyPoint[]): Array<number | null> {
  return trailingMeanSeries(points, (p) => p.kcal);
}

/** Integer % by kcal weight (p*4, c*4, f*9). null when total is 0. */
export function macroShares(proteinG: number, carbsG: number, fatG: number): MacroShares | null {
  const proteinKcal = proteinG * 4;
  const carbsKcal = carbsG * 4;
  const fatKcal = fatG * 9;
  const total = proteinKcal + carbsKcal + fatKcal;
  if (total <= 0) return null;
  return {
    protein: Math.round((proteinKcal / total) * 100),
    carbs: Math.round((carbsKcal / total) * 100),
    fat: Math.round((fatKcal / total) * 100),
  };
}

/** Even sampling to at most `max` points, always keeping first and last. Pure. */
export function sampleEvenly<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  if (max <= 1) return [points[0]!];
  const out: T[] = new Array(max);
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out[i] = points[Math.round(i * step)]!;
  }
  return out;
}
