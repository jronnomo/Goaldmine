import Link from "next/link";
import { Bullseye } from "@/components/Bullseye";
import type { CalendarDayCell } from "@/lib/calendar";
import { findLegendEntry, type LegendEntry } from "@/lib/legend";

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="text-xs text-[var(--muted)] text-center font-medium">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => (
          <DayCell
            key={c.dateKey}
            cell={c}
            inMonth={c.date.getMonth() === monthIdx}
            legend={legend}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  cell,
  inMonth,
  legend,
}: {
  cell: CalendarDayCell;
  inMonth: boolean;
  legend: readonly LegendEntry[];
}) {
  // Resolve which kinds the active goal cares about. If a kind isn't in the
  // legend, the corresponding cell icon is suppressed (consistent with the
  // legend list — what you see in the cell matches what's labeled below).
  const trainedEntry = findLegendEntry(legend, "trained");
  const hikeEntry = findLegendEntry(legend, "hike-completed");
  const plannedHikeEntry = findLegendEntry(legend, "hike-planned");
  const overrideEntry = findLegendEntry(legend, "override");
  const goalEntry = findLegendEntry(legend, "goal-date");

  const baseClass = "aspect-square rounded-md border p-1 flex flex-col text-xs leading-tight transition-colors";
  // A logged hike counts as a completed training day too — outdoor sessions
  // satisfy "you trained today" in the bullseye sense, with the boot icon
  // layered on top to mark it as out-of-gym.
  const isCompleted = cell.workoutCount > 0 || cell.hikeCount > 0;
  const isOutdoor = cell.hikeCount > 0;
  // A planned hike with no completion logged shows a faded boot — only on
  // today + future cells. Past planned-but-not-done is a lifecycle concern
  // out of scope for the calendar surface.
  const isPlannedOutdoor =
    !isOutdoor && cell.plannedHikeCount > 0 && !cell.isPast;

  let toneClass = "border-[var(--border)] bg-[var(--card)]";
  if (!inMonth) toneClass = "border-transparent bg-transparent text-[var(--muted)]/60";
  else if (cell.isToday && isCompleted) toneClass = "border-[var(--accent)] bg-[var(--card)]";
  else if (cell.isToday) toneClass = "border-[var(--accent)] bg-[var(--accent-soft)]";
  else if (cell.isPast && cell.isInPlan && !isCompleted) toneClass = "border-[var(--border)] bg-[var(--background)] text-[var(--muted)]";
  else if (cell.hasOverride) toneClass = "border-[var(--warning)]/50 bg-[var(--warning)]/5";

  const goalClass = cell.isGoalDate ? "ring-2 ring-[var(--accent)]" : "";

  const day = cell.date.getDate();
  const href = cell.workoutCount === 1 && cell.isPast
    ? `/days/${cell.dateKey}` // (we still go to day detail; user can click through)
    : `/days/${cell.dateKey}`;

  return (
    <Link
      href={href}
      className={`${baseClass} ${toneClass} ${goalClass} hover:border-[var(--accent)]`}
      aria-label={`${cell.dateKey}${cell.dayTitle ? ` — ${cell.dayTitle}` : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={`${cell.isToday ? "font-semibold" : ""}`}>{day}</span>
        <div className="flex flex-col items-end gap-0.5">
          {cell.isGoalDate && goalEntry && (
            <span title={goalEntry.label}>{goalEntry.icon}</span>
          )}
          {cell.hasOverride && overrideEntry && (
            <span title={overrideEntry.label} className="text-[var(--warning)]">
              {overrideEntry.icon}
            </span>
          )}
          {isOutdoor && hikeEntry && (
            <span
              title={
                cell.hikeCount > 1
                  ? `${cell.hikeCount} ${hikeEntry.label.toLowerCase()}s`
                  : hikeEntry.label
              }
              aria-label={hikeEntry.label}
            >
              {hikeEntry.icon}
            </span>
          )}
          {isPlannedOutdoor && plannedHikeEntry && (
            <span
              title={
                cell.plannedHikeCount > 1
                  ? `${cell.plannedHikeCount} ${plannedHikeEntry.label.toLowerCase()}s`
                  : plannedHikeEntry.label
              }
              aria-label={plannedHikeEntry.label}
              className="opacity-40"
            >
              {plannedHikeEntry.icon}
            </span>
          )}
          {isCompleted && trainedEntry && <Bullseye filled size={10} aria-hidden />}
          {cell.baselinesDue > 0 && (
            <span title={`${cell.baselinesDue} baseline test(s)`} className="text-[var(--muted)] text-[10px]">
              ◎{cell.baselinesDue}
            </span>
          )}
        </div>
      </div>
      {cell.isInPlan && cell.dayTitle && (
        <span
          className={`mt-auto truncate ${cell.isToday ? "" : "text-[var(--muted)]"}`}
          title={cell.dayTitle}
        >
          {cell.rotationDay ? `D${cell.rotationDay} ` : ""}
          {cell.dayTitle}
        </span>
      )}
    </Link>
  );
}
