import Link from "next/link";
import { Bullseye } from "@/components/Bullseye";
import { Card } from "@/components/Card";
import { GoalCreateForm, type CopySource } from "@/components/GoalCreateForm";
import { prisma } from "@/lib/db";
import { setFocusGoal } from "@/lib/goal-actions";

export const dynamic = "force-dynamic";

function goalProgress(
  g: { createdAt: Date; targetDate: Date | null; status: string },
  now: number,
): number {
  if (g.status === "achieved") return 1;
  if (g.status === "abandoned") return 0;
  if (!g.targetDate) return 0; // someday goal — no progress bar
  const total = g.targetDate.getTime() - g.createdAt.getTime();
  if (total <= 0) return 0;
  const elapsed = now - g.createdAt.getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}

export default async function GoalsPage() {
  // Focus goal first (isFocus=true), then tracked (active=true), then by target date
  // (nulls last = someday goals at the bottom), then most-recently-updated.
  const goals = await prisma.goal.findMany({
    orderBy: [
      { isFocus: "desc" },
      { active: "desc" },
      { targetDate: { sort: "asc", nulls: "last" } },
      { updatedAt: "desc" },
    ],
  });
  const focusedId = goals.find((g) => g.isFocus)?.id ?? null;

  const copySources: CopySource[] = goals
    .filter((g) => Array.isArray(g.targets) && (g.targets as unknown[]).length > 0)
    .map((g) => ({
      id: g.id,
      objective: g.objective,
      targetDate: g.targetDate?.toISOString() ?? "",
      targetCount: (g.targets as unknown[]).length,
    }));

  // Server component: Date.now() is safe here — rendered once per request, never re-renders.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Track an objective with a date. Optionally tie measurable targets so the Stats page can graph readiness.
        </p>
      </header>

      <Card title="New goal">
        <GoalCreateForm copySources={copySources} />
      </Card>

      <Card title="All goals">
        {goals.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            <strong className="font-semibold text-[var(--foreground)]">Nothing to aim at yet.</strong>{" "}
            Add a goal — a date, a metric, or both.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {goals.map((g) => {
              const days = g.targetDate
                ? Math.ceil((new Date(g.targetDate).getTime() - now) / (1000 * 60 * 60 * 24))
                : null;
              const pct = goalProgress(g, now);
              const isFocused = g.id === focusedId;
              const setFocus = setFocusGoal.bind(null, g.id);
              const rowBody = (
                <div className="flex items-start gap-2 min-w-0 flex-1 text-left">
                  <Bullseye
                    size={20}
                    progress={pct}
                    aria-label={`${g.objective}: ${Math.round(pct * 100)}% progress`}
                    className="shrink-0 mt-0.5"
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {g.objective}
                      {isFocused && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide rounded-full border border-[var(--accent)] text-[var(--accent)] px-1.5 py-0.5 align-middle">
                          Focus
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {g.targetDate ? new Date(g.targetDate).toLocaleDateString() : "Someday"}
                      {g.status !== "active" ? ` · ${g.status}` : ""}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={g.id} className="flex items-start gap-3 py-3">
                  {isFocused ? (
                    rowBody
                  ) : (
                    <form action={setFocus} className="flex-1 min-w-0">
                      <button
                        type="submit"
                        className="w-full flex items-start gap-2 hover:opacity-80"
                      >
                        {rowBody}
                      </button>
                    </form>
                  )}
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    {days !== null ? (
                      <span
                        className={`text-xs rounded-full px-2 py-0.5 border ${
                          days < 0
                            ? "border-[var(--danger)]/40 text-[var(--danger)]"
                            : days <= 14
                              ? "border-[var(--warning)]/40 text-[var(--warning)]"
                              : "border-[var(--border)] text-[var(--muted)]"
                        }`}
                      >
                        {days < 0 ? `${-days}d ago` : `${days}d`}
                      </span>
                    ) : (
                      <span className="text-xs rounded-full px-2 py-0.5 border border-[var(--muted)]/40 text-[var(--muted)]">
                        Someday
                      </span>
                    )}
                    <Link
                      href={`/goals/${g.id}`}
                      className="text-xs rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
                    >
                      Manage →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
