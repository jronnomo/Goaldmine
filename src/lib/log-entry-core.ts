// Plain async helpers for LogEntry (project-goal metric reading) mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/goal-actions.ts) AND MCP tool registrations
// (src/lib/mcp/tools/project-tools.ts). Adding the directive would constrain
// it to server-action call sites only and break the MCP path.
//
// Dual-caller contract:
//   - Server actions call these cores and then add revalidatePath.
//   - MCP tools call these cores directly — no revalidatePath needed.

import { getDb } from "@/lib/db";
import { ACTIVITY_LINK_TYPE } from "@/lib/activity-links";

// ---------------------------------------------------------------------------
// deleteLogEntryCore (#272 delete-hook consolidation)
// ---------------------------------------------------------------------------

/** Confirmation fields delete_metric echoes back to the coach. */
export interface DeletedLogEntry {
  id: string;
  metric: string;
  value: number | null;
}

/**
 * Delete one LogEntry row AND its ActivityGoalLink rows in the same
 * transaction. Returns the deleted row's confirmation fields, or null when
 * the id does not exist (P2025) — each caller maps null to its own friendly
 * error message (delete_metric: "Log entry not found: <id>";
 * deleteMetricReading: "Reading not found"). Single round-trip: no
 * findUnique-first, the delete's returned row is the confirmation.
 * Sequential top-level tx calls (never nested writes) so the getDb()
 * tenant-scoping extension fires for both deletes.
 */
export async function deleteLogEntryCore(id: string): Promise<DeletedLogEntry | null> {
  const db = await getDb();
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.logEntry.delete({
        where: { id },
        select: { id: true, metric: true, value: true },
      });
      await tx.activityGoalLink.deleteMany({
        where: { activityType: ACTIVITY_LINK_TYPE.logEntry, activityId: id },
      });
      return row;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") return null;
    throw e;
  }
}
