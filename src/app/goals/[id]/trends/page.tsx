import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getLogMetricSeries } from "@/lib/metric-series";
import { ProjectTrendsView } from "@/components/ProjectTrendsView";
import type { GoalTarget } from "@/lib/metrics-registry";

export const dynamic = "force-dynamic";

export default async function TrendsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const goal = await prisma.goal.findUnique({
    where: { id },
    select: { id: true, kind: true, objective: true, targets: true },
  });

  if (!goal) notFound();
  if (goal.kind !== "project") notFound();

  const logTargets = ((goal.targets as unknown as GoalTarget[]) ?? []).filter((t) =>
    t.metric.startsWith("log:"),
  );

  const series = await Promise.all(logTargets.map((t) => getLogMetricSeries(t, goal.id)));

  const milestones = await prisma.scheduledItem.findMany({
    where: { goalId: id, type: "milestone" },
    select: { id: true, title: true, status: true, date: true, completedAt: true },
    orderBy: { date: "asc" },
  });

  return (
    <ProjectTrendsView
      objective={goal.objective}
      goalId={id}
      targets={logTargets}
      series={series}
      milestones={milestones}
    />
  );
}
