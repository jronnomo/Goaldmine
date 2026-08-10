// src/lib/goal-focus.test.ts
//
// - REQ-007: getActiveGoalsWithPlans must add status:"active" to its where
//   clause alongside active:true — belt-and-braces against a legacy achieved
//   row (predating completeGoalCore's active:false write) still showing up on
//   Today/Calendar with an overdue chip / target-date events.
// - #297/#298 (isFocus sweep, suites merged at consolidation):
//   getRotationOwnerGoal is THE shared "current goal" accessor — its tenant
//   branches mirror getActiveProgram()'s seam: zero-Program-rows → legacy
//   isFocus compat query (byte-identical where/orderBy) in mode "legacy",
//   active Program + rotation → the Plan-owning goal (no isFocus) in mode
//   "program", active Program with no rotation → ownerless "program",
//   retired-Program tenant → ownerless "program" (never a silent regression
//   to the focus fallback). The resolution envelope carries the full goal
//   row plus the derived goalId/goalKind/planId flats.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import { getDb } from "@/lib/db";
import { getActiveGoalsWithPlans, getRotationOwnerGoal } from "@/lib/goal-focus";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActiveGoalsWithPlans", () => {
  it("queries with both active:true AND status:'active'", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    mockGetDb.mockResolvedValue({ goal: { findMany } });

    await getActiveGoalsWithPlans();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true, status: "active" } }),
    );
  });
});

describe("getRotationOwnerGoal (#297/#298, consolidated)", () => {
  const OWNER_ROW = {
    id: "g-owner",
    objective: "Freestanding handstand",
    targetDate: null,
    kind: "fitness",
    isFocus: false, // deliberately NOT the focus goal — rotation ownership wins
    legend: null,
    targets: [],
    githubRepo: null,
  };
  const FOCUS_ROW = {
    id: "g-focus",
    objective: "Legacy focus goal",
    targetDate: null,
    kind: "fitness",
    isFocus: true,
    legend: null,
    targets: [],
    githubRepo: null,
  };

  function db(overrides: Record<string, unknown> = {}) {
    return {
      program: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      plan: { findFirst: vi.fn().mockResolvedValue(null) },
      goal: { findFirst: vi.fn().mockResolvedValue(null) },
      ...overrides,
    };
  }

  it("zero Program rows → legacy mode via the isFocus compat query (same where/orderBy as getFocusGoal), full row + derived flats", async () => {
    const goalFindFirst = vi.fn().mockResolvedValue(FOCUS_ROW);
    const d = db({ goal: { findFirst: goalFindFirst } });
    mockGetDb.mockResolvedValue(d);

    const result = await getRotationOwnerGoal();

    expect(result).toEqual({
      mode: "legacy",
      goalId: "g-focus",
      goalKind: "fitness",
      planId: null,
      goal: FOCUS_ROW,
    });
    expect(goalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isFocus: true },
        orderBy: { updatedAt: "desc" },
      }),
    );
    // No Program-side plan resolution on the legacy branch.
    expect((d.plan as { findFirst: ReturnType<typeof vi.fn> }).findFirst).not.toHaveBeenCalled();
  });

  it("zero Program rows and no focus goal → legacy mode, ownerless (all nulls)", async () => {
    const d = db(); // goal.findFirst resolves null
    mockGetDb.mockResolvedValue(d);

    expect(await getRotationOwnerGoal()).toEqual({
      mode: "legacy",
      goalId: null,
      goalKind: null,
      planId: null,
      goal: null,
    });
  });

  it("active Program with a rotation → program mode, the Plan-owning goal via the plans relation (planId carried); isFocus never consulted", async () => {
    const goalFindFirst = vi.fn().mockResolvedValue(OWNER_ROW);
    const d = db({
      program: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: "prog-1", status: "active" }),
      },
      plan: { findFirst: vi.fn().mockResolvedValue({ id: "plan-rot" }) },
      goal: { findFirst: goalFindFirst },
    });
    mockGetDb.mockResolvedValue(d);

    const result = await getRotationOwnerGoal();

    expect(result).toEqual({
      mode: "program",
      goalId: "g-owner",
      goalKind: "fitness",
      planId: "plan-rot",
      goal: OWNER_ROW,
    });
    const args = goalFindFirst.mock.calls[0]![0];
    expect(args.where).toEqual({ plans: { some: { id: "plan-rot" } } });
    expect(JSON.stringify(args.where)).not.toContain("isFocus");
  });

  it("active Program with NO rotation plan → ownerless program mode (never regresses to the isFocus query)", async () => {
    const goalFindFirst = vi.fn();
    const d = db({
      program: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: "prog-1", status: "active" }),
      },
      plan: { findFirst: vi.fn().mockResolvedValue(null) },
      goal: { findFirst: goalFindFirst },
    });
    mockGetDb.mockResolvedValue(d);

    expect(await getRotationOwnerGoal()).toEqual({
      mode: "program",
      goalId: null,
      goalKind: null,
      planId: null,
      goal: null,
    });
    expect(goalFindFirst).not.toHaveBeenCalled();
  });

  it("retired-Program tenant (rows exist, none active) → ownerless program mode, not the focus fallback", async () => {
    const goalFindFirst = vi.fn().mockResolvedValue(FOCUS_ROW);
    const d = db({
      program: {
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn().mockResolvedValue(null), // no ACTIVE program
      },
      goal: { findFirst: goalFindFirst },
    });
    mockGetDb.mockResolvedValue(d);

    expect(await getRotationOwnerGoal()).toEqual({
      mode: "program",
      goalId: null,
      goalKind: null,
      planId: null,
      goal: null,
    });
    expect(goalFindFirst).not.toHaveBeenCalled();
  });
});
