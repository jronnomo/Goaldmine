import Link from "next/link";
import { MarkerIcon, ForeignGoalMarker } from "@/components/MarkerIcon";
import { Card } from "@/components/Card";
import { CalendarMonth } from "@/components/CalendarMonth";
import { StatTile } from "@/components/StatTile";
import { getCalendarMonth } from "@/lib/calendar";
import { resolveLegend } from "@/lib/legend";
import { getGoalCount } from "@/lib/goal-count";

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

  const { cells, monthStart, goal, program, otherGoals } = await getCalendarMonth({ year, month });
  const legend = resolveLegend(goal);
  // First-run signal: goalCount, NOT !goal — `goal` is the focus goal only
  // (getCalendarMonth's findFirst({ isFocus: true })), and focus-goal deletion
  // has no reassignment guard, so !goal is reachable with goalCount > 0 (an
  // established user whose focus goal was deleted). goalCount===0 is the
  // precise "truly no goals" signal, matching Today's gate (page.tsx).
  const goalCount = await getGoalCount();

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

      {goalCount === 0 && (
        <Card title="Get started">
          <p className="text-sm text-[var(--muted)]">
            Welcome to Goaldmine — start by creating your first goal. Your calendar fills in as
            you log.
          </p>
          <Link
            href="/onboarding"
            className="mt-3 inline-block text-sm font-medium text-[var(--accent)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
          >
            Get started →
          </Link>
        </Card>
      )}

      <Card className="!px-2">
        <CalendarMonth
          key={`${year}-${month}`}
          cells={cells}
          monthKey={`${year}-${String(month + 1).padStart(2, "0")}`}
          legend={legend}
          confirmedThroughDate={program?.confirmedThroughDate ?? null}
        />
      </Card>

      {cells.every((c) => c.workoutCount === 0 && c.hikeCount === 0 && !c.hasOverride) && (
        <p className="text-xs text-[var(--muted)] text-center mt-2">
          <strong className="font-semibold text-[var(--foreground)]">No completed days this month.</strong>{" "}
          Logged workouts and overrides will land here as filled targets.
        </p>
      )}

      <Card title="Legend">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {legend.map((entry) => (
            <LegendRow key={entry.kind} label={entry.label}>
              <MarkerIcon entry={entry} size={15} />
            </LegendRow>
          ))}
        </ul>

        {/* REQ-106: "Other goals" section — teaches the claim-ring encoding.
            UXR-62-14: divider + uppercase header + claim-ringed icon per non-focus goal.
            Renders nothing when no other active goals exist. */}
        {otherGoals.length > 0 && (
          <div data-testid="legend-other-goals" className="mt-3 pt-3 border-t border-[var(--border)]">
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] mb-2">
              Other goals
            </p>
            <ul className="space-y-2 text-sm">
              {otherGoals.map((og) => (
                <LegendRow
                  key={og.id}
                  label={`${og.goalDateLabel} — ${og.objective}`}
                >
                  {/* UXR-62-01/02: claim-ring icon teaches the foreign-marker encoding */}
                  <ForeignGoalMarker
                    icon={og.goalDateIcon}
                    label={og.goalDateLabel}
                    size={15}
                  />
                </LegendRow>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="This month">
        <div className="grid grid-cols-4 gap-2">
          <StatTile label="Completed" value={completedCount} />
          <StatTile label="Hikes" value={hikeCount} />
          <StatTile label="Overrides" value={overrideCount} />
          <StatTile label="Tests due" value={baselinesDueCount} />
        </div>
      </Card>

      {goal && (
        <p className="text-xs text-[var(--muted)] text-center">
          🏔️ {goal.objective}
          {goal.targetDate ? ` — ${new Date(goal.targetDate).toLocaleDateString()}` : ""}
        </p>
      )}
      {!program && goalCount > 0 && (
        <p className="text-xs text-[var(--muted)] text-center">
          No active plan. <Link href="/goals" className="text-[var(--accent)]">Create a goal</Link> to populate the calendar.
        </p>
      )}
    </div>
  );
}

function LegendRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-2 list-none">
      <span className="inline-flex items-center justify-center w-5 h-5 shrink-0">
        {children}
      </span>
      <span className="text-[var(--foreground)]">{label}</span>
    </li>
  );
}

