"use client";
// src/components/game/LevelUpCelebration.tsx
// CLIENT ISLAND — the ONLY client component in the game/ folder.
// Reads localStorage["goaldmine.lastSeenLevel"], fires the .level-up-ring CSS burst
// imperatively (no setState, no re-render) when the level increases.
//
// Behaviour:
//   - First install (key absent/unparseable): store N silently; do NOT fire rings.
//   - Level increased (lastSeen < N): add .level-up-ring classes to ring divs, store N.
//   - Level unchanged (lastSeen === N): no-op.
//   - Level decreased (stored > N): store N silently; do NOT celebrate.
//   - Reduced-motion: .level-up-ring { display: none } — CSS handles the guard.
//
// Ring divs are position:absolute; inset:0 inside the parent's relative wrapper
// (sized to the medallion — 36×36px on Today, 64×64px on /character).
// See §6.1 of architecture-blueprint-v2 for exact JSX nesting.

import { useEffect, useRef } from "react";

type LevelUpCelebrationProps = {
  level: number; // precomputed server-side integer; only the number crosses the boundary
};

const LS_KEY = "goaldmine.lastSeenLevel";

export function LevelUpCelebration({ level }: LevelUpCelebrationProps) {
  const ring1Ref = useRef<HTMLDivElement>(null);
  const ring2Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);

      if (raw === null) {
        // First install — store silently, do not celebrate.
        localStorage.setItem(LS_KEY, String(level));
        return;
      }

      const lastSeen = parseInt(raw, 10);

      if (!Number.isFinite(lastSeen)) {
        // Unparseable — treat as first install.
        localStorage.setItem(LS_KEY, String(level));
        return;
      }

      if (level > lastSeen) {
        // Level UP — fire the burst.
        ring1Ref.current?.classList.add("level-up-ring");
        ring2Ref.current?.classList.add("level-up-ring", "delayed");
        localStorage.setItem(LS_KEY, String(level));
      } else if (level < lastSeen) {
        // Level decreased (retroactive rule change) — store lower silently.
        localStorage.setItem(LS_KEY, String(level));
      }
      // level === lastSeen → no-op
    } catch {
      // localStorage blocked (private browsing, storage quota) — degrade silently.
    }
  }, [level]);

  return (
    // Two ring divs — start inert (no .level-up-ring class); effect adds them.
    // position:absolute; inset:0 — fills the medallion-scoped relative wrapper.
    <>
      <div
        ref={ring1Ref}
        data-testid="level-up-celebration"
        style={{ position: "absolute", inset: 0, borderRadius: "9999px", pointerEvents: "none" }}
      />
      <div
        ref={ring2Ref}
        style={{ position: "absolute", inset: 0, borderRadius: "9999px", pointerEvents: "none" }}
      />
    </>
  );
}
