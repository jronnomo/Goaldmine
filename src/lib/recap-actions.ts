// src/lib/recap-actions.ts
//
// "use server" — all exports MUST be async functions (Next.js App Router rule).
// No sync helpers, consts, or types in this file; those belong in calendar-core.ts
// or a shared types module.
//
// revalidatePath clears the client-side router cache for the given path.
// Both /recap and /coach are force-dynamic, so there is no full-route server
// cache to flush — revalidatePath's role here is cache invalidation for the
// client-side RSC payload, so the next navigation fetches fresh data.
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { startOfWeekMonday, addDays, weekRangeLabel } from "@/lib/calendar";

/**
 * Called by RecapClient after any completed share (native Web Share success OR
 * fallback download). Best-effort — never throws to the caller; returns
 * { posted: false } on DB failure (the share itself already succeeded).
 *
 * Steps:
 *   1. Clamp + trunc weekOffset to [-12, 0]  (REV-5/S-1)
 *   2. Compute the week's Monday (USER_TZ-correct via @/lib/calendar)
 *   3. Idempotent create: calendar-day RANGE query for shared_recap (REV-1/CRIT-1)
 *   4. Clear active routine nudge: resolve newest unresolved [week: open_item
 *   5. revalidatePath("/recap") + revalidatePath("/coach")
 *
 * NOTE on MCP: a log_note with type:"shared_recap" SHOULD pass
 * targetDate = the week's Monday (yyyy-mm-dd), otherwise the web idempotency
 * guard (step 3) won't find the MCP-written marker and may create a duplicate.
 */
export async function markRecapPosted(
  weekOffset: number,
): Promise<{ posted: boolean }> {
  try {
    // 1. Clamp + trunc — reject floats and values outside [-12, 0]  (REV-5)
    const clampedOffset = Math.max(-12, Math.min(0, Math.trunc(weekOffset)));

    // 2. Compute Monday (USER_TZ-aware; no raw setHours/getDate)
    const now = new Date();
    const thisMonday = startOfWeekMonday(now);
    const monday = addDays(thisMonday, clampedOffset * 7);

    // 3. Idempotent create — calendar-day RANGE, not exact-ms equality  (REV-1/CRIT-1)
    //    Tolerates notes written by MCP with a non-midnight targetDate on the same day.
    const existing = await prisma.note.findFirst({
      where: {
        type: "shared_recap",
        targetDate: { gte: monday, lt: addDays(monday, 1) },
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.note.create({
        data: {
          type: "shared_recap",
          targetDate: monday, // week's Monday 00:00 USER_TZ — the canonical week key
          date: now, // when the share happened
          body: `Shared recap for ${weekRangeLabel(now, clampedOffset)}`,
          // e.g. "Shared recap for Jun 9 – Jun 15"
        },
      });
    }

    // 4. Clear the active recap-ready nudge (newest unresolved [recap: open_item).
    //    This is the nudge that posting actually satisfies — written each Sunday
    //    by the proactive-coach routine's recap-ready step (#94, prefix
    //    "[recap:YYYY-Www]"). We deliberately do NOT touch "[week:" coaching-brief
    //    nudges — those carry unrelated weekly guidance the user may not have acted on.
    //    Resolves regardless of which historical week was shared (clear the current
    //    active recap nudge, per the #95 "stop nagging" decision).
    const nudge = await prisma.note.findFirst({
      where: {
        type: "open_item",
        resolvedAt: null,
        body: { startsWith: "[recap:" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (nudge) {
      await prisma.note.update({
        where: { id: nudge.id },
        data: {
          resolvedAt: now,
          resolvedReason: "recap posted from /recap",
        },
      });
    }
    // No active recap-ready nudge → silent no-op; the shared_recap marker is still created.

    // 5. Revalidate both affected paths (unconditional).
    //    revalidatePath clears the client-side router cache; both pages are
    //    force-dynamic so there is no server full-route cache to flush.
    revalidatePath("/recap");
    revalidatePath("/coach");

    return { posted: true };
  } catch {
    // Best-effort — the share already succeeded; never surface a DB error to the user.
    return { posted: false };
  }
}
