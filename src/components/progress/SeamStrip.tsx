// src/components/progress/SeamStrip.tsx
//
// The Seam Strip — the rolling-tracker record glyph (UXR-PROG-04, the page's
// only Tier-1 Card in the fold). ONE six-column time axis; the nested
// thresholds are encoded as COLUMN HEIGHT (a bottom-filled descending
// skyline), never as filled/hollow cells and never as three rows of dots.
//
// Binding decisions (ledger, 13 delegate-resolved rows are FINAL):
//  - R1 / UXR-PROG-05 ⚑: OLDEST-LEFT, newest-right — every time axis on the
//    page runs forward; the about-to-roll-off session sits in the past slot.
//  - R3 / UXR-PROG-06 ⚑: the threshold is TEXT ("3 of 6 · needs 4") — NO
//    geometric marker on the time axis (computeRollingHits counts hits
//    anywhere in the window; a positional rule would misstate it).
//  - R4 / UXR-PROG-07: the tally is a TALLY — never a bar (loses the cliff),
//    never a status word alone (renders 3 and 1 identically).
//  - R5/R6 / UXR-PROG-08/09/10: the roll-off bracket is an EXPLANATION, not a
//    countdown; its caption may never be truncated; never "(was 4)".
//  - UXR-PROG-69 ⚑ resolved: fill token is --accent (ReachMeter's segment
//    idiom rotated vertical inherits ReachMeter's emphasis token).
//  - UXR-PROG-71: the always-drawn baseline is a CONTRAST FIX — a hollow
//    outline in --border measures 1.59:1; absence on a drawn rule reads true.
//  - UXR-PROG-72/73: divs, not SVG; the ● ■ ▲ goal-identity triad is FORBIDDEN
//    in the slots (these are sessions within one goal, on a page of 3 goals).
//  - UXR-PROG-74: a11y DEVIATION, deliberate — an <ol> of <li>s with sr-only
//    spans, NOT role="img"/progressbar (progressbar implies monotonic advance;
//    this metric's defining property is that it goes down). The count/target
//    are REAL DOM TEXT, never aria-labels.
//  - UXR-PROG-66 ⚑ resolved: date labels ship the SAFE branch — text-[11px] +
//    .seam-date-label (muted light / foreground dark, .dwe-raw-cue precedent).
//  - UXR-PROG-13: ceremony is forbidden on ANY strip crossing, as a TYPE rule
//    — all tiers are window-inherent (F5: the gate un-crosses). Zero motion.
//
// Server component — no state, no handlers, no Recharts.

import { Card } from "@/components/Card";
import { GATE_FRAMING_LINE } from "@/lib/readiness-copy";
import { isRollingHitSession, type RollingSlot } from "@/lib/rolling-metrics";
import type { RollingParams } from "@/lib/metrics-registry";
import { USER_TZ } from "@/lib/calendar-core";

export type SeamStripTrack = {
  metricKey: string;
  /** GoalTarget.label — e.g. "≥10s hold — sessions hit, last 6". */
  label: string;
  gating: boolean;
  /** GoalTarget.target — the "needs N" count. */
  target: number;
  /** Hit-sessions in the trailing window; null = never attempted. */
  hits: number | null;
  params: RollingParams;
};

