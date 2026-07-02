// src/components/compare/DeltaRow.tsx
//
// One compared-metric row for /compare — DeltaRow v2 per the UX amendment
// (architecture-blueprint-v2-ux-amendment.md §5) + pixel mockup
// docs/ux-research/glance-back-forge-ahead.html.
//
// Server-safe (no "use client"). All delta/improved/formatting logic lives in
// compare-core's buildEntry — this component only renders the frozen
// CompareEntry shape, never recomputes.
//
// Tri-state chip:
//   improved  → ▲ glyph, success digits, success/40 pill border
//   regressed → ▼ glyph, FOREGROUND digits (never danger digits — --danger on
//               dark coal is 3.4:1 and fails AA) + danger/40 pill border
//   neutral/unchanged → – glyph, muted digits
//   newSinceA → accent-soft "new" pill (formattedA suppressed via "—")
// The chip carries .macro-flash (existing globals.css keyframe, reduced-motion
// guarded there) — a fresh server-rendered element on every navigation, so no
// JS toggle is needed for the one-shot wash.

import type { CompareEntry } from "@/lib/compare-core";

/** Units already embedded by formatValue ("%"/"$") or rendered as a duration
 *  ("sec" → "12:58") get no trailing suffix; everything else ("lb", "g",
 *  "ft"…) is appended once after the B value, per the pixel mockup. */
function unitSuffix(units: string): string | null {
  if (units === "" || units === "%" || units === "$" || units === "sec") return null;
  return units;
}

export function DeltaRow({ entry }: { entry: CompareEntry }) {
  const suffix = unitSuffix(entry.units);

  const chipBase =
    "macro-flash inline-flex items-center gap-1 justify-self-end whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums";

  let chip: React.ReactNode;
  if (entry.newSinceA) {
    chip = (
      <span
        className="macro-flash inline-flex items-center justify-self-end whitespace-nowrap rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]"
        aria-label="new since then"
      >
        new
      </span>
    );
  } else if (entry.improved === true) {
    chip = (
      <span
        className={`${chipBase} border-[var(--success)]/40 text-[var(--success)]`}
        aria-label={`${entry.formattedDelta}, improved`}
      >
        <span aria-hidden className="text-[9px] leading-none">
          ▲
        </span>
        {entry.formattedDelta}
      </span>
    );
  } else if (entry.improved === false) {
    chip = (
      <span
        className={`${chipBase} border-[var(--danger)]/40 text-[var(--foreground)]`}
        aria-label={`${entry.formattedDelta}, regressed`}
      >
        <span aria-hidden className="text-[9px] leading-none">
          ▼
        </span>
        {entry.formattedDelta}
      </span>
    );
  } else {
    // improved === null: delta 0 ("unchanged"), neutral direction (no valence
    // asserted), or no comparable pair — muted, no judgment color.
    chip = (
      <span
        className={`${chipBase} border-[var(--border)] text-[var(--muted)]`}
        aria-label={entry.delta === 0 ? `${entry.formattedDelta}, unchanged` : undefined}
      >
        <span aria-hidden className="text-[9px] leading-none">
          –
        </span>
        {entry.formattedDelta}
      </span>
    );
  }

  return (
    <div
      data-testid="delta-row"
      className="grid min-h-11 grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-[var(--border)] first:border-t-0"
    >
      <span className="truncate text-sm" title={entry.label}>
        {entry.label}
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums">
        <span className="text-[var(--muted)]">
          {entry.newSinceA ? "—" : entry.formattedA} →{" "}
        </span>
        <span className="text-[var(--foreground)]">{entry.formattedB}</span>
        {suffix && <span className="text-[var(--muted)]"> {suffix}</span>}
      </span>
      {chip}
    </div>
  );
}
