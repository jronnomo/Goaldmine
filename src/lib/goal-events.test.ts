// src/lib/goal-events.test.ts
// Coverage for two related fixes:
//
// 1. REQ-007's calendar cleanup: getGoalEventsResult gains a 🏆
//    "goal-completed" event for achieved goals — since getActiveGoalsWithPlans
//    filters to status:"active", an achieved goal would otherwise never emit
//    ANY calendar event again once completed.
// 2. The archived-decorations fix: an achieved goal's HISTORICAL decorative
//    events (baseline-retest ◎, planned-hike, scheduled-item) keep rendering
//    on the dates they actually happened, clamped to the goal's life window
//    [createdAt, completedAt] ∩ the requested range, with NO target-date pin
//    (the 🏆 is the terminal marker) and every emitted event flagged
//    `archived: true` so goal-conflicts.ts can exclude it from conflict math.
//
// Mocks @/lib/db only. @/lib/legend and @/lib/records (baselineCheckpointDates)
// are pure/synchronous and left real.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import { getDb } from "@/lib/db";
import { getGoalEventsResult, type GoalEvent } from "@/lib/goal-events";
import { crossGoalConflicts } from "@/lib/goal-conflicts";
import { dateKey, parseDateKey, startOfWeekMonday, addDays } from "@/lib/calendar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

const RANGE = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-31T23:59:59Z") };

// A minimal ProgramTemplate — only `baselineWeek` is read by
// baselineCheckpointDates(), so every other field is a harmless stub.
function makeTemplate(tests: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    name: "stub",
    totalWeeks: 26,
    phases: [],
    weeklySplit: [],
    baselineWeek: [{ dayOfWeek: 1, title: "Baseline", tests }],
    hikingSuperset: { type: "superset", label: "", rounds: 1, restSec: 0, exercises: [] },
    dailyMobility: { durationMin: 0, exercises: [] },
    goals: [],
  };
}

