// src/components/progress/BaselinesCard.tsx
//
// Manifest key 11 — G2 (UXR-PROG-51): Baselines promoted from a Tier-3 lid to
// an OPEN Tier-1 Card. Shipping the literal Pillar-1 deliverable closed would
// read as the brief being ignored.
//
// UXR-PROG-26: weight-desc sort with any BELOW-FLOOR maintenance row PINNED
// to position 1 — a state-dependent SORT (allowed), never a state-dependent
// defaultOpen (banned).
//
// The canary (maintenance) treatment — a CLIFF metric, by doctrine:
//   HOLDING {v}        --success eyebrow   (full credit at the floor)
//   BELOW FLOOR · {v}  --warning eyebrow   (zero below it)
// NEVER a progress bar, never an arrow, never --danger (UXR-PV-27/45).
//
// UXR-PROG-27: a negative retest reads as a READING, not a verdict — the
// dated prior beside it is the whole message; no ↓, no red. UXR-PROG-28:
// Baseline.notes renders ONLY on a negative delta (2-line clamp, the italic
// border idiom) — the only fatigue channel the schema has. UXR-PROG-29: no
// "conditions matched ✓" indicator — the schema cannot support one.
//
// Capped (UXR-PROG-30/31/32): channel 1 = the shipped ▲cap text (never
// inside a MarkLane); channel 2 = SeamLine's rule at the cap — a flat series
// ON a drawn ceiling reads as PINNED, not stalled. Capped applies to
// BASELINES ONLY.
//
// Server component.

import { Card } from "@/components/Card";
import { CappedMarker } from "@/components/CappedMarker";
import { OverflowList } from "@/components/OverflowList";
import { SeamLine } from "@/components/SeamLine";
import { USER_TZ } from "@/lib/calendar-core";

export type BaselineCardRow = {
  testName: string;
  units: string;
  latest: { value: number; date: Date; capped: boolean };
  earliest: { value: number; date: Date };
  count: number;
  /** Values asc by date — the SeamLine series. */
  history: number[];
  /** The cap value when latest.capped (channel 2's rule). */
  capValue: number | null;
  /** Max target weight across claiming goals — the sort key. 0 = unclaimed. */
  weight: number;
  /** start === target claims: the hold-the-line canary. */
  maintenance: { floor: number; holding: boolean } | null;
  /** Rendered ONLY when the latest delta is negative. */
  notes: string | null;
  sharedByGoals: number;
};

const RETEST_FRAMING_LINE =
  "Retests are readings, not verdicts. A low retest under fatigue is still the honest number.";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

const fmtVal = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1))));

/** UXR-PROG-26's ordering, exported pure for tests. */
export function orderBaselineRows(rows: readonly BaselineCardRow[]): BaselineCardRow[] {
  const pinned = rows.filter((r) => r.maintenance !== null && !r.maintenance.holding);
  const rest = rows.filter((r) => !pinned.includes(r));
  const byWeight = (a: BaselineCardRow, b: BaselineCardRow) =>
    b.weight - a.weight || a.testName.localeCompare(b.testName);
  return [...pinned.sort(byWeight), ...rest.sort(byWeight)];
}

export function BaselinesCard({
  rows,
  totalScheduled,
  headline = 4, // ⚠[3–5] UXR-PROG-68
}: {
  rows: BaselineCardRow[];
  /** Scheduled test count for the honest "N of M tested" line (measured
   *  count, never row count — the lid-digest rule applied to a subtitle). */
  totalScheduled: number | null;
  headline?: number;
}) {
  if (rows.length === 0) return null;
  const ordered = orderBaselineRows(rows);
  const belowFloor = ordered.filter((r) => r.maintenance !== null && !r.maintenance.holding).length;
  const subtitle = [
    totalScheduled !== null && totalScheduled > 0
      ? `${rows.length} of ${totalScheduled} tested`
      : `${rows.length} tested`,
    belowFloor > 0 ? `${belowFloor} below floor` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card data-testid="baseline-card" title="Baseline tests" className="scroll-mt-16">
      <p className="text-xs text-[var(--muted)] -mt-2 mb-2">{subtitle}</p>
      <OverflowList
        items={ordered}
        headline={headline}
        keyOf={(r) => r.testName}
        noun="tests"
        data-testid="overflow-list-tests"
        renderItem={(r) => <BaselineRow row={r} />}
      />
      <p className="mt-2 text-xs italic text-[var(--muted)]">{RETEST_FRAMING_LINE}</p>
    </Card>
  );
}

