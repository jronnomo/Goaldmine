// TypeBadge — SERVER COMPONENT
// ScheduledItem type chip, lifted out of ProjectTodayView (UXR-PV-84) so the
// Unified Today timeline and the legacy zero-Program project view share one
// definition. Styling verbatim from the original (UXR-s4-10): task/review
// neutral; milestone accent; launch-step warning.

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${typeBadgeClass(type)}`}>
      {type}
    </span>
  );
}

export function typeBadgeClass(type: string): string {
  switch (type) {
    case "milestone":
      return "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]";
    case "launch-step":
      return "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]";
    default: // task, review, and unknown types
      return "border-[var(--border)] text-[var(--muted)]";
  }
}
