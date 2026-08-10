// Plain async helpers for Measurement mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions AND MCP route handlers / tool registrations (src/lib/mcp/tools.ts).
// Adding the directive would constrain it to server-action call sites only
// and break the MCP path.
//
// Dual-caller contract:
//   - Server actions call these cores and then add revalidatePath.
//   - MCP tools (tools.ts) call these cores directly — no revalidatePath needed.

import { getDb } from "@/lib/db";
import { ACTIVITY_LINK_TYPE } from "@/lib/activity-links";

// ---------------------------------------------------------------------------
// deleteMeasurementCore (#272 delete-hook consolidation)
// ---------------------------------------------------------------------------

/**
 * Delete one Measurement row AND its ActivityGoalLink rows in the same
 * transaction. A missing id throws P2025 from measurement.delete, exactly as
 * the previous inline delete did. Sequential top-level tx calls (never nested
 * writes) so the getDb() tenant-scoping extension fires for both deletes.
 */
export async function deleteMeasurementCore(id: string): Promise<{ id: string }> {
  const db = await getDb();
  await db.$transaction(async (tx) => {
    await tx.measurement.delete({ where: { id } });
    await tx.activityGoalLink.deleteMany({
      where: { activityType: ACTIVITY_LINK_TYPE.measurement, activityId: id },
    });
  });
  return { id };
}
