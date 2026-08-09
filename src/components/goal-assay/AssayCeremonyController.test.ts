// src/components/goal-assay/AssayCeremonyController.test.ts
//
// Unit tests for the ceremony controller's single-authority state machine
// (V2/V3). AssayCeremonyController itself is a "use client" imperative-ref
// component (mirrors GoalCompletedCelebration/TodayCelebration) with no
// jsdom/render infra in this repo — per that precedent, we test only the
// extracted pure decision logic (`decideAssayCeremony`/`attemptAssayCeremony`)
// against fakes, never the real React component. Vitest include is
// src/**/*.test.ts; environment "node" — no DOM needed since every
// dependency (storage, dialog, visibilityState) is injected.

import { describe, it, expect, vi } from "vitest";
import {
  ASSAY_TOKEN_NAMESPACE,
  assayTokenKey,
  attemptAssayCeremony,
  decideAssayCeremony,
  type AssayDialogLike,
  type AssayStorageLike,
} from "@/components/goal-assay/AssayCeremonyController";

// Minimal in-memory stand-in for the localStorage surface, mirroring
// GoalCompletedCelebration.test.ts's fakeStorage.
function fakeStorage(seed: Record<string, string> = {}): AssayStorageLike & { getCalls: string[]; setCalls: Array<[string, string]> } {
  const store = new Map(Object.entries(seed));
  const getCalls: string[] = [];
  const setCalls: Array<[string, string]> = [];
  return {
    getCalls,
    setCalls,
    getItem(key: string): string | null {
      getCalls.push(key);
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      setCalls.push([key, value]);
      store.set(key, value);
    },
  };
}

function fakeDialog(showModalImpl?: () => void): AssayDialogLike & { showModal: ReturnType<typeof vi.fn> } {
  return { showModal: vi.fn(showModalImpl) };
}

