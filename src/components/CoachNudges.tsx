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

export function CoachNudges({ nudges }: { nudges: CoachNudge[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <Card title={nudges.length > 0 ? `Coach nudges · ${nudges.length}` : "Coach nudges"}>
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
    </Card>
  );
}
