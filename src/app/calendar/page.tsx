import Link from "next/link";
import { Card } from "@/components/Card";
import { CalendarMonth } from "@/components/CalendarMonth";
import { getCalendarMonth } from "@/lib/calendar";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { y, m } = await searchParams;
  const now = new Date();
  const year = y ? Number(y) : now.getFullYear();
  const month = m ? Number(m) : now.getMonth();

  const { cells, monthStart, goal, program } = await getCalendarMonth({ year, month });

  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;

  const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const completedCount = cells.filter(
    (c) => (c.workoutCount > 0 || c.hikeCount > 0) && c.isPast,
  ).length;
  const hikeCount = cells.filter((c) => c.hikeCount > 0 && c.isPast).length;
  const overrideCount = cells.filter((c) => c.hasOverride).length;
  const baselinesDueCount = cells.reduce((acc, c) => acc + c.baselinesDue, 0);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <Link
          href="/history"
          className="text-xs rounded-full border border-[var(--border)] px-3 py-1 text-[var(--muted)] hover:text-foreground"
        >
          List view
        </Link>
      </header>

      <div className="flex items-center justify-between">
        <Link
          href={`/calendar?y=${prevYear}&m=${prevMonth}`}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          ← {new Date(prevYear, prevMonth, 1).toLocaleDateString(undefined, { month: "short" })}
        </Link>
        <p className="font-medium">{monthLabel}</p>
        <Link
          href={`/calendar?y=${nextYear}&m=${nextMonth}`}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          {new Date(nextYear, nextMonth, 1).toLocaleDateString(undefined, { month: "short" })} →
        </Link>
      </div>

      <Card>
        <CalendarMonth cells={cells} monthStart={monthStart} />
      </Card>

      {cells.every((c) => c.workoutCount === 0 && c.hikeCount === 0 && !c.hasOverride) && (
        <p className="text-xs text-[var(--muted)] text-center mt-2">
          <strong className="font-semibold text-[var(--foreground)]">No completed days this month.</strong>{" "}
          Logged workouts and overrides will land here as filled targets.
        </p>
      )}

      <Card title="Legend">
        <ul className="space-y-1 text-xs text-[var(--muted)]">
          <li><span className="text-[var(--target)]">◉</span> training day logged</li>
          <li>🥾 out-of-gym session (hike, trail run, backpack)</li>
          <li><span className="text-[var(--warning)]">★</span> custom override applied</li>
          <li><span className="text-[var(--muted)]">◎N</span> N baseline test(s) due that day</li>
          <li>🏔️ goal target date</li>
          <li><span className="text-[var(--accent)]">accent ring</span> goal target highlighted</li>
        </ul>
      </Card>

      <Card title="This month">
        <ul className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Completed" value={completedCount} />
          <Stat label="Hikes" value={hikeCount} />
          <Stat label="Overrides" value={overrideCount} />
          <Stat label="Tests due" value={baselinesDueCount} />
        </ul>
      </Card>

      {goal && (
        <p className="text-xs text-[var(--muted)] text-center">
          🏔️ {goal.objective} — {new Date(goal.targetDate).toLocaleDateString()}
        </p>
      )}
      {!program && (
        <p className="text-xs text-[var(--muted)] text-center">
          No active plan. <Link href="/goals" className="text-[var(--accent)]">Create a goal</Link> to populate the calendar.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <li className="rounded-lg border border-[var(--border)] py-2 list-none">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </li>
  );
}