export type SeamStripProps = {
  goalId: string;
  /** Canonical exercise name — the session universe. */
  exercise: string;
  window: number;
  /** Newest-first (assembler order); rendered oldest-left. */
  slots: RollingSlot[];
  /** Shallowest → deepest (they nest; report F-B). */
  tracks: SeamStripTrack[];
  /** UXR-PROG-11 ⚑: ranged oldest-slot startedAt → asOf inclusive. */
  untimedSessionCount: number;
  /** R24 (UXR-PROG-79): retest weeks of the same exercise's baseline test,
   *  when derivable from the plan template. null omits the footer. */
  retestWeeks: number[] | null;
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

const FULL_H = 34; // ⚠[28–40] UXR-PROG-65
const STUB_H = 5; // ⚠[4–7]

export function SeamStrip({
  goalId,
  exercise,
  window: windowSize,
  slots,
  tracks,
  untimedSessionCount,
  retestWeeks,
}: SeamStripProps) {
  const slotsAsc = [...slots].reverse(); // oldest-left (R1)
  const windowFull = slots.length >= windowSize;
  const headingId = `seam-strip-h-${goalId}`;
  const anyGate = tracks.some((t) => t.gating);
  const oldest = slotsAsc[0] ?? null;

  /** Column rung = how many nested thresholds this session reached (a total
   *  order because the tiers nest — the grayscale acceptance test's channel). */
  const rungOf = (slot: RollingSlot): number =>
    tracks.filter((t) => isRollingHitSession(slot.attempts, t.params)).length;
  const heightOf = (rung: number): number =>
    rung === 0 ? STUB_H : Math.max(STUB_H, Math.round((FULL_H * rung) / Math.max(tracks.length, 1)));

  return (
    <Card data-testid={`seam-strip-${goalId}`} className="scroll-mt-16">
      <header className="mb-1">
        <h2 id={headingId} className="text-base font-semibold tracking-tight">
          {exercise} — repeatability
        </h2>
        <p className="text-xs text-[var(--muted)]">
          The {windowSize} most recent timed sessions.
        </p>
      </header>

      {/* ── The strip: <ol>, one <li> per slot, oldest-left ── */}
      <ol
        aria-labelledby={headingId}
        className="mt-3 flex items-end gap-2 list-none p-0"
        data-testid={`seam-strip-track-${goalId}`}
      >
        {Array.from({ length: windowSize }, (_, i) => {
          const slot = slotsAsc[i] ?? null;
          const rung = slot ? rungOf(slot) : null;
          return (
            <li
              key={slot?.id ?? `empty-${i}`}
              className="flex-1 min-w-0 max-w-[52px]"
              data-testid={slot ? `seam-slot-${goalId}-${slot.id}` : undefined}
            >
              {/* Column: always-drawn 2px baseline rule (contrast fix, UXR-PROG-71). */}
              <div
                aria-hidden="true"
                className="flex items-end border-b-2 border-[var(--muted)]"
                style={{ height: `${FULL_H + 2}px` }}
              >
                {slot && (
                  <div
                    data-rung={rung}
                    className="w-full bg-[var(--accent)] rounded-t-[2px]"
                    style={{ height: `${heightOf(rung!)}px` }}
                  />
                )}
              </div>
              {/* Date micro-label — SAFE branch (11px, theme-aware token). */}
              {slot && (
                <p aria-hidden="true" className="seam-date-label mt-0.5 text-[11px] tabular-nums text-center leading-tight">
                  {dateFmt.format(slot.startedAt)}
                </p>
              )}
              {/* Roll-off bracket under the OLDEST column (window full only). */}
              {windowFull && i === 0 && (
                <div
                  aria-hidden="true"
                  data-testid={`seam-rolloff-${goalId}`}
                  className="mt-0.5 h-[6px] border-l border-r border-b border-[var(--muted)]"
                />
              )}
              {/* SR narration per slot (aria-label on <li> is unreliable across AT). */}
              {slot && (
                <span className="sr-only">
                  {dateFmt.format(slot.startedAt)} — {slot.attempts.length} timed{" "}
                  {slot.attempts.length === 1 ? "attempt" : "attempts"}, {rung} of {tracks.length}{" "}
                  thresholds reached
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* The bracket's caption — a MECHANISM statement, never truncated,
          never a countdown (UXR-PROG-08/10; the roll-off is event-driven). */}
      {windowFull && oldest && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {dateFmt.format(oldest.startedAt)} is the oldest in the window. It leaves when the next
          timed session is logged.
        </p>
      )}

      {slots.length === 0 && (
        <p className="mt-2 text-sm font-medium" data-testid={`seam-empty-${goalId}`}>
          No timed {exercise} session logged yet.
        </p>
      )}

      {/* ── Tallies: real DOM text, tabular numerals, no bars, no markers ── */}
      <ul className="mt-3 space-y-1.5" data-testid={`seam-tallies-${goalId}`}>
        {tracks.map((t) => (
          <li
            key={t.metricKey}
            className="flex items-baseline gap-2 text-sm"
            data-testid={`seam-tally-${goalId}-${t.metricKey}`}
          >
            {t.gating && (
              <span className="inline-block shrink-0 rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] uppercase tracking-wide text-[var(--muted)]">
                gate
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{trackShortLabel(t)}</span>
            <span className="shrink-0 tabular-nums">
              <TallyText track={t} slotCount={slots.length} window={windowSize} windowFull={windowFull} />
            </span>
          </li>
        ))}
      </ul>

      {/* Untimed-session footnote — the invisible session, made visible (F3). */}
      {untimedSessionCount > 0 && (
        <p className="mt-2 text-xs text-[var(--muted)]" data-testid={`seam-untimed-note-${goalId}`}>
          {untimedSessionCount} {untimedSessionCount === 1 ? "session" : "sessions"} in this stretch
          logged no hold time — untimed sets aren&apos;t attempts.
        </p>
      )}

      {/* R24: the strip and the baseline disagree on purpose between retests. */}
      {retestWeeks !== null && retestWeeks.length > 0 && (
        <p className="mt-2 text-xs text-[var(--muted)]" data-testid={`seam-retest-note-${goalId}`}>
          Baselines re-test in {retestWeeksPhrase(retestWeeks)} — the strip moves in between.
        </p>
      )}

      {anyGate && <p className="mt-2 text-xs italic text-[var(--muted)]">{GATE_FRAMING_LINE}</p>}
    </Card>
  );
}

/** "≥10s hold — sessions hit, last 6" → "≥10s hold" (the tally carries the
 *  window arithmetic; repeating it in the label reads twice). Falls back to
 *  the full label when there is no em-dash segment. */
function trackShortLabel(t: SeamStripTrack): string {
  const cut = t.label.split(" — ")[0];
  return cut && cut.length > 0 ? cut : t.label;
}

function retestWeeksPhrase(weeks: number[]): string {
  const sorted = [...weeks].sort((a, b) => a - b);
  if (sorted.length === 1) return `week ${sorted[0]}`;
  if (sorted.length === 2) return `weeks ${sorted[0]} and ${sorted[1]}`;
  return `weeks ${sorted.slice(0, -1).join(", ")} and ${sorted.at(-1)}`;
}

/**
 * The tally states (report §4.4 — each is a distinct state, not one empty):
 *  never attempted  → "— of {window} · needs {target}"   (teach while free)
 *  window filling   → "{hits} of {slotCount} so far"      (UXR-TIA-49)
 *  full, below      → "{hits} of {window} · needs {target}"
 *  full, threshold  → "{hits} of {window} · HOLDING"      (--success word)
 *  full, gate clear → "{hits} of {window} · GATE CLEAR"   (--success word)
 * No delta, ever (R6). No color on regression — the words are the only
 * --success ink, so a grayscale screenshot loses nothing.
 */
function TallyText({
  track,
  slotCount,
  window: windowSize,
  windowFull,
}: {
  track: SeamStripTrack;
  slotCount: number;
  window: number;
  windowFull: boolean;
}) {
  if (track.hits === null) {
    return (
      <>
        — of {windowSize} <span className="text-[var(--muted)]">· needs {track.target}</span>
      </>
    );
  }
  if (!windowFull) {
    return (
      <>
        {track.hits} of {slotCount} <span className="text-[var(--muted)]">so far</span>
      </>
    );
  }
  const met = track.hits >= track.target;
  if (met) {
    return (
      <>
        {track.hits} of {windowSize}{" "}
        <span className="font-semibold text-[var(--success)]">
          · {track.gating ? "GATE CLEAR" : "HOLDING"}
        </span>
      </>
    );
  }
  return (
    <>
      {track.hits} of {windowSize}{" "}
      <span className="text-[var(--muted)]">· needs {track.target}</span>
    </>
  );
}
