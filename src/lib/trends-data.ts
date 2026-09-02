// src/lib/trends-data.ts — server data layer for /trends and get_trend_window.
// Server data layer — imports @/lib/db and @/lib/calendar; never import from
// client components.
//
// §0.S2: fetchDailyPoints is THE shared query + grid path for the page and the
// MCP tool — it takes the already-resolved scoped client so both callers share
// one code path, which is what makes their numbers byte-identical (G1
// criteria 6 + 20). Every finder passes omit: { userId: true } (harmless on
// the page path, required on the tool path). The raw `prisma` singleton
// appears nowhere in this file.

import { getDb } from "@/lib/db";
import type { ScopedClient } from "@/lib/db";
import { resolveDay } from "@/lib/calendar";
import {
  USER_TZ,
  addDays,
  dateKey,
  endOfDay,
  parseDateKey,
  startOfDay,
} from "@/lib/calendar-core";
import { hasAnyMacros, sumPlanTargetMacros } from "@/lib/nutrition-macros";
import { buildDailySeries } from "@/lib/trends-core";
import type { DailyPoint, MacroTargets } from "@/lib/trends-core";

export type TrendsPageData = {
  points: DailyPoint[];            // FULL-HISTORY day grid: [first day with any data … today], asc, server-labelled (§10.D3)
  targets: MacroTargets | null;    // today's plan macro targets; null when no plan or no macros
  rangeKey: "30d" | "90d" | "all"; // echo of the requested chip (initial client state)
  initialWindow: { fromT: number; toT: number } | null;   // from valid ?from=&to=, epoch-ms USER_TZ midnights
  shape: "zero" | "populated";     // zero ⇢ all three row sets empty ⇢ page renders EmptyState, no island
  /**
   * Server-computed start of each fixed range's REQUESTED window (t = epoch-ms
   * USER_TZ midnight via parseDateKey — the same construction as the grid's
   * t's, so when the day exists in the grid the values are identical). The
   * island needs these because a range chip's honest window is "the last N
   * calendar days ending today" even when history is shorter — the grid then
   * has no point for the window's start, and the client is forbidden its own
   * Date/TZ math. Feeds the WindowBounds the island passes to aggregateWindow
   * (QA C-2 fix: page and tool denominators must agree by construction).
   */
  rangeStarts: Record<"30d" | "90d", { t: number; key: string; label: string }>;
};

/**
 * The HealthDaily read, isolated and guarded (G1 §4.9 / blueprint §10.D8):
 * prod migrations are manual in this repo, so a deploy can briefly run against
 * a database where the table does not exist yet — that must degrade to [] and
 * never 500 the page or the tool. Permanent guard, not scaffolding.
 */
async function readHealthDaily(
  db: ScopedClient,
  dateFilter: { gte?: Date; lte: Date },
): Promise<
  Array<{
    date: Date;
    source: string;
    createdAt: Date;
    activeKcal: number | null;
    basalKcal: number | null;
    steps: number | null;
  }>
> {
  try {
    return await db.healthDaily.findMany({
      where: { date: dateFilter },
      orderBy: { date: "asc" }, // range-bounded by `where`, NO take — the recency gate fires only on asc+take
      omit: { userId: true },
    });
  } catch {
    return [];
  }
}

