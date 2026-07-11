// src/app/api/export/route.ts
// Session-authed full data export (#246) — one-click JSON download of every
// owned model for the current tenant.
//
// Auth pattern copied from api/log-sheet-data/route.ts (#232's precedent):
// auth() + explicit 401 JSON + runWithUser ALS scoping. NEVER use
// getCurrentUserId() here — it redirect()s to /signin on no session, which
// would surface as a 307 the <a href download> tag can't distinguish from a
// real file.
//
// Byte cap: Vercel's Node.js Serverless Function response body is capped at
// ~4.5 MB (platform limit inherited from the underlying Lambda synchronous
// invocation payload cap). We cap at 4,000,000 bytes, leaving ~500 KB / 11%
// headroom for HTTP framing/header overhead. Founder-scale payload measured
// ~1.37 MB (scripts/measure-export.ts) — see that script's docstring for the
// escalation trigger if a future run exceeds 2.5 MB.
//
// The cap MUST be measured with Buffer.byteLength(json, "utf8"), not
// json.length — `.length` counts UTF-16 code units, not bytes, and would
// undercount any non-ASCII content (accented characters, emoji) that this
// app already stores in free-text fields (Note.body, Workout.notes, etc.).

import { auth } from "@/lib/auth/auth";
import { runWithUser, getDb } from "@/lib/db";
import { buildExportPayload } from "@/lib/export-data";
import { dateKey } from "@/lib/calendar-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Prisma needs Node APIs — matches mcp/route.ts, log-sheet-data/route.ts

const MAX_EXPORT_BYTES = 4_000_000;

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runWithUser(session.user.id, async () => {
    const payload = await buildExportPayload(await getDb());
    const json = JSON.stringify(payload);
    const byteLength = Buffer.byteLength(json, "utf8");

    if (byteLength > MAX_EXPORT_BYTES) {
      // Never truncate — a partial export is worse than a clear failure.
      // No Content-Disposition header on this path (see Attack 9 in the
      // architecture critique: an <a download> tag downloads whatever bytes
      // come back regardless of status, so omitting the header at least lets
      // a curl/fetch caller distinguish success from failure by its presence).
      return Response.json(
        {
          error: "Export too large",
          detail: `Export payload is ${byteLength} bytes, exceeding the ${MAX_EXPORT_BYTES}-byte cap.`,
        },
        { status: 413 },
      );
    }

    return new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="goaldmine-export-${dateKey(new Date())}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