function makeFakeDb(
  opts: {
    activeGoals?: Array<Record<string, unknown>>;
    achievedGoals?: Array<Record<string, unknown>>;
    hikes?: Array<Record<string, unknown>>;
    scheduledItems?: Array<Record<string, unknown>>;
    achievedPlans?: Array<Record<string, unknown>>;
  } = {},
) {
  const activeGoals = opts.activeGoals ?? [];
  const achievedGoals = opts.achievedGoals ?? [];
  const hikes = opts.hikes ?? [];
  const scheduledItems = opts.scheduledItems ?? [];
  const achievedPlans = opts.achievedPlans ?? [];
  return {
    goal: {
      // Same mocked method backs both getActiveGoalsWithPlans (status:"active")
      // and the achieved-goals query (status:"achieved") — branch on args.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn().mockImplementation((args: any) => {
        if (args?.where?.status === "achieved") return Promise.resolve(achievedGoals);
        if (args?.where?.status === "active") return Promise.resolve(activeGoals);
        return Promise.resolve([]);
      }),
    },
    hike: { findMany: vi.fn().mockResolvedValue(hikes) },
    scheduledItem: { findMany: vi.fn().mockResolvedValue(scheduledItems) },
    plan: { findMany: vi.fn().mockResolvedValue(achievedPlans) },
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
          createdAt: new Date("2026-01-01T18:00:00Z"),
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

  it("an achieved goal with no plan/hikes/scheduled-items contributes ONLY the goal-completed event", async () => {
    // No plan fixture → the archived baseline-retest pass has nothing to
    // checkpoint against; no hike/scheduledItem fixtures either → the only
    // event this goal can possibly contribute is its own 🏆.
    const fakeDb = makeFakeDb({
      activeGoals: [],
      achievedGoals: [
        {
          id: "g1",
          objective: "Summit Mt. Elbert",
          kind: "fitness",
          createdAt: new Date("2026-01-01T18:00:00Z"),
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

describe("getGoalEventsResult — archived-goal decorative events (goal-story: keep history on the calendar)", () => {
  const g1 = {
    id: "g1",
    objective: "Summit Mt. Elbert",
    kind: "fitness",
    legend: null,
    createdAt: new Date("2026-07-01T18:00:00Z"), // dateKey 2026-07-01
    completedAt: new Date("2026-08-20T18:00:00Z"), // dateKey 2026-08-20
  };

  it("renders a baseline-retest event inside the goal's life window and the requested range, flagged archived", async () => {
    // startedOn 2026-07-01, retestWeeks: [6] → +42d → 2026-08-12 (dateKey),
    // inside both [createdAt, completedAt] and RANGE.
    const template = makeTemplate([
      {
        testName: "1RM Squat",
        units: "lb",
        protocol: "1RM",
        initialWeek: 1,
        retestWeeks: [6],
      },
    ]);
    const fakeDb = makeFakeDb({
      achievedGoals: [g1],
      achievedPlans: [{ goalId: "g1", planJson: template, startedOn: g1.createdAt }],
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    const retestEvents = result.events.filter(
      (e) => e.type === "baseline-retest" && e.goalId === "g1",
    );
    expect(retestEvents).toHaveLength(1);
    expect(retestEvents[0]).toMatchObject({
      goalId: "g1",
      goalObjective: "Summit Mt. Elbert",
      isFocusGoal: false,
      dateKey: "2026-08-12",
      type: "baseline-retest",
      icon: "◎",
      detail: "1RM Squat",
      archived: true,
    });

    // The 🏆 terminal marker still fires exactly once for the same goal.
    expect(
      result.events.filter((e) => e.type === "goal-completed" && e.goalId === "g1"),
    ).toHaveLength(1);

    // NO target-date pin is ever emitted for an achieved goal — the 🏆 is
    // the terminal marker (rule 2 of the fix spec).
    expect(
      result.events.filter((e) => e.type === "target-date" && e.goalId === "g1"),
    ).toHaveLength(0);
  });

  it("does NOT render a checkpoint that falls after the goal's completedAt, even if it's inside the requested range", async () => {
    const completedEarly = { ...g1, completedAt: new Date("2026-08-10T18:00:00Z") }; // dateKey 2026-08-10
    // retestWeeks: [6] → +42d from 2026-07-01 → 2026-08-12, which is INSIDE
    // RANGE but AFTER completedEarly.completedAt (2026-08-10) — must be
    // dropped by the life-window clamp, not just the range check.
    const template = makeTemplate([
      {
        testName: "1RM Squat",
        units: "lb",
        protocol: "1RM",
        initialWeek: 1,
        retestWeeks: [6],
      },
    ]);
    const fakeDb = makeFakeDb({
      achievedGoals: [completedEarly],
      achievedPlans: [{ goalId: "g1", planJson: template, startedOn: g1.createdAt }],
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    expect(result.events.filter((e) => e.type === "baseline-retest")).toHaveLength(0);
  });

  it("renders a planned-hike attributed to the achieved goal, within its life window, flagged archived", async () => {
    const fakeDb = makeFakeDb({
      achievedGoals: [g1],
      hikes: [
        {
          id: "h1",
          date: new Date("2026-08-15T18:00:00Z"), // dateKey 2026-08-15, inside life + range
          route: "Elbert Loop",
          goalId: "g1",
        },
      ],
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    const hikeEvents = result.events.filter((e) => e.type === "planned-hike");
    expect(hikeEvents).toHaveLength(1);
    expect(hikeEvents[0]).toMatchObject({
      goalId: "g1",
      isFocusGoal: false,
      dateKey: "2026-08-15",
      type: "planned-hike",
      detail: "Elbert Loop",
      archived: true,
    });
  });

  it("a goal whose entire life falls outside the requested range contributes no events at all", async () => {
    const longGone = {
      id: "g3",
      objective: "Old finished goal",
      kind: "fitness",
      legend: null,
      createdAt: new Date("2026-05-01T18:00:00Z"),
      completedAt: new Date("2026-06-01T18:00:00Z"), // dateKey 2026-06-01, well before RANGE start
    };
    const template = makeTemplate([
      {
        testName: "Irrelevant Test",
        units: "lb",
        protocol: "1RM",
        initialWeek: 1,
        retestWeeks: [1],
      },
    ]);
    const fakeDb = makeFakeDb({
      achievedGoals: [longGone],
      achievedPlans: [{ goalId: "g3", planJson: template, startedOn: longGone.createdAt }],
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    expect(result.events.filter((e) => e.goalId === "g3")).toHaveLength(0);
  });
});

describe("getGoalEventsResult — active-goal pipeline stays byte-unchanged", () => {
  it("an active goal's target-date and baseline-retest events carry no `archived` key", async () => {
    const activeGoal = {
      id: "focus-1",
      objective: "Marathon PR",
      targetDate: new Date("2026-08-20T18:00:00Z"),
      kind: "fitness",
      isFocus: true,
      legend: null,
      plans: [
        {
          id: "plan-1",
          startedOn: new Date("2026-07-01T18:00:00Z"),
          endsOn: new Date("2026-12-01T18:00:00Z"),
          weeks: 20,
          planJson: makeTemplate([
            {
              testName: "5K Time Trial",
              units: "min",
              protocol: "5K",
              initialWeek: 1,
              retestWeeks: [6],
            },
          ]),
        },
      ],
    };
    const fakeDb = makeFakeDb({ activeGoals: [activeGoal] });
    mockGetDb.mockResolvedValue(fakeDb);

    const result = await getGoalEventsResult(RANGE);

    expect(result.events.length).toBeGreaterThan(0);
    for (const e of result.events) {
      expect(e.archived).toBeUndefined();
    }
    const targetDateEvent = result.events.find((e) => e.type === "target-date");
    expect(targetDateEvent).toMatchObject({
      goalId: "focus-1",
      isFocusGoal: true,
      dateKey: "2026-08-20",
      type: "target-date",
    });
  });
});

describe("crossGoalConflicts — archived events are excluded from conflict math", () => {
  it("an archived goal's baseline-retest event cannot create a key-events-same-week conflict", () => {
    // Two key events (target-date/baseline-retest type) in the SAME Mon–Sun
    // week normally triggers key-events-same-week. Compute two same-week
    // dateKeys dynamically so the test doesn't depend on which weekday a
    // hardcoded date happens to fall on.
    const monday = startOfWeekMonday(parseDateKey("2026-08-10"));
    const mondayKey = dateKey(monday);
    const wednesdayKey = dateKey(addDays(monday, 2));

    const baseEvents: GoalEvent[] = [
      {
        goalId: "focus-1",
        goalObjective: "Focus Goal",
        goalKind: "fitness",
        isFocusGoal: true,
        dateKey: mondayKey,
        type: "baseline-retest",
        icon: "◎",
        label: "Retest: Squat",
      },
      {
        goalId: "archived-1",
        goalObjective: "Old Goal",
        goalKind: "fitness",
        isFocusGoal: false,
        dateKey: wednesdayKey,
        type: "baseline-retest",
        icon: "◎",
        label: "Retest: Deadlift",
        archived: true,
      },
    ];

    const conflicts = crossGoalConflicts({
      events: baseEvents,
      focusGoalId: "focus-1",
      focusProgram: null,
      plannedHikeDateKeys: [],
      range: RANGE,
    });
    expect(conflicts).toHaveLength(0);

    // Sanity check: the SAME shape without the archived flag DOES conflict —
    // proves the test isn't vacuously passing for some unrelated reason.
    const sameEventsUnflagged: GoalEvent[] = baseEvents.map((e) => {
      const rest: GoalEvent = { ...e };
      delete rest.archived;
      return rest;
    });
    const sanityConflicts = crossGoalConflicts({
      events: sameEventsUnflagged,
      focusGoalId: "focus-1",
      focusProgram: null,
      plannedHikeDateKeys: [],
      range: RANGE,
    });
    expect(sanityConflicts.length).toBeGreaterThan(0);
    expect(sanityConflicts.some((c) => c.goalId === "archived-1")).toBe(true);
  });
});
