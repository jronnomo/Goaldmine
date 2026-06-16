import Link from "next/link";
import { Card } from "@/components/Card";
import { MilestoneBurnDown } from "@/components/MilestoneBurnDown";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { ReadinessChart } from "@/components/ReadinessChart";
import { WeightChart } from "@/components/WeightChart";
import { RecordsSummary } from "@/components/RecordsSummary";
import { prisma } from "@/lib/db";
import type { GoalTarget } from "@/lib/goal-targets";
import { computeReadiness, computeReadinessSeries } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const [measurements, activeGoals] = await Promise.all([
    prisma.measurement.findMany({ orderBy: { date: "asc" }, take: 180 }),
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

  // REQ-006: identify the focus project goal for burn-down gating.
  // Derived from activeGoals (no extra query); null when fitness is focus.
  const focusProjectGoal = activeGoals.find((g) => g.isFocus && g.kind === "project") ?? null;

  // Build weight chart aria-label
  const weightAriaLabel =
    latest !== undefined && start !== undefined && delta !== null
      ? `Weight trend, latest ${latest} lb, ${delta < 0 ? "down" : delta > 0 ? "up" : "unchanged"} ${Math.abs(delta).toFixed(1)} from start`
      : latest !== undefined
        ? `Weight trend, latest ${latest} lb`
        : "Weight trend, no data";

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
      </header>

      {/* Share recap entry point */}
      <Link
        href="/recap"
        className="flex items-center gap-2 min-h-[44px] text-sm font-medium text-[var(--accent)] hover:opacity-80 transition-opacity"
      >
        <span>Share recap</span>
        <span aria-hidden>→</span>
      </Link>

      {/* Readiness by goal */}
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

      {readinessByGoal.map(({ goal, snapshot, series }) => {
        const latestScore = series.at(-1)?.score ?? snapshot?.score ?? null;
        const firstScore = series[0]?.score ?? null;
        const readinessAriaLabel =
          latestScore !== null && firstScore !== null && series.length > 1
            ? `Readiness trend for ${goal.objective}, latest score ${latestScore}/100, ${latestScore > firstScore ? "up" : latestScore < firstScore ? "down" : "unchanged"} from ${firstScore}`
            : latestScore !== null
              ? `Readiness for ${goal.objective}, score ${latestScore}/100`
              : `Readiness for ${goal.objective}, no data`;

        return (
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
                  <div aria-label={readinessAriaLabel}>
                    <ReadinessChart data={series} targetDate={goal.targetDate?.toISOString()} />
                  </div>
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
        );
      })}

      {/* REQ-006: milestone burn-down — only when a project goal is in focus.
          MilestoneBurnDown fetches its own data and self-gates when milestoneCount=0. */}
      {focusProjectGoal && (
        <MilestoneBurnDown goalId={focusProjectGoal.id} />
      )}

      {/* Weight card */}
      <Card title="Weight">
        {weights.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No weight logged yet — tap Log in the nav to record your first weigh-in.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <WeightStat label="Current" value={latest !== undefined ? `${latest} lb` : "—"} />
              <WeightStat label="Start" value={start !== undefined ? `${start} lb` : "—"} />
              <WeightStat
                label="Δ"
                value={
                  delta !== null
                    ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} lb`
                    : "—"
                }
              />
            </div>
            <div aria-label={weightAriaLabel}>
              <WeightChart data={weights} />
            </div>
          </>
        )}
      </Card>

      {/* Records summary */}
      <RecordsSummary />
    </div>
  );
}

function WeightStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] py-2 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
