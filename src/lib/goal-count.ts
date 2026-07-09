import { cache } from "react";
import { getDb } from "@/lib/db";

/**
 * Total goal count for the signed-in user (all goals, no filter beyond
 * tenant scoping — matches the Today-gate's original `gateDb.goal.count()`
 * call, which had no explicit `where`: getDb()'s Prisma extension already
 * injects `userId` into `count`'s args, so parity is by construction).
 *
 * React.cache → memoized per React request render (no-op outside RSC
 * context). NO module-global (that would leak one user's count across
 * requests) — same shape/precedent as getCurrentUserId in
 * src/lib/auth/current-user.ts.
 *
 * Single source of truth for both layout.tsx (BottomNav's MoreSheet badge)
 * and page.tsx (the /onboarding redirect gate) — dedupes to exactly one
 * `goal.count()` query per `/` request (#248).
 */
export const getGoalCount = cache(async (): Promise<number> => {
  const db = await getDb();
  return db.goal.count();
});
