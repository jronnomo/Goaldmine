import Link from "next/link";
import { Card } from "@/components/Card";
import { HistoryChart } from "@/components/HistoryChart";
import { MilestoneBurnDown } from "@/components/MilestoneBurnDown";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { ReadinessChart } from "@/components/ReadinessChart";
import { WeightChart } from "@/components/WeightChart";
import { RecordsSummary } from "@/components/RecordsSummary";
import { BodyMetricsSection } from "@/components/BodyMetricsSection";
import { StatTile } from "@/components/StatTile";
import { ProgramReadinessSection } from "@/components/progress/ProgramReadinessSection";
import { getDb } from "@/lib/db";
import type { GoalTarget } from "@/lib/goal-targets";
import { getRotationOwnerGoal } from "@/lib/goal-focus";
import {
  getProgressProgramData,
  nonMemberGoals,
  resolveProgressPrimaryGoals,
} from "@/lib/progress-program";
import { computeReadiness, computeReadinessSeries } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  // #301: the page's single-goal gates (weight card, MRR, burn-down) key off
  // the ROTATION-OWNING goal under a Program; zero-Program tenants keep the
  // legacy focus-first query + derivations byte-identical (mode "legacy").
  const resolution = await getRotationOwnerGoal();

  const db = await getDb();
  const [measurements, activeGoals, baselineCount, workoutCount, hikeCount] = await Promise.all([
    db.measurement.findMany({ orderBy: { date: "asc" }, take: 180 }),
    db.goal.findMany({
      where: { active: true },
      // Program tenants: the deprecated focus key is dropped — the single-goal
      // picks below come from the rotation owner, and this list only orders
      // the legacy (non-member) readiness cards.
      orderBy:
        resolution.mode === "program"
          ? [{ targetDate: { sort: "asc", nulls: "last" } }]
          : [{ isFocus: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
    }),
    db.baseline.count(),
    db.workout.count({ where: { status: "completed" } }),
    db.hike.count(),
  ]);

  const weights = measurements
    .filter((m) => m.weightLb !== null)
    .map((m) => ({ date: m.date.toISOString(), weight: m.weightLb! }));

  const latest = weights.at(-1)?.weight;
  const start = weights[0]?.weight;
  const delta = latest !== undefined && start !== undefined ? latest - start : null;

  // #292: Program users get a dedicated member-goal section (live arcs via
  // the sampled series + frozen R9 arcs + per-metric window rows). Active
  // member goals move OUT of the legacy loop below; everything else — and the
  // ENTIRE zero-Program page (programData === null ⇒ nonMemberGoals returns
  // activeGoals untouched) — renders byte-identically to pre-#292.
  const programData = await getProgressProgramData();
  const legacyReadinessGoals = nonMemberGoals(
    activeGoals,
    programData ? programData.memberGoalIds : null,
  );

  const readinessByGoal = await Promise.all(
    legacyReadinessGoals.map(async (g) => {
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

  // #301 (was REQ-006): the burn-down / weight / MRR gates key off ONE goal —
  // the rotation owner under a Program (it renders exactly once on this page:
  // in ProgramReadinessSection, since nonMemberGoals excluded it from the
  // legacy loop above), the legacy focus derivations otherwise. See
  // resolveProgressPrimaryGoals for the full contract; derived from
  // activeGoals (no extra query).
  const { primaryGoal: focusGoal, primaryProjectGoal: focusProjectGoal } =
    resolveProgressPrimaryGoals(activeGoals, resolution);

  // Weight-card gate: only render when that goal tracks body weight (D-1, D-2).
  const focusTargets = (focusGoal?.targets as unknown as GoalTarget[] | null) ?? [];
  const hasWeightTarget = focusTargets.some((t) => t.metric === "weightLb");

  // MRR trend: only query + render when that goal has a "log:mrr" target (D-4).
  // NOTE: GoalTarget.metric = "log:mrr" (with prefix); LogEntry.metric = "mrr" (bare key).
  const hasMrrTarget = focusTargets.some((t) => t.metric === "log:mrr");
  const mrrPoints: { date: string; value: number; tooltip: string }[] =
    hasMrrTarget && focusGoal
      ? await db.logEntry
          .findMany({
            where: { goalId: focusGoal.id, metric: "mrr", value: { not: null } },
            orderBy: { date: "asc" },
            select: { date: true, value: true },
          })
          .then((rows) =>
            rows.map((r) => ({
              date: r.date.toISOString(),
              value: r.value!,
              tooltip: `$${r.value!.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
            })),
          )
      : [];

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
        aria-label="Share weekly recap — generate a card and Stories from your week"
        className="flex items-center justify-between gap-3 min-h-[64px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:opacity-90 transition-opacity"
      >
        <span className="flex items-center gap-3">
          <span aria-hidden className="text-xl">📤</span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold">Share weekly recap</span>
            <span className="text-xs text-[var(--muted)]">
              Generate a card &amp; Stories from your week
            </span>
          </span>
        </span>
        <span aria-hidden className="text-[var(--accent)]">→</span>
      </Link>

      {/* #292: Program member goals — live arcs + frozen R9 arcs + per-metric
          Program-window rows. Renders only for tenants with an active Program
          and member goals; zero-Program tenants skip straight to the loop
          below, byte-identical to pre-#292. */}
      {programData && <ProgramReadinessSection data={programData} />}

      {/* Readiness by goal */}
      {readinessByGoal.length === 0 && !programData && (
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
                {/* REQ-006: coverage + open-gate hint */}
                {snapshot.coverage.total > 0 && (
                  <p className="text-xs text-[var(--muted)] mb-2">
                    {snapshot.coverage.tested}/{snapshot.coverage.total} verified
                    {snapshot.openGateCount > 0
                      ? ` · ${snapshot.openGateCount} gate${snapshot.openGateCount === 1 ? "" : "s"} left`
                      : ""}
                  </p>
                )}
                {series.length > 1 ? (
                  <ReadinessChart
                    data={series}
                    targetDate={goal.targetDate?.toISOString()}
                    ariaLabel={readinessAriaLabel}
                  />
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

      {/* REQ-006/#301: milestone burn-down + MRR trend — only when the page's
          primary goal (rotation owner / legacy focus) is a project goal.
          MilestoneBurnDown self-gates when milestoneCount=0.
          MRR trend gates on hasMrrTarget; shows honest placeholder when no rows logged. */}
      {focusProjectGoal && (
        <>
          <MilestoneBurnDown goalId={focusProjectGoal.id} />
          {hasMrrTarget && (
            mrrPoints.length > 0 ? (
              <Card title="MRR Trend">
                <HistoryChart data={mrrPoints} units="$" ariaLabel="MRR trend chart" />
              </Card>
            ) : (
              <Card title="MRR Trend">
                <p className="text-sm text-[var(--muted)]">
                  No MRR logged yet — log MRR to see your trend.
                </p>
              </Card>
            )
          )}
        </>
      )}

      {/* Weight card — gate on the primary goal (rotation owner / legacy
          focus) having a weightLb target (D-3, #301). */}
      {hasWeightTarget && (
        <Card title="Weight">
          {weights.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No weight logged yet — tap Log in the nav to record your first weigh-in.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                <StatTile label="Current" value={latest !== undefined ? `${latest} lb` : "—"} />
                <StatTile label="Start" value={start !== undefined ? `${start} lb` : "—"} />
                <StatTile
                  label="Δ"
                  value={
                    delta !== null
                      ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} lb`
                      : "—"
                  }
                />
              </div>
              <WeightChart data={weights} ariaLabel={weightAriaLabel} />
            </>
          )}
        </Card>
      )}

      {/* Body metrics — ungated; shows regardless of goal targets (R-S5) */}
      <BodyMetricsSection />

      {/* Records summary */}
      <RecordsSummary />

      <Card title="Totals">
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Workouts" value={workoutCount} />
          <StatTile label="Baselines" value={baselineCount} />
          <StatTile label="Hikes" value={hikeCount} />
        </div>
      </Card>
    </div>
  );
}
