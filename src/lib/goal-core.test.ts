// src/lib/goal-core.test.ts
// Regression tests for the kind-gated plan scaffolding (rhino.the.grey bug, 2026-06-18).
//
// Bug: createGoalCore / ensurePlanForGoalCore scaffolded a FITNESS program-template
// plan (baseline battery + phases) for ANY dated goal, regardless of kind — so a
// project goal (Instagram followers) got 24 default baseline markers bleeding onto
// the focus calendar. Fix: only kind === "fitness" scaffolds a plan.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { $transaction: vi.fn(), goal: { findUnique: vi.fn() } },
}));
// canonicalExerciseName is only invoked when attributionHints are present; passthrough.
vi.mock("@/lib/records", () => ({ canonicalExerciseName: (s: string) => s }));

import { createGoalCore, ensurePlanForGoalCore } from "@/lib/goal-core";
import { prisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pm = prisma as any;

describe("createGoalCore — kind-gated plan scaffolding", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedData: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedData = undefined;
    // $transaction(cb) → run cb with a fake tx; capture the goal.create payload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pm.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        goal: {
          count: vi.fn().mockResolvedValue(1), // an existing focus goal → don't steal focus
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: vi.fn().mockImplementation((args: any) => {
            capturedData = args.data;
            return { id: "g1", plans: args.data.plans ? [{ id: "p1" }] : [] };
          }),
        },
      };
      return cb(tx);
    });
  });

  it("project goal WITH a target date scaffolds NO plan (the regression)", async () => {
    const r = await createGoalCore({
      objective: "Grow @rhino.the.grey to 100k",
      targetDate: new Date("2027-06-01"),
      kind: "project",
      targets: [],
    });
    expect(capturedData.plans).toBeUndefined(); // no fitness plan, no baseline battery
    expect(capturedData.kind).toBe("project");
    expect(r.planId).toBeNull();
  });

  it("fitness goal WITH a target date DOES scaffold a plan (coexistence preserved)", async () => {
    const r = await createGoalCore({
      objective: "Summit Mt. Elbert",
      targetDate: new Date("2027-06-01"),
      kind: "fitness",
      targets: [],
    });
    expect(capturedData.plans).toBeDefined();
    expect(r.planId).toBe("p1");
  });

  it("kind defaults to fitness when omitted (back-compat — still scaffolds with a date)", async () => {
    await createGoalCore({ objective: "x", targetDate: new Date("2027-06-01"), targets: [] });
    expect(capturedData.kind).toBe("fitness");
    expect(capturedData.plans).toBeDefined();
  });

  it("project goal WITHOUT a date scaffolds no plan", async () => {
    await createGoalCore({ objective: "someday", targetDate: null, kind: "project", targets: [] });
    expect(capturedData.plans).toBeUndefined();
  });

  it("fitness goal WITHOUT a date scaffolds no plan (someday)", async () => {
    await createGoalCore({ objective: "someday-fit", targetDate: null, kind: "fitness", targets: [] });
    expect(capturedData.plans).toBeUndefined();
  });
});

describe("ensurePlanForGoalCore — kind gate (dated-upgrade path)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("non-fitness goal returns no plan and never opens a transaction", async () => {
    pm.goal.findUnique.mockResolvedValue({ kind: "project" });
    const r = await ensurePlanForGoalCore("g1", new Date("2027-06-01"));
    expect(r).toEqual({ planId: null, created: false });
    expect(pm.$transaction).not.toHaveBeenCalled(); // short-circuits before scaffolding
  });

  it("missing goal throws", async () => {
    pm.goal.findUnique.mockResolvedValue(null);
    await expect(ensurePlanForGoalCore("missing", new Date("2027-06-01"))).rejects.toThrow();
  });
});
