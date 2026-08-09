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
// Key: goaldmine.celebrated.goal.<goalId>.<completionToken> (QA M-1 fix).
//
// `completionToken` MUST be a value that is fresh on every completion, even
// when the same goal is completed → reopened → re-completed for the SAME
// calendar day. The caller (goals/[id]/page.tsx) passes
// `completionSnapshot.capturedAt` — the ISO wall-clock instant
// computeCompletionSnapshot() stamped via `new Date()` at *write* time
// (goal-completion.ts:155), not the (possibly backdated) `completedAt`/
// `completedDateKey` the old key used.
//
// Verified against completeGoalCore (src/lib/goal-completion.ts): `completedAt`
// defaults to `new Date()` but, when the caller backdates via the dashboard
// form (`goal-actions.ts` → `parseDateKey`), it resolves to USER_TZ midnight
// for that calendar day — so backdating to the SAME day twice (complete →
// reopen → re-complete, both backdated to e.g. "2026-08-05") would produce a
// byte-identical `completedAt`/`completedDateKey`, reproducing the exact key
// collision this fix is meant to close. `capturedAt` has no such risk: it is
// computed fresh, once, inside computeCompletionSnapshot on every
// completeGoalCore call — two separate human-driven completions cannot land
// in the same millisecond — so it's the token actually used here.
//
// celebrationStorageKey/shouldCelebrate are pure and exported for unit
// testing (QA L-1) — see GoalCompletedCelebration.test.ts.

import { useEffect, useRef } from "react";

/** Pure key builder — exported for tests (QA L-1). */
export function celebrationStorageKey(goalId: string, completionToken: string): string {
  return `goaldmine.celebrated.goal.${goalId}.${completionToken}`;
}

/** Pure one-shot check — exported for tests (QA L-1). True when this key has never fired. */
export function shouldCelebrate(storage: { getItem(key: string): string | null }, key: string): boolean {
  return storage.getItem(key) === null;
}

export function GoalCompletedCelebration({
  goalId,
  completionToken,
}: {
  goalId: string;
  /** A value guaranteed fresh per completion — pass completionSnapshot.capturedAt. */
  completionToken: string;
}) {
  const ring1Ref = useRef<HTMLDivElement>(null);
  const ring2Ref = useRef<HTMLDivElement>(null);
  const ring3Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = celebrationStorageKey(goalId, completionToken);
    try {
      if (shouldCelebrate(localStorage, key)) {
        localStorage.setItem(key, "1");
        // Imperative classList.add — no setState, no re-render, no SSR/CSR mismatch.
        ring1Ref.current?.classList.add("goal-completed-ring");
        ring2Ref.current?.classList.add("goal-completed-ring", "delayed");
        ring3Ref.current?.classList.add("goal-completed-ring", "more-delayed");
      }
    } catch {
      // localStorage blocked (private browsing, storage quota, etc.) — degrade silently.
    }
  }, [goalId, completionToken]);

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
