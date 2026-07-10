// src/app/goals/[id]/metric/[key]/page.tsx
// C1 (#149) — per-metric detail page for project goals.
// Mirrors the baselines/exercise/[name] pattern: header + summary + chart + reverse-chron readings list.
// Guards: fitness goal, missing goal, or unknown metric key → notFound().

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { DeleteReadingButton } from "@/components/DeleteReadingButton";
import { HistoryChart } from "@/components/HistoryChart";
import { getDb } from "@/lib/db";
import { getLogMetricSeries } from "@/lib/metric-series";
import { USER_TZ } from "@/lib/calendar";
import type { GoalTarget } from "@/lib/metrics-registry";

export const dynamic = "force-dynamic";

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: USER_TZ,
  }).format(date);
}

export default async function MetricDetailPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  const { id, key } = await params;
  const metricKey = decodeURIComponent(key);

  const db = await getDb();
  const goal = await db.goal.findUnique({
    where: { id },
    select: { id: true, kind: true, objective: true, targets: true },
  });

  if (!goal) notFound();
  if (goal.kind !== "project") notFound();

  const target = ((goal.targets as unknown as GoalTarget[]) ?? []).find(
    (t) => t.metric === "log:" + metricKey,
  );
  if (!target) notFound();

  const [series, readings] = await Promise.all([
    getLogMetricSeries(target, id),
    db.logEntry.findMany({
      where: { goalId: id, metric: metricKey },
      orderBy: { date: "desc" },
      select: { id: true, date: true, value: true, text: true },
    }),
  ]);

  // Latest reading for summary line (readings is desc-ordered, so index 0 is most recent).
  const latest = readings.find((r) => r.value != null);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href={`/goals/${id}/trends`} className="text-sm text-[var(--accent)]">
          ← Trends
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{series.label}</h1>
        <p className="text-sm text-[var(--muted)]">
          {latest?.value != null
            ? `${latest.value}${series.units ? " " + series.units : ""} / ${target.target}${series.units ? " " + series.units : ""}`
            : `Target: ${target.target}${series.units ? " " + series.units : ""}`}
        </p>
      </header>

      <Card title={series.label}>
        {series.points.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No readings yet.</p>
        ) : (
          <HistoryChart
            data={series.points}
            units={series.units}
            domain={series.domain}
            ariaLabel={`${series.label} trend chart`}
          />
        )}
      </Card>

      <Card title="Readings">
        {readings.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No readings yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {readings.map((r) => (
              <li key={r.id} className="py-2 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  {r.value != null && (
                    <p className="font-mono text-sm">
                      {r.value}
                      {series.units ? " " + series.units : ""}
                    </p>
                  )}
                  {r.text && (
                    <p className="text-xs text-[var(--muted)] truncate">{r.text}</p>
                  )}
                </div>
                <div className="flex items-baseline gap-1 shrink-0">
                  <p className="text-xs text-[var(--muted)]">{fmtDate(r.date)}</p>
                  <DeleteReadingButton goalId={id} metric={metricKey} entryId={r.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
