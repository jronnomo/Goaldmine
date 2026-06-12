"use client";

// SkipDayControl — REQ-65-2 skip/unskip island.
//
// DA fixes encoded:
//   H2 — title passed in from parent as templateTitle (used in skipDay server action)
//   H3 — hidden entirely when isRestDay || !isInPlan (UI gate; action also throws)
//   M4 — unskipDay uses deleteMany backstop in the server action
// UXR copy: honest-not-guilt framing ("Logging rest, not failure").

import { useState, useTransition } from "react";
import { skipDay, unskipDay } from "@/lib/day-log-actions";
import { ConfirmButton } from "@/components/ConfirmButton";

interface ExistingSkip {
  id: string;
  notes: string | null;
}

interface SkipDayControlProps {
  dateKey: string;
  templateTitle: string | null;
  isRestDay: boolean;
  isInPlan: boolean;
  existingSkip: ExistingSkip | null;
}

export function SkipDayControl({
  dateKey,
  templateTitle,
  isRestDay,
  isInPlan,
  existingSkip,
}: SkipDayControlProps) {
  // DA H3: hidden entirely for rest days or days outside the plan.
  if (isRestDay || !isInPlan) return null;

  return (
    <SkipDayControlInner
      dateKey={dateKey}
      templateTitle={templateTitle}
      existingSkip={existingSkip}
    />
  );
}

function SkipDayControlInner({
  dateKey,
  templateTitle,
  existingSkip,
}: {
  dateKey: string;
  templateTitle: string | null;
  existingSkip: ExistingSkip | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(existingSkip?.notes ?? "");

  function handleSkip() {
    setError(null);
    startTransition(async () => {
      try {
        await skipDay({
          dateKey,
          reason: reason.trim() || null,
          templateTitle,
          isRestDay: false,
          isInPlan: true,
        });
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function handleUnskip() {
    setError(null);
    startTransition(async () => {
      try {
        await unskipDay(dateKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // When a skip already exists, show the muted "Skipped" line + un-skip control.
  if (existingSkip) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-[var(--muted)]">
              <span className="font-medium text-[var(--foreground)]">Day acknowledged</span>
              {existingSkip.notes && (
                <span className="ml-1">— {existingSkip.notes}</span>
              )}
            </p>
          </div>
          <ConfirmButton
            label="Un-skip"
            confirmLabel="Un-skip · confirm"
            onConfirm={handleUnskip}
            disabled={pending}
            variant="accent"
            className="rounded-lg border border-[var(--accent)]/40 text-[var(--accent)] text-xs px-3 py-1.5 shrink-0"
          />
        </div>
        {error && (
          <p className="text-xs text-[var(--danger)]">{error}</p>
        )}
      </div>
    );
  }

  // Collapsed state — flat-muted door (not accent).
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full min-h-[44px] rounded-2xl border border-[var(--border)] text-[var(--muted)] text-sm flex items-center justify-center gap-2 hover:border-[var(--muted)] hover:text-[var(--foreground)] transition"
      >
        Log rest day
      </button>
    );
  }

  // Expanded state.
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Log rest day</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Logging rest, not failure — life happens.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition"
        >
          ×
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
          Reason (optional)
        </span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Travel, sick day, recovery…"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y placeholder:text-[var(--muted)]"
        />
      </label>

      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSkip}
        disabled={pending}
        className="w-full min-h-[44px] rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)] disabled:opacity-50 transition"
      >
        {pending ? "Saving…" : "Mark as rest day"}
      </button>
    </div>
  );
}
