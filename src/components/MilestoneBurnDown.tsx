// src/components/MilestoneBurnDown.tsx
// Server component — no "use client".
// REQ-006: burn-down card for progress page. Returns null when no milestones.

import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/calendar";

const MILESTONE_WARNING_DAYS = 14;
const MS_PER_DAY = 1_000 * 60 * 60 * 24;

export async function MilestoneBurnDown({ goalId }: { goalId: string }) {
  // Single query — milestones only, all statuses, ordered by date.
  // Few milestones per goal (typically < 20); no pagination needed.
  const milestones = await prisma.scheduledItem.findMany({
    where: { goalId, type: "milestone" },
    orderBy: { date: "asc" },
    select: { id: true, title: true, status: true, date: true },
  });

  if (milestones.length === 0) return null; // PRD §3.1.6 gate

  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "done").length;
  const remaining = milestones.filter((m) => m.status === "planned").length;

  const now = new Date();
  // [v2] LOW-3: includes TODAY (>= todayStart) — "Next:" means soonest incomplete,
  // including a milestone due today if it hasn't been marked done.
  // Contrast with ProjectTodayView "Next milestone" card which is strictly AFTER today
  // (tomorrow+) to avoid duplicating an item that is already in the today checklist.
  const nextMilestone = milestones.find(
    (m) => m.status === "planned" && startOfDay(m.date).getTime() >= startOfDay(now).getTime(),
  ) ?? null;

  const nextDaysRemaining =
    nextMilestone != null
      ? Math.round(
          (startOfDay(nextMilestone.date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
        )
      : null;

  const nextDueLabel =
    nextMilestone?.date != null
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
          new Date(nextMilestone.date),
        )
      : null;

  const pct = total > 0 ? (done / total) * 100 : 0;

  // [v2] LOW-2: Card does not accept data-testid — use wrapper div.
  return (
    <div data-testid="milestone-burndown-card">
      <Card>
        {/* Header (UXR-s4-12: "X of Y milestones complete" framing) */}
        <p className="text-base font-semibold mb-3">
          <span className="text-2xl">{done}</span>
          <span className="text-[var(--muted)] font-normal"> / {total} milestones complete</span>
        </p>

        {/* 3-stat grid (UXR-s4-12) */}
        <div className="grid grid-cols-3 gap-2 mb-3 text-center">
          <BurndownStat label="Total" value={total} testId="burndown-stat-total" />
          <BurndownStat label="Done" value={done} testId="burndown-stat-done" />
          <BurndownStat label="Remaining" value={remaining} testId="burndown-stat-remaining" />
        </div>

        {/* Thin accent scope bar — NO Bullseye per UXR-s4-12; NO animation per UXR-s4-17 */}
        <div
          className="h-1.5 rounded-full overflow-hidden mb-3"
          style={{ background: "var(--border)" }}
          role="progressbar"
          aria-valuenow={done}
          aria-valuemax={total}
          aria-label={`${done} of ${total} milestones complete`}
        >
          <div
            className="h-full rounded-full"
            style={{ background: "var(--accent)", width: `${pct.toFixed(1)}%` }}
          />
        </div>

        {/* Next milestone line */}
        {nextMilestone != null && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <p className="truncate text-[var(--muted)]">
              <span className="font-medium text-[var(--foreground)]">Next:</span>{" "}
              {nextMilestone.title}
              {nextDueLabel ? ` · ${nextDueLabel}` : ""}
            </p>
            {nextDaysRemaining !== null && nextDaysRemaining <= MILESTONE_WARNING_DAYS && (
              <span
                className={`shrink-0 text-xs rounded-full px-2 py-0.5 border font-medium ${
                  nextDaysRemaining < 0
                    ? "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
                    : "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
                }`}
              >
                {nextDaysRemaining < 0 ? `Overdue ${Math.abs(nextDaysRemaining)}d` : `${nextDaysRemaining}d`}
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function BurndownStat({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div
      className="rounded-lg border border-[var(--border)] py-2 text-center"
      data-testid={testId}
    >
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
