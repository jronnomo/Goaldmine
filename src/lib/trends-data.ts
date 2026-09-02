// CONTRACT STUB — Stream C replaces this file's bodies (blueprint §2.6).
/* eslint-disable @typescript-eslint/no-unused-vars -- throwing stub bodies;
   Stream C's real implementations use every parameter. Remove with the stubs. */
//
// Server data layer — imports @/lib/db and @/lib/calendar; never import from
// client components.

import type { ScopedClient } from "@/lib/db";   // exported at db.ts:255
import type { DailyPoint, MacroTargets } from "@/lib/trends-core";

export type TrendsPageData = {
  points: DailyPoint[];            // FULL-HISTORY day grid: [first day with any data … today], asc, server-labelled (§10.D3)
  targets: MacroTargets | null;    // today's plan macro targets; null when no plan or no macros
  rangeKey: "30d" | "90d" | "all"; // echo of the requested chip (initial client state)
  initialWindow: { fromT: number; toT: number } | null;   // from valid ?from=&to=, epoch-ms USER_TZ midnights
  shape: "zero" | "populated";     // zero ⇢ all three row sets empty ⇢ page renders EmptyState, no island
};

export async function getTrendsPageData(opts: {
  rangeKey: "30d" | "90d" | "all";
  from?: Date | null;
  to?: Date | null;
}): Promise<TrendsPageData> {
  throw new Error("stub — Stream C implements (REQ-007)");
}

/** Shared by the page and get_trend_window (§0.S2). ALL three finders pass omit:{userId:true}. */
export async function fetchDailyPoints(
  db: ScopedClient,
  opts: { from?: Date | null; to: Date },   // from omitted ⇒ grid starts at the earliest row across the three models
): Promise<DailyPoint[]> {
  throw new Error("stub — Stream C implements (REQ-007)");
}

/** resolveDay(new Date()).nutritionPlan → sumPlanTargetMacros → null unless hasAnyMacros. Shared by page + tool. */
export async function getAdherenceTargets(): Promise<MacroTargets | null> {
  throw new Error("stub — Stream C implements (REQ-007)");
}
