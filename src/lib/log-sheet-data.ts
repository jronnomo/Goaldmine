// src/lib/log-sheet-data.ts
// server-only: uses getDb()/Prisma — matches the comment convention used by
// calendar.ts/compare-core.ts (no "server-only" package dependency in this repo).
//
// Shared pipeline for the Log sheet's meal-block data. Extracted verbatim from
// layout.tsx (#232) so it can be called from both the layout RSC (initial props,
// until #233 removes them) and the session-authed /api/log-sheet-data route
// (LogLauncher's self-fetch on every sheet open).

import { getDb } from "@/lib/db";
import { startOfDay, endOfDay, resolveDay } from "@/lib/calendar";
import { getQuickPickFoods, listLibraryFoods } from "@/lib/food-actions";
import { type NutritionItem, parseStoredItems } from "@/lib/nutrition-log-ops";
import {
  sumLoggedDayMacros,
  sumPlanTargetMacros,
  hasAnyMacros,
  type DayMacros,
} from "@/lib/nutrition-macros";
import type { LibraryFood } from "@/lib/food-types";

/** Serializable per-meal shape threaded to the Log sheet. */
export type TodayMealLite = {
  id: string;
  mealType: string;
  items: NutritionItem[];
  notes: string | null;
  dateISO: string;
  macros: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  };
};

/** Full payload the Log sheet needs: today's meals + composer context. */
export type LogSheetData = {
  todaysMeals: TodayMealLite[];
  quickPickFoods: LibraryFood[];
  libraryFoods: LibraryFood[];
  trackedSoFar: DayMacros;
  dayTarget: DayMacros | null;
};

// Preserve structured fields so the global Log launcher's edit path keeps live
// recalc (a stripping map reverted items to freehand steppers — stale macros on
// size change).
function toNutritionItems(raw: unknown): NutritionItem[] {
  return parseStoredItems(raw);
}

/**
 * Fetch today's logged meals, quick-picks, the full food library, and the
 * tracked-vs-target macro totals for the Log sheet. Byte-identical logic to
 * the pre-#232 layout.tsx pipeline.
 *
 * `now` defaults to `new Date()` internally (not a caller-supplied default) so
 * unit tests can assert the exact `startOfDay`/`endOfDay` call args without
 * mocking global `Date`.
 */
export async function getLogSheetData(now: Date = new Date()): Promise<LogSheetData> {
  const db = await getDb();
  const [rawMeals, quickPickFoods, libraryFoods, today] = await Promise.all([
    db.nutritionLog.findMany({
      where: { date: { gte: startOfDay(now), lte: endOfDay(now) } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        mealType: true,
        items: true,
        notes: true,
        calories: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        fiberG: true,
        sodiumMg: true,
      },
    }),
    getQuickPickFoods(),
    listLibraryFoods(),
    // Override-aware resolved day — the only source of today's per-slot
    // nutrition-plan target. Mirrors /nutrition/page.tsx exactly.
    resolveDay(now),
  ]);

  const todaysMeals: TodayMealLite[] = rawMeals.map((m) => ({
    id: m.id,
    mealType: m.mealType,
    items: toNutritionItems(m.items),
    notes: m.notes,
    dateISO: m.date.toISOString(),
    macros: {
      calories: m.calories,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
      fiberG: m.fiberG,
      sodiumMg: m.sodiumMg,
    },
  }));

  const trackedSoFar: DayMacros = sumLoggedDayMacros(
    todaysMeals.map((m) => m.macros),
  );
  const planTarget = sumPlanTargetMacros(today.nutritionPlan);
  const dayTarget: DayMacros | null = hasAnyMacros(planTarget) ? planTarget : null;

  return { todaysMeals, quickPickFoods, libraryFoods, trackedSoFar, dayTarget };
}
