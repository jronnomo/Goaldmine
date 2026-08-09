// src/lib/goal-completion.test.ts
// Mocked-DB unit tests for the server completion cores (REQ-006). Mocks
// @/lib/db (dual-export prisma+getDb convention), @/lib/readiness, and
// @/lib/rarity — mirrors src/lib/compare.test.ts's pattern for a module that
// composes computeReadiness + a scoped client. @/lib/goal-completion-core
// (buildCompletionSnapshot / parseCompletionSnapshot) is left real — it's
// pure and already covered by goal-completion-core.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));
vi.mock("@/lib/readiness", () => ({ computeReadiness: vi.fn() }));
vi.mock("@/lib/rarity", () => ({ computeGoalFeasibility: vi.fn() }));

import { getDb } from "@/lib/db";
import { computeReadiness } from "@/lib/readiness";
import { computeGoalFeasibility } from "@/lib/rarity";
import { Prisma } from "@/generated/prisma/client";
import {
  completeGoalCore,
  computeCompletionSnapshot,
  reopenGoalCore,
} from "@/lib/goal-completion";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeReadiness = computeReadiness as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeGoalFeasibility = computeGoalFeasibility as any;

const FEASIBILITY_FIXTURE = {
  goalId: "g1",
  tier: null,
  unratedReason: "no-targets",
  ratio: null,
  perTarget: [],
  basis: null,
  weeksRemaining: null,
  computedAt: new Date().toISOString(),
};

// Well-in-the-past fixed dates — never mistaken for "in the future" by the
// USER_TZ dateKey future-guard regardless of the real wall-clock at test time.
const CREATED_AT = new Date("2020-01-01T12:00:00Z");
const COMPLETED_AT = new Date("2020-02-15T12:00:00Z"); // after createdAt, still in the past

function baseGoalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    status: "active",
    createdAt: CREATED_AT,
    isFocus: false,
    objective: "Summit Mt. Elbert",
    kind: "fitness",
    targetDate: null,
    targets: [],
    coachFeasibility: null,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeDb(overrides: Record<string, any> = {}) {
  return {
    goal: {
      findUnique: vi.fn().mockResolvedValue(baseGoalRow()),
      findMany: vi.fn().mockResolvedValue([]),
    },
    plan: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComputeGoalFeasibility.mockResolvedValue(FEASIBILITY_FIXTURE);
});

// ─────────────────────────────────────────────────────────────────────────
// computeCompletionSnapshot
// ─────────────────────────────────────────────────────────────────────────

