import type { ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className = "",
  "data-testid": testId,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm ${className}`}
      data-testid={testId}
    >
      {(title || action) && (
        <header className="flex items-center justify-between mb-3">
          {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
