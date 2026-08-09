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
vi.mock("@/lib/readiness", () => ({
  computeReadiness: vi.fn(),
  computeReadinessSeriesSampled: vi.fn(),
}));
vi.mock("@/lib/rarity", () => ({ computeGoalFeasibility: vi.fn() }));
// REQ-008/V5: completeGoalCore now calls computeGameStateFresh itself (moved
// here from tools.ts's complete_goal handler) for the pre/post badge/level
// diff it freezes onto the snapshot's `ceremony` field. Mocked here the same
// way leaky-reads.test.ts mocks it — this file is testing goal-completion.ts's
// OWN transaction/ordering/guard logic, not engine.ts's real DB fan-out.
vi.mock("@/lib/game/engine", () => ({ computeGameStateFresh: vi.fn() }));

import { getDb } from "@/lib/db";
import { computeReadiness, computeReadinessSeriesSampled } from "@/lib/readiness";
import { computeGoalFeasibility } from "@/lib/rarity";
import { computeGameStateFresh } from "@/lib/game/engine";
import { Prisma } from "@/generated/prisma/client";
import { dateKey } from "@/lib/calendar";
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
const mockComputeReadinessSeriesSampled = computeReadinessSeriesSampled as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeGoalFeasibility = computeGoalFeasibility as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeGameStateFresh = computeGameStateFresh as any;

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
      // The post-tx best-effort ceremony write (REQ-008/V5) — a SEPARATE
      // top-level db.goal.update call, outside $transaction. Defaults to a
      // resolved value so tests that don't care about it (most of them)
      // don't have to stub it.
      update: vi.fn().mockResolvedValue({}),
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
  // Sane default so tests that don't care about the series (most of them)
  // don't have to stub it — computeCompletionSnapshot only calls it inside
  // the targets.length>0 branch.
  mockComputeReadinessSeriesSampled.mockResolvedValue([]);
  // Sane default badge/level state (REQ-008/V5) — completeGoalCore calls
  // this twice (pre-tx, post-tx); default to "nothing changed" so tests
  // that don't care about the ceremony diff don't have to stub it.
  mockComputeGameStateFresh.mockResolvedValue({ level: 1, badges: [] });
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
    // Zero-target goal: nothing to sample a series against — never called,
    // and the field is omitted entirely (not null, not []) from the snapshot.
    expect(mockComputeReadinessSeriesSampled).not.toHaveBeenCalled();
    expect(Object.prototype.hasOwnProperty.call(snapshot, "readinessSeries")).toBe(false);
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

  it("REQ-002/S2: calls computeReadinessSeriesSampled(goal.createdAt, targets, completedAt, goalId) and maps weekEnd -> dateKey into the snapshot", async () => {
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
    const weekEndA = new Date("2020-01-05T23:59:59.999Z");
    const weekEndB = new Date("2020-02-15T12:00:00Z");
    mockComputeReadinessSeriesSampled.mockResolvedValue([
      { weekEnd: weekEndA, score: 10 },
      { weekEnd: weekEndB, score: 80 },
    ]);

    const snapshot = await computeCompletionSnapshot("g1", COMPLETED_AT);

    expect(mockComputeReadinessSeriesSampled).toHaveBeenCalledTimes(1);
    const [createdAtArg, targetsArg, untilArg, goalIdArg] = mockComputeReadinessSeriesSampled.mock.calls[0];
    expect(createdAtArg).toBe(CREATED_AT);
    expect(targetsArg).toEqual([target]);
    expect(untilArg).toBe(COMPLETED_AT);
    expect(goalIdArg).toBe("g1");

    // weekEnd (Date) -> dateKey (USER_TZ string) mapping, values preserved.
    expect(snapshot.readinessSeries).toEqual([
      { dateKey: dateKey(weekEndA), score: 10 },
      { dateKey: dateKey(weekEndB), score: 80 },
    ]);
  });

  it("readinessSeries survives the completeGoalCore snapshot capture (written to tx.goal.update's completionSnapshot)", async () => {
    const target = {
      metric: "weightLb",
      label: "Body weight",
      units: "lb",
      direction: "decrease",
      target: 150,
      weight: 1,
    };
    const txMock = {
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
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(baseGoalRow({ targets: [target] })),
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
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
    const weekEnd = new Date("2020-02-09T23:59:59.999Z");
    mockComputeReadinessSeriesSampled.mockResolvedValue([{ weekEnd, score: 42 }]);

    await completeGoalCore("g1", COMPLETED_AT);

    const writtenSnapshot = txMock.goal.update.mock.calls[0][0].data.completionSnapshot;
    expect(writtenSnapshot.readinessSeries).toEqual([{ dateKey: dateKey(weekEnd), score: 42 }]);
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
        // The post-tx best-effort ceremony write (REQ-008/V5) — see makeFakeDb's default; re-declared
        // per-suite since this describe's `goal` override replaces the default object wholesale.
        update: vi.fn().mockResolvedValue({}),
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
// completeGoalCore — ceremony capture (REQ-008/V5): the badge/level diff and
// its two-step write (tx writes snapshot sans ceremony; a second, best-effort
// db.goal.update merges `ceremony` in). See goal-completion.ts's comments on
// completeGoalCore for the full design rationale.
// ─────────────────────────────────────────────────────────────────────────

describe("completeGoalCore — ceremony capture (REQ-008/V5)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;

  function committedGoal() {
    return {
      id: "g1",
      objective: "Summit Mt. Elbert",
      kind: "fitness",
      status: "achieved",
      completedAt: COMPLETED_AT,
      isFocus: false,
      active: false,
      createdAt: CREATED_AT,
      targetDate: null,
    };
  }

  beforeEach(() => {
    txMock = {
      goal: { update: vi.fn().mockResolvedValue(committedGoal()) },
      plan: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(baseGoalRow()),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
    });
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("calls computeGameStateFresh exactly twice: once before the transaction, once after it commits", async () => {
    mockComputeGameStateFresh
      .mockResolvedValueOnce({ level: 3, badges: [] }) // pre-state
      .mockResolvedValueOnce({ level: 3, badges: [] }); // post-state

    await completeGoalCore("g1", COMPLETED_AT);

    expect(mockComputeGameStateFresh).toHaveBeenCalledTimes(2);
    const preCallOrder = mockComputeGameStateFresh.mock.invocationCallOrder[0];
    const postCallOrder = mockComputeGameStateFresh.mock.invocationCallOrder[1];
    const txUpdateCallOrder = txMock.goal.update.mock.invocationCallOrder[0];
    // Pre-state precedes the transaction's write; post-state follows it —
    // the badge predicates for "post" need the just-committed achieved row.
    expect(preCallOrder).toBeLessThan(txUpdateCallOrder);
    expect(postCallOrder).toBeGreaterThan(txUpdateCallOrder);
  });

  it("diffs badges by id (newly-unlocked only) and reports levelBefore/levelAfter on result.ceremony", async () => {
    mockComputeGameStateFresh
      .mockResolvedValueOnce({
        level: 3,
        badges: [
          { def: { id: "already-unlocked", name: "Old Badge" }, dateKey: "2020-01-01" },
          { def: { id: "goal-first", name: "First Summit" }, dateKey: null },
        ],
      })
      .mockResolvedValueOnce({
        level: 4,
        badges: [
          { def: { id: "already-unlocked", name: "Old Badge" }, dateKey: "2020-01-01" },
          { def: { id: "goal-first", name: "First Summit" }, dateKey: "2020-02-15" },
        ],
      });

    const result = await completeGoalCore("g1", COMPLETED_AT);

    expect(result.ceremony).toEqual({
      badgesUnlocked: [{ id: "goal-first", name: "First Summit" }],
      levelBefore: 3,
      levelAfter: 4,
    });
  });

  it("tx.goal.update (inside the transaction) writes the snapshot WITHOUT ceremony", async () => {
    mockComputeGameStateFresh
      .mockResolvedValueOnce({ level: 3, badges: [] })
      .mockResolvedValueOnce({ level: 4, badges: [] });

    await completeGoalCore("g1", COMPLETED_AT);

    const txWrittenSnapshot = txMock.goal.update.mock.calls[0][0].data.completionSnapshot;
    expect(Object.prototype.hasOwnProperty.call(txWrittenSnapshot, "ceremony")).toBe(false);
  });

  it("a SECOND db.goal.update (outside the transaction) merges ceremony into the persisted snapshot", async () => {
    mockComputeGameStateFresh
      .mockResolvedValueOnce({ level: 3, badges: [] })
      .mockResolvedValueOnce({ level: 4, badges: [] });

    await completeGoalCore("g1", COMPLETED_AT);

    expect(fakeDb.goal.update).toHaveBeenCalledTimes(1);
    const call = fakeDb.goal.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "g1" });
    expect(call.data.completionSnapshot.ceremony).toEqual({
      badgesUnlocked: [],
      levelBefore: 3,
      levelAfter: 4,
    });
    // The second write happens strictly after the transaction's own write.
    const txCallOrder = txMock.goal.update.mock.invocationCallOrder[0];
    const secondCallOrder = fakeDb.goal.update.mock.invocationCallOrder[0];
    expect(secondCallOrder).toBeGreaterThan(txCallOrder);
  });

  it("result.snapshot mirrors the persisted (enriched) snapshot on the happy path", async () => {
    mockComputeGameStateFresh
      .mockResolvedValueOnce({ level: 3, badges: [] })
      .mockResolvedValueOnce({ level: 4, badges: [] });

    const result = await completeGoalCore("g1", COMPLETED_AT);

    expect(result.snapshot.ceremony).toEqual({
      badgesUnlocked: [],
      levelBefore: 3,
      levelAfter: 4,
    });
  });

  it("failure isolation: a throwing second write does NOT fail completeGoalCore — completion still succeeds, ceremony diff still returned, persisted snapshot just omits it", async () => {
    fakeDb.goal.update.mockRejectedValue(new Error("boom — DB hiccup on the best-effort write"));
    mockComputeGameStateFresh
      .mockResolvedValueOnce({ level: 3, badges: [] })
      .mockResolvedValueOnce({ level: 4, badges: [] });

    const result = await completeGoalCore("g1", COMPLETED_AT);

    // The completion itself succeeded (goal row, plan deactivation, etc.)...
    expect(result.goal.status).toBe("achieved");
    // ...the diff is still returned for the immediate MCP response...
    expect(result.ceremony).toEqual({ badgesUnlocked: [], levelBefore: 3, levelAfter: 4 });
    // ...but the returned (== persisted) snapshot has NO ceremony field —
    // it mirrors exactly what's in the DB (only the tx's plain write landed).
    expect(Object.prototype.hasOwnProperty.call(result.snapshot, "ceremony")).toBe(false);
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
