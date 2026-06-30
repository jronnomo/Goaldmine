// src/lib/milestone-partition.ts
//
// Pure helper — no Prisma, no server deps.
// Partitions an array of milestone-shaped objects into completed (status="done",
// sorted by completedAt desc) and upcoming (status!="done", sorted by date asc).
// Used by ProjectTrendsView (B1 #147). Tested in milestone-partition.test.ts.

export type MilestoneRow = {
  id: string;
  title: string;
  status: string;
  date: Date;
  completedAt: Date | null;
};

export function partitionMilestones(milestones: MilestoneRow[]): {
  completed: MilestoneRow[];
  upcoming: MilestoneRow[];
} {
  const completed = milestones
    .filter((m) => m.status === "done")
    .sort((a, b) => {
      // Most recently completed first; treat null completedAt as epoch (sorts to end).
      const aTime = a.completedAt?.getTime() ?? 0;
      const bTime = b.completedAt?.getTime() ?? 0;
      return bTime - aTime;
    });

  const upcoming = milestones
    .filter((m) => m.status !== "done")
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return { completed, upcoming };
}
