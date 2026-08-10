// src/components/CeilingRule.tsx
//
// Flat gate-ceiling bar (#290, UXR-PV-21 / UXR-PV-92 — signed off as DIVS,
// not inline SVG: the cited precedents (`XpBar`, `ReadinessBreakdown`) are
// divs, and divs give a crisp 2px stile with no viewBox scaling artifact and
// a CSS `repeating-linear-gradient` hatch).
//
// Anatomy: track (the shipped h-1.5 rounded-full grammar) + fill at the
// CAPPED score + a 2px stile at the ceiling + a hatch across the zone above
// it. Stile and hatch render ONLY while a gate holds the ceiling below 100 —
// `ceiling === 100` emits neither. Never an arc, never a ring, never the
// Bullseye (R6; F2 proved `Bullseye progress={0.8}` renders as "done").
//
// A11y: role="progressbar" with aria-valuenow = the CAPPED score, never
// rawScore — the honest headline number is what assistive tech reads too.
//
// Server component — no state, no handlers.

export function CeilingRule({
  score,
  rawScore,
  ceiling,
  ariaLabel,
  "data-testid": testId,
}: {
  /** Capped headline score (Math.min(rawScore, ceiling)). Drives the fill. */
  score: number;
  /** Uncapped weighted score — named in copy, never in aria-valuenow. */
  rawScore: number;
  /** 80 while any gate is open, 100 otherwise. */
  ceiling: number;
  ariaLabel: string;
  "data-testid"?: string;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const capped = ceiling < 100;
  // rawScore is intentionally unused visually beyond the copy the caller
  // renders (UXR-PV-23) — referenced here so the prop contract is explicit.
  void rawScore;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamp(score)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      data-testid={testId}
      className="relative py-1"
    >
      <div className="relative h-1.5 rounded-full bg-[var(--border)]/60 overflow-hidden">
        {capped && (
          <div
            aria-hidden="true"
            data-testid={testId ? `${testId}-hatch` : undefined}
            className="absolute inset-y-0 right-0 opacity-60"
            style={{
              left: `${clamp(ceiling)}%`,
              backgroundImage:
                "repeating-linear-gradient(-45deg, var(--muted) 0px, var(--muted) 1px, transparent 1px, transparent 4px)",
            }}
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
          style={{ width: `${clamp(score)}%` }}
        />
      </div>
      {capped && (
        <div
          aria-hidden="true"
          data-testid={testId ? `${testId}-stile` : undefined}
          className="absolute top-0 bottom-0 w-[2px] rounded-full bg-[var(--foreground)]"
          style={{ left: `calc(${clamp(ceiling)}% - 1px)` }}
        />
      )}
    </div>
  );
}
