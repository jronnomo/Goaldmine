import { cache } from "react";
import { redirect } from "next/navigation";
import { FOUNDER_USER_ID } from "./founder";
import { hashSecret, timingSafeEqualStr } from "@/lib/oauth/tokens";

/**
 * THE Phase-1 swap (dashboard / RSC / server-action boundary).
 * Phase 0: always the founder. Phase 1 (this commit): reads the Auth.js session.
 *
 * Returns the signed-in user's id, or throws a NEXT_REDIRECT to /signin when
 * no session is active — NEVER silently defaults to the founder. Every
 * `getDb()` call on the RSC / server-action path scopes to the session user.
 *
 * React.cache → memoized per React request render (no-op outside RSC context,
 * per the React 19 development build). NO module-global (that would leak one
 * user's id across requests).
 *
 * IMPORT-CYCLE NOTE: `auth` is imported lazily (dynamic import) to break the
 * circular dependency that would otherwise arise:
 *   db.ts → current-user.ts → auth.ts → prisma from db.ts  (cycle → TDZ crash)
 * Dynamic import defers resolution past module initialisation, avoiding the
 * Turbopack temporal-dead-zone error. vitest's vi.mock() intercepts dynamic
 * imports, so tests are unaffected.
 */
export const getCurrentUserId = cache(async (): Promise<string> => {
  const { auth } = await import("@/lib/auth/auth");
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  return session.user.id;
});

/**
 * THE MCP boundary swap site (no React render context, so not cached).
 *
 * C-3a: maps bearer token → owning userId via OAuth access-token lookup.
 * Falls back to the legacy shared-token path when:
 *   1. ALLOW_LEGACY_MCP_TOKEN=true (env flag, NOT NODE_ENV — Vercel sets
 *      production on ALL deploys; this flag is for the founder-continuity
 *      window during cutover).
 *   2. MCP_AUTH_TOKEN is set and matches the incoming token (timing-safe).
 *
 * Returns null when no valid identity can be established — the caller
 * (route.ts) MUST null-guard before calling runWithUser.
 *
 * Import cycle note: `prisma` is lazily imported (dynamic import) to break
 * the circular dep that would otherwise arise:
 *   db.ts → current-user.ts → db.ts  (cycle → Turbopack TDZ crash)
 * Dynamic import defers resolution past module initialisation. At request
 * time, all modules are fully loaded, so the dynamic import is a no-op
 * cache hit (fast). vi.mock() in vitest intercepts dynamic imports too.
 *
 * Security invariants (DA-hardened revisions):
 *  - lastUsedAt update is fire-and-forget (DO NOT await) with .catch(() => {})
 *    so a slow DB write never blocks the MCP request.
 *  - timingSafeEqualStr guards the legacy token comparison with a length-check
 *    before timingSafeEqual (prevents throw on length mismatch).
 *  - hashSecret produces a stable hex digest; stored token hashes are hex.
 */
export async function resolveUserIdFromToken(token: string): Promise<string | null> {
  // ── 1. Per-user OAuth access token lookup ─────────────────────────────────
  const { prisma } = await import("@/lib/db");

  const at = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash: hashSecret(token) },
    select: { userId: true, expiresAt: true, revokedAt: true },
  });

  if (at && !at.revokedAt && at.expiresAt > new Date()) {
    // Fire-and-forget — MUST .catch; DO NOT await
    prisma.oAuthAccessToken
      .update({ where: { tokenHash: hashSecret(token) }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return at.userId;
  }

  // ── 2. Legacy shared-token fallback (founder-continuity window) ───────────
  if (
    process.env.ALLOW_LEGACY_MCP_TOKEN === "true" &&
    process.env.MCP_AUTH_TOKEN &&
    timingSafeEqualStr(token, process.env.MCP_AUTH_TOKEN)
  ) {
    return FOUNDER_USER_ID;
  }

  return null;
}
