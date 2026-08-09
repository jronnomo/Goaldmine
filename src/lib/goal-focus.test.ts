// src/lib/goal-focus.test.ts
// Minimal coverage for REQ-007: getActiveGoalsWithPlans must add status:"active"
// to its where clause alongside active:true — belt-and-braces against a
// legacy achieved row (predating completeGoalCore's active:false write) still
// showing up on Today/Calendar with an overdue chip / target-date events.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import { getDb } from "@/lib/db";
import { getActiveGoalsWithPlans } from "@/lib/goal-focus";

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
