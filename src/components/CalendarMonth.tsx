"use client";

// Month calendar — a glanceable icon grid plus a detail panel.
//
// The grid stays compact (square cells, day number + a row of the goal's
// legend icons). It is NOT where you read workout detail — tapping a day
// SELECTS it and the panel below shows the full, readable detail (workout
// name, marker labels, link to the day page). Today is selected by default.
// This split keeps the grid uncluttered on narrow phones (~48px cells) while
// the cells still carry the goal's own custom legend icons, not generic dots.
import { useState } from "react";
import Link from "next/link";
import { MarkerIcon } from "@/components/MarkerIcon";
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
  monthStart,
  legend,
}: {
  cells: CalendarDayCell[];
  monthStart: Date;
  legend: readonly LegendEntry[];
}) {
  const monthIdx = monthStart.getMonth();
  const inMonth = (c: CalendarDayCell) => c.date.getMonth() === monthIdx;

  // Default selection: today if it's in this month, else the first day of it.
  const defaultCell =
    cells.find((c) => c.isToday && inMonth(c)) ?? cells.find(inMonth) ?? cells[0];
  const [selectedKey, setSelectedKey] = useState(defaultCell?.dateKey ?? "");

  const selected = cells.find((c) => c.dateKey === selectedKey) ?? null;

  return (
    <div className="space-y-3">
      <div>
        <div className="grid grid-cols-7 mb-1">
          {DAY_HEADERS.map((d) => (
            <div
              key={d}
              className="text-xs text-[var(--muted)] text-center font-medium"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c) => (
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
      </div>
      {selected && <DayDetail cell={selected} legend={legend} />}
    </div>
  );
}

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
  const isQuietPast = cell.isPast && cell.isInPlan && markers.length === 0;

  // Every day carries a slim border for separation; out-of-month days get a
  // fainter one so the current month still reads as the focus.
  let toneClass = "border-[var(--border)] bg-[var(--card)]";
  if (!inMonth) toneClass = "border-[var(--border)]/50 bg-transparent";
  else if (isQuietPast) toneClass = "border-[var(--border)] bg-[var(--background)]";

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

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${cell.dateKey}${cell.dayTitle ? ` — ${cell.dayTitle}` : ""}`}
      className={`min-h-[3.75rem] rounded-lg border flex flex-col items-center justify-start gap-0.5 p-1 text-xs transition-colors hover:border-[var(--accent)] ${toneClass} ${ringClass}`}
    >
      <span className={numClass}>{cell.date.getDate()}</span>
      <span className="flex flex-wrap items-center justify-center gap-0.5">
        {markers.map((m) => (
          <MarkerIcon key={m.entry.kind} entry={m.entry} size={13} />
        ))}
      </span>
    </button>
  );
}

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
