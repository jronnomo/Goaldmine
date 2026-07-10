// src/app/api/log-sheet-data/route.ts
// Session-authed JSON read for the Log sheet (#232). LogLauncher fetches this
// on every closed→open transition so the sheet never renders stale
// layout-threaded props mid-session.
//
// Auth pattern (new precedent for this repo): auth() + explicit 401 JSON +
// runWithUser ALS scoping. Middleware's isPublicPath cookie gate is
// presence-only (307 on no cookie) — this handler's auth() check is the
// authoritative layer (401 on missing/invalid session).
//
// NEVER use getCurrentUserId() here — it redirect()s to /signin on no
// session (current-user.ts), which would surface as a 307 that a same-origin
// fetch() follows silently into HTML instead of a clean 401 JSON body.

import { auth } from "@/lib/auth/auth";
import { runWithUser } from "@/lib/db";
import { getLogSheetData } from "@/lib/log-sheet-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Prisma needs Node APIs — matches mcp/route.ts, peek/route.ts

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runWithUser(session.user.id, async () => {
    const data = await getLogSheetData();
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  });
}
