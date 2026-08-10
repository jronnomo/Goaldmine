// src/lib/day-rhythm.test.ts
// The Unified Today rhythm ladder + timeline builder (program-views research
// §7.8 test 7 + the #288 acceptance criteria). Fixtures come from the Phase 2A
// spec builders — the founder's real Monday is the canonical multi-goal day.

import { describe, it, expect } from "vitest";
import {
  blockRhythm,
  parseRhythm,
  buildTodayTimeline,
  type TodayTimelineInput,
} from "@/lib/day-rhythm";
import {
  buildPhase2aWeeklySplit,
  buildG4AttributionRule,
  PHASE2A_GOAL1,
} from "@/lib/phase2a-spec";

const G1 = "g-handstand"; // fitness, owns the rotation plan
const G2 = "g-bodycomp"; // fitness, metrics-only
const G3 = "g-aws"; // project

const MEMBERS = [
  { id: G1, objective: PHASE2A_GOAL1.objective, kind: "fitness", status: "active" },
  { id: G2, objective: "Reach 10% body fat", kind: "fitness", status: "active" },
  { id: G3, objective: "Pass the AWS exam", kind: "project", status: "active" },
];

const GOAL_MARKS = [
  { goalId: G1, claims: ["rotation", "nutrition"] },
  { goalId: G2, claims: ["baseline:Body Weight", "nutrition"] },
  { goalId: G3, claims: [] as string[] },
];

const RULES = [buildG4AttributionRule({ cut: G2, aws: G3, handstand: G1 })];
const HINTS = new Map<string, readonly string[]>([[G1, PHASE2A_GOAL1.attributionHints]]);

const MONDAY = buildPhase2aWeeklySplit()[0]; // Day 1 — Upper, Pressing Anchor

function input(overrides: Partial<TodayTimelineInput> = {}): TodayTimelineInput {
  return {
    dateKey: "2026-08-24",
    activeWorkout: MONDAY,
    plannedHike: null,
    baselinesDue: [{ testName: "Body Weight", checkpoint: "retest", logged: false }],
    scheduledItems: [],
    nutritionPlan: null,
    loggedMealsCount: 0,
    completedWorkouts: [],
    members: MEMBERS,
    goalMarks: GOAL_MARKS,
    attributionRules: RULES,
    attributionHintsByGoal: HINTS,
    ...overrides,
  };
}

describe("blockRhythm", () => {
  it("splits the founder's labeled blocks by prefix convention", () => {
    expect(blockRhythm({ type: "cardio", label: "Fasted AM — incline walk + AWS lectures" })).toBe("fasted-am");
    expect(blockRhythm({ type: "straight", label: "PM Skill — Session A · Balance" })).toBe("skill");
    expect(blockRhythm({ type: "straight", label: "Overhead press anchor" })).toBe("training");
    expect(blockRhythm({ type: "straight", label: "AM walk" })).toBe("fasted-am");
    // "AMRAP" must NOT read as an AM prefix (word boundary).
    expect(blockRhythm({ type: "straight", label: "AMRAP finisher" })).toBe("training");
    expect(blockRhythm({ type: "mobility" })).toBe("training");
  });
});

describe("parseRhythm", () => {
  it("accepts valid slots, falls back on anything else without throwing", () => {
    expect(parseRhythm("am")).toBe("am");
    expect(parseRhythm("fasted-am")).toBe("fasted-am");
    expect(parseRhythm("brunch")).toBeNull();
    expect(parseRhythm(42)).toBeNull();
    expect(parseRhythm(undefined)).toBeNull();
  });
});

