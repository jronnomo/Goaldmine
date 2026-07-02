"use client";

import { useState } from "react";

/**
 * Copies the connector URL to the clipboard.
 *
 * Silent no-op on clipboard API failure (http origin, permission denied) —
 * the URL is still visible and selectable in the parent <code> block.
 * Min-h-[44px] satisfies the 44px mobile tap-target requirement.
 */
export function CopyConnectorButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      const id = setTimeout(() => setCopied(false), 2000);
      // Clear timeout on fast double-click (idempotent)
      return () => clearTimeout(id);
    } catch {
      // Clipboard API unavailable (http origin, permission denied).
      // URL is still visible + selectable in the <code> block — no-op gracefully.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex-shrink-0 text-xs font-medium px-2 py-1 rounded-md border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)]/50 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      aria-label="Copy connector URL"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}
