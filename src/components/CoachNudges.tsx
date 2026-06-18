"use client";

import { useTransition } from "react";
import { Card } from "@/components/Card";
import { ConfirmButton } from "@/components/ConfirmButton";
import { resolveOpenItem } from "@/lib/note-actions";

export type CoachNudge = {
  id: string;
  body: string;
  priority: string | null;
  overdue: boolean;
  targetDateLabel: string | null;
};

export function CoachNudges({
  nudges,
  lastNudgeDaysAgo,
  recapPostedThisWeek = false,
}: {
  nudges: CoachNudge[];
  lastNudgeDaysAgo: number | null;
  recapPostedThisWeek?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const agoLabel =
    lastNudgeDaysAgo === 0
      ? "today"
      : lastNudgeDaysAgo === 1
        ? "1 day ago"
        : `${lastNudgeDaysAgo} days ago`;

  return (
    <Card title={nudges.length > 0 ? `Coach nudges · ${nudges.length}` : "Coach nudges"}>
      {/* Positive confirmation — shown all week once you've shared this week's recap.
          Data-derived from the shared_recap marker (not a transient toast). */}
      {recapPostedThisWeek && (
        <p className="text-sm text-[var(--success)] mb-3">
          <span aria-hidden="true">✓ </span>You&rsquo;ve shared this week&rsquo;s recap
        </p>
      )}
      {nudges.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No coach nudges right now — your coach will surface gate alerts, staleness, and the
          weekly brief here.
        </p>
      ) : (
        <ul className="space-y-2">
          {nudges.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-[var(--border)] p-3 text-sm space-y-1"
            >
              {/* Meta row: priority tag + overdue badge + date label */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {n.priority === "high" && (
                  <span className="uppercase tracking-wide font-semibold text-[var(--danger)]">
                    High priority
                  </span>
                )}
                {n.overdue && (
                  <span className="uppercase tracking-wide font-semibold text-[var(--warning)]">
                    Overdue
                  </span>
                )}
                {n.targetDateLabel && (
                  <span className="text-[var(--muted)]">Due {n.targetDateLabel}</span>
                )}
              </div>

              {/* Body */}
              <p className="whitespace-pre-wrap">{n.body}</p>

              {/* Dismiss action */}
              <div className="flex justify-end pt-1">
                <ConfirmButton
                  label="Dismiss"
                  confirmLabel="Dismiss · confirm"
                  variant="danger"
                  disabled={pending}
                  onConfirm={() => startTransition(() => resolveOpenItem(n.id))}
                  className="text-xs rounded-full border border-[var(--border)] px-3 hover:bg-[var(--danger)] hover:text-white hover:border-[var(--danger)] disabled:opacity-50"
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Staleness footer — only rendered when a routine nudge has been written at least once */}
      {lastNudgeDaysAgo !== null && (
        <p
          className={`text-xs mt-3 pt-2 border-t border-[var(--border)] ${
            lastNudgeDaysAgo > 8 ? "text-[var(--warning)]" : "text-[var(--muted)]"
          }`}
        >
          {lastNudgeDaysAgo > 8
            ? `Last coach brief: ${agoLabel} — the weekly brief may not be running (check claude.ai/code/routines).`
            : `Last coach brief: ${agoLabel}.`}
        </p>
      )}
    </Card>
  );
}
