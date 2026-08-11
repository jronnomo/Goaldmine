// src/components/progress/SectionRule.tsx
//
// G1 (UXR-PROG-50): exactly TWO of these render on /progress — REPEATABILITY
// and EFFORT. A ZoneDivider-style hairline that gives the honesty prose an
// attachment point and the anchor chips something to land on. These are
// SECTION LABELS, not zone boundaries — this page has no ACT zone (no writes).
// Each rule mirrors its section's render predicate (a rule may never point at
// emptiness). ⚠[20–28px].
//
// The optional `line` is the framing prose §0 says only this page can afford.
//
// Server component.

export function SectionRule({
  label,
  line,
  id,
  "data-testid": testId,
}: {
  label: string;
  /** One framing sentence under the hairline (the teaching surface). */
  line?: string;
  /** Anchor id for the jump chips; carries scroll-mt-16 (UXR-PROG-56). */
  id?: string;
  "data-testid"?: string;
}) {
  return (
    <div id={id} data-testid={testId} className="scroll-mt-16 pt-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {label}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
      </div>
      {line && <p className="mt-0.5 text-xs text-[var(--muted)]">{line}</p>}
    </div>
  );
}