describe("buildTodayTimeline — the founder's Monday", () => {
  it("orders the ladder [AM walk+AWS, session, PM skill, weigh-in, nutrition]", () => {
    const rows = buildTodayTimeline(input());
    expect(rows.map((r) => r.id)).toEqual([
      "am-0",
      "session",
      "pm-5",
      "baseline-body-weight",
      "fuel",
    ]);
  });

  it("the shared AM walk is ONE row carrying every claim it serves (● ■ ▲)", () => {
    const rows = buildTodayTimeline(input());
    const amRows = rows.filter((r) => r.slot === "fasted-am");
    expect(amRows).toHaveLength(1); // no-repeat invariant: one row, many marks
    expect([...amRows[0].goalIds].sort()).toEqual([G3, G2, G1].sort());
    expect(amRows[0].title).toBe("Fasted AM — incline walk + AWS lectures");
  });

  it("the session row claims only the rotation owner; the PM skill row claims via hints", () => {
    const rows = buildTodayTimeline(input());
    expect(rows.find((r) => r.id === "session")!.goalIds).toEqual([G1]);
    expect(rows.find((r) => r.id === "pm-5")!.goalIds).toEqual([G1]);
  });

  it("the weigh-in row is marked by the baseline-target goal, not the rotation owner", () => {
    const rows = buildTodayTimeline(input());
    expect(rows.find((r) => r.id === "baseline-body-weight")!.goalIds).toEqual([G2]);
  });

  it("the fuel row carries every fitness member's nutrition claim", () => {
    const rows = buildTodayTimeline(input());
    const fuel = rows.find((r) => r.id === "fuel")!;
    expect([...fuel.goalIds].sort()).toEqual([G2, G1].sort());
    expect(fuel.detail).toBe("0 meals logged");
    expect(fuel.filled).toBe(false);
  });

  it("nutrition plan macros produce the tier line; logged meals fill the mark", () => {
    const rows = buildTodayTimeline(
      input({
        nutritionPlan: {
          breakfast: { items: [{ name: "yogurt" }], macros: { calories: 500, proteinG: 50 } },
          dinner: { items: [{ name: "bowl" }], macros: { calories: 1000, proteinG: 100 } },
        },
        loggedMealsCount: 2,
      }),
    );
    const fuel = rows.find((r) => r.id === "fuel")!;
    expect(fuel.detail).toBe("1500 cal · 150 g protein target · 2 meals logged");
    expect(fuel.filled).toBe(true);
  });
});

describe("buildTodayTimeline — logged-side fill (conservative, server truth)", () => {
  it("a walk-only log fills the AM row and nothing else", () => {
    const rows = buildTodayTimeline(
      input({ completedWorkouts: [{ title: "Fasted incline walk", exerciseNames: [] }] }),
    );
    expect(rows.find((r) => r.id === "am-0")!.filled).toBe(true);
    expect(rows.find((r) => r.id === "session")!.filled).toBe(false);
    expect(rows.find((r) => r.id === "pm-5")!.filled).toBe(false);
  });

  it("a lift log with exercises fills the session via canonical-name intersection", () => {
    const rows = buildTodayTimeline(
      input({
        completedWorkouts: [
          { title: "Upper — Pressing Anchor", exerciseNames: ["DB Shoulder Press"] },
        ],
      }),
    );
    expect(rows.find((r) => r.id === "session")!.filled).toBe(true);
    expect(rows.find((r) => r.id === "am-0")!.filled).toBe(false);
  });

  it("a skill-only log fills the PM row without spilling into the session fallback", () => {
    const rows = buildTodayTimeline(
      input({
        completedWorkouts: [
          { title: "Evening practice", exerciseNames: ["Chest-to-Wall Handstand Hold"] },
        ],
      }),
    );
    expect(rows.find((r) => r.id === "pm-5")!.filled).toBe(true);
    expect(rows.find((r) => r.id === "session")!.filled).toBe(false);
  });

  it("an unclassifiable log falls back to the session row", () => {
    const rows = buildTodayTimeline(
      input({ completedWorkouts: [{ title: "Zumba", exerciseNames: [] }] }),
    );
    expect(rows.find((r) => r.id === "session")!.filled).toBe(true);
  });

  it("an all-in-one export fills every row it truly covers", () => {
    const rows = buildTodayTimeline(
      input({
        completedWorkouts: [
          {
            title: "Monday full day",
            exerciseNames: [
              "Incline Treadmill Walk",
              "DB Shoulder Press",
              "Chest-to-Wall Handstand Hold",
            ],
          },
        ],
      }),
    );
    expect(rows.find((r) => r.id === "am-0")!.filled).toBe(true);
    expect(rows.find((r) => r.id === "session")!.filled).toBe(true);
    expect(rows.find((r) => r.id === "pm-5")!.filled).toBe(true);
  });

  it("a logged baseline fills its own row", () => {
    const rows = buildTodayTimeline(
      input({ baselinesDue: [{ testName: "Body Weight", checkpoint: "retest", logged: true }] }),
    );
    expect(rows.find((r) => r.id === "baseline-body-weight")!.filled).toBe(true);
  });
});

