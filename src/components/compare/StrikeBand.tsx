// src/components/compare/StrikeBand.tsx
//
// Conditional level-up strike band (UX amendment §5, UXR-19 MINIMAL).
// Renders ONLY on a genuine in-window level-up: levelA !== null &&
// levelB !== null && levelB > levelA — otherwise renders nothing.
// Celebration is earned, never ambient (brand rule). No bullseye-pop,
// no animation. Server-safe (no "use client").
// Readiness-band-crossing trigger is DEFERRED (ledger UXR-19).

export function StrikeBand({
  levelA,
  levelB,
}: {
  levelA: number | null;
  levelB: number | null;
}) {
  if (levelA === null || levelB === null || levelB <= levelA) return null;

  return (
    <section
      aria-label={`Leveled up: level ${levelA} to level ${levelB}`}
      className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-3"
    >
      <p className="text-xs font-bold tracking-[0.09em] text-[var(--accent)]">LEVELED UP</p>
      <p className="mt-0.5 font-[family-name:var(--font-display)] text-3xl leading-tight">
        Level {levelA} → {levelB}
      </p>
      <p className="mt-0.5 text-[13px] text-[var(--muted)]">struck gold in this span</p>
    </section>
  );
}
