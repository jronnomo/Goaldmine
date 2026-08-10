"use server";

// SavedMeal reads for the composer quick-pick (#296). "use server" so the
// client composer hook can lazy-fetch it on mount (the getQuickPickFoods
// precedent in food-actions.ts) while server callers (getLogSheetData, the
// /nutrition page RSC) invoke it directly.
//
// getDb() only — SavedMeal is an owned model; never the raw prisma singleton
// (issue #296 AC). userId never crosses the boundary (explicit select).
//
// Creation stays MCP-only for now (save_meal / list_saved_meals) — there is
// deliberately NO create/update action here; the composer's empty state
// points users at their coach instead.

import { getDb } from "@/lib/db";
import { toSavedMealLite, type SavedMealLite } from "@/lib/saved-meal";

/**
 * The user's saved meals for the quick-pick chips row, name-ascending (the
 * shipped list_saved_meals ordering — SavedMeal has no usage columns to
 * mirror getQuickPickFoods' favorite/usage sort with). Cap matches the food
 * quick-pick's shipped `limit = 8` (research band ⚠[6–12]).
 */
export async function listSavedMealsLite(limit = 8): Promise<SavedMealLite[]> {
  const db = await getDb();
  const rows = await db.savedMeal.findMany({
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      items: true,
      macros: true,
      defaultServings: true,
    },
  });
  return rows.map(toSavedMealLite);
}
