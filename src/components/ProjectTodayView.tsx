// src/components/ProjectTodayView.tsx
// Server component — no "use client".
// REQ-002: QuestCard Hero layout for project focus goals.
// One Promise.all: today's items, latest MRR entry, next milestone, goal targets.
// Does NOT call computeGameState() — CharacterHeader is omitted on the project path.

import Link from "next/link";
import { Card } from "@/components/Card";
import { TodayCelebration } from "@/components/TodayCelebration";
import { prisma } from "@/lib/db";
import { startOfDay, endOfDay, dateKey, addDays, USER_TZ } from "@/lib/calendar";
import type { GoalTarget } from "@/lib/metrics-registry";
import type { FocusGoalRow } from "@/lib/goal-focus";
import { computeGoalFeasibility } from "@/lib/rarity";
import { parseCoachFeasibility } from "@/lib/rarity-core";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";

// UXR-s4-13: urgency threshold constant (≤14d → warning, <0 → danger).
const MILESTONE_WARNING_DAYS = 14;
const MS_PER_DAY = 1_000 * 60 * 60 * 24;

type ProjectTodayViewProps = {
  goal: Pick<FocusGoalRow, "id" | "objective" | "targetDate" | "kind">;
};

export async function ProjectTodayView({ goal }: ProjectTodayViewProps) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const todayDateKey = dateKey(now);

  // All data in a single round-trip. UXR-s4-20: "upcoming-7d items" query DROPPED
  // (Decision CD-1: nothing in the chosen direction renders a 7-day list).
  const [items, mrrEntry, nextMilestone, goalRow] = await Promise.all([
    // Today's scheduled items (planned + done) — sorted by date then title for stable order.
    prisma.scheduledItem.findMany({
      where: {
        goalId: goal.id,
        date: { gte: todayStart, lte: todayEnd },
        status: { in: ["planned", "done"] },
      },
      orderBy: [{ date: "asc" }, { title: "asc" }],
      select: { id: true, type: true, title: true, status: true },
    }),
    // Latest MRR log entry. Metric key in DB is "mrr" (bare, without "log:" prefix).
    prisma.logEntry.findFirst({
      where: { goalId: goal.id, metric: "mrr", value: { not: null } },
      orderBy: { date: "desc" },
      select: { value: true },
    }),
    // [v2] LOW-3: Next planned milestone strictly AFTER today (tomorrow+).
    // Today's milestones already appear in the checklist above — showing them here
    // too would be redundant. Contrast with MilestoneBurnDown which includes today.
    prisma.scheduledItem.findFirst({
      where: {
        goalId: goal.id,
        type: "milestone",
        status: "planned",
        date: { gte: addDays(todayStart, 1) }, // strictly tomorrow and beyond
      },
      orderBy: { date: "asc" },
      select: { id: true, title: true, date: true },
    }),
    // Goal targets — needed for MRR target. ProjectTodayView fetches this itself
    // (getFocusGoal select was NOT extended; Decision CD-5).
    prisma.goal.findUnique({
      where: { id: goal.id },
      select: { targets: true, coachFeasibility: true },
    }),
  ]);

  // Feasibility — sequential after Promise.all (D-3): needs goalRow.targets from above.
  // .catch(() => null) guards against transient per-target query failures (D-4);
  // the {feasibility && ...} JSX guard absorbs null with no card shown on failure.
  const feasibility = await computeGoalFeasibility({
    id: goal.id,
    targetDate: goal.targetDate,
    targets: goalRow?.targets,
    kind: goal.kind,
  }).catch(() => null);
  const coachFeas = parseCoachFeasibility(goalRow?.coachFeasibility);
  const targetDateLabel =
    goal.targetDate != null
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: USER_TZ,
        }).format(goal.targetDate)
      : null;

  // --- Derived values ---

  // MRR card
  const targets = (goalRow?.targets as unknown as GoalTarget[] | null) ?? [];
  const mrrTarget = targets.find((t) => t.metric === "log:mrr") ?? null;
  const mrrValue = mrrEntry?.value ?? null;

  // Bullseye progress
  const total = items.length;
  const doneToday = items.filter((i) => i.status === "done").length;
  const allDone = total > 0 && doneToday === total;
  // [v2] HIGH-2: live progress fraction for progressive Bullseye rings (UXR-s4-01).
  // total===0 guard prevents division-by-zero; Bullseye(progress=0) renders hollow.
  const progress = total === 0 ? 0 : doneToday / total;

  // Days remaining to goal target
  const daysToGoal =
    goal.targetDate != null
      ? Math.round(
          (startOfDay(goal.targetDate).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
        )
      : null;

  // Days remaining to next milestone
  const milestoneRemainingDays =
    nextMilestone != null
      ? Math.round(
          (startOfDay(nextMilestone.date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
        )
      : null;

  const milestoneDueLabel = nextMilestone?.date
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: USER_TZ }).format(
        new Date(nextMilestone.date),
      )
    : null;

  // Once-per-day pop: project-scoped localStorage key (Decision CD-6).
  const celebStorageKey = `goaldmine.project-celebrated.${goal.id}.${todayDateKey}`;

  const isEmpty = total === 0;

  return (
    <div
      className="max-w-md mx-auto p-4 space-y-4"
      data-testid="project-today-view"
    >
      {/* ── Hero: QuestCard ribbon (UXR-s4-01) ── */}
      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] p-4 space-y-3 border-l-2"
        style={{ borderLeftColor: "var(--accent)" }}
        aria-label={`Today's work — ${goal.objective}`}
      >
        {/* Eyeline */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-[var(--foreground)] truncate">{goal.objective}</p>
          {daysToGoal !== null && (
            <span className="shrink-0 text-xs rounded-full bg-[var(--accent-soft)] border border-[var(--accent)]/30 px-2 py-0.5 text-[var(--accent)] font-medium">
              {daysToGoal > 0 ? `${daysToGoal}d to launch` : daysToGoal === 0 ? "Launch day!" : "Overdue"}
            </span>
          )}
        </div>

        {/* [v2] HIGH-2: TodayCelebration now receives progress + ariaLabel for live progressive rings. */}
        <div className="flex items-center gap-3">
          <TodayCelebration
            completed={allDone}
            dateKey={todayDateKey}
            storageKey={celebStorageKey}
            progress={progress}
            ariaLabel={
              total === 0
                ? "Nothing scheduled today"
                : `${doneToday} of ${total} items done today`
            }
          />
          <div>
            <p className="text-sm font-semibold">
              {isEmpty
                ? "Today's work"
                : `${doneToday} of ${total} done today`}
            </p>
            {!isEmpty && (
              <p className="text-xs text-[var(--muted)]">
                {doneToday} done · {total - doneToday} remaining
              </p>
            )}
          </div>
        </div>

        {/* Checklist or empty state (UXR-s4-02) */}
        {isEmpty ? (
          <p
            className="text-sm text-[var(--muted)]"
            data-testid="project-today-empty"
          >
            Nothing scheduled today — open Claude to plan tomorrow or log MRR.
          </p>
        ) : (
          <ul
            className="space-y-1"
            data-testid="project-today-checklist"
          >
            {items.map((item) => {
              const isDone = item.status === "done";
              return (
                <li key={item.id} data-testid={`project-today-item-${item.id}`}>
                  <Link
                    href={`/days/${todayDateKey}`}
                    className="flex items-center gap-2 min-h-[44px] rounded-lg px-2 hover:bg-[var(--card)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <span
                      aria-label={isDone ? "Done" : "Planned"}
                      title={isDone ? "Done" : "Planned"}
                      className={`shrink-0 text-sm ${isDone ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
                    >
                      {isDone ? "●" : "○"}
                    </span>
                    <span
                      className={`flex-1 text-sm ${isDone ? "text-[var(--muted)]" : ""}`}
                    >
                      {item.title}
                    </span>
                    <TypeBadge type={item.type} />
                    <span className="text-xs text-[var(--accent)] shrink-0" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── MRR Progress card (UXR-s4-03; hidden when no log:mrr target) ── */}
      {/* [v2] LOW-2: Card does not accept data-testid — use wrapper div. */}
      {mrrTarget != null && (
        <div data-testid="mrr-progress-card">
          <Card>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-4xl font-semibold tracking-tight">
                {mrrValue != null ? formatCurrency(mrrValue) : "—"}
                <span className="text-base font-normal text-[var(--muted)]">
                  {" "}/ {formatCurrency(mrrTarget.target)} MRR
                </span>
              </p>
            </div>
            {/* Thin accent scope bar — no animation per UXR-s4-17 */}
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--border)" }}
              role="progressbar"
              aria-valuenow={mrrValue ?? 0}
              aria-valuemax={mrrTarget.target}
              aria-label={`MRR ${mrrValue != null ? formatCurrency(mrrValue) : "—"} of ${formatCurrency(mrrTarget.target)}`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  background: "var(--accent)",
                  width: `${Math.min(100, mrrValue != null ? (mrrValue / mrrTarget.target) * 100 : 0).toFixed(1)}%`,
                  // No CSS transition — static bar per UXR-s4-17.
                }}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">Monthly recurring revenue</p>
          </Card>
        </div>
      )}

      {/* ── Feasibility (Reach) card — between MRR and next-milestone. ── */}
      {/* .catch(() => null) means feasibility can be null on transient DB failure;
          guard here prevents passing null to FeasibilityReadout's non-nullable prop. */}
      {feasibility && (
        <FeasibilityReadout
          feasibility={feasibility}
          targetDateLabel={targetDateLabel}
          coach={coachFeas}
        />
      )}

      {/* ── Next milestone card (UXR-s4-13; hidden when none) ── */}
      {/* [v2] LOW-2: Card does not accept data-testid — use wrapper div. */}
      {nextMilestone != null && (
        <div data-testid="next-milestone-card">
          <Card>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-1">
                  Next milestone
                </p>
                <p className="text-sm font-medium truncate">{nextMilestone.title}</p>
                {milestoneDueLabel && (
                  <p className="text-xs text-[var(--muted)] mt-0.5">{milestoneDueLabel}</p>
                )}
              </div>
              {milestoneRemainingDays !== null && (
                <UrgencyChip days={milestoneRemainingDays} />
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const cls = typeBadgeClass(type);
  return (
    <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${cls}`}>
      {type}
    </span>
  );
}

function typeBadgeClass(type: string): string {
  // UXR-s4-10: task/review neutral; milestone accent; launch-step warning.
  switch (type) {
    case "milestone":
      return "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]";
    case "launch-step":
      return "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]";
    default: // task, review, and unknown types
      return "border-[var(--border)] text-[var(--muted)]";
  }
}

function UrgencyChip({ days }: { days: number }) {
  // UXR-s4-13: ≤14d → warning; overdue (< 0) → danger; >14d → no chip.
  if (days > MILESTONE_WARNING_DAYS) return null;
  const isDanger = days < 0;
  // [v2] LOW-1: "!" prefix on danger (overdue) only. Warning chip shows remaining days
  // without the alarm prefix — the color distinction (warning vs danger token) carries
  // the urgency signal for non-overdue cases.
  const label = isDanger ? `! Overdue ${Math.abs(days)}d` : `${days}d`;
  if (isDanger) {
    return (
      <span className="shrink-0 text-xs rounded-full px-2 py-0.5 border border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)] font-medium">
        {label}
      </span>
    );
  }
  return (
    <span className="shrink-0 text-xs rounded-full px-2 py-0.5 border border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)] font-medium">
      {label}
    </span>
  );
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}
