/**
 * ConnectClaudePanel — reusable server component.
 *
 * Renders the "connect your Claude" walkthrough and/or connection confirmation.
 * Used on /onboarding/connect (variant="onboarding") and /settings (variant="settings").
 *
 * NO DB calls in this component — the host page calls listConnections and passes
 * the result as props. No "use client" — pure server component.
 *
 * DA nits applied:
 * - When connected: heading = "Claude connector", walkthrough steps collapsed in
 *   <details> to avoid duplicating the Connected-apps card on /settings.
 * - When not connected: heading = "Connect your Claude", steps shown directly.
 */

import Link from "next/link";
import { USER_TZ } from "@/lib/calendar-core";
import { Card } from "@/components/Card";
import { CopyConnectorButton } from "@/components/CopyConnectorButton";
import { CheckConnectionButton } from "@/components/CheckConnectionButton";
import type { Connection } from "@/lib/oauth/connections";

// ---------------------------------------------------------------------------
// Date formatting (USER_TZ, mirrors settings/page.tsx exactly)
// ---------------------------------------------------------------------------

const connectedAtFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: USER_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

function fmtDate(d: Date): string {
  return connectedAtFmt.format(d);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectClaudePanelProps {
  connectorUrl: string;
  connected: boolean;
  connection?: Connection | null;
  variant?: "onboarding" | "settings";
}

// ---------------------------------------------------------------------------
// Sub-component: the numbered steps + URL (shared between connected/not states)
// ---------------------------------------------------------------------------

function ConnectorSteps({ connectorUrl }: { connectorUrl: string }) {
  return (
    <ol className="space-y-3 text-sm">
      <li className="flex gap-3">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
          1
        </span>
        <span className="text-[var(--foreground)] leading-snug">
          In claude.ai, go to{" "}
          <span className="font-medium">
            Settings → Connectors → Add custom connector
          </span>
          .
        </span>
      </li>
      <li className="flex gap-3">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
          2
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--foreground)] leading-snug mb-2">Paste this URL:</p>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--accent)]/5 px-3 py-2">
            <code className="flex-1 text-xs font-mono text-[var(--foreground)] break-all select-all">
              {connectorUrl}
            </code>
            <CopyConnectorButton url={connectorUrl} />
          </div>
        </div>
      </li>
      <li className="flex gap-3">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs flex items-center justify-center font-semibold">
          3
        </span>
        <span className="text-[var(--foreground)] leading-snug">
          Claude sends you to Goaldmine to approve access — click{" "}
          <span className="font-medium">Allow</span>.
        </span>
      </li>
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ConnectClaudePanel({
  connectorUrl,
  connected,
  connection,
  variant = "settings",
}: ConnectClaudePanelProps) {
  const inner = (
    <div className="space-y-4">
      {/* Connected confirmation — shown when connected */}
      {connected && connection && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/8 px-4 py-3">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            ✓ Claude is connected
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {connection.clientName ? (
              <>
                &ldquo;{connection.clientName}&rdquo;{" "}
                <span className="italic">(unverified name)</span> ·{" "}
              </>
            ) : null}
            Connected {fmtDate(connection.connectedAt)}
          </p>
        </div>
      )}

      {/* Heading — changes when connected (DA nit) */}
      <div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          {connected ? "Claude connector" : "Connect your Claude"}
        </h2>
        {!connected && (
          <p className="mt-1 text-sm text-[var(--muted)] leading-relaxed">
            Connect Claude so your coach can read and write your Goaldmine data.
          </p>
        )}
      </div>

      {/* Steps — always shown when not connected; collapsed in <details> when connected (DA nit) */}
      {connected ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors select-none">
            <span className="underline underline-offset-2">Connect another client</span>
          </summary>
          <div className="mt-3 space-y-3">
            <ConnectorSteps connectorUrl={connectorUrl} />
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Claude starts the secure sign-in itself — there&rsquo;s nothing to
              authorize here.
            </p>
          </div>
        </details>
      ) : (
        <>
          <ConnectorSteps connectorUrl={connectorUrl} />
          {/* Clarifying note — no in-app authorize button */}
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Claude starts the secure sign-in itself — there&rsquo;s nothing to
            authorize here.
          </p>
        </>
      )}

      {/* Check-for-connection button */}
      <CheckConnectionButton connected={connected} />

      {/* Onboarding continue/skip — variant only */}
      {variant === "onboarding" && (
        <div className="flex flex-col gap-2 pt-2 border-t border-[var(--border)]">
          <Link
            href="/"
            className="block w-full text-center rounded-xl bg-[var(--accent)] text-white px-4 py-3 text-sm font-medium min-h-[44px] flex items-center justify-center transition-opacity hover:opacity-90"
          >
            Continue to Today →
          </Link>
          <Link
            href="/"
            className="block w-full text-center rounded-xl border border-[var(--border)] text-[var(--muted)] px-4 py-3 text-sm min-h-[44px] flex items-center justify-center hover:text-[var(--foreground)] transition-colors"
          >
            I&rsquo;ll connect later
          </Link>
        </div>
      )}
    </div>
  );

  if (variant === "onboarding") {
    return <Card>{inner}</Card>;
  }

  // settings variant — hand-rolled to match the adjacent Connected-apps card
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] overflow-hidden shadow-sm p-4">
      {inner}
    </div>
  );
}
