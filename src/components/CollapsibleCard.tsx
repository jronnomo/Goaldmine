import type { ReactNode } from "react";

/** Card-styled <details> — same shell as Card, with a native expand/collapse header. */
export function CollapsibleCard({
  title,
  defaultOpen = false,
  children,
  className = "",
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={`group rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm ${className}`}
    >
      <summary className="flex items-center justify-between gap-2 p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden min-h-[44px]">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span
          aria-hidden
          className="text-[var(--muted)] text-xs shrink-0 transition-transform group-open:rotate-180"
        >
          ▼
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
