/**
 * /settings — Connected apps management (C-3b).
 *
 * Server component. dynamic="force-dynamic" — connection state changes on revoke.
 * B-1 middleware gates this route (not in the public allowlist) — redirect to
 * /signin for unauthenticated access. getCurrentUserId also redirects on no session.
 *
 * Dates are formatted in USER_TZ via Intl.DateTimeFormat — no raw Date.toString().
 */

import { getCurrentUserId } from "@/lib/auth/current-user";
import { listConnections } from "@/lib/oauth/connections";
import { RevokeConnectionButton } from "@/components/RevokeConnectionButton";
import { USER_TZ } from "@/lib/calendar-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Date formatting (USER_TZ, no raw Date formatting)
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: USER_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

function fmtDate(d: Date): string {
  return dateFmt.format(d);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SettingsPage() {
  // getCurrentUserId redirects to /signin when there's no session.
  const uid = await getCurrentUserId();
  const connections = await listConnections(uid);

  return (
    <div className="min-h-[calc(100vh-48px)] px-4 py-8">
      <div className="w-full max-w-sm mx-auto space-y-6">
        {/* Page header */}
        <div>
          <h1
            className="font-display text-2xl tracking-tight text-[var(--foreground)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Settings
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Manage how external apps connect to your Goaldmine data.
          </p>
        </div>

        {/* Connected apps card */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Connected apps
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Apps that can access your Goaldmine data via MCP.
            </p>
          </div>

          {connections.length === 0 ? (
            /* Empty state */
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                No apps are connected. Connect Claude from your{" "}
                <span className="text-[var(--foreground)] font-medium">
                  claude.ai settings
                </span>{" "}
                to let it access your Goaldmine data.
              </p>
            </div>
          ) : (
            /* Connection list */
            <ul className="divide-y divide-[var(--border)]">
              {connections.map((conn) => (
                <li key={conn.clientId} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    {/* Connection info */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--foreground)] truncate">
                        {conn.clientName ? (
                          <>
                            &ldquo;{conn.clientName}&rdquo;{" "}
                            <span className="text-xs font-normal text-[var(--muted)]">
                              (unverified name)
                            </span>
                          </>
                        ) : (
                          <span className="text-[var(--muted)]">Unknown app</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Connected {fmtDate(conn.connectedAt)}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        Last used{" "}
                        {conn.lastUsedAt ? fmtDate(conn.lastUsedAt) : "never"}
                      </p>
                    </div>

                    {/* Revoke button */}
                    <div className="flex-shrink-0">
                      <RevokeConnectionButton
                        clientId={conn.clientId}
                        clientName={conn.clientName}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer note */}
        <p className="text-xs text-[var(--muted)] text-center">
          Revoking a connection immediately cuts off that app&rsquo;s access.
          You can reconnect at any time.
        </p>
      </div>
    </div>
  );
}
