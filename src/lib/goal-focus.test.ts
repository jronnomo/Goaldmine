// src/lib/goal-focus.test.ts
//
// - REQ-007: getActiveGoalsWithPlans must add status:"active" to its where
//   clause alongside active:true — belt-and-braces against a legacy achieved
//   row (predating completeGoalCore's active:false write) still showing up on
//   Today/Calendar with an overdue chip / target-date events.
// - #297 (isFocus sweep): getRotationOwnerGoal is THE shared "current goal"
//   accessor — its four tenant branches mirror getActiveProgram()'s seam:
//   zero-Program-rows → legacy isFocus compat query (byte-identical where/
//   orderBy), active Program + rotation → the Plan-owning goal (no isFocus),
//   active Program with no rotation → null, retired-Program tenant → null.

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

describe("getRotationOwnerGoal (#297)", () => {
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

  it("zero Program rows → the legacy isFocus compat query (same where/orderBy as getFocusGoal)", async () => {
    const goalFindFirst = vi.fn().mockResolvedValue(FOCUS_ROW);
    const d = db({ goal: { findFirst: goalFindFirst } });
    mockGetDb.mockResolvedValue(d);

    const row = await getRotationOwnerGoal();

    expect(row?.id).toBe("g-focus");
    expect(goalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isFocus: true },
        orderBy: { updatedAt: "desc" },
      }),
    );
    // No Program-side plan resolution on the legacy branch.
    expect((d.plan as { findFirst: ReturnType<typeof vi.fn> }).findFirst).not.toHaveBeenCalled();
  });

  it("active Program with a rotation → the Plan-owning goal via the plans relation; isFocus never consulted", async () => {
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

    const row = await getRotationOwnerGoal();

    expect(row?.id).toBe("g-owner");
    const args = goalFindFirst.mock.calls[0]![0];
    expect(args.where).toEqual({ plans: { some: { id: "plan-rot" } } });
    expect(JSON.stringify(args.where)).not.toContain("isFocus");
  });

  it("active Program with NO rotation plan → null (never regresses to the isFocus query)", async () => {
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

    expect(await getRotationOwnerGoal()).toBeNull();
    expect(goalFindFirst).not.toHaveBeenCalled();
  });

  it("retired-Program tenant (rows exist, none active) → null, not the focus fallback", async () => {
    const goalFindFirst = vi.fn().mockResolvedValue(FOCUS_ROW);
    const d = db({
      program: {
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn().mockResolvedValue(null), // no ACTIVE program
      },
      goal: { findFirst: goalFindFirst },
    });
    mockGetDb.mockResolvedValue(d);

    expect(await getRotationOwnerGoal()).toBeNull();
    expect(goalFindFirst).not.toHaveBeenCalled();
  });
});
