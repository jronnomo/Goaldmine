// src/components/progress/GoalStrip.tsx
//
// ONE readiness grammar for /progress (UXR-PROG-22 — collapses LiveMemberCard,
// the legacy inline loop, and the two-grammar A30 failure into a single
// Tier-2 strip; /program's MemberGoalCard already carries the same grammar
// with a Card-sized body). Member goals and legacy zero-Program goals render
// through THIS component with the same model — nonMemberGoals() keeps
// deciding WHICH goals, never HOW they look.
//
// Anatomy (mockup C-1 [3][4][5], C-2, C-3):
//   mark · objective ─ SeamLine trend ─ score numeral (R11 tabular numeral)
//   CeilingRule (stile + hatch while capped — A3/A27 fixed here)
//   gateCopyState body line (readiness-copy.ts three-state table)
//   zero-state branches — FOUR of them (R23 adds the fourth):
//     snapshot null            → "No measurable targets"      (no number)
//     coverage.tested === 0    → "Not measured yet"           (no number)
//     tested > 0 && raw === 0  → numeral 0 + the two-part line (UXR-PROG-24 ★)
//     otherwise                → numeral + rule + copy
//   measured-score caption (UXR-PV-25) when untested targets drag the score.
//   Frozen (achieved) members: muted numeral + FROZEN eyebrow + muted
//   SeamLine — stroke-only, never dashed, never recomputed (R9).
//
// Dates: USER_TZ formatter — never toLocaleDateString on the server (A9/A82).
// Server component; zero Recharts (SeamLine is the trend — R21/day-1-zero).

import Link from "next/link";
import { CeilingRule } from "@/components/CeilingRule";
import { SeamLine } from "@/components/SeamLine";
import { gateCopyState } from "@/lib/readiness-copy";
import type { GoalIdentity } from "@/lib/goal-identity";
import type { ReadinessSnapshot } from "@/lib/readiness";
import { parseDateKey, USER_TZ } from "@/lib/calendar-core";