function BaselineRow({ row }: { row: BaselineCardRow }) {
  const delta = row.latest.value - row.earliest.value;
  const negative = row.count > 1 && delta < 0;

  if (row.maintenance) {
    const m = row.maintenance;
    return (
      <div className="py-2.5 border-b border-[var(--border)] last:border-b-0" data-testid={`baseline-row-${row.testName}`}>
        {/* Cliff metric: STATUS READOUT — never a bar (UXR-PV-27/45). */}
        <p
          className={`text-[11px] font-semibold uppercase tracking-wide ${
            m.holding ? "text-[var(--success)]" : "text-[var(--warning)]"
          }`}
          data-testid={`baseline-canary-${row.testName}`}
        >
          {m.holding ? `Holding ${fmtVal(row.latest.value)}` : `Below floor · ${fmtVal(row.latest.value)}`}
        </p>
        <p className="text-sm font-medium">{row.testName}</p>
        <p className="text-xs text-[var(--foreground)] tabular-nums">
          {fmtVal(row.latest.value)} {row.units} · {dateFmt.format(row.latest.date)}
          {!m.holding && (
            <span>
              {" "}· {fmtVal(m.floor)} {row.units} is the floor
            </span>
          )}
        </p>
        {row.sharedByGoals > 1 && (
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Shared by {row.sharedByGoals} goals
          </p>
        )}
        {negative && row.notes && <BaselineNotes testName={row.testName} notes={row.notes} />}
      </div>
    );
  }

  return (
    <div className="py-2.5 border-b border-[var(--border)] last:border-b-0" data-testid={`baseline-row-${row.testName}`}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{row.testName}</p>
        <p className="shrink-0 text-sm tabular-nums">
          {fmtVal(row.latest.value)} {row.units}
          {row.latest.capped && (
            <span data-testid={`baseline-capped-${row.testName}`}>
              <CappedMarker />
            </span>
          )}
        </p>
      </div>
      {/* The dated prior — reference-point framing: data, never a verdict.
          No arrow, no red, --foreground copy (UXR-PROG-27). */}
      <p className="text-xs text-[var(--foreground)] tabular-nums">
        {dateFmt.format(row.latest.date)}
        {row.count > 1 && (
          <span>
            {" "}· {fmtVal(row.earliest.value)} {row.units} on {dateFmt.format(row.earliest.date)}
          </span>
        )}
      </p>
      {row.history.length >= 2 && (
        <div className="mt-1">
          <SeamLine
            points={row.history}
            rule={row.capValue ?? undefined}
            ariaLabel={`${row.testName} trend, ${row.history.length} readings, latest ${fmtVal(row.latest.value)} ${row.units}${row.latest.capped ? ", capped by equipment ceiling" : ""}`}
            data-testid={`baseline-seamline-${row.testName}`}
          />
          {row.latest.capped && row.capValue !== null && (
            <p className="text-[11px] text-[var(--muted)]">
              Flat on a drawn ceiling reads pinned, not stalled.
            </p>
          )}
        </div>
      )}
      {negative && row.notes && <BaselineNotes testName={row.testName} notes={row.notes} />}
    </div>
  );
}

/** The only fatigue channel the schema has — shown on negative deltas only,
 *  2-line clamp ⚠[1–2], the ReadinessBreakdown italic-border idiom. */
function BaselineNotes({ testName, notes }: { testName: string; notes: string }) {
  return (
    <p
      className="mt-1 text-xs text-[var(--muted)] italic border-l-2 border-[var(--border)] pl-2 line-clamp-2"
      data-testid={`baseline-notes-${testName}`}
    >
      {notes}
    </p>
  );
}