describe("computeCompletionSnapshot", () => {
  it("zero-target goal → readiness null; plan-less goal → plan fields null", async () => {
    const fakeDb = makeFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);

    const snapshot = await computeCompletionSnapshot("g1", COMPLETED_AT);

    expect(snapshot.readiness).toBeNull();
    expect(snapshot.targets).toEqual([]);
    expect(snapshot.plan).toEqual({ planId: null, weeksTotal: null, weeksElapsed: null });
    expect(mockComputeReadiness).not.toHaveBeenCalled();
  });

  it("passes completedAt RAW to computeReadiness (R7) — never pre-wrapped with endOfDay", async () => {
    const target = {
      metric: "weightLb",
      label: "Body weight",
      units: "lb",
      direction: "decrease",
      target: 150,
      weight: 1,
    };
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(baseGoalRow({ targets: [target] })),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);
    mockComputeReadiness.mockResolvedValue({
      score: 80,
      rawScore: 80,
      ceiling: 100,
      coverage: { tested: 1, total: 1 },
      openGateCount: 0,
      breakdown: [{ target, current: 150, start: 168, progress: 1 }],
      missing: [],
    });

    await computeCompletionSnapshot("g1", COMPLETED_AT);

    expect(mockComputeReadiness).toHaveBeenCalledTimes(1);
    const [, asOfArg, goalIdArg] = mockComputeReadiness.mock.calls[0];
    // Exact same instant as the input — not shifted to 23:59:59.999.
    expect(asOfArg.getTime()).toBe(COMPLETED_AT.getTime());
    expect(goalIdArg).toBe("g1");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// completeGoalCore — guards
// ─────────────────────────────────────────────────────────────────────────

describe("completeGoalCore — guards", () => {
  it("missing goal throws and never opens a transaction", async () => {
    const fakeDb = makeFakeDb({
      goal: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn() },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    await expect(completeGoalCore("missing")).rejects.toThrow(/not found/i);
    expect(fakeDb.$transaction).not.toHaveBeenCalled();
  });

  it("already-achieved goal throws a reopen_goal redirect and never opens a transaction", async () => {
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(baseGoalRow({ status: "achieved" })),
        findMany: vi.fn(),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    await expect(completeGoalCore("g1")).rejects.toThrow(/reopen_goal/);
    expect(fakeDb.$transaction).not.toHaveBeenCalled();
  });

  it("future completion date throws and never opens a transaction", async () => {
    const fakeDb = makeFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    await expect(completeGoalCore("g1", future)).rejects.toThrow(/future/i);
    expect(fakeDb.$transaction).not.toHaveBeenCalled();
  });

  it("completion date before the goal's createdAt throws (error, not clamp) and never opens a transaction", async () => {
    const fakeDb = makeFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);
    const beforeCreation = new Date("2019-12-01T00:00:00Z"); // < CREATED_AT, still in the past

    await expect(completeGoalCore("g1", beforeCreation)).rejects.toThrow(/created/i);
    expect(fakeDb.$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// completeGoalCore — happy path: transaction args + ordering
// ─────────────────────────────────────────────────────────────────────────

describe("completeGoalCore — transaction + snapshot ordering", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;

  beforeEach(() => {
    txMock = {
      goal: {
        update: vi.fn().mockResolvedValue({
          id: "g1",
          objective: "Summit Mt. Elbert",
          kind: "fitness",
          status: "achieved",
          completedAt: COMPLETED_AT,
          isFocus: false,
          active: false,
          createdAt: CREATED_AT,
          targetDate: null,
        }),
      },
      plan: {
        findMany: vi.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    fakeDb = makeFakeDb({
      goal: {
        // isFocus:true so we can assert focusReleased reflects the PRE-mutation value.
        findUnique: vi.fn().mockResolvedValue(baseGoalRow({ isFocus: true })),
        findMany: vi.fn().mockResolvedValue([{ id: "g2", objective: "Other goal", kind: "fitness" }]),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
    });
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("writes status/completedAt/snapshot/isFocus/active on tx.goal.update, and deactivates active plans via tx.plan.updateMany", async () => {
    const result = await completeGoalCore("g1", COMPLETED_AT);

    expect(txMock.goal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1" },
        data: expect.objectContaining({
          status: "achieved",
          completedAt: COMPLETED_AT,
          isFocus: false,
          active: false,
          completionSnapshot: expect.objectContaining({ version: 1 }),
        }),
      }),
    );
    expect(txMock.plan.updateMany).toHaveBeenCalledWith({
      where: { goalId: "g1", active: true },
      data: { active: false },
    });

    expect(result.planDeactivatedIds).toEqual(["p1", "p2"]);
    expect(result.focusReleased).toBe(true); // pre-mutation isFocus was true
    expect(result.remainingActiveGoals).toEqual([
      { id: "g2", objective: "Other goal", kind: "fitness" },
    ]);
    expect(fakeDb.goal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "active", id: { not: "g1" } } }),
    );
  });

  it("computes the snapshot BEFORE the mutating tx.goal.update call", async () => {
    await completeGoalCore("g1", COMPLETED_AT);

    // computeCompletionSnapshot (called before $transaction) drives
    // computeGoalFeasibility — its call must precede the transaction's write.
    const feasibilityCallOrder = mockComputeGoalFeasibility.mock.invocationCallOrder[0];
    const updateCallOrder = txMock.goal.update.mock.invocationCallOrder[0];
    expect(feasibilityCallOrder).toBeLessThan(updateCallOrder);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// reopenGoalCore
// ─────────────────────────────────────────────────────────────────────────

describe("reopenGoalCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;

  const VALID_SNAPSHOT: GoalCompletionSnapshot = {
    version: 1,
    completedDateKey: "2020-02-15",
    capturedAt: "2020-02-15T12:00:00.000Z",
    backdated: false,
    objective: "Summit Mt. Elbert",
    kind: "fitness",
    daysElapsed: 45,
    readiness: null,
    targets: [],
    targetsMet: 0,
    targetsTotal: 0,
    feasibilityTierAtCompletion: null,
    coachFeasibilityTier: null,
    plan: { planId: null, weeksTotal: null, weeksElapsed: null },
    xpBasis: { weeks: 6, targetsMet: 0 },
    xpAwardedAtCompletion: 300,
  };

  beforeEach(() => {
    txMock = {
      goal: {
        findUnique: vi.fn().mockResolvedValue({
          id: "g1",
          status: "achieved",
          completionSnapshot: VALID_SNAPSHOT,
        }),
        update: vi.fn().mockResolvedValue({
          id: "g1",
          objective: "Summit Mt. Elbert",
          kind: "fitness",
          status: "active",
          completedAt: null,
          isFocus: false,
          active: true,
          createdAt: CREATED_AT,
          targetDate: null,
        }),
      },
    };
    fakeDb = makeFakeDb({
      plan: { findFirst: vi.fn().mockResolvedValue({ id: "latest-plan" }) },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
    });
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("missing goal throws inside the transaction", async () => {
    txMock.goal.findUnique.mockResolvedValue(null);
    await expect(reopenGoalCore("g1")).rejects.toThrow(/not found/i);
    expect(txMock.goal.update).not.toHaveBeenCalled();
  });

  it("non-achieved goal throws and never mutates", async () => {
    txMock.goal.findUnique.mockResolvedValue({ id: "g1", status: "active", completionSnapshot: null });
    await expect(reopenGoalCore("g1")).rejects.toThrow(/not completed|nothing to reopen/i);
    expect(txMock.goal.update).not.toHaveBeenCalled();
  });

  it("restores active status, clears completedAt, discards snapshot via Prisma.JsonNull, and returns the parsed discarded snapshot", async () => {
    const result = await reopenGoalCore("g1");

    expect(txMock.goal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1" },
        data: expect.objectContaining({
          status: "active",
          completedAt: null,
          completionSnapshot: Prisma.JsonNull,
          active: true,
        }),
      }),
    );
    expect(result.discardedSnapshot).toEqual(VALID_SNAPSHOT);
  });

  it("retrospective is absent from the update payload (R10 — never touched by reopen)", async () => {
    await reopenGoalCore("g1");
    const call = txMock.goal.update.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(call.data, "retrospective")).toBe(false);
  });

  it("returns hints.latestPlanId without a hadFocus key (documented pragmatic call — see goal-completion.ts)", async () => {
    const result = await reopenGoalCore("g1");
    expect(result.hints).toEqual({ latestPlanId: "latest-plan" });
    expect(Object.prototype.hasOwnProperty.call(result.hints, "hadFocus")).toBe(false);
  });
});
