// src/components/EmptyState.tsx
//
// Shared empty-state block (#290, UXR-PV-81 seeds it). The house grammar the
// existing hand-rolled sites use: a quiet title, muted body copy, an optional
// accent action link — never an alarmed tone (an empty state is a normal
// day-one condition, not an error).
//
// v1 consumer is /program only; migrating the other hand-rolled sites onto it
// (Today / calendar, currently byte-identical to each other) is follow-up
// work in files owned by other in-flight branches.
//
// Server component — render-only.

import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
  icon,
  "data-testid": testId,
}: {
  title: string;
  body: ReactNode;
  /** Optional action row (a Link, usually accent-colored). */
  action?: ReactNode;
  icon?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div className="py-6 px-2 text-center" data-testid={testId}>
      {icon && (
        <div className="mb-2 flex justify-center text-[var(--muted)]" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="font-medium">{title}</p>
      <div className="text-sm text-[var(--muted)] mt-1">{body}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
