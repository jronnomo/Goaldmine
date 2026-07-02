/**
 * /onboarding/connect — Step 2 of 2-step onboarding.
 *
 * After creating a first goal (D-1 → redirectTo="/onboarding/connect"), the
 * user lands here to wire their claude.ai connector.
 *
 * Auth gate: middleware gates this route (not in isPublicPath — confirmed in
 * src/lib/auth/route-access.ts). getCurrentUserId() also redirects to /signin
 * if no session (belt-and-suspenders, matches every other protected page).
 *
 * NO goalCount guard — the user has just created a goal and belongs here.
 * Adding a goalCount>0 → redirect("/") guard would create a loop.
 *
 * Continue/skip both go to "/" — this step is optional. No cookie or DB flag.
 */

import { headers } from "next/headers";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { originFromHeaders } from "@/lib/oauth/tokens";
import { listConnections } from "@/lib/oauth/connections";
import { ConnectClaudePanel } from "@/components/ConnectClaudePanel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function OnboardingConnectPage() {
  const uid = await getCurrentUserId();
  const h = await headers();
  const origin = originFromHeaders(h);
  const connectorUrl = `${origin}/api/mcp`;

  const connections = await listConnections(uid);
  const connected = connections.length > 0;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <ConnectClaudePanel
        variant="onboarding"
        connectorUrl={connectorUrl}
        connected={connected}
        connection={connections[0] ?? null}
      />
    </div>
  );
}
