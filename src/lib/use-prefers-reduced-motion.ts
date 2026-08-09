"use client";

import { useSyncExternalStore } from "react";

/**
 * usePrefersReducedMotion — tracks `(prefers-reduced-motion: reduce)` live.
 *
 * useSyncExternalStore (not useState + a mount effect): the same idiom as
 * ThemeToggle.tsx's `matchMedia`-free storage subscription and BottomSheet's
 * two-phase-mount store. getServerSnapshot always returns `false`, so the
 * server render and the client's first (hydration) render agree — no
 * hydration mismatch, no `set-state-in-effect` lint violation, no flash of
 * animated content before a reduced-motion client can react.
 *
 * REQ-006 (goal-celebration-upgrade.md §8.3, UXR-GCU-49): ships now so
 * `ReadinessChart` can guard Recharts' unconditional 1500ms mount animation.
 * Any other client leaf that needs to branch on the OS/browser motion
 * preference (rather than relying purely on the `@media` CSS guard) should
 * use this hook instead of re-deriving its own `matchMedia` listener.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Exported (not just used internally) so the unit test can mock `matchMedia`
// and exercise this logic directly — the repo's test env is `node` (no
// jsdom/testing-library), so there is no way to mount the hook itself and
// observe a live re-render; testing the pure store functions is the
// available seam. Mirrors the dual-export-for-testability convention used
// elsewhere in the repo (e.g. `db.ts`'s prisma/getDb split).
export function subscribe(callback: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

export function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
