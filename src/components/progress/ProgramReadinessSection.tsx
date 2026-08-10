// src/components/progress/ProgramReadinessSection.tsx
// Server component (no "use client") — the /progress Program extension
// (#292, program-views.md §7.4). Chart rendering stays in the client leaves
// (ReadinessChart, MetricWindowChart); everything here is plain markup over
// pre-assembled ProgressProgramData.
//
// Grammar notes (binding research):
//  · Shared metric = ONE series + one ReferenceLine per claiming goal under a
//    "SHARED BY N GOALS" eyebrow with goal-chipped meanings below (UXR-PV-44).
//  · Cliff/maintenance targets get a status readout (HOLDING / BELOW FLOOR),
//    never a progress bar (UXR-PV-27/45).
//  · Frozen (R9) arcs: muted stroke-only, never dashed, "FROZEN · <date>"
//    eyebrow, filled Bullseye doing the "this one was hit" work (UXR-PV-47).
//  · Two-metric overlay defaults to small multiples — stacked panels, one per
//    metric (UXR-PV-46).

import Link from "next/link";
import { Bullseye } from "@/components/Bullseye";
import { Card } from "@/components/Card";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { ReadinessChart } from "@/components/ReadinessChart";
import { MetricWindowChart } from "@/components/progress/MetricWindowChart";
import { readinessSeriesHint } from "@/lib/goal-assay-core";
import { parseDateKey, USER_TZ } from "@/lib/calendar-core";
import type {
  MemberGoalArc,
  MetricClaim,
  ProgramMetricRow,
  ProgressProgramData,
} from "@/lib/progress-program";

/** dateKey → "Aug 8" in USER_TZ (metric-series.ts fmtUserTz idiom — a naive
 *  new Date("yyyy-mm-dd") parse would shift a day off-UTC). */
function fmtDateKey(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: USER_TZ,
  }).format(parseDateKey(key));
}

/** "155 → 149.2" style value formatting — one decimal only when non-integral. */
function fmtValue(v: number | null): string {
  if (v === null) return "—";
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));
}

const EYEBROW_CLASS =
  "text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]";

// ── Member goal arc cards ────────────────────────────────────────────────────

