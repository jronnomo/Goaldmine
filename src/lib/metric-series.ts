// src/lib/metric-series.ts
//
// Reusable server fn that turns a project goal's `log:` metric into a
// chart-ready time-series. Used by B1 (#147) and C1 (#149).
//
// Two distinct paths:
//   SNAPSHOT (!target.cumulative) — flat-maps every DB row; no same-day collapse.
//   CUMULATIVE (target.cumulative) — groups by USER_TZ day, sums within day,
//     then prefix-sums across days. Same-day SUM is required: log_metric
//     intentionally writes multiple same-day increment rows.
//
// Import from calendar-core (not calendar) to keep this module free of the
// server-only transitive deps that calendar.ts pulls in (prisma, program, …).

import { prisma } from "@/lib/db";
import { GoalTarget, METRIC_BY_ID } from "@/lib/metrics-registry";
import { USER_TZ, dateKey, parseDateKey } from "@/lib/calendar-core";

/** Format a Date as a short "Mon D" label in USER_TZ (e.g. "Jun 28"). */
function fmtUserTz(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: USER_TZ,
  }).format(date);
}

export async function getLogMetricSeries(
  target: GoalTarget,
  goalId: string,
): Promise<{
  points: { date: string; value: number; label: string }[];
  label: string;
  units: string;
  domain: [number, number];
}> {
  // Resolve display label/units from the curated registry; fall back to the
  // target's own fields for ad-hoc metrics (practice_hours, followers, …).
  const spec = METRIC_BY_ID.get(target.metric);
  const label = spec?.label ?? target.label;
  const units = spec?.units ?? target.units;

  // LogEntry.metric is stored bare ("mrr"), but GoalTarget.metric carries the
  // "log:" namespace prefix ("log:mrr"). Strip it before querying.
  const bareKey = target.metric.replace(/^log:/, "");

  const rows = await prisma.logEntry.findMany({
    where: { goalId, metric: bareKey, value: { not: null } },
    orderBy: { date: "asc" },
    select: { date: true, value: true },
  });

  // Empty series — return early with a sane domain anchored to target.
  if (rows.length === 0) {
    return {
      points: [],
      label,
      units,
      domain: [0, target.target > 0 ? target.target : 1],
    };
  }

  let points: { date: string; value: number; label: string }[];

  if (target.cumulative) {
    // ── CUMULATIVE path ──────────────────────────────────────────────────────
    // Step 1: group rows by their USER_TZ calendar day and SUM values within
    //   each day. log_metric writes one row per session/event; same-day rows
    //   are additive (e.g. two 1-hour practice sessions → 2 hours that day).
    const dayMap = new Map<string, number>();
    for (const r of rows) {
      const dk = dateKey(r.date);
      dayMap.set(dk, (dayMap.get(dk) ?? 0) + (r.value as number));
    }

    // Step 2: sort day keys asc. ISO yyyy-mm-dd strings sort lexicographically.
    const sortedDays = [...dayMap.keys()].sort();

    // Step 3: prefix-sum across days — each point carries the running total.
    let running = 0;
    points = sortedDays.map((dk) => {
      running += dayMap.get(dk)!;
      const d = parseDateKey(dk); // midnight in USER_TZ as a UTC instant
      return {
        date: d.toISOString(),
        value: running,
        label: fmtUserTz(d),
      };
    });
  } else {
    // ── SNAPSHOT path ────────────────────────────────────────────────────────
    // Flat-map every row — NO same-day collapse. This matches the live MRR
    // query in progress/page.tsx exactly so B1 can replace it without visual
    // change. Multiple same-day entries (e.g. two MRR snapshots logged in one
    // day) each produce their own point.
    points = rows.map((r) => ({
      date: r.date.toISOString(),
      value: r.value as number,
      label: fmtUserTz(r.date),
    }));
  }

  // ── Domain ──────────────────────────────────────────────────────────────────
  const values = points.map((p) => p.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  let domain: [number, number];

  if (target.cumulative) {
    // Cumulative always starts at 0 so the accumulation reads honestly.
    // When max is 0 (all-zero increments), anchor to target so the chart
    // isn't collapsed to a single point at the origin.
    domain =
      maxVal === 0
        ? [0, target.target > 0 ? target.target : 1]
        : [0, maxVal * 1.1];
  } else {
    // BodyMetricsSection padding pattern (BodyMetricsSection.tsx:56-71).
    // pad = 10 % of range, minimum 2 units so a single-point series has space.
    const range = maxVal - minVal;
    const pad = Math.max(range * 0.1, 2);
    const lo = minVal - pad;
    const hi = maxVal + pad;

    domain =
      units === "%"
        ? [Math.max(0, lo), Math.min(100, hi)]
        : [lo, hi];
  }

  return { points, label, units, domain };
}
