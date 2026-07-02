import { cache } from "react";
import { redirect } from "next/navigation";
import { FOUNDER_USER_ID } from "./founder";

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
 * Phase 0: returns the founder regardless of token.
 * Phase C-3a: maps bearer token → owning user (per-user OAuth tokens).
 * Unchanged until C-3a — do not alter here.
 */
export async function resolveUserIdFromToken(_token: string): Promise<string> {
  return FOUNDER_USER_ID;
}
