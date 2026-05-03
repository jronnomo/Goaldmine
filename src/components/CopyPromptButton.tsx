"use client";

import { useState } from "react";

export function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`text-xs rounded-full px-3 py-1 border transition ${
        copied
          ? "border-emerald-500/40 text-emerald-500"
          : "border-[var(--border)] text-[var(--muted)] hover:text-foreground hover:border-[var(--accent)]"
      }`}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
