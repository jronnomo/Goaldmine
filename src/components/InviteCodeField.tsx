"use client";

// Small client island for /signin's invite code input. Renders the real
// form field (name="invite" — read by signInWithGoogle's FormData wrapper)
// plus a debounced/on-blur *advisory* hint calling previewInviteCode.
//
// This is UX only — checkInviteGate (src/lib/auth/auth.ts) remains the sole
// enforcement path. The hint never states a hard negative (never "invalid"),
// since previewInviteCode can't distinguish "unknown" from "exhausted" from
// "expired" by design, and a confident-sounding negative here would read as
// enforcement it isn't.

import { useRef, useState, useTransition } from "react";
import { previewInviteCode } from "@/lib/auth/auth-actions";

const DEBOUNCE_MS = 400;

type Advisory = "valid" | "unchecked" | null;

export function InviteCodeField({ defaultValue }: { defaultValue?: string }) {
  const [advisory, setAdvisory] = useState<Advisory>(null);
  const [, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function runPreview(rawValue: string) {
    const code = rawValue.trim();
    if (!code) {
      setAdvisory(null);
      return;
    }
    startTransition(async () => {
      const looksValid = await previewInviteCode(code);
      setAdvisory(looksValid ? "valid" : "unchecked");
    });
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!value.trim()) {
      setAdvisory(null);
      return;
    }
    timeoutRef.current = setTimeout(() => runPreview(value), DEBOUNCE_MS);
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    runPreview(e.target.value);
  }

  return (
    <label className="flex flex-col gap-1 mb-5">
      <span className="text-sm font-medium text-[var(--foreground)]">
        Invite code <span className="text-[var(--muted)] font-normal">(optional)</span>
      </span>
      <input
        type="text"
        name="invite"
        defaultValue={defaultValue}
        maxLength={64}
        autoComplete="off"
        onChange={handleChange}
        onBlur={handleBlur}
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
      />
      <span className="text-xs text-[var(--muted)] min-h-[1rem]" aria-live="polite">
        {advisory === "valid" && "Code looks valid ✓"}
        {advisory === "unchecked" && "This code will be checked when you continue"}
      </span>
    </label>
  );
}
