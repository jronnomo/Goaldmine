// src/components/GoalCompletedCelebration.test.ts
// Pure-helper tests for the celebration one-shot key logic (QA L-1, follow-up
// to M-1). GoalCompletedCelebration itself is a "use client" imperative-ref
// component (mirrors TodayCelebration) with no jsdom/render infra in this repo
// — per QA guidance, we test only the extracted pure decision logic:
// celebrationStorageKey (key format) and shouldCelebrate (one-shot check).
// Vitest include is src/**/*.test.ts; environment "node" — no DOM needed since
// neither helper touches the real DOM/localStorage, only an injected stub.

import { describe, it, expect } from "vitest";
import { celebrationStorageKey, shouldCelebrate } from "@/components/GoalCompletedCelebration";

// Minimal in-memory stand-in for the localStorage surface both helpers need.
function fakeStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("celebrationStorageKey", () => {
  it("builds the goaldmine.celebrated.goal.<goalId>.<completionToken> key", () => {
    expect(celebrationStorageKey("goal-1", "2026-08-05T12:00:00.000Z")).toBe(
      "goaldmine.celebrated.goal.goal-1.2026-08-05T12:00:00.000Z",
    );
  });

  it("produces the SAME key for the same goalId + completionToken (idempotent)", () => {
    const a = celebrationStorageKey("goal-1", "2026-08-05T12:00:00.000Z");
    const b = celebrationStorageKey("goal-1", "2026-08-05T12:00:00.000Z");
    expect(a).toBe(b);
  });

  it("produces DIFFERENT keys for two completions of the same goal on the same dateKey but different tokens (QA M-1 fix)", () => {
    // Same calendar day (completedDateKey would collide), but capturedAt
    // (the completionToken) differs because it's stamped at write time.
    const firstCompletion = celebrationStorageKey("goal-1", "2026-08-05T09:00:00.000Z");
    const reCompletionAfterReopen = celebrationStorageKey("goal-1", "2026-08-05T14:30:00.000Z");
    expect(firstCompletion).not.toBe(reCompletionAfterReopen);
  });

  it("produces different keys for different goals with the same token", () => {
    const g1 = celebrationStorageKey("goal-1", "2026-08-05T09:00:00.000Z");
    const g2 = celebrationStorageKey("goal-2", "2026-08-05T09:00:00.000Z");
    expect(g1).not.toBe(g2);
  });
});

describe("shouldCelebrate", () => {
  it("is true when the key has never been set", () => {
    const storage = fakeStorage();
    expect(shouldCelebrate(storage, "goaldmine.celebrated.goal.goal-1.tok-a")).toBe(true);
  });

  it("is false once the key has been set (one-shot: no re-fire on reload)", () => {
    const storage = fakeStorage({ "goaldmine.celebrated.goal.goal-1.tok-a": "1" });
    expect(shouldCelebrate(storage, "goaldmine.celebrated.goal.goal-1.tok-a")).toBe(false);
  });

  it("is true again for a fresh token after a reopen → re-complete (different key)", () => {
    const storage = fakeStorage({ "goaldmine.celebrated.goal.goal-1.tok-a": "1" });
    const newKey = celebrationStorageKey("goal-1", "tok-b");
    expect(shouldCelebrate(storage, newKey)).toBe(true);
  });

  it("is unaffected by keys for other goals/tokens", () => {
    const storage = fakeStorage({ "goaldmine.celebrated.goal.goal-2.tok-a": "1" });
    expect(shouldCelebrate(storage, "goaldmine.celebrated.goal.goal-1.tok-a")).toBe(true);
  });
});
