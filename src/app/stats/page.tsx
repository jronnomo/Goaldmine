import Link from "next/link";
import { Card } from "@/components/Card";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { ReadinessChart } from "@/components/ReadinessChart";
import { WeightChart } from "@/components/WeightChart";
import { prisma } from "@/lib/db";
import type { GoalTarget } from "@/lib/goal-targets";
import { computeReadiness, computeReadinessSeries } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const [measurements, baselineCount, workoutCount, hikeCount, activeGoals] = await Promise.all([
    prisma.measurement.findMany({ orderBy: { date: "asc" }, take: 180 }),
    prisma.baseline.count(),
    prisma.workout.count(),
    prisma.hike.count(),
    prisma.goal.findMany({
      where: { active: true },
      orderBy: [{ isFocus: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
    }),
  ]);

  const weights = measurements
    .filter((m) => m.weightLb !== null)
    .map((m) => ({ date: m.date.toISOString(), weight: m.weightLb! }));

  const latest = weights.at(-1)?.weight;
  const start = weights[0]?.weight;
  const delta = latest !== undefined && start !== undefined ? latest - start : null;

  const readinessByGoal = await Promise.all(
    activeGoals.map(async (g) => {
      const targets = (g.targets as unknown as GoalTarget[] | null) ?? [];
      if (targets.length === 0) {
        return { goal: g, snapshot: null, series: [] as { date: string; score: number }[] };
      }
      const [snapshot, series] = await Promise.all([
        computeReadiness(targets, new Date(), g.id),
        computeReadinessSeries(g.createdAt, targets, new Date(), g.id),
      ]);
      return {
        goal: g,
        snapshot,
        series: series.map((p) => ({ date: p.weekEnd.toISOString(), score: p.score })),
      };
    }),
  );

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
      </header>

      {readinessByGoal.length === 0 && (
        <Card title="Readiness">
          <p className="text-sm text-[var(--muted)]">
            No active goals yet.{" "}
            <Link href="/goals" className="text-[var(--accent)]">
              Add a goal
            </Link>{" "}
            with measurable targets to see a readiness graph here.
          </p>
        </Card>
      )}

      {readinessByGoal.map(({ goal, snapshot, series }) => (
        <Card
          key={goal.id}
          title={`Readiness: ${goal.objective}`}
          action={
            <Link href={`/goals/${goal.id}`} className="text-sm text-[var(--accent)]">
              Edit →
            </Link>
          }
        >
          {snapshot === null ? (
            <p className="text-sm text-[var(--muted)]">
              No targets set on this goal.{" "}
              <Link href={`/goals/${goal.id}`} className="text-[var(--accent)]">
                Add some
              </Link>
              .
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-4xl font-semibold tracking-tight">
                  {snapshot.score}
                  <span className="text-base text-[var(--muted)]">/100</span>
                </p>
                <p className="text-xs text-[var(--muted)] text-right">
                  {goal.targetDate ? `by ${new Date(goal.targetDate).toLocaleDateString()}` : "Someday goal"}
                  <br />
                  best-effort estimate
                </p>
              </div>
              {series.length > 1 ? (
                <ReadinessChart data={series} targetDate={goal.targetDate?.toISOString()} />
              ) : (
                <p className="text-xs text-[var(--muted)] mb-3">
                  Trend appears once you have at least two weeks of data.
                </p>
              )}
              <div className="mt-3">
                <ReadinessBreakdown breakdown={snapshot.breakdown} />
              </div>
              {snapshot.missing.length > 0 && (
                <p className="text-xs text-[var(--muted)] mt-2">
                  {snapshot.missing.length} target{snapshot.missing.length === 1 ? "" : "s"} have no data yet — log baselines / weight / hikes to fill them in.
                </p>
              )}
            </>
          )}
        </Card>
      ))}

      <Card title="Weight">
        {weights.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No weight logged yet — tap Log in the nav to record your first weigh-in.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <Stat label="Current" value={latest !== undefined ? `${latest} lb` : "—"} />
              <Stat label="Start" value={start !== undefined ? `${start} lb` : "—"} />
              <Stat
                label="Δ"
                value={
                  delta !== null
                    ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} lb`
                    : "—"
                }
              />
            </div>
            <WeightChart data={weights} />
          </>
        )}
      </Card>

      <Card title="Totals">
        <ul className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Workouts" value={workoutCount} />
          <Stat label="Baselines" value={baselineCount} />
          <Stat label="Hikes" value={hikeCount} />
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <li className="rounded-lg border border-[var(--border)] py-2 list-none">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </li>
  );
}
