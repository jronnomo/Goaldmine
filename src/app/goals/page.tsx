import Link from "next/link";
import { Card } from "@/components/Card";
import { GoalCreateForm, type CopySource } from "@/components/GoalCreateForm";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const goals = await prisma.goal.findMany({
    orderBy: [{ active: "desc" }, { targetDate: "asc" }],
  });

  const copySources: CopySource[] = goals
    .filter((g) => Array.isArray(g.targets) && (g.targets as unknown[]).length > 0)
    .map((g) => ({
      id: g.id,
      objective: g.objective,
      targetDate: g.targetDate.toISOString(),
      targetCount: (g.targets as unknown[]).length,
    }));

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
              const days = Math.ceil(
                (new Date(g.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
              );
              return (
                <li key={g.id}>
                  <Link
                    href={`/goals/${g.id}`}
                    className="flex items-start justify-between py-3 gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{g.objective}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(g.targetDate).toLocaleDateString()}
                        {g.status !== "active" ? ` · ${g.status}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${
                        days < 0
                          ? "border-red-500/40 text-red-500"
                          : days <= 14
                            ? "border-amber-500/40 text-amber-500"
                            : "border-[var(--border)] text-[var(--muted)]"
                      }`}
                    >
                      {days < 0 ? `${-days}d ago` : `${days}d`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
