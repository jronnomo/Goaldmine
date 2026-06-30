// src/components/ProjectTrendsView.tsx
// Server component — no "use client".
// Per-metric trend charts + milestone timeline for project goals (B1 #147).

import Link from "next/link";
import { Card } from "@/components/Card";
import { HistoryChart } from "@/components/HistoryChart";
import type { GoalTarget } from "@/lib/metrics-registry";
import { USER_TZ } from "@/lib/calendar-core";
import { partitionMilestones, type MilestoneRow } from "@/lib/milestone-partition";

type SeriesData = {
  points: { date: string; value: number; label: string }[];
  label: string;
  units: string;
  domain: [number, number];
};

function fmtUserTz(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: USER_TZ,
  }).format(date);
}

export function ProjectTrendsView({
  objective,
  goalId,
  targets,
  series,
  milestones,
}: {
  objective: string;
  goalId: string;
  targets: GoalTarget[];
  series: SeriesData[];
  milestones: MilestoneRow[];
}) {
  const { completed, upcoming } = partitionMilestones(milestones);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href={`/goals/${goalId}`} className="text-sm text-[var(--accent)]">
          ← {objective}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Trends</h1>
      </header>

      {/* ── Metric charts ─────────────────────────────────────────────────────── */}
      {targets.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">This goal has no tracked metrics yet.</p>
        </Card>
      ) : (
        targets.map((t, i) => {
          const s = series[i]!;
          const bareKey = t.metric.replace(/^log:/, "");
          return (
            <Card
              key={t.metric}
              title={s.label}
              action={
                <Link
                  href={`/goals/${goalId}/metric/${bareKey}`}
                  className="text-xs text-[var(--accent)]"
                >
                  View all →
                </Link>
              }
            >
              {s.points.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  No {s.label} logged yet — log one to see the trend.
                </p>
              ) : (
                <HistoryChart data={s.points} units={s.units} domain={s.domain} />
              )}
            </Card>
          );
        })
      )}

      {/* ── Milestone timeline ────────────────────────────────────────────────── */}
      {milestones.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Milestones</h2>

          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Upcoming</p>
              {upcoming.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
                >
                  <span className="text-sm min-w-0 truncate">{m.title}</span>
                  <span className="text-xs text-[var(--muted)] shrink-0">
                    {fmtUserTz(m.date)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {completed.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Completed</p>
              {completed.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[var(--success)] shrink-0 text-base">●</span>
                    <span className="text-sm text-[var(--muted)] min-w-0 truncate">
                      {m.title}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--muted)] shrink-0">
                    {fmtUserTz(m.completedAt ?? m.date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