function LiveMemberCard({ arc }: { arc: MemberGoalArc }) {
  const { goal } = arc;
  const latestScore = arc.series.at(-1)?.score ?? arc.score ?? null;
  const firstScore = arc.series[0]?.score ?? null;
  const ariaLabel =
    latestScore !== null && firstScore !== null && arc.series.length > 1
      ? `Readiness trend for ${goal.objective}, latest score ${latestScore}/100, ${latestScore > firstScore ? "up" : latestScore < firstScore ? "down" : "unchanged"} from ${firstScore}`
      : latestScore !== null
        ? `Readiness for ${goal.objective}, score ${latestScore}/100`
        : `Readiness for ${goal.objective}, no data`;

  return (
    <Card
      data-testid={`member-goal-progress-${goal.id}`}
      title={`Readiness: ${goal.objective}`}
      action={
        <Link href={`/goals/${goal.id}`} className="text-sm text-[var(--accent)]">
          Edit →
        </Link>
      }
    >
      {arc.score === null ? (
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
              {arc.score}
              <span className="text-base text-[var(--muted)]">/100</span>
            </p>
            <p className="text-xs text-[var(--muted)] text-right">
              {goal.targetDate
                ? `by ${new Date(goal.targetDate).toLocaleDateString()}`
                : "Someday goal"}
              <br />
              best-effort estimate
            </p>
          </div>
          {arc.coverage && arc.coverage.total > 0 && (
            <p className="text-xs text-[var(--muted)] mb-2">
              {arc.coverage.tested}/{arc.coverage.total} verified
              {(arc.openGateCount ?? 0) > 0
                ? ` · ${arc.openGateCount} gate${arc.openGateCount === 1 ? "" : "s"} left`
                : ""}
            </p>
          )}
          {arc.series.length > 1 ? (
            <ReadinessChart data={arc.series} targetDate={goal.targetDate ?? undefined} ariaLabel={ariaLabel} />
          ) : (
            <p className="text-xs text-[var(--muted)] mb-3">
              Trend appears once you have at least two weeks of data.
            </p>
          )}
          <div className="mt-3">
            <ReadinessBreakdown breakdown={arc.breakdown} />
          </div>
          {arc.missingCount > 0 && (
            <p className="text-xs text-[var(--muted)] mt-2">
              {arc.missingCount} target{arc.missingCount === 1 ? "" : "s"} have no
              data yet — log baselines / weight / hikes to fill them in.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function FrozenMemberCard({ arc }: { arc: MemberGoalArc }) {
  const { goal } = arc;
  return (
    <Card
      data-testid={`member-goal-progress-${goal.id}`}
      title={`Readiness: ${goal.objective}`}
      action={
        <Link href={`/goals/${goal.id}`} className="text-sm text-[var(--accent)]">
          View →
        </Link>
      }
    >
      <div className="flex items-center gap-2 mb-2">
        <Bullseye size={14} filled aria-label="Completed goal" />
        <p className={EYEBROW_CLASS}>
          Frozen{arc.frozenAsOf ? ` · ${arc.frozenAsOf}` : ""}
        </p>
      </div>
      {arc.score !== null && (
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-4xl font-semibold tracking-tight text-[var(--muted)]">
            {arc.score}
            <span className="text-base">/100</span>
          </p>
          <p className="text-xs text-[var(--muted)] text-right">at completion</p>
        </div>
      )}
      {arc.series.length > 1 ? (
        <ReadinessChart
          data={arc.series}
          frozen
          ariaLabel={`Frozen readiness arc for ${goal.objective}, completed at ${arc.score ?? "unknown"}/100`}
        />
      ) : (
        <p className="text-sm text-[var(--muted)]">
          {readinessSeriesHint(arc.targetsTotal)}
        </p>
      )}
      <p className="text-xs text-[var(--muted)] mt-2">
        Completed{arc.frozenAsOf ? ` ${fmtDateKey(arc.frozenAsOf)}` : ""} — readiness
        story frozen at completion, never recomputed.
      </p>
    </Card>
  );
}

// ── Per-metric rows ──────────────────────────────────────────────────────────

function claimStatus(c: MetricClaim): { text: string; tone: "success" | "warning" | "muted" } {
  if (c.current === null) return { text: "NOT TESTED", tone: "muted" };
  const holding =
    c.direction === "decrease" ? c.current <= c.target : c.current >= c.target;
  return holding
    ? { text: `HOLDING ${fmtValue(c.current)}`, tone: "success" }
    : { text: `BELOW FLOOR · ${fmtValue(c.current)}`, tone: "warning" };
}

function ClaimRow({
  claim,
  metricKey,
  units,
}: {
  claim: MetricClaim;
  metricKey: string;
  units: string;
}) {
  return (
    <div data-testid={`metric-row-${claim.goalId}-${metricKey}`} className="py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium max-w-[16ch] truncate">
          {claim.objective}
        </span>
        <span className="ml-auto text-xs text-[var(--muted)] shrink-0">
          Worth {Math.round(claim.weight * 100)} of 100
        </span>
      </div>
      {claim.maintenance ? (
        // Cliff metric: status readout, never a progress bar (UXR-PV-27/45).
        <>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Maintenance — hold {fmtValue(claim.target)} {units}.{" "}
            {fmtValue(claim.target)} = full credit, below = zero. Pass/fail by
            design.
          </p>
          {(() => {
            const s = claimStatus(claim);
            return (
              <p
                className={`mt-1 text-xs font-semibold tabular-nums ${
                  s.tone === "success"
                    ? "text-[var(--success)]"
                    : s.tone === "warning"
                      ? "text-[var(--warning)]"
                      : "text-[var(--muted)]"
                }`}
              >
                {s.text}
              </p>
            );
          })()}
        </>
      ) : (
        <p className="mt-1 text-sm tabular-nums">
          {fmtValue(claim.start)} → {fmtValue(claim.current)} /{" "}
          {fmtValue(claim.target)} {units}
          {claim.gating && (
            <span className="ml-1.5 text-xs text-[var(--muted)]">· gate</span>
          )}
        </p>
      )}
    </div>
  );
}

function MetricCard({
  row,
  windowStartKey,
  windowEndKey,
}: {
  row: ProgramMetricRow;
  windowStartKey: string;
  windowEndKey: string;
}) {
  const shared = row.claims.length > 1;
  const chartAria = `${row.label} over the program window, ${
    row.points?.length ?? 0
  } points, target line${row.targetLines.length === 1 ? "" : "s"} at ${row.targetLines
    .map((t) => `${t.value} (${t.label})`)
    .join(", ")}`;

  return (
    <Card data-testid={`metric-card-${row.metricKey}`} title={row.label}>
      {shared && (
        <p
          data-testid={`metric-shared-eyebrow-${row.metricKey}`}
          className={`${EYEBROW_CLASS} mb-2`}
        >
          Shared by {row.claims.length} goals
        </p>
      )}
      {row.points === null ? (
        <p className="text-xs text-[var(--muted)]">
          No history chart for this metric yet — current standing below.
        </p>
      ) : row.points.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No readings in this program window yet.
        </p>
      ) : row.points.length === 1 ? (
        <p className="text-sm text-[var(--muted)]">
          One reading so far. A trend needs two.
        </p>
      ) : (
        <MetricWindowChart
          data-testid={`metric-chart-${row.metricKey}`}
          points={row.points}
          units={row.units}
          targetLines={row.targetLines}
          shared={shared}
          ariaLabel={chartAria}
        />
      )}
      <div className="mt-3 divide-y divide-[var(--border)]">
        {row.claims.map((c) => (
          <ClaimRow key={c.goalId} claim={c} metricKey={row.metricKey} units={row.units} />
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Program window · {fmtDateKey(windowStartKey)} → {fmtDateKey(windowEndKey)} ·
        not scored
      </p>
    </Card>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function ProgramReadinessSection({ data }: { data: ProgressProgramData }) {
  return (
    <section data-testid="program-readiness-section" className="space-y-4">
      <p className={EYEBROW_CLASS}>
        Program · {data.program.name} · {fmtDateKey(data.program.startedOnKey)} →{" "}
        {data.program.endsOnKey ? fmtDateKey(data.program.endsOnKey) : "today"}
      </p>

      {data.arcs.map((arc) =>
        arc.mode === "frozen" ? (
          <FrozenMemberCard key={arc.goal.id} arc={arc} />
        ) : (
          <LiveMemberCard key={arc.goal.id} arc={arc} />
        ),
      )}

      {data.metrics.length > 0 && (
        <>
          <p className={EYEBROW_CLASS}>Metrics · program window</p>
          {data.metrics.map((row) => (
            <MetricCard
              key={row.metricKey}
              row={row}
              windowStartKey={data.program.startedOnKey}
              windowEndKey={data.program.windowEndKey}
            />
          ))}
        </>
      )}
    </section>
  );
}