describe("buildTodayTimeline — scheduled items", () => {
  it("items land once each with the owning goal's mark; done state fills", () => {
    const rows = buildTodayTimeline(
      input({
        activeWorkout: null,
        baselinesDue: [],
        scheduledItems: [
          { id: "i1", goalId: G3, type: "task", title: "Cantrill section 5", status: "planned" },
          { id: "i2", goalId: G3, type: "milestone", title: "Practice exam 1", status: "done" },
          { id: "i3", goalId: G3, type: "task", title: "Cancelled thing", status: "canceled" },
        ],
      }),
    );
    const items = rows.filter((r) => r.id.startsWith("item-"));
    expect(items.map((r) => r.id)).toEqual(["item-i1", "item-i2"]); // canceled hidden
    expect(items[0].goalIds).toEqual([G3]);
    expect(items[0].filled).toBe(false);
    expect(items[1].filled).toBe(true);
    expect(items[1].itemType).toBe("milestone");
  });

  it("payload rhythm overrides the anytime default; unknown values fall back", () => {
    const rows = buildTodayTimeline(
      input({
        activeWorkout: null,
        baselinesDue: [],
        scheduledItems: [
          { id: "i1", goalId: G3, type: "task", title: "Early", status: "planned", rhythm: "am" },
          { id: "i2", goalId: G3, type: "task", title: "Whenever", status: "planned", rhythm: "brunch" },
        ],
      }),
    );
    expect(rows.find((r) => r.id === "item-i1")!.slot).toBe("am");
    expect(rows.find((r) => r.id === "item-i2")!.slot).toBe("anytime");
    // "am" sorts ahead of "anytime" on the ladder.
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf("item-i1")).toBeLessThan(ids.indexOf("item-i2"));
  });
});

describe("buildTodayTimeline — deferral days & guards", () => {
  it("baseline day (session deferred): no block rows, tests + fuel only, and a stray log fills nothing", () => {
    const rows = buildTodayTimeline(
      input({
        activeWorkout: null, // deriveTodayTask nulls it on baseline days
        completedWorkouts: [{ title: "Casual walk", exerciseNames: [] }],
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(["baseline-body-weight", "fuel"]);
    expect(rows.every((r) => r.id !== "session")).toBe(true);
    expect(rows.find((r) => r.id === "baseline-body-weight")!.filled).toBe(false);
  });

  it("a planned hike renders as the fasted-am effort claimed by the rotation owner", () => {
    const rows = buildTodayTimeline(
      input({
        activeWorkout: null,
        baselinesDue: [],
        plannedHike: { route: "Mt. Sanitas", distanceMi: 3.2, elevationFt: 1300 },
      }),
    );
    const hike = rows.find((r) => r.id === "hike")!;
    expect(hike.slot).toBe("fasted-am");
    expect(hike.goalIds).toEqual([G1]);
    expect(rows[0].id).toBe("hike"); // fasted-am leads the ladder
  });

  it("project-only program: no fuel row when no goal claims nutrition", () => {
    const rows = buildTodayTimeline(
      input({
        activeWorkout: null,
        baselinesDue: [],
        members: [MEMBERS[2]],
        goalMarks: [{ goalId: G3, claims: ["scheduled_item"] }],
        scheduledItems: [
          { id: "i1", goalId: G3, type: "task", title: "Study", status: "planned" },
        ],
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(["item-i1"]);
  });

  it("an empty day builds an empty timeline (the component renders the empty state)", () => {
    const rows = buildTodayTimeline(
      input({
        activeWorkout: null,
        baselinesDue: [],
        members: [MEMBERS[2]],
        goalMarks: [{ goalId: G3, claims: [] }],
      }),
    );
    expect(rows).toEqual([]);
  });
});
