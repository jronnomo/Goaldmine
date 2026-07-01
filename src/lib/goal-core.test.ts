// src/lib/goal-core.test.ts
// Regression tests for the kind-gated plan scaffolding (rhino.the.grey bug, 2026-06-18).
//
// Bug: createGoalCore / ensurePlanForGoalCore scaffolded a FITNESS program-template
// plan (baseline battery + phases) for ANY dated goal, regardless of kind — so a
// project goal (Instagram followers) got 24 default baseline markers bleeding onto
// the focus calendar. Fix: only kind === "fitness" scaffolds a plan.
//
// E4b-1 note: goal-core.ts was migrated from raw `prisma` to `getDb()` (ALS-scoped
// client). The mock now intercepts `getDb()` and returns a fake scoped client.
// The nested Goal→Plan create was also SPLIT: goal.create no longer nests plans;
// a separate tx.plan.create is called when needed. Assertions updated accordingly.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db — getDb() returns a fake scoped client configured per test.
// prisma is kept as an empty export so any stale import doesn't error; goal-core.ts
// no longer calls prisma.* directly after the E4b-1 migration.
vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));
// canonicalExerciseName is only invoked when attributionHints are present; passthrough.
vi.mock("@/lib/records", () => ({ canonicalExerciseName: (s: string) => s }));

import { createGoalCore, ensurePlanForGoalCore } from "@/lib/goal-core";
import { getDb } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

describe("createGoalCore — kind-gated plan scaffolding", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedData = undefined;

    // tx is the transaction callback arg — must have both goal and plan ops after the split.
    txMock = {
      goal: {
        count: vi.fn().mockResolvedValue(1), // an existing focus goal → don't steal focus
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn().mockImplementation((args: any) => {
          capturedData = args.data;
          // E4b-1 split: goal.create no longer contains plans — plan is created separately.
          return { id: "g1" };
        }),
      },
      plan: {
        create: vi.fn().mockResolvedValue({ id: "p1" }),
      },
    };

    // getDb() returns a fake scoped client whose $transaction executes the callback with txMock.
    mockGetDb.mockResolvedValue({
      goal: { findUnique: vi.fn() }, // for copyFromGoalId path (not exercised in these tests)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(txMock)),
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
    expect(txMock.plan.create).not.toHaveBeenCalled();
  });

  it("fitness goal WITH a target date DOES scaffold a plan (coexistence preserved)", async () => {
    const r = await createGoalCore({
      objective: "Summit Mt. Elbert",
      targetDate: new Date("2027-06-01"),
      kind: "fitness",
      targets: [],
    });
    // After split: goal.create has no nested plans field; plan is created via tx.plan.create
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).toHaveBeenCalledOnce();
    expect(txMock.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ goalId: "g1" }) }),
    );
    expect(r.planId).toBe("p1");
  });

  it("kind defaults to fitness when omitted (back-compat — still scaffolds with a date)", async () => {
    await createGoalCore({ objective: "x", targetDate: new Date("2027-06-01"), targets: [] });
    expect(capturedData.kind).toBe("fitness");
    // After split: plans are not nested in goal.create; plan.create is called separately
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).toHaveBeenCalledOnce();
  });

  it("project goal WITHOUT a date scaffolds no plan", async () => {
    await createGoalCore({ objective: "someday", targetDate: null, kind: "project", targets: [] });
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).not.toHaveBeenCalled();
  });

  it("fitness goal WITHOUT a date scaffolds no plan (someday)", async () => {
    await createGoalCore({ objective: "someday-fit", targetDate: null, kind: "fitness", targets: [] });
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).not.toHaveBeenCalled();
  });
});

describe("ensurePlanForGoalCore — kind gate (dated-upgrade path)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = {
      goal: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("non-fitness goal returns no plan and never opens a transaction", async () => {
    fakeDb.goal.findUnique.mockResolvedValue({ kind: "project" });
    const r = await ensurePlanForGoalCore("g1", new Date("2027-06-01"));
    expect(r).toEqual({ planId: null, created: false });
    expect(fakeDb.$transaction).not.toHaveBeenCalled(); // short-circuits before scaffolding
  });

  it("missing goal throws", async () => {
    fakeDb.goal.findUnique.mockResolvedValue(null);
    await expect(ensurePlanForGoalCore("missing", new Date("2027-06-01"))).rejects.toThrow();
  });
});
