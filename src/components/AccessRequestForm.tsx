"use client";

// Client form for /request-access. Calls submitAccessRequest directly (NOT
// via useFormFeedback — see the JSDoc on submitAccessRequest in
// src/lib/auth/access-request-actions.ts: that hook treats any resolved
// value, including `{ ok: false }`, as success. This component inspects
// `result.ok` itself and renders `result.error` inline on failure.

import { useState, useTransition } from "react";
import { submitAccessRequest } from "@/lib/auth/access-request-actions";

export function AccessRequestForm({ defaultEmail }: { defaultEmail?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await submitAccessRequest(formData);
      if (result.ok) {
        setSubmittedEmail(String(formData.get("email") ?? "").trim());
      } else {
        setError(result.error);
      }
    });
  }

  if (submittedEmail) {
    return (
      <div className="flex flex-col items-center gap-2 text-center" role="status">
        <p className="text-base font-medium text-[var(--foreground)]">
          Request sent — you&apos;ll hear back at {submittedEmail}.
        </p>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Thanks for your patience while we&apos;re in closed beta.
        </p>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="w-full flex flex-col gap-3 text-left">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-[var(--foreground)]">Email</span>
        <input
          type="email"
          name="email"
          required
          defaultValue={defaultEmail}
          maxLength={254}
          placeholder="you@example.com"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-[var(--foreground)]">
          Note <span className="text-[var(--muted)] font-normal">(optional)</span>
        </span>
        <textarea
          name="note"
          rows={3}
          maxLength={1000}
          placeholder="Tell us a bit about what you'd like to track."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      {/* Honeypot — real users never see or fill this. Hidden visually AND
          from assistive tech (aria-hidden), unreachable by keyboard (tabIndex
          -1), and excluded from autofill. Any non-empty value here is treated
          as a bot submission and silently no-ops (see submitAccessRequest). */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="sr-only"
      />

      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
      >
        {pending ? "Sending…" : "Request access"}
      </button>
    </form>
  );
}
