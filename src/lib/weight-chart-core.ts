/**
 * weight-chart-core — the honesty math behind the weigh-in chart.
 *
 * Pure and client-safe (no Prisma, no Date-now, no locale/timezone calls), so
 * it unit-tests like rotation-core / compare-core / rarity-core do.
 *
 * Three things this exists to get right, all of which the previous chart got
 * wrong by drawing raw readings on a CATEGORICAL x-axis:
 *
 *   1. TIME, not index. A 40-day silence and a 1-day interval used to render
 *      as the same width. Rows carry a real timestamp and the axis is a time
 *      scale, so a gap looks like a gap.
 *   2. A trailing mean over DATES, not over row counts. The series is
 *      irregularly sampled — three readings on one day, none for six weeks —
 *      so "last 7 rows" is not "last 7 days".
 *   3. Broken lines across quiet stretches. Connecting across a six-week gap
 *      draws a confident diagonal through data that was never recorded.
 */

export type WeightPoint = { date: string; weight: number; label?: string };

/** A reading resolved to epoch-ms with its display label settled. */
export type ResolvedPoint = { t: number; weight: number; label: string };

/** A chart row. A row with null values is a deliberate line break. */
export type WeightRow = {
  t: number;
  weight: number | null;
  trend: number | null;
  label: string;
};

export type WeightSeries = {
  rows: WeightRow[];
  /** Readings inside the window, ascending. Excludes the synthetic break rows. */
  visible: ResolvedPoint[];
  /** Integer y-domain padded 1 unit past the extremes. */
  domain: [number, number];
  /** Axis ticks, spread by time and snapped to real readings. */
  ticks: number[];
};

export const DAY_MS = 86_400_000;
/** Trailing window for the trend line. Daily weight is mostly water. */
export const TREND_WINDOW_DAYS = 7;
/** A quiet stretch longer than this breaks the line instead of bridging it. */
export const GAP_BREAK_DAYS = 14;
/** Axis tick budget — four labels is what fits at 390px. */
export const MAX_TICKS = 4;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Deterministic fallback label for callers that don't pass a server-formatted
 * one. Reads the ISO string's own Y-M-D characters rather than going through
 * toLocaleDateString(undefined, …), which resolves locale AND timezone
 * differently at SSR (UTC on Vercel) than at hydration — a text-content
 * mismatch. Callers should pass `label` formatted server-side in USER_TZ; this
 * is the legacy escape hatch (original A10 note, UXR-PROG-81).
 */
export function isoLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** Parse, drop unparseable rows, sort ascending. */
export function resolvePoints(data: WeightPoint[]): ResolvedPoint[] {
  return data
    .map((p) => ({ t: Date.parse(p.date), weight: p.weight, label: p.label ?? isoLabel(p.date) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.weight))
    .sort((a, b) => a.t - b.t);
}

/** Total span of the series in days. 0 for fewer than two readings. */
export function spanDays(points: ResolvedPoint[]): number {
  return points.length > 1 ? (points.at(-1)!.t - points[0]!.t) / DAY_MS : 0;
}

/**
 * Trailing mean over the preceding `windowDays`, INCLUSIVE of the point itself
 * and windowed by date rather than by row count. `points` must be ascending.
 */
export function trailingMean(
  points: ResolvedPoint[],
  i: number,
  windowDays = TREND_WINDOW_DAYS,
): number {
  const cutoff = points[i]!.t - windowDays * DAY_MS;
  let sum = 0;
  let n = 0;
  for (let j = i; j >= 0 && points[j]!.t >= cutoff; j--) {
    sum += points[j]!.weight;
    n++;
  }
  return sum / n;
}

/**
 * Build the plot rows for a window.
 *
 * `windowDays` of null means the full history. The trend is always computed
 * over the FULL series and then sliced, so the leftmost visible point carries
 * a real trailing average instead of restarting at its own value.
 */
export function buildWeightSeries(
  points: ResolvedPoint[],
  windowDays: number | null,
  opts: { windowSize?: number; gapBreakDays?: number; maxTicks?: number } = {},
): WeightSeries {
  const gapBreakDays = opts.gapBreakDays ?? GAP_BREAK_DAYS;
  const maxTicks = opts.maxTicks ?? MAX_TICKS;

  if (points.length === 0) {
    return { rows: [], visible: [], domain: [0, 1], ticks: [] };
  }

  const cutoff = windowDays === null ? -Infinity : points.at(-1)!.t - windowDays * DAY_MS;
  const visible = points.filter((p) => p.t >= cutoff);

  const trendAll = points.map((_, i) => trailingMean(points, i, opts.windowSize));
  const offset = points.length - visible.length;

  const rows: WeightRow[] = [];
  for (let i = 0; i < visible.length; i++) {
    const p = visible[i]!;
    if (i > 0 && (p.t - visible[i - 1]!.t) / DAY_MS > gapBreakDays) {
      // A null row breaks both lines across the quiet stretch.
      rows.push({ t: (p.t + visible[i - 1]!.t) / 2, weight: null, trend: null, label: "" });
    }
    rows.push({ t: p.t, weight: p.weight, trend: trendAll[offset + i]!, label: p.label });
  }

  const vals = visible.map((p) => p.weight);
  const domain: [number, number] = [
    Math.floor(Math.min(...vals)) - 1,
    Math.ceil(Math.max(...vals)) + 1,
  ];

  return { rows, visible, domain, ticks: pickTicks(visible, maxTicks) };
}

/**
 * Ticks spread evenly by TIME and then snapped to the nearest real reading —
 * index-spacing bunches them wherever readings are dense, and snapping means
 * every tick label is a server-formatted one already in hand, so nothing
 * formats a date on the client.
 */
export function pickTicks(visible: ResolvedPoint[], maxTicks = MAX_TICKS): number[] {
  const want = Math.min(maxTicks, visible.length);
  if (want === 0) return [];
  const t0 = visible[0]!.t;
  const t1 = visible.at(-1)!.t;
  const ticks: number[] = [];
  for (let k = 0; k < want; k++) {
    const at = want === 1 ? t0 : t0 + ((t1 - t0) * k) / (want - 1);
    let best = visible[0]!;
    for (const p of visible) {
      if (Math.abs(p.t - at) < Math.abs(best.t - at)) best = p;
    }
    if (!ticks.includes(best.t)) ticks.push(best.t);
  }
  return ticks;
}
