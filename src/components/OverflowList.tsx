// src/components/OverflowList.tsx
//
// SERVER component — extracts the compare/page.tsx:45-66 idiom (UXR-PROG-57,
// UXR-TIA-59 finally built): ≤`headline` rows visible, the rest inside a
// native <details> that expands IN PLACE — never a link to another page
// (RecordsSummary's two hand-rolled variants did exactly that and are
// replaced by this). <summary> carries min-h-11 (44px touch target) and a
// focus ring. Threshold default 4 ⚠[3–5].

import type { ReactNode } from "react";

export function OverflowList<T>({
  items,
  headline = 4,
  keyOf,
  renderItem,
  noun,
  "data-testid": testId,
}: {
  items: readonly T[];
  headline?: number;
  keyOf: (t: T) => string;
  renderItem: (t: T) => ReactNode;
  noun: string;
  "data-testid"?: string;
}) {
  const head = items.slice(0, headline);
  const overflow = items.slice(headline);
  return (
    <div data-testid={testId ?? `overflow-list-${noun}`}>
      {head.map((t) => (
        <div key={keyOf(t)}>{renderItem(t)}</div>
      ))}
      {overflow.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer select-none items-center text-sm text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
            Show all {items.length} {noun}
          </summary>
          {overflow.map((t) => (
            <div key={keyOf(t)}>{renderItem(t)}</div>
          ))}
        </details>
      )}
    </div>
  );
}
