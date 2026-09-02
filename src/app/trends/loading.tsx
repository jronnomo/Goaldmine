// src/app/trends/loading.tsx — geometry-matched skeleton for /trends.
//
// Follows src/app/progress/loading.tsx's discipline: heights are LITERAL
// arbitrary values naming their manifest key — never the Tailwind scale (a
// scale edit must not move them), never `Card` (its padding could change
// independently). The chart block matches the SHIPPED heights h-48/h-28/h-10
// (192/112/40 — ⚑1 ruled h-32 for calories, but Stream D's pre-authorized
// fold concession took it to h-28; NOT the blueprint's 208/176/160 either),
// plus headers, the shared axis, the rail and its caption inside one
// card-shaped block.
//
// Every block: motion-safe:animate-pulse + aria-hidden, bg-[var(--muted)]/25
// fills (never an opacity bump on --border — it is 1.4–1.7:1 in dark).

const BLOCK = "motion-safe:animate-pulse rounded-xl bg-[var(--muted)]/25";

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* 1 · hero — h1 + sub */}
      <div aria-hidden="true">
        <div className={`h-[32px] w-24 ${BLOCK}`} />
        <div className={`mt-2 h-[14px] w-44 ${BLOCK}`} />
      </div>

      {/* 2 · range chips — 44px row (fixed by the touch-target invariant) */}
      <div aria-hidden="true" className={`h-[44px] w-full ${BLOCK}`} />

      {/* 3 · chart card — weight 192 + calories 112 (h-28, the shipped fold
          concession) + macros 40 + three panel headers/axis (~74) + rail row
          44 + caption ~45, inside p-4 walls ≈ 578px (UXR-TRENDS-04's measured
          594px Card assumed the pre-concession h-32 calories chart — 16px
          taller than what ships) */}
      <div aria-hidden="true" className={`h-[578px] w-full rounded-2xl ${BLOCK}`} />

      {/* 4 · fallback lid summary row */}
      <div aria-hidden="true" className={`h-[44px] w-full ${BLOCK}`} />

      {/* 5 · window panel head — coverage + stat tiles; stop here (the fold
          asymmetry: too-long costs nothing, too-short shows a bald patch) */}
      <div aria-hidden="true" className={`h-[140px] w-full rounded-2xl ${BLOCK}`} />

      <span className="sr-only">Loading…</span>
    </div>
  );
}