export type GoalStripModel = {
  goal: {
    id: string;
    objective: string;
    kind: string;
    status: string;
    targetDate: Date | null;
  };
  mode: "live" | "frozen";
  /** null ⇔ zero targets. */
  snapshot: ReadinessSnapshot | null;
  /** Weekly readiness scores (as-of table cursors). null/short → text hint. */
  series: number[] | null;
  /** Frozen branch only — the completionSnapshot score + date key. */
  frozenScore: number | null;
  frozenAsOfKey: string | null;
  /** Σ(w·p)/Σ(w) over TESTED targets only (UXR-PV-25); null when untested. */
  measuredScore: number | null;
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

export function GoalStrip({
  identity,
  model,
  "data-testid": testId,
}: {
  identity: GoalIdentity | null;
  model: GoalStripModel;
  "data-testid"?: string;
}) {
  const { goal, snapshot } = model;

  return (
    <section
      data-testid={testId ?? `goal-strip-${goal.id}`}
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm scroll-mt-16"
    >
      {/* Header row: identity mark + objective + numeral (R11). */}
      <div className="flex items-center gap-2.5">
        {identity && identity.shape !== null && (
          <span
            aria-hidden="true"
            className="shrink-0 text-base leading-none"
            style={{ color: identity.hue }}
          >
            {identity.glyphFilled}
          </span>
        )}
        <Link
          href={`/goals/${goal.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
        >
          {goal.objective}
        </Link>
        <HeaderNumeral model={model} />
      </div>

      {model.mode === "frozen" ? (
        <FrozenBody model={model} />
      ) : snapshot === null ? (
        <div className="mt-2" data-testid={`goal-strip-empty-${goal.id}`}>
          <p className="text-sm font-medium">No measurable targets</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Ask your coach in Claude to add targets — readiness starts scoring once one exists.
          </p>
        </div>
      ) : snapshot.coverage.tested === 0 ? (
        // A 0 that means unmeasured must never render as a 0.
        <div className="mt-2" data-testid={`goal-strip-unmeasured-${goal.id}`}>
          <p className="text-sm font-medium">Not measured yet</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            0 of {snapshot.coverage.total} targets have a reading. Log the first one and this
            moves.
          </p>
        </div>
      ) : (
        <LiveBody model={model} snapshot={snapshot} />
      )}
    </section>
  );
}

/** The R11 numeral: renders ONLY when a real number exists (the carve-out —
 *  a documented zero-state strip has no number and no invented 0). */
function HeaderNumeral({ model }: { model: GoalStripModel }) {
  if (model.mode === "frozen") {
    return model.frozenScore !== null ? (
      <span className="shrink-0 text-lg font-semibold tabular-nums text-[var(--muted)]">
        {model.frozenScore}
        <span className="text-xs font-normal">/100</span>
      </span>
    ) : null;
  }
  const snap = model.snapshot;
  if (snap === null || snap.coverage.tested === 0) return null;
  return (
    <span className="shrink-0 text-lg font-semibold tabular-nums">
      {snap.score}
      <span className="text-xs font-normal text-[var(--muted)]">/100</span>
    </span>
  );
}

function LiveBody({ model, snapshot }: { model: GoalStripModel; snapshot: ReadinessSnapshot }) {
  const { goal } = model;
  const copy = snapshot.gates.length > 0 ? gateCopyState(snapshot) : null;
  const series = model.series;
  const zeroButTested = snapshot.rawScore === 0; // R23 / UXR-PROG-24 ★

  return (
    <div className="mt-2 space-y-1.5">
      <CeilingRule
        score={snapshot.score}
        rawScore={snapshot.rawScore}
        ceiling={snapshot.ceiling}
        ariaLabel={`Readiness ${snapshot.score} of 100${
          snapshot.ceiling < 100 ? `, ceiling ${snapshot.ceiling} while gates are open` : ""
        }`}
        data-testid={`ceiling-rule-${goal.id}`}
      />

      {copy && (
        <div data-testid={`gate-copy-${goal.id}`}>
          {copy.eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              {copy.eyebrow}
            </p>
          )}
          <p className={`text-xs ${copy.state === "clear" ? "text-[var(--success)]" : "text-[var(--muted)]"}`}>
            {copy.body}
          </p>
        </div>
      )}

      {zeroButTested ? (
        // ★ The fourth zero-state branch (audit A29): the numeral IS real —
        // render it (above) plus the two-part explanation. Never a bare 0/100.
        <p className="text-xs text-[var(--muted)]" data-testid={`zero-tested-${goal.id}`}>
          {snapshot.coverage.tested} of {snapshot.coverage.total} targets have a reading; neither
          has moved off its start yet.
        </p>
      ) : (
        <MeasuredCaption model={model} snapshot={snapshot} />
      )}

      <div className="flex items-center justify-between gap-2">
        {series !== null && series.length >= 2 ? (
          <SeamLine
            points={series}
            ariaLabel={`Readiness trend for ${goal.objective}, ${series.length} readings, now ${snapshot.score} of 100`}
            data-testid={`goal-strip-trend-${goal.id}`}
          />
        ) : (
          <p className="text-xs text-[var(--muted)]">One reading so far. A trend needs two.</p>
        )}
        {goal.targetDate && (
          <span className="shrink-0 text-xs text-[var(--muted)]">
            by {dateFmt.format(goal.targetDate)}
          </span>
        )}
      </div>
    </div>
  );
}

/** UXR-PV-25: when untested targets drag the composite, show both numbers.
 *  "Measured score 52 · 28 counting untested targets as 0." */
function MeasuredCaption({ model, snapshot }: { model: GoalStripModel; snapshot: ReadinessSnapshot }) {
  if (
    model.measuredScore === null ||
    snapshot.coverage.tested >= snapshot.coverage.total ||
    model.measuredScore === snapshot.rawScore
  ) {
    return null;
  }
  return (
    <p className="text-xs text-[var(--muted)]" data-testid={`measured-score-${model.goal.id}`}>
      Measured score {model.measuredScore} · {snapshot.rawScore} counting untested targets as 0.
    </p>
  );
}

function FrozenBody({ model }: { model: GoalStripModel }) {
  const series = model.series;
  return (
    <div className="mt-2 space-y-1.5" data-testid={`goal-strip-frozen-${model.goal.id}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Frozen{model.frozenAsOfKey ? ` · ${fmtDateKeySafe(model.frozenAsOfKey)}` : ""}
      </p>
      {series !== null && series.length >= 2 && (
        // R9: stroke-only muted, never dashed, never recomputed.
        <SeamLine
          points={series}
          ariaLabel={`Frozen readiness arc for ${model.goal.objective}, completed at ${model.frozenScore ?? "unknown"} of 100`}
          data-testid={`goal-strip-frozen-trend-${model.goal.id}`}
        />
      )}
      <p className="text-xs text-[var(--muted)]">
        Readiness story frozen at completion, never recomputed.
      </p>
    </div>
  );
}

/** dateKey → "Aug 8" in USER_TZ — ONE format on the frozen strip (fixes A8's
 *  two-formats-24px-apart). Tolerates non-dateKey strings by echoing them. */
function fmtDateKeySafe(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  return dateFmt.format(parseDateKey(key));
}
