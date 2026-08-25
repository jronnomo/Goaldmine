// body-scroll-lock — refcount + capture semantics.
//
// The bug this exists for: the Log sheet hosts four other sheets (saved-meal,
// scan, library picker, meal-edit). Each used to freeze/restore the page
// itself, so closing an inner one unlocked the page while the outer sheet was
// still open — and the outer's later restore fired against a position that had
// already moved. On iOS that leaves the page panned by a keyboard's height and
// the top-layer sheet shifted up off the screen with it.

import { describe, it, expect } from "vitest";
import { createBodyScrollLock, type ScrollLockTarget } from "@/lib/body-scroll-lock";

function fakeTarget(initialScrollY = 0) {
  const calls: string[] = [];
  const state = { scrollY: initialScrollY, frozenAt: null as number | null };
  const target: ScrollLockTarget = {
    getScrollY: () => state.scrollY,
    freeze: (y) => {
      calls.push(`freeze:${y}`);
      state.frozenAt = y;
    },
    thaw: (y) => {
      calls.push(`thaw:${y}`);
      state.frozenAt = null;
      state.scrollY = y;
    },
    reassert: (y) => {
      calls.push(`reassert:${y}`);
    },
  };
  return { target, state, calls };
}

describe("createBodyScrollLock", () => {
  it("freezes at the current position and thaws back to it", () => {
    const { target, state, calls } = fakeTarget(742);
    const lock = createBodyScrollLock(target);

    const release = lock.lock();
    expect(state.frozenAt).toBe(742);

    release();
    expect(calls).toEqual(["freeze:742", "thaw:742"]);
    expect(state.scrollY).toBe(742);
  });

  it("nested sheets: only the outermost freezes and thaws", () => {
    const { target, state, calls } = fakeTarget(500);
    const lock = createBodyScrollLock(target);

    const releaseOuter = lock.lock(); // Log sheet
    state.scrollY = 1200; // a pan leaked through mid-session
    const releaseInner = lock.lock(); // saved-meal sheet, opened after the pan
    expect(lock.depth()).toBe(2);
    // The inner lock must NOT re-capture — 500 is the real page position.
    expect(calls).toEqual(["freeze:500"]);

    releaseInner();
    // Page stays frozen (the Log sheet is still open) and the outermost
    // capture is re-asserted rather than restored.
    expect(state.frozenAt).toBe(500);
    expect(calls).toEqual(["freeze:500", "reassert:500"]);
    expect(lock.depth()).toBe(1);

    releaseOuter();
    expect(calls).toEqual(["freeze:500", "reassert:500", "thaw:500"]);
    expect(state.scrollY).toBe(500);
    expect(lock.depth()).toBe(0);
  });

  it("release is idempotent — a double cleanup cannot thaw a still-open sheet", () => {
    const { target, state, calls } = fakeTarget(0);
    const lock = createBodyScrollLock(target);

    const releaseOuter = lock.lock();
    const releaseInner = lock.lock();

    releaseInner();
    releaseInner(); // StrictMode / double cleanup
    releaseInner();
    expect(lock.depth()).toBe(1);
    expect(state.frozenAt).toBe(0); // outer sheet still open
    expect(calls.filter((c) => c.startsWith("reassert")).length).toBe(1);

    releaseOuter();
    expect(lock.depth()).toBe(0);
    expect(state.frozenAt).toBe(null);
  });

  it("re-locking after a full release captures the new position", () => {
    const { target, state, calls } = fakeTarget(100);
    const lock = createBodyScrollLock(target);

    lock.lock()();
    state.scrollY = 900;
    lock.lock()();

    expect(calls).toEqual(["freeze:100", "thaw:100", "freeze:900", "thaw:900"]);
  });
});
