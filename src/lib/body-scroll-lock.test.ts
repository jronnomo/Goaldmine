// body-scroll-lock — refcount + restore semantics.
//
// The bug this exists for: the Log sheet hosts four other sheets (saved-meal,
// scan, library picker, meal-edit). Each used to capture/restore the page
// scroll itself, so closing an inner one unlocked the page while the outer
// sheet was still open — and the outer's later restore fired against a scroll
// position that had already moved. On iOS that leaves the layout viewport
// panned, and the next open renders the fixed sheet slammed against the top of
// the screen with its header cut off.

import { describe, it, expect } from "vitest";
import { createBodyScrollLock, type ScrollLockTarget } from "@/lib/body-scroll-lock";

function fakeTarget(initialScrollY = 0, initialOverflow = "") {
  const state = { scrollY: initialScrollY, overflow: initialOverflow };
  const scrollCalls: number[] = [];
  const target: ScrollLockTarget = {
    getScrollY: () => state.scrollY,
    setScrollY: (y) => {
      scrollCalls.push(y);
      state.scrollY = y;
    },
    getOverflow: () => state.overflow,
    setOverflow: (v) => {
      state.overflow = v;
    },
  };
  return { target, state, scrollCalls };
}

describe("createBodyScrollLock", () => {
  it("locks and restores overflow + scroll position for a single sheet", () => {
    const { target, state, scrollCalls } = fakeTarget(742, "auto");
    const lock = createBodyScrollLock(target);

    const release = lock.lock();
    expect(state.overflow).toBe("hidden");

    // iOS pans the layout viewport while a field is focused.
    state.scrollY = 1520;

    release();
    expect(state.overflow).toBe("auto"); // prior value, not hardcoded ""
    expect(scrollCalls).toEqual([742]); // un-panned back to where the sheet opened
  });

  it("nested sheets: the outermost lock owns the captured position", () => {
    const { target, state, scrollCalls } = fakeTarget(500, "");
    const lock = createBodyScrollLock(target);

    const releaseOuter = lock.lock(); // Log sheet
    state.scrollY = 1200; // keyboard pan
    const releaseInner = lock.lock(); // saved-meal sheet, opened mid-pan
    expect(lock.depth()).toBe(2);

    releaseInner();
    // Page position restored to the OUTER capture (pre-pan), and the page stays
    // locked because the Log sheet is still open.
    expect(scrollCalls).toEqual([500]);
    expect(state.overflow).toBe("hidden");
    expect(lock.depth()).toBe(1);

    releaseOuter();
    expect(state.overflow).toBe("");
    expect(scrollCalls).toEqual([500, 500]);
    expect(lock.depth()).toBe(0);
  });

  it("release is idempotent — a double cleanup cannot unlock a still-open sheet", () => {
    const { target, state } = fakeTarget(0, "");
    const lock = createBodyScrollLock(target);

    const releaseOuter = lock.lock();
    const releaseInner = lock.lock();

    releaseInner();
    releaseInner(); // StrictMode / double-cleanup
    releaseInner();
    expect(lock.depth()).toBe(1);
    expect(state.overflow).toBe("hidden"); // outer sheet still open

    releaseOuter();
    expect(lock.depth()).toBe(0);
    expect(state.overflow).toBe("");
  });

  it("re-locking after a full release captures the new position", () => {
    const { target, state, scrollCalls } = fakeTarget(100, "");
    const lock = createBodyScrollLock(target);

    lock.lock()();
    state.overflow = "";
    state.scrollY = 900;

    const release = lock.lock();
    release();
    expect(scrollCalls).toEqual([100, 900]);
  });
});
