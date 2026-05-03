import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { GoalEditForm, type CopySource } from "@/components/GoalEditForm";
import { GoalReferences } from "@/components/GoalReferences";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { prisma } from "@/lib/db";
import type { GoalReference } from "@/lib/goal-actions";
import type { GoalTarget } from "@/lib/goal-targets";
import { computeReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export default async function GoalDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const goal = await prisma.goal.findUnique({ where: { id } });
  if (!goal) notFound();

  const targets = (goal.targets as unknown as GoalTarget[] | null) ?? [];
  const references = (goal.references as unknown as GoalReference[] | null) ?? [];
  const readiness = targets.length > 0 ? await computeReadiness(targets) : null;

  const otherGoals = await prisma.goal.findMany({
    where: { id: { not: id } },
    orderBy: { updatedAt: "desc" },
  });
  const copySources: CopySource[] = otherGoals
    .filter((g) => Array.isArray(g.targets) && (g.targets as unknown[]).length > 0)
    .map((g) => ({
      id: g.id,
      objective: g.objective,
      targetDate: g.targetDate.toISOString(),
      targetCount: (g.targets as unknown[]).length,
    }));

  const days = Math.ceil(
    (new Date(goal.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/goals" className="text-sm text-[var(--accent)]">
          ← Goals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{goal.objective}</h1>
        <p className="text-sm text-[var(--muted)]">
          {new Date(goal.targetDate).toLocaleDateString()} ·{" "}
          {days < 0 ? `${-days} days past` : `${days} days out`} · {goal.status}
        </p>
      </header>

      {readiness && (
        <Card title="Readiness">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-4xl font-semibold tracking-tight">{readiness.score}<span className="text-base text-[var(--muted)]">/100</span></p>
            {readiness.missing.length > 0 && (
              <p className="text-xs text-[var(--muted)]">
                {readiness.missing.length} target{readiness.missing.length === 1 ? "" : "s"} no data yet
              </p>
            )}
          </div>
          <ReadinessBreakdown breakdown={readiness.breakdown} />
        </Card>
      )}

      <Card title="References">
        <GoalReferences goalId={goal.id} references={references} />
      </Card>

      {goal.notes && (
        <Card title="Notes">
          <p className="text-sm whitespace-pre-wrap">{goal.notes}</p>
        </Card>
      )}

      <Card title="Edit">
        <GoalEditForm
          id={goal.id}
          copySources={copySources}
          defaultValues={{
            objective: goal.objective,
            targetDate: new Date(goal.targetDate).toISOString().slice(0, 10),
            notes: goal.notes ?? "",
            status: goal.status,
            targets: JSON.stringify(targets, null, 2),
          }}
        />
      </Card>
    </div>
  );
}