/** Shared by the page and get_trend_window (§0.S2). ALL three finders pass omit:{userId:true}. */
export async function fetchDailyPoints(
  db: ScopedClient,
  opts: { from?: Date | null; to: Date },   // from omitted ⇒ grid starts at the earliest row across the three models
): Promise<DailyPoint[]> {
  const upper = endOfDay(opts.to);
  const dateFilter = opts.from
    ? { gte: startOfDay(opts.from), lte: upper }
    : { lte: upper };

  // Three queries, each range-bounded by `where`, each orderBy date asc with
  // NO `take` (db.recency.test.ts fires only on asc+take co-occurrence; if a
  // take is ever added here it must be DESC-then-reverse, never an ALLOWLIST
  // entry). The weightLb filter lives IN the query so every returned row is a
  // real weigh-in (/history-fix rationale, commit 7d1a9b6).
  const [measurements, nutritionRows, healthRows] = await Promise.all([
    db.measurement.findMany({
      where: { weightLb: { not: null }, date: dateFilter },
      orderBy: { date: "asc" },
      omit: { userId: true },
    }),
    db.nutritionLog.findMany({
      where: { date: dateFilter },
      orderBy: { date: "asc" },
      omit: { userId: true },
    }),
    readHealthDaily(db, dateFilter),
  ]);

  // Grid start: an explicit `from`, else the earliest row across the three
  // models (each set is already date-ascending, so index 0 is its earliest).
  let gridStart: Date | null = opts.from ? startOfDay(opts.from) : null;
  if (!gridStart) {
    let earliest: Date | null = null;
    for (const d of [measurements[0]?.date, nutritionRows[0]?.date, healthRows[0]?.date]) {
      if (d && (!earliest || d.getTime() < earliest.getTime())) earliest = d;
    }
    if (!earliest) return []; // zero rows of every kind ⇒ empty series ⇒ shape "zero"
    gridStart = startOfDay(earliest);
  }

  // Full day grid, one entry per calendar day, stepped with addDays
  // (USER_TZ-aware — a DST 23/25-hour day still buckets to exactly one
  // dateKey). Labels come from ONE Intl.DateTimeFormat in USER_TZ, formatted
  // SERVER-side (UXR-PROG-81: client toLocaleDateString resolves differently
  // at SSR than at hydration).
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: USER_TZ,
  });
  const endKey = dateKey(opts.to);
  const days: Array<{ t: number; dateKey: string; label: string }> = [];
  for (let d = gridStart; ; d = addDays(d, 1)) {
    const key = dateKey(d);
    if (key > endKey) break; // ISO keys compare lexicographically
    days.push({ t: parseDateKey(key).getTime(), dateKey: key, label: labelFmt.format(d) });
  }

  return buildDailySeries({
    days,
    weights: measurements.map((m) => ({
      dateKey: dateKey(m.date),
      weightLb: m.weightLb!, // non-null by the query filter
    })),
    nutrition: nutritionRows.map((n) => ({
      dateKey: dateKey(n.date),
      calories: n.calories,
      proteinG: n.proteinG,
      carbsG: n.carbsG,
      fatG: n.fatG,
    })),
    health: healthRows.map((h) => ({
      dateKey: dateKey(h.date),
      source: h.source,
      createdAtMs: h.createdAt.getTime(),
      activeKcal: h.activeKcal,
      basalKcal: h.basalKcal,
      steps: h.steps,
    })),
  });
}

/** resolveDay(new Date()).nutritionPlan → sumPlanTargetMacros → null unless hasAnyMacros. Shared by page + tool. */
export async function getAdherenceTargets(): Promise<MacroTargets | null> {
  const today = await resolveDay(new Date());
  const target = sumPlanTargetMacros(today.nutritionPlan ?? null);
  if (!hasAnyMacros(target)) return null;
  return {
    calories: target.calories,
    proteinG: target.proteinG,
    carbsG: target.carbsG,
    fatG: target.fatG,
  };
}

export async function getTrendsPageData(opts: {
  rangeKey: "30d" | "90d" | "all";
  from?: Date | null;
  to?: Date | null;
}): Promise<TrendsPageData> {
  const db = await getDb(); // ⟵ TENANT — the only getDb() on the page path

  // Full-history grid up to today; the island slices client-side. Page points
  // are NEVER sampled — sampling would make the island's window aggregate
  // approximate (§10.D3); the 400-row cap applies only to the MCP `daily` output.
  // NOTE the grid deliberately starts at the first day with data (no `from`),
  // so points.length says how much HISTORY exists, not how long a requested
  // window is — the island's aggregateWindow calls carry the requested
  // WindowBounds (rangeStarts below) so denominators stay honest (QA C-2).
  const today = startOfDay(new Date());
  const points = await fetchDailyPoints(db, { to: today });
  const targets = await getAdherenceTargets();

  // Requested-window starts for the fixed range chips — see TrendsPageData.
  const rangeLabelFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: USER_TZ,
  });
  const rangeStart = (days: number) => {
    const d = addDays(today, -(days - 1));
    const key = dateKey(d);
    return { t: parseDateKey(key).getTime(), key, label: rangeLabelFmt.format(d) };
  };
  const rangeStarts = { "30d": rangeStart(30), "90d": rangeStart(90) };

  // initialWindow from valid ?from=&to=: clamp to the grid bounds and discard
  // (null) if empty after clamping.
  let initialWindow: { fromT: number; toT: number } | null = null;
  if (opts.from && opts.to && points.length > 0) {
    let fromT = parseDateKey(dateKey(opts.from)).getTime();
    let toT = parseDateKey(dateKey(opts.to)).getTime();
    if (fromT > toT) [fromT, toT] = [toT, fromT]; // defensive; the page already swaps
    const gridMin = points[0]!.t;
    const gridMax = points[points.length - 1]!.t;
    fromT = Math.max(fromT, gridMin);
    toT = Math.min(toT, gridMax);
    if (fromT <= toT) initialWindow = { fromT, toT };
  }

  return {
    points,
    targets,
    rangeKey: opts.rangeKey,
    initialWindow,
    shape: points.length === 0 ? "zero" : "populated",
    rangeStarts,
  };
}