describe("assayTokenKey", () => {
  it("builds goaldmine.assay.<goalId>.<capturedAt>", () => {
    expect(assayTokenKey("goal-1", "2026-08-09T12:00:00.000Z")).toBe(
      "goaldmine.assay.goal-1.2026-08-09T12:00:00.000Z",
    );
  });

  it("uses a namespace disjoint from GoalCompletedCelebration's legacy `goaldmine.celebrated.goal.*` keys (V1/C1)", () => {
    expect(ASSAY_TOKEN_NAMESPACE).toBe("goaldmine.assay");
    expect(assayTokenKey("goal-1", "tok")).not.toContain("celebrated");
  });

  it("produces different keys for different goals or different capturedAt tokens", () => {
    const a = assayTokenKey("goal-1", "tok-a");
    const b = assayTokenKey("goal-2", "tok-a");
    const c = assayTokenKey("goal-1", "tok-b");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("decideAssayCeremony — the single-authority state machine (V2/V3)", () => {
  it("burned -> SETTLED: no showModal call, no storage write, no flourish", () => {
    const storage = fakeStorage();
    const dialog = fakeDialog();
    const onFlourishFallback = vi.fn();

    const outcome = decideAssayCeremony({
      storage,
      key: "k",
      alreadyBurned: true,
      visibilityState: "visible",
      dialog,
      onFlourishFallback,
    });

    expect(outcome).toBe("settled");
    expect(dialog.showModal).not.toHaveBeenCalled();
    expect(storage.setCalls).toHaveLength(0);
    expect(onFlourishFallback).not.toHaveBeenCalled();
  });

  it("not burned + hidden -> WAITING: no showModal call, no write, no flourish (caller must re-invoke on visibilitychange)", () => {
    const storage = fakeStorage();
    const dialog = fakeDialog();
    const onFlourishFallback = vi.fn();

    const outcome = decideAssayCeremony({
      storage,
      key: "k",
      alreadyBurned: false,
      visibilityState: "hidden",
      dialog,
      onFlourishFallback,
    });

    expect(outcome).toBe("waiting");
    expect(dialog.showModal).not.toHaveBeenCalled();
    expect(storage.setCalls).toHaveLength(0);
    expect(onFlourishFallback).not.toHaveBeenCalled();
  });

  it("not burned + visible + showModal succeeds -> SHOWN: burns once, flourish never plays (no double ceremony)", () => {
    const storage = fakeStorage();
    const dialog = fakeDialog();
    const onFlourishFallback = vi.fn();

    const outcome = decideAssayCeremony({
      storage,
      key: "k",
      alreadyBurned: false,
      visibilityState: "visible",
      dialog,
      onFlourishFallback,
    });

    expect(outcome).toBe("shown");
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(storage.setCalls).toEqual([["k", "1"]]);
    expect(onFlourishFallback).not.toHaveBeenCalled();
  });

  it("not burned + visible + showModal THROWS -> flourish fallback: burns once (this view IS the shown ceremony), flourish plays exactly once", () => {
    const storage = fakeStorage();
    const dialog = fakeDialog(() => {
      throw new Error("InvalidStateError: dialog already open");
    });
    const onFlourishFallback = vi.fn();

    const outcome = decideAssayCeremony({
      storage,
      key: "k",
      alreadyBurned: false,
      visibilityState: "visible",
      dialog,
      onFlourishFallback,
    });

    expect(outcome).toBe("flourish-fallback");
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(storage.setCalls).toEqual([["k", "1"]]);
    expect(onFlourishFallback).toHaveBeenCalledTimes(1);
  });

  it("burn happens AFTER the visual commitment attempt, never before (C3): showModal is called before setItem on the success path", () => {
    const order: string[] = [];
    const storage: AssayStorageLike = {
      getItem: () => null,
      setItem: (k) => {
        order.push(`setItem:${k}`);
      },
    };
    const dialog: AssayDialogLike = {
      showModal: () => {
        order.push("showModal");
      },
    };

    decideAssayCeremony({
      storage,
      key: "k",
      alreadyBurned: false,
      visibilityState: "visible",
      dialog,
      onFlourishFallback: () => {},
    });

    expect(order).toEqual(["showModal", "setItem:k"]);
  });

  it("a storage write failure (private browsing / quota) degrades silently — never throws — on both the success and fallback paths", () => {
    const throwingStorage: AssayStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(() =>
      decideAssayCeremony({
        storage: throwingStorage,
        key: "k",
        alreadyBurned: false,
        visibilityState: "visible",
        dialog: fakeDialog(),
        onFlourishFallback: () => {},
      }),
    ).not.toThrow();

    expect(() =>
      decideAssayCeremony({
        storage: throwingStorage,
        key: "k",
        alreadyBurned: false,
        visibilityState: "visible",
        dialog: fakeDialog(() => {
          throw new Error("boom");
        }),
        onFlourishFallback: () => {},
      }),
    ).not.toThrow();
  });
});

describe("attemptAssayCeremony — component-facing wrapper (resolves alreadyBurned from real storage semantics)", () => {
  it("reads the burned state via the versioned key and delegates to decideAssayCeremony", () => {
    const storage = fakeStorage({ "goaldmine.assay.goal-1.tok-a": "1" });
    const dialog = fakeDialog();

    const outcome = attemptAssayCeremony({
      goalId: "goal-1",
      capturedAt: "tok-a",
      storage,
      visibilityState: "visible",
      dialog,
      onFlourishFallback: vi.fn(),
    });

    expect(outcome).toBe("settled");
    expect(dialog.showModal).not.toHaveBeenCalled();
  });

  it("a storage READ failure is treated as unburned (ceremony may repeat — accepted degrade), never throws", () => {
    const throwingStorage: AssayStorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    const dialog = fakeDialog();

    const outcome = attemptAssayCeremony({
      goalId: "goal-1",
      capturedAt: "tok-a",
      storage: throwingStorage,
      visibilityState: "visible",
      dialog,
      onFlourishFallback: vi.fn(),
    });

    expect(outcome).toBe("shown");
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
  });

  it("a fresh (unburned) token for the same goal at visible -> shows and burns, matching the real end-to-end flow", () => {
    const storage = fakeStorage();
    const dialog = fakeDialog();

    const outcome = attemptAssayCeremony({
      goalId: "goal-elbert",
      capturedAt: "2026-08-09T15:00:00.000Z",
      storage,
      visibilityState: "visible",
      dialog,
      onFlourishFallback: vi.fn(),
    });

    expect(outcome).toBe("shown");
    expect(storage.setCalls).toEqual([["goaldmine.assay.goal-elbert.2026-08-09T15:00:00.000Z", "1"]]);

    // A second attempt with the SAME storage now sees the burned token.
    const second = attemptAssayCeremony({
      goalId: "goal-elbert",
      capturedAt: "2026-08-09T15:00:00.000Z",
      storage,
      visibilityState: "visible",
      dialog: fakeDialog(),
      onFlourishFallback: vi.fn(),
    });
    expect(second).toBe("settled");
  });
});
