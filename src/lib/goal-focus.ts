// Focus-goal and active-goal resolution.
//
// "Focus" (isFocus=true): the one goal whose plan drives the daily prescription.
// "Active" (active=true): tracked; contributes events; exactly one can also be focus.
//
// When multiple goals are stuck with isFocus=true (bad state), readers use
// findFirst(orderBy: { updatedAt: "desc" }) — deterministic winner, mirrors the
// existing active-goal convention in calendar.ts and program.ts.

import { getDb } from "@/lib/db";

export type FocusGoalRow = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
  isFocus: boolean;
  legend: unknown;
};

export type ActiveGoalWithPlan = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
  isFocus: boolean;
  legend: unknown;
  plans: Array<{
    id: string;
    startedOn: Date;
    endsOn: Date;
    weeks: number;
    planJson: unknown;
  }>;
};

/**
 * Returns the focus goal (isFocus=true), or null when no goal is focused.
 * Deterministically picks the most-recently-updated if multiple are stuck isFocus=true.
 */
export async function getFocusGoal(): Promise<FocusGoalRow | null> {
  const db = await getDb();
  return db.goal.findFirst({
    where: { isFocus: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      objective: true,
      targetDate: true,
      kind: true,
      isFocus: true,
      legend: true,
    },
  });
}

/**
 * Returns all active (tracked) goals, each with their single most-recently-updated
 * active plan. Focus goal appears first (isFocus desc), then by updatedAt.
 * Used by getGoalEvents for the 3-query event fetch.
 */
export async function getActiveGoalsWithPlans(): Promise<ActiveGoalWithPlan[]> {
  const db = await getDb();
  return db.goal.findMany({
    where: { active: true },
    orderBy: [{ isFocus: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      objective: true,
      targetDate: true,
      kind: true,
      isFocus: true,
      legend: true,
      plans: {
        where: { active: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          startedOn: true,
          endsOn: true,
          weeks: true,
          planJson: true,
        },
      },
    },
  });
}
