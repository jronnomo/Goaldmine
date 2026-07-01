import { cache } from "react";
import { FOUNDER_USER_ID } from "./founder";

/**
 * THE Phase-1 swap site (dashboard / RSC / server-action boundary).
 * Phase 0: always the founder. Phase 1: read the session/OAuth identity here.
 * React.cache → memoized per request render. NO module-global (that would leak
 * one user's id across requests). async now so Phase 1 can await a lookup
 * without changing any call site.
 */
export const getCurrentUserId = cache(async (): Promise<string> => {
  return FOUNDER_USER_ID;
});

/**
 * THE Phase-1 swap site (MCP boundary — no React render context, so not cached).
 * Phase 0: returns the founder regardless of token. Phase 1: map the bearer
 * token → the owning user. async for the same forward-compat reason.
 */
export async function resolveUserIdFromToken(_token: string): Promise<string> {
  return FOUNDER_USER_ID;
}
