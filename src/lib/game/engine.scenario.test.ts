import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Hoisted above other imports (Vitest auto-hoists vi.mock regardless of literal
// position, but written here to match records.test.ts's convention). Only the
// "no plans ever → emptyState" suite below actually drives a DB call
// (computeGameStateFresh → getActiveProgram/getMostRecentProgram); every other
// test in this file calls the pure computeGameStateFromData and never touches
// this mock. Dual-export prisma + getDb, same shape as records.test.ts.
vi.mock("@/lib/db", () => ({
  prisma: {
    planDayOverride: { findMany: vi.fn() },
  },
  getDb: vi.fn(),
}));

import { computeGameStateFromData, computeGameStateFresh } from "@/lib/game/engine";
import { getDb } from "@/lib/db";
import { buildCompletionSnapshot } from "@/lib/goal-completion-core";
import { goalAchievedXp } from "@/lib/game/rules";
import { dateKey } from "@/lib/calendar-core";
import type { ProgramTemplate } from "@/lib/program-template";

// Minimal template: a single 1-week program whose rotation day 1 is a strength
// "lower" day. Only the fields the engine actually reads are populated.
const template = {
  name: "test",
  totalWeeks: 1,
  phases: [],
  weeklySplit: [
    { dayOfWeek: 1, title: "Lower", category: "lower", summary: "", blocks: [] },
  ],
  baselineWeek: [],
  goals: [],
} as unknown as ProgramTemplate;

const program = {
  id: "p1",
  name: "test",
  startedOn: new Date("2026-06-23T07:00:00.000Z"),
  template,
  confirmedThroughDate: null,
};

const now = new Date("2026-06-23T20:00:00.000Z"); // same plan day (day 1)

// completedGoals is intentionally omitted from the returned object when the
// caller doesn't pass it — not defaulted to [] here — so the two pre-existing
// call sites below exercise EXACTLY the R2 scenario the critique flagged: a
// genuinely-absent field on an `as never`-cast fixture. The engine's own
// `data.completedGoals ?? []` (inside computeGameStateFromData) is what makes
// that safe; if that runtime default regresses, these two tests are the ones
// that would start throwing.
function baseData(workouts: unknown[], completedGoals?: unknown[]) {
  return {
    program,
    goal: { id: "g1", kind: "fitness" },
    workouts,
    hikes: [],
    baselines: [],
    nutritionLogs: [],
    reviewNotes: [],
    mobilityCheckins: [],
    overridesByKey: new Map(),
    bonusRows: [],
    ...(completedGoals !== undefined ? { completedGoals } : {}),
  } as never;
}

const strengthWorkout = {
  id: "w-strength",
  startedAt: new Date("2026-06-23T14:00:00.000Z"),
  status: "completed",
  source: "manual",
  exercises: [
    { name: "Goblet Squat", sets: [{ weightLb: 50, reps: 12, durationSec: null, distanceMi: null }] },
  ],
};

const mobilityWorkout = {
  id: "w-mobility",
  startedAt: new Date("2026-06-23T15:00:00.000Z"), // logged AFTER the strength session
  status: "completed",
  source: "manual",
  exercises: [
    { name: "Mobility Session", sets: [{ weightLb: null, reps: null, durationSec: 900, distanceMi: null }] },
  ],
};

describe("off-plan extra mobility session (the reported scenario)", () => {
  it("awards mobility.session MOB when an extra mobility workout follows the scheduled strength session", () => {
    const state = computeGameStateFromData(baseData([strengthWorkout, mobilityWorkout]), now);
    const today = state.recentEvents.filter((e) => e.dateKey === "2026-06-23");

    const mobilitySession = today.find((e) => e.ruleId === "mobility.session");
    expect(mobilitySession, "expected a mobility.session event for the extra mobility workout").toBeDefined();
    expect(mobilitySession?.attribute).toBe("MOB");

    // The primary (first-logged) workout still takes the workout.completed slot.
    const completed = today.find((e) => e.ruleId === "workout.completed");
    expect(completed?.attribute).toBe("STR");
  });

  it("still credits mobility.session when the mobility workout is the only session", () => {
    const state = computeGameStateFromData(baseData([mobilityWorkout]), now);
    const today = state.recentEvents.filter((e) => e.dateKey === "2026-06-23");
    expect(today.find((e) => e.ruleId === "mobility.session")?.attribute).toBe("MOB");
    expect(today.find((e) => e.ruleId === "workout.completed")?.attribute).toBe("MOB");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Goal Completion Ceremony — REQ-004/REQ-005 (Track A)
// ─────────────────────────────────────────────────────────────────────────

// Builds a valid GoalCompletionSnapshot with a caller-controlled xpBasis
// (weeks/targetsMet) via the real pure builder — mirrors what
// computeCompletionSnapshot (Stage 1) actually persists, rather than
// hand-rolling a fixture that could drift from the real shape.
function mkSnapshot(opts: { weeksTotal: number; targetsMet: number; completedAt: Date }) {
  // Plan started far enough back that fullWeeksElapsed always exceeds
  // weeksTotal, so xpBasis.weeks lands exactly on weeksTotal (the min()
  // in buildCompletionSnapshot then clamps to weeksTotal every time).
  const startedOn = new Date(opts.completedAt.getTime() - 200 * 86_400_000);
  const targets = Array.from({ length: opts.targetsMet }, (_, i) => ({
    metric: `metric${i}`,
    label: `Target ${i}`,
    units: "lb",
    start: 0,
    final: 100,
    target: 100,
    progress: 1, // met = progress >= 1
  }));
  return buildCompletionSnapshot({
    goal: { objective: "Climb Elbert", kind: "fitness", createdAt: startedOn },
    completedAt: opts.completedAt,
    completedDateKey: dateKey(opts.completedAt),
    capturedAt: opts.completedAt,
    readiness: null,
    targets,
    feasibilityTierAtCompletion: null,
    coachFeasibilityTier: null,
    plan: { planId: "plan-1", weeksTotal: opts.weeksTotal, startedOn },
    xpAwardedAtCompletion: 0,
  });
}

describe("goal.achieved XP rule", () => {
  it("emits goal.achieved at completedAt's dateKey with formula XP (12 weeks / 4 targets met -> 650)", () => {
    const completedAt = new Date("2026-05-01T20:00:00.000Z");
    const snapshot = mkSnapshot({ weeksTotal: 12, targetsMet: 4, completedAt });

    const state = computeGameStateFromData(
      baseData([], [
        { completedAt, kind: "fitness", objective: "Climb Elbert", completionSnapshot: snapshot },
      ]),
      now,
    );

    const event = state.events.find((e) => e.ruleId === "goal.achieved");
    expect(event).toBeDefined();
    expect(event?.dateKey).toBe("2026-05-01");
    expect(event?.label).toBe("Goal achieved · Climb Elbert");
    expect(event?.attribute).toBeNull();
    expect(event?.xp).toBe(goalAchievedXp(12, 4));
    expect(event?.xp).toBe(650);
  });

  it("falls back to base-only XP (150) when the snapshot is unparseable", () => {
    const completedAt = new Date("2026-05-01T20:00:00.000Z");

    const state = computeGameStateFromData(
      baseData([], [
        { completedAt, kind: "project", objective: "Ship v2", completionSnapshot: { garbage: true } },
      ]),
      now,
    );

    const event = state.events.find((e) => e.ruleId === "goal.achieved");
    expect(event?.dateKey).toBe("2026-05-01");
    expect(event?.xp).toBe(150);
    expect(event?.xp).toBe(goalAchievedXp(0, 0));
  });

  it("also falls back to base-only XP when the snapshot is null (legacy achieved row)", () => {
    const completedAt = new Date("2026-05-01T20:00:00.000Z");

    const state = computeGameStateFromData(
      baseData([], [
        { completedAt, kind: "fitness", objective: "Old Goal", completionSnapshot: null },
      ]),
      now,
    );

    expect(state.events.find((e) => e.ruleId === "goal.achieved")?.xp).toBe(150);
  });
});

describe("goal-completion badges (REQ-005)", () => {
  const g1 = { completedAt: new Date("2026-01-10T20:00:00.000Z"), kind: "fitness", objective: "A", completionSnapshot: null };
  const g2 = { completedAt: new Date("2026-02-15T20:00:00.000Z"), kind: "project", objective: "B", completionSnapshot: null };
  const g3 = { completedAt: new Date("2026-03-20T20:00:00.000Z"), kind: "fitness", objective: "C", completionSnapshot: null };

  it("unlocks goal-first/goal-third/kind-first badges at the qualifying goal's completedAt dateKey (sorted, order-independent input)", () => {
    // Passed scrambled to prove the engine sorts completedGoals by dateKey asc
    // itself rather than relying on caller order.
    const state = computeGameStateFromData(baseData([], [g3, g1, g2]), now);
    const byId = (id: string) => state.badges.find((b) => b.def.id === id);

    expect(byId("goal-first")?.dateKey).toBe("2026-01-10");
    expect(byId("goal-third")?.dateKey).toBe("2026-03-20"); // only 3 rows — the 3rd is the last
    expect(byId("goal-fit-finisher")?.dateKey).toBe("2026-01-10"); // g1: first kind="fitness"
    expect(byId("goal-ship-it")?.dateKey).toBe("2026-02-15"); // g2: first kind="project"
    // Only 3 completed goals — the 5th/10th-goal milestones stay locked.
    expect(byId("goal-fifth")?.dateKey).toBeNull();
    expect(byId("goal-tenth")?.dateKey).toBeNull();
  });

  it("locks all 6 goal-completion badges when there are no achieved goals", () => {
    const state = computeGameStateFromData(baseData([]), now); // completedGoals omitted entirely
    for (const id of ["goal-first", "goal-third", "goal-fifth", "goal-tenth", "goal-fit-finisher", "goal-ship-it"]) {
      expect(state.badges.find((b) => b.def.id === id)?.dateKey).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R1 — streak gap-guard in the program-fallback path (fixes critique C-1)
// ─────────────────────────────────────────────────────────────────────────

// Every rotation day is "rest" so every ledger day succeeds automatically
// (no workouts/hikes/baselines needed to prove the streak math in isolation).
const restTemplate = {
  name: "rest-fallback-test",
  totalWeeks: 2, // 14 days
  phases: [],
  weeklySplit: [1, 2, 3, 4, 5, 6, 7].map((d) => ({
    dayOfWeek: d as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    title: "Rest",
    category: "rest",
    summary: "",
    blocks: [],
  })),
  baselineWeek: [],
  goals: [],
} as unknown as ProgramTemplate;

const restProgram = {
  id: "p-rest-fallback",
  name: "rest-fallback-test",
  // Denver-day-safe instant (see the file-level `program`/`now` fixtures above
  // for the same 07:00Z/20:00Z convention).
  startedOn: new Date("2026-06-01T07:00:00.000Z"),
  template: restTemplate,
  confirmedThroughDate: null,
};

function restFallbackData() {
  return {
    program: restProgram,
    goal: { id: "g1", kind: "fitness" },
    workouts: [],
    hikes: [],
    baselines: [],
    nutritionLogs: [],
    reviewNotes: [],
    mobilityCheckins: [],
    overridesByKey: new Map(),
    bonusRows: [],
  } as never;
}

describe("R1: streak gap-guard for a stale program-fallback plan", () => {
  it("forces streak.current = 0 when the fallback plan's window ended more than a day before today, preserving longest + ledger XP/level", () => {
    // restProgram's window is 14 days from 2026-06-01 -> last ledger day 2026-06-14.
    // "now" here is 6 days past that -> a real gap, not just "today hasn't happened yet".
    const nowWithGap = new Date("2026-06-20T20:00:00.000Z");
    const state = computeGameStateFromData(restFallbackData(), nowWithGap);

    expect(state.streak.current).toBe(0);
    expect(state.streak.longest).toBe(14); // historical fact about the stale run — untouched
    expect(state.streak.todayCounted).toBe(false);
    // NOT emptyState(): the program-fallback still preserves ledger XP/level.
    expect(state.goalKind).not.toBeNull();
    expect(state.xp).toBeGreaterThan(0);
    expect(state.level).toBeGreaterThan(1);
  });

  it("boundary: a fallback plan window ending exactly yesterday walks normally (streak preserved, not zeroed)", () => {
    // last ledger day 2026-06-14; "now" is exactly the day after it.
    const nowAtBoundary = new Date("2026-06-15T20:00:00.000Z");
    const state = computeGameStateFromData(restFallbackData(), nowAtBoundary);

    expect(state.streak.current).toBe(14); // unbroken run through the whole ledger
    expect(state.streak.longest).toBe(14);
    expect(state.streak.todayCounted).toBe(false); // today itself has no ledger entry yet
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Program fallback — "no plan has ever existed" still returns emptyState()
// ─────────────────────────────────────────────────────────────────────────

describe("program fallback: no active AND no historical plan -> emptyState()", () => {
  it("computeGameStateFresh returns emptyState() when getActiveProgram and getMostRecentProgram both resolve null", async () => {
    vi.mocked(getDb).mockResolvedValue({
      // M1/#269: no legacyProgram accessor — getActiveProgram/getMostRecentProgram
      // resolve null from the Plan table alone; a legacy read would throw here.
      // #277: zero Program rows (findFirst null / count 0) — the legacy-path
      // tenant this scenario has always described.
      plan: { findFirst: vi.fn().mockResolvedValue(null) },
      program: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
    } as never);

    const state = await computeGameStateFresh();

    expect(state.goalKind).toBeNull();
    expect(state.level).toBe(1);
    expect(state.xp).toBe(0);
    expect(state.streak).toEqual({ current: 0, longest: 0, todayCounted: false });
    expect(state.badges.every((b) => b.dateKey === null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// #299 (isFocus sweep, engine site) — the goal-context lookup swap.
// Primary path: rotation owner via getRotationOwnerGoal(); TRACKED EXCEPTION:
// legacy isFocus fallback when the helper yields null but a focus goal exists
// (single-ledger v1 — A3/Q3). These tests prove the DB path's output is
// byte-identical to the pure pipeline fed the same goal — XP totals,
// attribute pack, events, badges, quest — for the founder-shape fixtures.
// ─────────────────────────────────────────────────────────────────────────

describe("#299: fresh goal-context resolution (rotation owner ?? legacy focus)", () => {
  const PLAN_ROW = {
    id: "p1",
    name: "test",
    startedOn: program.startedOn,
    planJson: template,
    confirmedThroughDate: null,
  };
  const WORKOUT_ROWS = [
    {
      id: "w1",
      startedAt: new Date("2026-06-23T15:00:00.000Z"),
      status: "completed",
      source: null,
      exercises: [
        {
          name: "Goblet Squat",
          sets: [{ weightLb: 100, reps: 5, durationSec: null, distanceMi: null }],
        },
      ],
    },
  ];
  const OWNER_SELECT_ROW = {
    // Superset row the shared helper returns (only id/kind are consumed here).
    id: "g1",
    objective: "Owner goal",
    targetDate: null,
    kind: "fitness",
    isFocus: true,
    legend: null,
    targets: [],
    githubRepo: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mkFreshDb(overrides: Record<string, any> = {}) {
    return {
      plan: { findFirst: vi.fn().mockResolvedValue(PLAN_ROW) },
      program: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      goal: {
        findFirst: vi.fn().mockResolvedValue(OWNER_SELECT_ROW),
        findMany: vi.fn().mockResolvedValue([]),
      },
      workout: { findMany: vi.fn().mockResolvedValue(WORKOUT_ROWS) },
      hike: { findMany: vi.fn().mockResolvedValue([]) },
      baseline: { findMany: vi.fn().mockResolvedValue([]) },
      nutritionLog: { findMany: vi.fn().mockResolvedValue([]) },
      note: { findMany: vi.fn().mockResolvedValue([]) },
      mobilityCheckin: { findMany: vi.fn().mockResolvedValue([]) },
      gameBonusXp: { findMany: vi.fn().mockResolvedValue([]) },
      ...overrides,
    } as never;
  }

  // The pure pipeline fed the SAME data + the same goal — the before/after
  // yardstick (the pre-#299 lookup resolved this exact goal for both shapes).
  function pureState() {
    return computeGameStateFromData(
      baseData(WORKOUT_ROWS, []) as never,
      now,
    );
  }

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("zero-Program founder shape: the helper's compat path resolves the SAME focus goal — full state byte-identical to the pure pipeline", async () => {
    const db = mkFreshDb();
    vi.mocked(getDb).mockResolvedValue(db);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.planDayOverride.findMany).mockResolvedValue([]);

    const fresh = await computeGameStateFresh();

    // XP totals, attribute pack, events, badges, quest — the whole state.
    expect(fresh).toEqual(pureState());
    // And the resolution went through the legacy isFocus compat query
    // (zero Program rows), exactly like the pre-#299 inline lookup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goalCalls = (db as any).goal.findFirst.mock.calls as [{ where?: { isFocus?: unknown } }][];
    expect(goalCalls.some((c) => c[0]?.where?.isFocus === true)).toBe(true);
  });

  it("active Program shape: the rotation owner's goal gates the pack — same kind ⇒ state byte-identical; isFocus never queried", async () => {
    // plan.findFirst serves BOTH getActiveProgram calls (engine's own + the
    // helper's): the Program-attached active plan.
    const db = mkFreshDb({
      program: {
        findFirst: vi.fn().mockResolvedValue({ id: "prog-1", status: "active" }),
        count: vi.fn().mockResolvedValue(1),
      },
      goal: {
        // The helper resolves the owner via the plans relation; the legacy
        // fallback must never fire on this shape.
        findFirst: vi.fn().mockImplementation((args: { where?: { plans?: unknown } }) =>
          Promise.resolve(args?.where?.plans ? OWNER_SELECT_ROW : null),
        ),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    vi.mocked(getDb).mockResolvedValue(db);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.planDayOverride.findMany).mockResolvedValue([]);

    const fresh = await computeGameStateFresh();

    expect(fresh).toEqual(pureState());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goalCalls = (db as any).goal.findFirst.mock.calls as [{ where?: { isFocus?: unknown } }][];
    expect(goalCalls.some((c) => c[0]?.where?.isFocus === true)).toBe(false);
  });

  it("TRACKED EXCEPTION — Program with no rotation plan: falls back to the legacy focus goal (its kind still gates the pack, never the 'fitness' default)", async () => {
    const db = mkFreshDb({
      program: {
        findFirst: vi.fn().mockResolvedValue({ id: "prog-1", status: "active" }),
        count: vi.fn().mockResolvedValue(1),
      },
      plan: {
        // Program-attached active plan: none. getMostRecentProgram (no where
        // clause) still finds the historical plan — the engine keeps showing
        // historical XP (REQ-004c), and the pack falls back to the focus goal.
        findFirst: vi
          .fn()
          .mockImplementation((args: { where?: { programId?: unknown } }) =>
            Promise.resolve(args?.where?.programId ? null : PLAN_ROW),
          ),
      },
      goal: {
        findFirst: vi.fn().mockImplementation((args: { where?: { isFocus?: unknown } }) =>
          Promise.resolve(
            args?.where?.isFocus ? { id: "g-proj", kind: "project" } : null,
          ),
        ),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    vi.mocked(getDb).mockResolvedValue(db);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.planDayOverride.findMany).mockResolvedValue([]);

    const fresh = await computeGameStateFresh();

    // The focus fallback's kind gates the pack — proof the tracked exception
    // fired instead of a silent null → "fitness" default.
    expect(fresh.goalKind).toBe("project");
  });
});
