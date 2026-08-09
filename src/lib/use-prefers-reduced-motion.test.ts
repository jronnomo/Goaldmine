// src/lib/use-prefers-reduced-motion.test.ts
//
// The repo's Vitest env is `node` (vitest.config.ts) — no jsdom, no
// testing-library, so there's no way to mount usePrefersReducedMotion()
// itself and observe a re-render on a `change` event. Instead this tests
// the exported store functions the hook is built from
// (subscribe/getSnapshot/getServerSnapshot), mocking `matchMedia` via
// `vi.stubGlobal` — the same seam useSyncExternalStore itself relies on.

import { describe, it, expect, vi, afterEach } from "vitest";
import { getServerSnapshot, getSnapshot, subscribe, REDUCED_MOTION_QUERY } from "@/lib/use-prefers-reduced-motion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion store", () => {
  it("getServerSnapshot is always false (SSR-safe, no window access)", () => {
    expect(getServerSnapshot()).toBe(false);
  });

  it("getSnapshot returns false when window is undefined (no window global at all)", () => {
    expect(getSnapshot()).toBe(false);
  });

  it("getSnapshot returns false when window.matchMedia is not a function", () => {
    vi.stubGlobal("window", {});
    expect(getSnapshot()).toBe(false);
  });

  it("getSnapshot reflects matchMedia(...).matches", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("window", { matchMedia });

    expect(getSnapshot()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("subscribe is a no-op (returns a callable unsubscribe) when window is undefined", () => {
    const unsubscribe = subscribe(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it("subscribe wires addEventListener('change', cb) and unsubscribe removes it", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener,
      removeEventListener,
    }));
    vi.stubGlobal("window", { matchMedia });

    const callback = () => {};
    const unsubscribe = subscribe(callback);

    expect(addEventListener).toHaveBeenCalledWith("change", callback);
    expect(removeEventListener).not.toHaveBeenCalled();

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("change", callback);
  });
});
