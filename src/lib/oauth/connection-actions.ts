"use server";

/**
 * C-3b: Server action for revoking a connected-app token.
 *
 * OWNERSHIP CRITICAL — userId is ALWAYS sourced from the session (via
 * getCurrentUserId). It is NEVER taken from a client-supplied parameter.
 * A caller cannot revoke another user's tokens by passing a different userId.
 */

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { revokeConnection } from "@/lib/oauth/connections";

/**
 * Revoke all tokens for the current session user's connection to `clientId`.
 *
 * Safe to bind and pass to a form action — clientId is the only external
 * input; the userId always comes from the verified session.
 */
export async function revokeConnectionAction(clientId: string): Promise<void> {
  // getCurrentUserId throws/redirects when there is no session — ensures we
  // only revoke for an authenticated user.
  const uid = await getCurrentUserId();
  await revokeConnection(uid, clientId);
  revalidatePath("/settings");
}
