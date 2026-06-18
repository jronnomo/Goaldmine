// src/lib/footage-core.ts
// Shared, server-side (not "use server") helper for footage operations.
// Imported by footage-actions.ts AND tools.ts — must stay side-effect free.

import { endOfDay } from "@/lib/calendar";
import { prisma } from "@/lib/db";

/**
 * Resolve the completed workout id for the given USER_TZ midnight date.
 * Returns null when no completed workout exists on that day.
 *
 * Shared between log_footage (MCP) and logFootageMarker (server action).
 * Both write paths MUST use this function — do not inline the logic separately.
 *
 * @param dayStart  USER_TZ midnight Date (from parseDateInput or parseDateKey).
 */
export async function resolveWorkoutIdForDay(dayStart: Date): Promise<string | null> {
  const dayEnd = endOfDay(dayStart);
  const w = await prisma.workout.findFirst({
    where: {
      startedAt: { gte: dayStart, lte: dayEnd },
      status: "completed",
    },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return w?.id ?? null;
}
