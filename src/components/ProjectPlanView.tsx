// src/components/ProjectPlanView.tsx
// Server component — no "use client".
// REQ-005: month-grouped CollapsibleCard timeline for project goals.

import Link from "next/link";
import { Card } from "@/components/Card";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { prisma } from "@/lib/db";
import { dateKey } from "@/lib/calendar";

const USER_TZ = process.env.USER_TZ ?? "America/Denver";

type GoalArg = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
};

export async function ProjectPlanView({ goal }: { goal: GoalArg }) {
  // [v2] DC-2: no date filter — loads all items for this goal.
  // For chewgether's ~3-month launch timeline (30-60 items) this is fine.
  // TODO: paginate or date-cap when item count grows beyond ~200 items per goal.
  const items = await prisma.scheduledItem.findMany({
    where: { goalId: goal.id },
    orderBy: [{ date: "asc" }, { title: "asc" }],
    select: { id: true, type: true, title: true, status: true, date: true },
  });

  // Top-level milestone summary
  const allMilestones = items.filter((i) => i.type === "milestone");
  const doneMilestones = allMilestones.filter((i) => i.status === "done").length;
  const totalMilestones = allMilestones.length;

  // Group items by yyyy-mm using USER_TZ-aware dateKey
  const todayMonth = dateKey(new Date()).slice(0, 7);
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const k = dateKey(item.date).slice(0, 7); // "yyyy-mm"
    const arr = groups.get(k) ?? [];
    arr.push(item);
    groups.set(k, arr);
  }

  const monthLabel = (groupKey: string): string => {
    const [y, m] = groupKey.split("-");
    // [v2] HIGH-1: use mid-month UTC instant (day 15) to avoid TZ boundary trap.
    // new Date(y, m-1, 1) creates LOCAL-timezone midnight. On Vercel (UTC runtime)
    // with USER_TZ="America/Denver" (UTC-6), June 1 00:00 UTC is May 31 18:00 MDT —
    // toLocaleString with timeZone:"America/Denver" then returns "May 2026" instead of
    // "June 2026". Using Date.UTC(y, m-1, 15) pins to noon-ish UTC on the 15th, which
    // is unambiguously within the target month for any UTC-negative timezone.
    const d = new Date(Date.UTC(Number(y), Number(m) - 1, 15));
    return d.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: USER_TZ,
    });
  };

  const isEmpty = items.length === 0;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4" data-testid="project-plan-view">
      <header className="pt-2">
        <Link href={`/goals/${goal.id}`} className="text-sm text-[var(--accent)]">
          ← {goal.objective}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Plan</h1>

        {/* Top-level milestone completion (UXR-s4-08) */}
        {totalMilestones > 0 && (
          <p className="text-sm text-[var(--muted)] mt-1">
            <span className="font-semibold text-[var(--foreground)]">
              {doneMilestones} / {totalMilestones}
            </span>{" "}
            milestones complete
          </p>
        )}
      </header>

      {isEmpty ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No scheduled items yet — ask Claude to build out the schedule for this goal.
          </p>
        </Card>
      ) : (
        [...groups.entries()].map(([groupKey, groupItems]) => {
          const doneInGroup = groupItems.filter((i) => i.status === "done").length;
          const isCurrentMonth = groupKey === todayMonth;

          // [v2] LOW-2/MIS-1: CollapsibleCard does not accept data-testid — use wrapper div.
          // Do NOT pass data-testid to CollapsibleCard; the wrapper div is the E2E selector target.
          return (
            <div key={groupKey} data-testid={`plan-month-${groupKey}`}>
              <CollapsibleCard
                title={`${monthLabel(groupKey)} · ${doneInGroup}/${groupItems.length} done`}
                defaultOpen={isCurrentMonth}
              >
                <ul className="space-y-1 pt-1">
                  {groupItems.map((item) => {
                    const isDone = item.status === "done";
                    const isSkipped = item.status === "skipped";
                    const dueLabel = new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(item.date));

                    return (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 min-h-[44px] text-sm"
                      >
                        {/* Status glyph (UXR-s4-09) */}
                        <span
                          aria-label={isDone ? "Done" : isSkipped ? "Skipped" : "Planned"}
                          title={isDone ? "Done" : isSkipped ? "Skipped" : "Planned"}
                          className={`shrink-0 text-base ${
                            isDone
                              ? "text-[var(--success)]"
                              : "text-[var(--muted)]"
                          }`}
                        >
                          {isDone ? "●" : "○"}
                        </span>

                        {/* Type badge */}
                        <TypeBadgePlan type={item.type} />

                        {/* Title — strikethrough for skipped */}
                        <span
                          className={`flex-1 min-w-0 truncate ${
                            isSkipped
                              ? "line-through text-[var(--muted)]"
                              : isDone
                                ? "text-[var(--muted)]"
                                : ""
                          }`}
                        >
                          {item.title}
                        </span>

                        {/* Due date */}
                        <span className="shrink-0 text-xs text-[var(--muted)]">
                          {dueLabel}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleCard>
            </div>
          );
        })
      )}
    </div>
  );
}

function TypeBadgePlan({ type }: { type: string }) {
  const cls =
    type === "milestone"
      ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]"
      : type === "launch-step"
        ? "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
        : "border-[var(--border)] text-[var(--muted)]";
  return (
    <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${cls}`}>
      {type}
    </span>
  );
}
