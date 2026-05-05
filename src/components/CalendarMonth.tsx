import Link from "next/link";
import { Bullseye } from "@/components/Bullseye";
import type { CalendarDayCell } from "@/lib/calendar";

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarMonth({
  cells,
  monthStart,
}: {
  cells: CalendarDayCell[];
  monthStart: Date;
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
          <DayCell key={c.dateKey} cell={c} inMonth={c.date.getMonth() === monthIdx} />
        ))}
      </div>
    </div>
  );
}

function DayCell({ cell, inMonth }: { cell: CalendarDayCell; inMonth: boolean }) {
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
          {cell.isGoalDate && <span title="Goal date">🏔️</span>}
          {cell.hasOverride && <span title="Custom day" className="text-[var(--warning)]">★</span>}
          {isOutdoor && (
            <span
              title={cell.hikeCount > 1 ? `${cell.hikeCount} hikes logged` : "Hike logged"}
              aria-label="hike"
            >
              🥾
            </span>
          )}
          {isPlannedOutdoor && (
            <span
              title={
                cell.plannedHikeCount > 1
                  ? `${cell.plannedHikeCount} hikes planned`
                  : "Hike planned"
              }
              aria-label="hike planned"
              className="opacity-40"
            >
              🥾
            </span>
          )}
          {isCompleted && <Bullseye filled size={10} aria-hidden />}
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
