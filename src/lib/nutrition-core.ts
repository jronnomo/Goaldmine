// Plain async helpers for NutritionLog mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/workout-actions.ts) AND MCP route handlers / tool
// registrations (src/lib/mcp/tools.ts). Adding the directive would constrain
// it to server-action call sites only and break the MCP path.
//
// Dual-caller contract:
//   - Server actions call these cores and then add revalidatePath.
//   - MCP tools (tools.ts) call these cores directly — no revalidatePath needed.

import { prisma, getDb } from "@/lib/db";
import { ACTIVITY_LINK_TYPE } from "@/lib/activity-links";

// ---------------------------------------------------------------------------
// deleteNutritionCore (#272 delete-hook consolidation)
// ---------------------------------------------------------------------------

/** Full deleted NutritionLog row — the dashboard delete path snapshots it for
 *  the optimistic-delete/Undo flow (UXR-meal-edit-13). */
export type DeletedNutritionLog = Awaited<
  ReturnType<typeof prisma.nutritionLog.delete>
>;

/**
 * Delete one NutritionLog row AND its ActivityGoalLink rows in the same
 * transaction, returning the deleted row (Prisma delete returns it — keeps
 * the dashboard's single-round-trip snapshot behavior). A missing id throws
 * P2025 from nutritionLog.delete, exactly as the previous inline deletes did.
 * Sequential top-level tx calls (never nested writes) so the getDb()
 * tenant-scoping extension fires for both deletes.
 */
export async function deleteNutritionCore(id: string): Promise<DeletedNutritionLog> {
  const db = await getDb();
  return db.$transaction(async (tx) => {
    const row = await tx.nutritionLog.delete({ where: { id } });
    await tx.activityGoalLink.deleteMany({
      where: { activityType: ACTIVITY_LINK_TYPE.nutrition, activityId: id },
    });
    return row;
  });
}
