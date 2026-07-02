"use client";

import { useTransition } from "react";
import { revokeConnectionAction } from "@/lib/oauth/connection-actions";

interface RevokeConnectionButtonProps {
  clientId: string;
  clientName: string | null;
}

/**
 * Client island — two-step revoke: first click shows confirmation, second
 * click fires the server action. Resets to idle on cancel.
 */
export function RevokeConnectionButton({
  clientId,
  clientName,
}: RevokeConnectionButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleRevoke() {
    const label = clientName ?? "this app";
    const confirmed = window.confirm(
      `Revoke access for "${label}"?\n\nThis will sign out that Claude connection immediately. You can reconnect by authorizing again from claude.ai settings.`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      await revokeConnectionAction(clientId);
    });
  }

  return (
    <button
      type="button"
      onClick={handleRevoke}
      disabled={isPending}
      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 active:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
    >
      {isPending ? "Revoking…" : "Revoke"}
    </button>
  );
}
