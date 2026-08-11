// src/app/progress/loading.tsx
//
// Skeleton bound to the NEW manifest's above-fold geometry (UXR-PROG-86 —
// today's skeleton was ⚠[890–925px] in a DIFFERENT order than the page, so
// arrival was a reflow plus a reorder). Specced to the TALLEST plausible
// fold (iPhone 15 Pro Max: 932 − 49 − 58 = 825px) and STOPPED — the fold
// asymmetry inverts for a skeleton: too-short shows a bald patch, too-long
// costs nothing but guarantees the reflow is visible.
//
// Heights are LITERAL arbitrary values naming their manifest key — never the
// Tailwind scale (a scale edit must not move them), never `Card` (its
// padding could change independently), and the three goal strips are three
// literal constants, not a .map().
//
// Every block: motion-safe:animate-pulse (UXR-PROG-85 — the old skeleton
// pulsed infinitely under prefers-reduced-motion) + aria-hidden, with
// bg-[var(--muted)]/25 fills (UXR-PROG-88: --border on --card in dark is
// ⚠[1.4–1.7:1] — never an opacity bump on --border).
//
// Geometry parity with page.tsx is pinned by loading.parity.test.ts (±40px).

const BLOCK = "motion-safe:animate-pulse rounded-xl bg-[var(--muted)]/25";

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* 1 · hero — h1 + context line ⚠[60–72] */}
      <div aria-hidden="true">
        <div className={`h-[32px] w-28 ${BLOCK}`} />
        <div className={`mt-2 h-[14px] w-48 ${BLOCK}`} />
      </div>

      {/* 2 · jump — 44px chip row (fixed by the touch-target invariant) */}
      <div aria-hidden="true" className={`h-[44px] w-full ${BLOCK}`} />

      {/* 3 · program-band ⚠[68–84] */}
      <div aria-hidden="true" className={`h-[78px] w-full rounded-2xl ${BLOCK}`} />

      {/* 4 · rule-repeatability ⚠[20–28] */}
      <div aria-hidden="true" className={`h-[24px] w-32 ${BLOCK}`} />

      {/* 5 · repeatability — day-1 variant ⚠[150–180] */}
      <div aria-hidden="true" className={`h-[170px] w-full rounded-2xl ${BLOCK}`} />

      {/* 6 · goal-strip ×3 — three literal constants, not a .map() ⚠[68–92] */}
      <div aria-hidden="true" className={`h-[88px] w-full rounded-2xl ${BLOCK}`} />
      <div aria-hidden="true" className={`h-[88px] w-full rounded-2xl ${BLOCK}`} />
      <div aria-hidden="true" className={`h-[88px] w-full rounded-2xl ${BLOCK}`} />

      {/* 7 · next-readings ⚠[64–80] — the 825px stop falls inside this block */}
      <div aria-hidden="true" className={`h-[72px] w-full rounded-2xl ${BLOCK}`} />

      {/* STOP — render nothing below ~850px (skeletonizing 2,100px only
          guarantees the reflow is visible). */}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
