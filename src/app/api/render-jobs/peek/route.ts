// Cheap polling endpoint for the GPU-box cron to check whether any render work
// is queued — so it can decide to spin up a Claude session without wasting tokens
// when the queue is empty.
//
// Includes a stale-claim reaper (story #117 [A5]) that runs post-auth, pre-read:
//   - claimed  jobs older than 30 min → pending  (re-queue stuck draft-run claims)
//   - rendering jobs older than 30 min → approved (re-queue stuck render-run claims)
// Terminal statuses (rendered, failed) and other statuses are never touched.
// The reaper is idempotent: a second call within the window reaps nothing new.
//
// Auth mirrors src/app/api/mcp/[token]/route.ts:
//   - Bearer token in Authorization header.
//   - Constant-time compare (length-guard + XOR) so timing doesn't leak a prefix.
//   - 404 on mismatch/missing (same as [token] route — no header that signals validity).
//   - 500 when MCP_AUTH_TOKEN is unset.

import { prisma } from "@/lib/db";
import { dateKey } from "@/lib/calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    return new Response("Server misconfigured: MCP_AUTH_TOKEN not set", { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token || !timingSafeEqual(token, expected)) {
    return new Response("Not Found", { status: 404 });
  }

  // Stale-claim reaper: re-queue jobs whose worker died mid-claim (story #117 [A5]).
  // claimedAt is an absolute UTC instant — Date.now() arithmetic is timezone-agnostic.
  // Do NOT route through @/lib/calendar date-key helpers (those operate on USER_TZ day keys).
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  const [reapedClaimed, reapedRendering] = await Promise.all([
    // SYSTEM: raw prisma — cross-user render worker (Phase 1: multi-tenant worker pattern)
    prisma.dayRenderJob.updateMany({
      where: { status: "claimed", claimedAt: { lt: staleBefore } },
      data: { status: "pending", claimedAt: null },
    }),
    // SYSTEM: raw prisma — cross-user render worker (Phase 1: multi-tenant worker pattern)
    prisma.dayRenderJob.updateMany({
      where: { status: "rendering", claimedAt: { lt: staleBefore } },
      data: { status: "approved", claimedAt: null },
    }),
  ]);

  // Two findFirst + two count — all independent, run in parallel.
  // Runs after the reaper so the response reflects reaped-and-re-queued state.
  const [pendingCount, nextJob, approvedCount, nextApprovedJob] = await Promise.all([
    // SYSTEM: raw prisma — cross-user render worker (Phase 1: multi-tenant worker pattern)
    prisma.dayRenderJob.count({ where: { status: "pending" } }),
    // SYSTEM: raw prisma — cross-user render worker (Phase 1: multi-tenant worker pattern)
    prisma.dayRenderJob.findFirst({
      where: { status: "pending" },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    }),
    // SYSTEM: raw prisma — cross-user render worker (Phase 1: multi-tenant worker pattern)
    prisma.dayRenderJob.count({ where: { status: "approved" } }),
    // SYSTEM: raw prisma — cross-user render worker (Phase 1: multi-tenant worker pattern)
    prisma.dayRenderJob.findFirst({
      where: { status: "approved" },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    }),
  ]);

  return Response.json({
    pendingCount,
    nextJob: nextJob ? { id: nextJob.id, date: dateKey(nextJob.date) } : null,
    approvedCount,
    nextApprovedJob: nextApprovedJob
      ? { id: nextApprovedJob.id, date: dateKey(nextApprovedJob.date) }
      : null,
    reaped: { claimed: reapedClaimed.count, rendering: reapedRendering.count },
  });
}

// Constant-time string compare so timing doesn't leak a prefix of the token.
// Length mismatch is checked first to avoid allocating equal-length buffers
// when the strings are obviously different.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
