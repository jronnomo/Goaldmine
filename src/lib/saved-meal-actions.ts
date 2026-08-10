"use server";

// SavedMeal reads + writes for the composer (#296 quick-pick, bundle
// save/delete). "use server" so the client composer hook can lazy-fetch /
// mutate (the getQuickPickFoods precedent in food-actions.ts) while server
// callers (getLogSheetData, the /nutrition page RSC) invoke reads directly.
//
// getDb() only — SavedMeal is an owned model; never the raw prisma singleton
// (issue #296 AC). userId never crosses the boundary (explicit select).

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { NutritionItem } from "@/lib/nutrition-log-ops";
import { parseStoredItems } from "@/lib/nutrition-log-ops";
import type { NutritionMacros } from "@/lib/nutrition-plan";
import {
  buildSavedMealItemsFromComposition,
  parseSavedMealMacros,
  toSavedMealLite,
  type SavedMealLite,
} from "@/lib/saved-meal";

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

export type CreateSavedMealResult =
  | { ok: true; id: string; name: string; updated: boolean; message: string }
  | { ok: false; error: string };

/**
 * "Save as meal" from the composer: capture the CURRENT composed items (with
 * their save-time source snapshots / foodIds / itemMacros where known — §B.5
 * snapshot-off-at-save doctrine) plus the composer's macro totals, under a
 * user-chosen name. UPSERT-BY-NAME semantics match the MCP save_meal tool
 * exactly: one meal per name (case-insensitive), re-saving replaces items /
 * macros / defaultServings in place and keeps the new casing.
 *
 * Items arrive from the client and are re-validated server-side through the
 * same defensive parsers the read path uses — nothing client-shaped is
 * trusted into the Json column.
 */
export async function createSavedMealFromComposition(input: {
  name: string;
  items: NutritionItem[];
  macros?: NutritionMacros;
  defaultServings?: number;
}): Promise<CreateSavedMealResult> {
  try {
    const name = (input.name ?? "").trim().slice(0, 120);
    if (!name) return { ok: false, error: "Name the meal first." };

    // Defensive round-trip: parseStoredItems drops malformed rows and strips
    // unknown keys; buildSavedMealItemsFromComposition lifts foodId from the
    // source snapshot and fills itemMacros where computable.
    const cleanItems = buildSavedMealItemsFromComposition(
      parseStoredItems(input.items),
    );
    if (cleanItems.length === 0) {
      return { ok: false, error: "Add at least one item before saving a meal." };
    }
    const macros = parseSavedMealMacros(input.macros);
    const defaultServings =
      typeof input.defaultServings === "number" &&
      Number.isFinite(input.defaultServings) &&
      input.defaultServings > 0
        ? input.defaultServings
        : 1;

    const db = await getDb();
    // Upsert-by-name (the save_meal contract): the scoped client injects
    // userId into the where, so the case-insensitive match only ever sees the
    // caller's own meals.
    const existing = await db.savedMeal.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      const updated = await db.savedMeal.update({
        where: { id: existing.id },
        data: {
          name, // latest casing wins
          items: cleanItems as Prisma.InputJsonValue,
          // Replace semantics (matches save_meal): a re-save describes the
          // meal fully — absent macros clear any previously stored macros.
          macros:
            macros === undefined ? Prisma.DbNull : (macros as Prisma.InputJsonValue),
          defaultServings,
        },
        select: { id: true, name: true },
      });
      revalidatePath("/nutrition");
      return {
        ok: true,
        id: updated.id,
        name: updated.name,
        updated: true,
        message: `Updated “${updated.name}” — same name, replaced in place.`,
      };
    }

    const created = await db.savedMeal.create({
      data: {
        name,
        items: cleanItems as Prisma.InputJsonValue,
        ...(macros !== undefined && { macros: macros as Prisma.InputJsonValue }),
        defaultServings,
      },
      select: { id: true, name: true },
    });
    revalidatePath("/nutrition");
    return {
      ok: true,
      id: created.id,
      name: created.name,
      updated: false,
      message: `Saved “${created.name}” — it's in your Saved meals row now.`,
    };
  } catch {
    return { ok: false, error: "Couldn't save the meal — try again." };
  }
}

/**
 * Quick-delete for the bundle sheet. Same core write as the MCP
 * delete_saved_meal tool (scoped savedMeal.delete — past NutritionLog rows
 * logged from the meal are untouched). Never throws — returns ok:false so the
 * sheet can keep the chip on failure.
 */
export async function deleteSavedMeal(id: string): Promise<{ ok: boolean }> {
  try {
    const db = await getDb();
    await db.savedMeal.delete({ where: { id } });
    revalidatePath("/nutrition");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
