"use client";

import { useActionState, useState } from "react";
import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/lib/auth/auth-actions";

const CONFIRM_PHRASE = "delete my account";

const initialState: DeleteAccountState = { error: null };

/**
 * #245 — Danger-zone client island for permanent account deletion.
 *
 * Type-to-confirm (no window.confirm): submit stays disabled until the
 * input's trimmed value exactly matches CONFIRM_PHRASE. That client-side
 * gate is UX-only defense-in-depth — deleteAccountAction re-validates the
 * exact same phrase server-side, so a bypassed client check still hits the
 * real gate.
 *
 * useActionState (React 19) — chosen over the useTransition pattern in
 * RevokeConnectionButton.tsx because delete-account has a real
 * server-rejectable case (wrong phrase) whose failure must be surfaced via
 * `role="alert"`; useTransition doesn't hand back the action's return value.
 *
 * iOS input attributes are LOAD-BEARING, not cosmetic: on a phone-first PWA,
 * iOS Safari's default keyboard auto-capitalizes the first letter and offers
 * autocorrect — either would silently mutate "delete my account" into a
 * string that can never satisfy the exact, case-sensitive server match.
 */
export function DeleteAccountSection() {
  const [state, formAction, isPending] = useActionState(
    deleteAccountAction,
    initialState,
  );
  const [value, setValue] = useState("");
  const matches = value.trim() === CONFIRM_PHRASE;

  return (
    <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--background)] overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-[var(--danger)]/30">
        <h2 className="text-sm font-semibold text-[var(--danger)]">
          Delete account
        </h2>
      </div>
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm text-[var(--muted)]">
          This permanently deletes your account and everything in it — all
          goals, workouts, history, nutrition, and connections. This cannot
          be undone.
        </p>

        <form action={formAction} className="space-y-3">
          <div>
            <label
              htmlFor="delete-account-confirmation"
              className="block text-xs font-medium text-[var(--foreground)] mb-1"
            >
              Type <span className="font-semibold">{CONFIRM_PHRASE}</span> to
              confirm
            </label>
            <input
              id="delete-account-confirmation"
              type="text"
              name="confirmation"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              placeholder={CONFIRM_PHRASE}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50"
            />
          </div>

          {state.error && (
            <p
              role="alert"
              className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2"
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={!matches || isPending}
            className="w-full text-sm font-medium px-3 py-2.5 min-h-11 rounded-lg border border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10 active:bg-[var(--danger)]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50"
          >
            {isPending ? "Deleting…" : "Delete my account"}
          </button>
        </form>
      </div>
    </div>
  );
}
