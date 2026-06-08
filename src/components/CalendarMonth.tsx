"use client";

// Month calendar — a glanceable icon grid plus a detail panel.
//
// The grid stays compact (square cells, day number + a row of the goal's
// legend icons). It is NOT where you read workout detail — tapping a day
// SELECTS it and the panel below shows the full, readable detail (workout
// name, marker labels, link to the day page). Today is selected by default.
// This split keeps the grid uncluttered on narrow phones (~48px cells) while
// the cells still carry the goal's own custom legend icons, not generic dots.
//
// Track 2 additions:
//   - 6-week rows with WeekRail (spine + confidence cap) in a 16px left gutter
//   - DayCell provisional opacity + dashed top hairline (REQ-006)
//   - DayCell conflict corner wedge (REQ-006, D-2 colorblind-safe redundancy)
//   - bullseye-pop flip on newly-confirmed weeks via localStorage gate (REQ-007)

import { useState, useEffect } from "react";
import Link from "next/link";
import { MarkerIcon } from "@/components/MarkerIcon";
import { WeekRail } from "@/components/WeekRail";
import type { CalendarDayCell } from "@/lib/calendar";
import { findLegendEntry, type LegendEntry, type LegendKind } from "@/lib/legend";

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Marker = { entry: LegendEntry; count: number };

// Resolve which markers a day shows. A kind absent from the goal's legend is
// suppressed — a cell only ever shows what the legend can explain.
function markersFor(
  cell: CalendarDayCell,
  legend: readonly LegendEntry[],
): Marker[] {
  const out: Marker[] = [];
  const isOutdoor = cell.hikeCount > 0;
  const isPlannedOutdoor =
    !isOutdoor && cell.plannedHikeCount > 0 && !cell.isPast;
  // A logged hike counts as a completed training day too.
  const isCompleted = cell.workoutCount > 0 || cell.hikeCount > 0;

  const push = (kind: LegendKind, count: number) => {
    const entry = findLegendEntry(legend, kind);
    if (entry) out.push({ entry, count });
  };

  if (isCompleted) push("trained", 1);
  if (isOutdoor) push("hike-completed", cell.hikeCount);
  if (isPlannedOutdoor) push("hike-planned", cell.plannedHikeCount);
  if (cell.hasOverride) push("override", 1);
  if (cell.baselinesDue > 0) push("baseline", cell.baselinesDue);
  if (cell.isGoalDate) push("goal-date", 1);
  return out;
}

