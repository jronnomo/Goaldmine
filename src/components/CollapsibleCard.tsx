import type { ReactNode } from "react";

/** Card-styled <details> — same shell as Card, with a native expand/collapse header.
 *
 * ⚠ `defaultOpen` hazard (today-page-ia §4.2, UXR-TIA-19/20): <details open>
 * is uncontrolled after mount. On any page a same-page server action can
 * revalidate, `defaultOpen` may depend only on state that cannot change
 * without a full navigation — otherwise React calls removeAttribute("open")
 * and the section slams shut under the user's finger. On the Today page every
 * lid ships a LITERAL constant.
 */
export function CollapsibleCard({
  title,
  defaultOpen = false,
  children,
  className = "",
  digest,
  variant = "default",
  "data-testid": testId,
}: {
  title: string;
  defaultOpen?: boolean;
  // Optional: a lid may render header-only (title + digest) with no body —
  // and React's createElement typing requires optional children for the
  // (type, props, ...children) call form used in .ts tests (children-in-props
  // is banned by react/no-children-prop).
  children?: ReactNode;
  className?: string;
  /** Right-rail digest before the chevron — a closed lid must never be an
   *  empty lid (today-page-ia §2.1). Non-interactive content only: a link
   *  inside <summary> would toggle the disclosure on click. */
  digest?: ReactNode;
  /** "lid" = Tier-3 collapsed-row treatment (today-page-ia §2.1, with the
   *  Tier-2/3 differentiation biased stronger for 390px): muted fg, text-sm,
   *  and a <span> title instead of the Tier-1 h2 — a lid must read one step
   *  quieter than both a primary Card and a full-fg Tier-2 strip. */
  variant?: "default" | "lid";
  "data-testid"?: string;
}) {
  const isLid = variant === "lid";
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className={`group rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm ${className}`}
    >
      <summary className="flex items-center justify-between gap-2 p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden min-h-[44px]">
        {isLid ? (
          <span className="text-sm font-medium text-[var(--muted)] truncate min-w-0 flex-1">
            {title}
          </span>
        ) : (
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        )}
        {digest != null && (
          <span className="text-xs tabular-nums text-[var(--muted)] shrink-0">{digest}</span>
        )}
        {/* UXR-PROG-92: the bare transition-transform silently shipped
            Tailwind's cubic-bezier(0.4,0,0.2,1) — a THIRD easing against
            globals.css's two-easing doctrine. Explicit ease-out brings the
            chevron under the sanctioned pair (at 150ms the difference is
            imperceptible; the doctrine is whole). */}
        <span
          aria-hidden
          className="text-[var(--muted)] text-xs shrink-0 motion-safe:transition-transform motion-safe:ease-out group-open:rotate-180"
        >
          ▼
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
