// src/components/program/MemberGoalCard.tsx
//
// One member-goal card on /program (#290, research §7.2 hierarchy). Zero
// client JS — the target breakdown expands via native <details>/<summary>.
//
// Honesty rules carried from the research (all binding):
//   - The headline numeral NEVER sits on a Bullseye (F2 / UXR-PV-22 —
//     progress={0.8} renders byte-identical to `filled`). Plain tabular type.
//   - The Bullseye stays canonical for the BINARY per-gate rows only
//     (size 14, filled — progressToRings never runs, UXR-PV-32).
//   - Gate copy shows rawScore; capped-by-gate reads as CAPPED, never a
//     mysterious plateau (UXR-PV-23 / three-state table in readiness-copy.ts).
//   - A goal with zero targets renders NO number at all — never a 0
//     (§8 zero-row states). Same for coverage.tested === 0: "Not measured
//     yet", because a 0 that means "unmeasured" must never render as a 0.
//   - One reading → "A trend needs two." — never a one-point line.
//
// Server component.

import Link from "next/link";
import { Card } from "@/components/Card";
import { Bullseye } from "@/components/Bullseye";
import { CeilingRule } from "@/components/CeilingRule";
import { SeamLine } from "@/components/SeamLine";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { gateCopyState, GATE_FRAMING_LINE } from "@/lib/readiness-copy";
import type { GoalIdentity } from "@/lib/goal-identity";
import type { ReadinessSnapshot } from "@/lib/readiness";
import { USER_TZ } from "@/lib/calendar-core";

export type MemberGoalCardGoal = {
  id: string;
  objective: string;
  kind: string;
  status: string;
  targetDate: Date | null;
};

const targetDateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

export function MemberGoalCard({
  identity,
  goal,
  snapshot,
  series,
}: {
  identity: GoalIdentity;
  goal: MemberGoalCardGoal;
  /** null ⇔ the goal has zero targets (renders the honest empty row). */
  snapshot: ReadinessSnapshot | null;
  /** Weekly readiness scores, domain-clamped to the Program window.
   *  null ⇔ not computed (zero targets, or nothing measured yet). */
  series: number[] | null;
}) {
  const metaBits: string[] = [];
  if (goal.targetDate) metaBits.push(targetDateFmt.format(goal.targetDate));
  else if (goal.kind === "project") metaBits.push("project");
  if (goal.status !== "active") metaBits.push(goal.status);

  return (
    <Card data-testid={`member-goal-card-${goal.id}`}>
      {/* Header: identity mark + objective (+ target date / status) */}
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-lg leading-none"
          style={{ color: identity.hue }}
        >
          {identity.glyphFilled}
        </span>
        <Link
          href={`/goals/${goal.id}`}
          className="min-w-0 flex-1 font-medium leading-snug hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
        >
          {goal.objective}
        </Link>
        {metaBits.length > 0 && (
          <span className="shrink-0 text-xs text-[var(--muted)]">{metaBits.join(" · ")}</span>
        )}
      </div>

      {snapshot === null ? (
        // Zero targets: honest empty row — no number at all, never a 0 (§8).
        <div className="mt-3" data-testid={`member-goal-empty-${goal.id}`}>
          <p className="text-sm font-medium">No measurable targets</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Ask your coach in Claude to add targets — readiness starts scoring once one exists.
          </p>
        </div>
      ) : snapshot.coverage.tested === 0 ? (
        // Targets exist but nothing has a reading: suppress the number
        // entirely — a 0 that means "unmeasured" must never render as a 0.
        <div className="mt-3" data-testid={`member-goal-unmeasured-${goal.id}`}>
          <p className="text-sm font-medium">Not measured yet</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            0 of {snapshot.coverage.total} targets have a reading. Log the first one and this
            starts moving.
          </p>
          <TargetsDetails goalId={goal.id} snapshot={snapshot} />
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {/* Headline numeral — plain type, never a Bullseye (F2). */}
          <p className="text-4xl font-semibold tabular-nums leading-none">
            {snapshot.score}
            <span className="text-base font-normal text-[var(--muted)]">/100</span>
          </p>

          <div>
            <CeilingRule
              score={snapshot.score}
              rawScore={snapshot.rawScore}
              ceiling={snapshot.ceiling}
              ariaLabel={`Readiness ${snapshot.score} of 100${
                snapshot.ceiling < 100 ? `, ceiling ${snapshot.ceiling} while gates are open` : ""
              }`}
              data-testid={`ceiling-rule-${goal.id}`}
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              {snapshot.coverage.tested} of {snapshot.coverage.total} targets measured · untested
              count as 0
            </p>
          </div>

          {snapshot.gates.length > 0 && <GateCopy goalId={goal.id} snapshot={snapshot} />}

          {/* Trend seam-line — decoration-tier, muted single stroke. */}
          {series !== null && series.length >= 2 ? (
            <div className="flex items-center gap-2">
              <SeamLine
                points={series}
                ariaLabel={`Readiness trend, ${series.length} readings, now ${snapshot.score} of 100`}
                data-testid={`seam-line-${goal.id}`}
              />
              <span className="text-xs tabular-nums text-[var(--muted)]">
                {seriesDeltaLabel(series)}
              </span>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">One reading so far. A trend needs two.</p>
          )}

          <TargetsDetails goalId={goal.id} snapshot={snapshot} />
        </div>
      )}
    </Card>
  );
}

function seriesDeltaLabel(series: number[]): string {
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const delta = last - first;
  if (delta === 0) return `flat since the start of the window`;
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} over ${series.length} readings`;
}

/**
 * Gate story: framing line once per card + the three-state copy + binary
 * per-gate rows (Bullseye size 14, filled — its true, binary meaning).
 */
function GateCopy({ goalId, snapshot }: { goalId: string; snapshot: ReadinessSnapshot }) {
  const copy = gateCopyState(snapshot);
  return (
    <div data-testid={`gate-copy-${goalId}`}>
      {copy.eyebrow && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
          {copy.eyebrow}
        </p>
      )}
      <p
        className={`text-sm ${copy.state === "clear" ? "text-[var(--success)]" : ""}`}
      >
        {copy.body}
      </p>
      <p className="mt-0.5 text-xs italic text-[var(--muted)]">{GATE_FRAMING_LINE}</p>
      <ul className="mt-2 space-y-1.5">
        {snapshot.gates.map((g) => (
          <li key={g.label} className="flex items-center gap-2 text-sm">
            <Bullseye size={14} filled={g.cleared} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{g.label}</span>
            <span className="shrink-0 text-xs text-[var(--muted)]">
              {g.cleared ? "cleared" : "open"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Expandable per-target breakdown — native details/summary, zero client JS. */
function TargetsDetails({ goalId, snapshot }: { goalId: string; snapshot: ReadinessSnapshot }) {
  return (
    <details className="mt-3 group" data-testid={`member-goal-targets-${goalId}`}>
      <summary className="cursor-pointer select-none py-1 text-sm font-medium text-[var(--muted)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
        Targets ({snapshot.coverage.total})
      </summary>
      <div className="mt-2">
        <ReadinessBreakdown breakdown={snapshot.breakdown} showGating />
      </div>
    </details>
  );
}
