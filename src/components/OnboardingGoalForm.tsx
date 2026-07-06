"use client";

import { useState, useTransition } from "react";
import { createGoal } from "@/lib/goal-actions";

type Kind = "fitness" | "project";

/**
 * Guided first-goal form for /onboarding.
 *
 * Mirrors the GoalCreateForm.tsx submit pattern exactly:
 * - useTransition + startTransition wrapping the async server action
 * - Re-throws NEXT_REDIRECT so Next.js can perform the redirect on success
 * - Shows inline error on non-redirect failure
 *
 * Hidden inputs:
 * - name="kind"       → the domain-neutral kind choice (fitness|project)
 * - name="redirectTo" → "/" so createGoal lands the user on Today after creation
 *
 * The kind chooser uses role="radiogroup" + role="radio" + aria-checked
 * for accessible mutually-exclusive selection (keyboard-operable).
 */
export function OnboardingGoalForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("fitness");

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          try {
            await createGoal(fd);
          } catch (e) {
            // Re-throw NEXT_REDIRECT so Next.js can handle the redirect
            if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-4"
    >
      {/* Hidden fields — must be inside <form> to be included in FormData */}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="redirectTo" value="/onboarding/connect" />

      {/* Kind chooser — mutually exclusive; role="radiogroup" for a11y */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">What kind of goal?</legend>
        <div
          role="radiogroup"
          aria-label="Goal kind"
          className="grid grid-cols-2 gap-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={kind === "fitness"}
            onClick={() => setKind("fitness")}
            className={`rounded-xl border p-3 text-left text-sm transition-colors min-h-[44px] ${
              kind === "fitness"
                ? "border-[var(--accent)] bg-[var(--accent-soft,color-mix(in_srgb,var(--accent)_10%,transparent))] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50"
            }`}
          >
            <span className="font-medium block">Fitness</span>
            <span className="text-xs opacity-80">Summit a peak, shred, build</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={kind === "project"}
            onClick={() => setKind("project")}
            className={`rounded-xl border p-3 text-left text-sm transition-colors min-h-[44px] ${
              kind === "project"
                ? "border-[var(--accent)] bg-[var(--accent-soft,color-mix(in_srgb,var(--accent)_10%,transparent))] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50"
            }`}
          >
            <span className="font-medium block">Project</span>
            <span className="text-xs opacity-80">Grow MRR, ship a product</span>
          </button>
        </div>
      </fieldset>

      {/* Objective — always shown */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Objective</span>
        <input
          name="objective"
          required
          maxLength={200}
          placeholder={kind === "fitness" ? "Run a sub-2:00 half marathon" : "Ship v1.0 of my app"}
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      {/* Target date — shown for both kinds, copy varies */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          Target date{" "}
          <span className="text-[var(--muted)] font-normal text-xs">
            {kind === "fitness"
              ? "(add a date so we can build your plan)"
              : "(optional)"}
          </span>
        </span>
        <input
          type="date"
          name="targetDate"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base"
        />
      </label>

      {/* Notes — project only */}
      {kind === "project" && (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Notes{" "}
            <span className="text-[var(--muted)] font-normal text-xs">(optional)</span>
          </span>
          <textarea
            name="notes"
            rows={3}
            placeholder="Any context, constraints, or sub-goals."
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
          />
        </label>
      )}

      {/* Inline error — mirrors GoalCreateForm style */}
      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2.5 font-medium disabled:opacity-50 min-h-[44px]"
      >
        {pending ? "Creating…" : "Create goal →"}
      </button>
    </form>
  );
}