export function CalendarMonth({
  cells,
  monthKey,
  legend,
  confirmedThroughDate,
}: {
  cells: CalendarDayCell[];
  monthKey: string; // "yyyy-mm" of the displayed month
  legend: readonly LegendEntry[];
  confirmedThroughDate?: Date | null; // Track 2: from calendar/page.tsx via program
}) {
  // Compare via the tz-stable dateKey string, not Date.getMonth() — the latter
  // is shifted by the client's timezone and can misclassify boundary days
  // (which made the default selection fall through to the first grid cell).
  const inMonth = (c: CalendarDayCell) => c.dateKey.startsWith(monthKey);

  // Default selection: today if it's in this month, else the first day of it.
  const defaultCell =
    cells.find((c) => c.isToday && inMonth(c)) ?? cells.find(inMonth) ?? cells[0];
  const [selectedKey, setSelectedKey] = useState(defaultCell?.dateKey ?? "");

  const selected = cells.find((c) => c.dateKey === selectedKey) ?? null;

  // ── REQ-007: bullseye-pop flip ──────────────────────────────────────────────
  // The pop is applied imperatively via a DOM query in useEffect so we avoid:
  //   1. Accessing refs during render (ESLint react-hooks/refs)
  //   2. setState/re-render/SSR hydration mismatch (mirrors TodayCelebration.tsx)
  // WeekRail marks each cap wrapper with data-testid="week-cap-{weekIndex}",
  // so we can querySelector without any ref plumbing through JSX.
  useEffect(() => {
    // Scan all cells for confirmed weekIndices on this render.
    const confirmedWeekIndices = new Set(
      cells
        .filter((c) => c.isInPlan && c.confidence === "confirmed" && c.weekIndex != null)
        .map((c) => c.weekIndex as number),
    );

    // C-3: sort descending — fire the pop for the HIGHEST (most-recently confirmed)
    // week first. A confirm_week(5) call covers weeks 1-5; the "completion moment"
    // should be associated with week 5, not week 1.
    const sorted = [...confirmedWeekIndices].sort((a, b) => b - a);

    for (const wi of sorted) {
      const key = `goaldmine.weekConfirmed.${wi}`;
      try {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, "1");
          // Query the cap wrapper by its data-testid and imperatively add the
          // pop class — no ref needed; no setState; no re-render; no mismatch.
          const capEl = document.querySelector(`[data-testid="week-cap-${wi}"]`);
          capEl?.classList.add("week-confirm-pop");
          break; // Only one pop per render cycle.
        }
      } catch {
        // localStorage blocked (private browsing, storage quota) — degrade silently.
      }
    }
  }, [cells]);

  // ── Week-row grid ────────────────────────────────────────────────────────────
  // The 42 padded cells already arrive Mon–Sun aligned from getCalendarMonth
  // (via startOfWeekMonday/endOfWeekSunday), so chunking by 7 gives correct rows.
  const weeks = Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <div className="space-y-3">
      <div>
        {/* Header: 16px rail gutter spacer + 7 day-name columns (same grid as rows).
            The spacer keeps columns perfectly aligned with the week data rows. */}
        <div className="grid grid-cols-[16px_repeat(7,1fr)] mb-1">
          {/* Header gets the 16px rail spacer but no spine/cap component */}
          <div aria-hidden="true" />
          {DAY_HEADERS.map((d) => (
            <div
              key={d}
              className="text-xs text-[var(--muted)] text-center font-medium"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Week rows: col 1 = WeekRail (16px), cols 2-8 = DayCell */}
        <div className="space-y-1">
          {weeks.map((weekCells, rowIdx) => {
            const weekIndex = weekCells.find((c) => c.isInPlan)?.weekIndex ?? null;
            return (
              <div
                key={rowIdx}
                data-testid={weekIndex != null ? `week-row-${weekIndex}` : undefined}
                className="grid grid-cols-[16px_repeat(7,1fr)] gap-1"
              >
                <WeekRail
                  cells={weekCells}
                  weekIndex={weekIndex}
                  confirmedThroughDate={confirmedThroughDate ?? null}
                />
                {weekCells.map((c) => (
                  <DayCell
                    key={c.dateKey}
                    cell={c}
                    inMonth={inMonth(c)}
                    legend={legend}
                    selected={c.dateKey === selectedKey}
                    onSelect={() => setSelectedKey(c.dateKey)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {selected && <DayDetail cell={selected} legend={legend} />}
    </div>
  );
}

// ─── DayCell ──────────────────────────────────────────────────────────────────
// REQ-006: provisional opacity + dashed top hairline; conflict corner wedge.
// D-3: isPopping prop does not exist — the pop lives on the WeekRail cap ref.

function DayCell({
  cell,
  inMonth,
  legend,
  selected,
  onSelect,
}: {
  cell: CalendarDayCell;
  inMonth: boolean;
  legend: readonly LegendEntry[];
  selected: boolean;
  onSelect: () => void;
}) {
  const markers = markersFor(cell, legend);
  const isCompleted = cell.workoutCount > 0 || cell.hikeCount > 0;
  const isQuietPast = cell.isPast && cell.isInPlan && markers.length === 0;

  // Every day carries a slim border for separation; out-of-month days get a
  // fainter one so the current month still reads as the focus.
  let toneClass = "border-[var(--border)] bg-[var(--card)]";
  if (!inMonth) toneClass = "border-[var(--border)]/50 bg-transparent";
  else if (isQuietPast) toneClass = "border-[var(--border)] bg-[var(--background)]";

  // Completed in-month days get a soft gold halo — a blurred box-shadow, not
  // a crisp ring, so it reads as a glow distinct from the today/selected ring.
  const glowClass =
    inMonth && isCompleted ? "shadow-[0_0_11px_-3px_var(--accent)]" : "";

  // Selection wins the ring; today gets a subtler ring when not selected.
  const ringClass = selected
    ? "ring-2 ring-[var(--accent)]"
    : cell.isToday
      ? "ring-1 ring-[var(--accent)]"
      : "";

  const numClass = !inMonth
    ? "text-[var(--muted)]/40"
    : cell.isToday
      ? "font-semibold"
      : isQuietPast
        ? "text-[var(--muted)]"
        : "";

  // REQ-006: provisional cue — reduced opacity + dashed top hairline.
  // Only applied to in-month, in-plan provisional cells (not to out-of-month padding).
  // ⚠ opacity 0.62 starting point — verify date number stays ≥ WCAG AA on cream;
  //   raise to 0.68 if too faint (the range is 0.55–0.70 per UX §9).
  const confidenceClass =
    inMonth && cell.isInPlan && cell.confidence === "provisional"
      ? "opacity-[0.62] border-t border-dashed border-t-[var(--muted)]"
      : "";

  // REQ-006 / a11y: extend aria-label with confidence + conflict info.
  const ariaLabel = [
    cell.dateKey,
    cell.dayTitle ? `— ${cell.dayTitle}` : "",
    cell.confidence && cell.confidence !== "past" ? `· ${cell.confidence}` : "",
    cell.conflict ? `· conflict: ${cell.conflict.kind}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={ariaLabel}
      data-testid={`day-cell-${cell.dateKey}`}
      data-confidence={cell.confidence ?? "out-of-plan"}
      data-conflict={cell.conflict?.kind ?? undefined}
      className={`relative min-h-[3.75rem] rounded-lg border flex flex-col items-center justify-start gap-0.5 p-1 text-xs transition-colors hover:border-[var(--accent)] ${toneClass} ${ringClass} ${glowClass} ${confidenceClass}`}
    >
      <span className={numClass}>{cell.date.getDate()}</span>
      <span className="flex flex-wrap items-center justify-center gap-0.5">
        {markers.map((m) => (
          <MarkerIcon key={m.entry.kind} entry={m.entry} size={13} />
        ))}
      </span>

      {/* REQ-006 / D-2: conflict corner wedge.
          Geometric non-color redundant channel — required for colorblind-safety
          alongside the warning-color BullseyeWarning cap (UX §8). Without the wedge
          the conflict state would be color-only.
          ⚠ 11px wedge: verify it doesn't fight the today/selected ring at 390px. */}
      {cell.conflict != null && (
        <span
          data-testid={`day-conflict-${cell.dateKey}`}
          aria-hidden="true"
          className="absolute top-0 right-0 w-0 h-0 border-t-[11px] border-t-[var(--warning)] border-l-[11px] border-l-transparent rounded-tr-lg"
        />
      )}
    </button>
  );
}

// ─── DayDetail ────────────────────────────────────────────────────────────────

function DayDetail({
  cell,
  legend,
}: {
  cell: CalendarDayCell;
  legend: readonly LegendEntry[];
}) {
  const markers = markersFor(cell, legend);
  const dateLabel = cell.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {dateLabel}
          {cell.isToday && (
            <span className="ml-2 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              Today
            </span>
          )}
        </p>
        {cell.weekIndex != null && (
          <span className="shrink-0 text-xs text-[var(--muted)]">
            Week {cell.weekIndex}
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--muted)]">
        {cell.dayTitle
          ? `${cell.rotationDay ? `D${cell.rotationDay} · ` : ""}${cell.dayTitle}`
          : cell.isInPlan
            ? "Rest / unscheduled day."
            : "Outside the current plan."}
      </p>

      {markers.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {markers.map((m) => (
            <li
              key={m.entry.kind}
              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
            >
              <MarkerIcon entry={m.entry} size={14} />
              <span>
                {m.count > 1 ? `${m.count} ` : ""}
                {m.entry.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/days/${cell.dateKey}`}
        className="inline-block text-xs font-medium text-[var(--accent)]"
      >
        Open day →
      </Link>
    </div>
  );
}
