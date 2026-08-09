// src/components/compare/StrikeBand.tsx
//
// Conditional level-up strike band (UX amendment §5, UXR-19 MINIMAL).
// Renders ONLY on a genuine in-window level-up: levelA !== null &&
// levelB !== null && levelB > levelA — otherwise renders nothing.
// Celebration is earned, never ambient (brand rule). No bullseye-pop,
// no animation. Server-safe (no "use client").
// Readiness-band-crossing trigger is DEFERRED (ledger UXR-19).
//
// UXR-GCU-48 fix (goal-celebration-upgrade.md §1.7/§8.4/§10.5, report 10.5):
// the eyebrow was `--accent` text directly on `--accent-soft` background —
// 4.14:1, failing AA (4.5:1) for 12px bold text in light. Smallest correct
// fix: swap the card's background token from `--accent-soft` to `--card`
// (kept the `--accent` border so the "struck gold" framing is unchanged).
// `--accent` on `--card` clears AA in both palettes — `--card` is lighter
// than `--background` in light mode (where the pair was measured at
// 4.95:1) and darker than `--background` in dark mode, so contrast only
// improves. No typography or layout changed.

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
      className="rounded-xl border border-[var(--accent)] bg-[var(--card)] p-3"
    >
      <p className="text-xs font-bold tracking-[0.09em] text-[var(--accent)]">LEVELED UP</p>
      <p className="mt-0.5 font-[family-name:var(--font-display)] text-3xl leading-tight">
        Level {levelA} → {levelB}
      </p>
      <p className="mt-0.5 text-[13px] text-[var(--muted)]">struck gold in this span</p>
    </section>
  );
}
