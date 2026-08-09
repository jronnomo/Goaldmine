"use client";
// src/components/GoalCompletedCelebration.tsx (REQ-012)
//
// One-shot celebration for an achieved goal's detail page. Clones
// TodayCelebration's localStorage one-shot + imperative-ref pattern (no
// setState in effect, no hydration mismatch — the DOM starts inert and the
// effect adds classes directly via refs) and borrows LevelUpCelebration's
// expanding-rings visual vocabulary (three staggered rings here instead of
// two, for a bigger ceremony moment).
//
// Key: goaldmine.celebrated.goal.<goalId>.<completedDateKey> — re-completing
// after a reopen produces a NEW completedDateKey, so it re-fires; reloading
// the same achieved state does not.

import { useEffect, useRef } from "react";

export function GoalCompletedCelebration({
  goalId,
  completedDateKey,
}: {
  goalId: string;
  completedDateKey: string;
}) {
  const ring1Ref = useRef<HTMLDivElement>(null);
  const ring2Ref = useRef<HTMLDivElement>(null);
  const ring3Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = `goaldmine.celebrated.goal.${goalId}.${completedDateKey}`;
    try {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        // Imperative classList.add — no setState, no re-render, no SSR/CSR mismatch.
        ring1Ref.current?.classList.add("goal-completed-ring");
        ring2Ref.current?.classList.add("goal-completed-ring", "delayed");
        ring3Ref.current?.classList.add("goal-completed-ring", "more-delayed");
      }
    } catch {
      // localStorage blocked (private browsing, storage quota, etc.) — degrade silently.
    }
  }, [goalId, completedDateKey]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: 64,
        height: 64,
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div ref={ring1Ref} style={{ position: "absolute", inset: 0, borderRadius: "9999px", pointerEvents: "none" }} />
      <div ref={ring2Ref} style={{ position: "absolute", inset: 0, borderRadius: "9999px", pointerEvents: "none" }} />
      <div ref={ring3Ref} style={{ position: "absolute", inset: 0, borderRadius: "9999px", pointerEvents: "none" }} />
      <span style={{ fontSize: 32, lineHeight: 1 }}>🏆</span>
    </div>
  );
}
