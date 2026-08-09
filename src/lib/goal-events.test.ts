// src/lib/goal-events.test.ts
// Minimal coverage for REQ-007's calendar cleanup: getGoalEventsResult gains
// a DISTINCT 4th query (architecture-blueprint-v2.md R8) that surfaces
// "goal-completed" 🏆 events for achieved goals — since getActiveGoalsWithPlans
// now filters to status:"active" (also REQ-007), an achieved goal would
// otherwise never emit ANY calendar event again once completed.
//
// Mocks @/lib/db only. @/lib/legend and @/lib/records (baselineCheckpointDates)
// are pure/synchronous and left real.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import { getDb } from "@/lib/db";
import { getGoalEventsResult } from "@/lib/goal-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

const RANGE = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-31T23:59:59Z") };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeDb(opts: { activeGoals?: any[]; achievedGoals?: any[] } = {}) {
  const activeGoals = opts.activeGoals ?? [];
  const achievedGoals = opts.achievedGoals ?? [];
  return {
    goal: {
      // Same mocked method backs both getActiveGoalsWithPlans (status:"active")
      // and the new achieved-goals query (status:"achieved") — branch on args.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn().mockImplementation((args: any) => {
        if (args?.where?.status === "achieved") return Promise.resolve(achievedGoals);
        if (args?.where?.status === "active") return Promise.resolve(activeGoals);
        return Promise.resolve([]);
      }),
    },
    hike: { findMany: vi.fn().mockResolvedValue([]) },
    scheduledItem: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGoalEventsResult — goal-completed events (REQ-007 / R8)", () => {
  it("emits a 🏆 goal-completed event for an achieved goal whose completedAt falls in range", async () => {
    const fakeDb = makeFakeDb({
      achievedGoals: [
        {
          id: "g1",
          objective: "Summit Mt. Elbert",
          kind: "fitness",
          completedAt: new Date("2026-08-15T18:00:00Z"),
        },
      ],
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    const completedEvents = result.events.filter((e) => e.type === "goal-completed");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      goalId: "g1",
      goalObjective: "Summit Mt. Elbert",
      goalKind: "fitness",
      isFocusGoal: false,
      type: "goal-completed",
      icon: "🏆",
      label: "Goal completed",
      detail: "Summit Mt. Elbert",
    });
  });

  it("an achieved goal contributes ONLY the goal-completed event — no target-date/baseline-retest events (excluded from the active pipeline)", async () => {
    // The achieved goal never appears in the active-goals query result (that's
    // the status:"active" filter from REQ-007's getActiveGoalsWithPlans change) —
    // simulated here by omitting it from activeGoals entirely, even though it
    // still has a targetDate that WOULD have produced a target-date event
    // under the old active:true-only filter.
    const fakeDb = makeFakeDb({
      activeGoals: [],
      achievedGoals: [
        {
          id: "g1",
          objective: "Summit Mt. Elbert",
          kind: "fitness",
          completedAt: new Date("2026-08-15T18:00:00Z"),
        },
      ],
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe("goal-completed");
  });

  it("no achieved goals in range → no goal-completed events", async () => {
    const fakeDb = makeFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    expect(result.events.filter((e) => e.type === "goal-completed")).toHaveLength(0);
  });
});
