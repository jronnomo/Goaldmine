import Link from "next/link";
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
  const isCompleted = cell.workoutCount > 0;

  let toneClass = "border-[var(--border)] bg-[var(--card)]";
  if (!inMonth) toneClass = "border-transparent bg-transparent text-[var(--muted)]/60";
  else if (cell.isToday) toneClass = "border-[var(--accent)] bg-[var(--accent)]/10";
  else if (isCompleted && cell.isPast) toneClass = "border-emerald-500/40 bg-emerald-500/5";
  else if (cell.isPast && cell.isInPlan) toneClass = "border-[var(--border)] bg-[var(--background)] text-[var(--muted)]";
  else if (cell.hasOverride) toneClass = "border-amber-500/50 bg-amber-500/5";

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
          {isCompleted && <span className="text-emerald-500">✓</span>}
          {cell.hasOverride && <span title="Custom day" className="text-amber-500">★</span>}
          {cell.baselinesDue > 0 && (
            <span title={`${cell.baselinesDue} baseline test(s)`} className="text-[var(--accent)] text-[10px]">
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
