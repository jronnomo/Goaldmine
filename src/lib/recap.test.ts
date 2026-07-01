// src/lib/recap.test.ts
// Unit tests for src/lib/recap.ts — story #85 (honesty engine).
//
// Part A: resolveStatSlot — pure function, fabricated ctx.
//         The vi.mock on @/lib/db is a transitive-import guard only;
//         resolveStatSlot is pure and never touches prisma at runtime.
//
// Part B: computeWeeklyRecap — full async aggregator.
//         Prisma methods + helper modules mocked; goals use empty targets
//         so computeReadiness is never invoked.
//
// C-1 invariant (from goal-presentation.test.ts):
//   isNull is `v === null`. Integer-count slots (workoutsCompleted:0, prCount:0)
//   are v===0, so isNull:false. Do NOT assert isNull:true for zero-count slots.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted by Vitest before all imports. This prevents the
// "DATABASE_URL is not set" throw from db.ts and intercepts the async helpers
// called by computeWeeklyRecap.
vi.mock("@/lib/db", () => {
  // Shared mock db — both `prisma` (legacy import at line 51) and the object
  // returned by `getDb()` point to the same vi.fn() instances so beforeEach
  // setup via `pm.*` applies to both paths.
  const db = {
    goal: { findFirst: vi.fn() },
    workout: { findMany: vi.fn() },
    hike: { findMany: vi.fn() },
    logEntry: { findFirst: vi.fn() },
    scheduledItem: { groupBy: vi.fn() },
    baseline: { findMany: vi.fn() },
  };
  return {
    prisma: db,
    getDb: vi.fn().mockResolvedValue(db),
  };
});

// @/lib/records is mocked for getExerciseSummaries (called by computeWeeklyRecap)
// and getExerciseHistory (transitively imported by goal-targets.ts → readiness.ts).
vi.mock("@/lib/records", () => ({
  getExerciseSummaries: vi.fn(),
  getExerciseHistory: vi.fn(),
}));

vi.mock("@/lib/program", () => ({
  getActiveProgram: vi.fn(),
}));

// computeGameState is wrapped with React cache() in engine.ts; mocking the
// whole module replaces it with a plain vi.fn() — the cache wrapper is gone.
vi.mock("@/lib/game/engine", () => ({
  computeGameState: vi.fn(),
}));

import { resolveStatSlot, computeWeeklyRecap } from "@/lib/recap";
import { FITNESS_PRESENTATION, PROJECT_PRESENTATION } from "@/lib/goal-presentation";
import { prisma } from "@/lib/db";
import { getExerciseSummaries } from "@/lib/records";
import { getActiveProgram } from "@/lib/program";
import { computeGameState } from "@/lib/game/engine";

// ─── Cast helpers ─────────────────────────────────────────────────────────────
// At runtime prisma is our vi.fn() mock object; TypeScript still sees the
// original PrismaClient types. `as any` casts silence static type errors on
// mock-only methods like .mockResolvedValue without changing runtime behavior.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pm = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetExerciseSummaries = getExerciseSummaries as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetActiveProgram = getActiveProgram as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeGameState = computeGameState as any;

// ─── Shared ctx fixtures for Part A ──────────────────────────────────────────

/** Full fitness ctx — 2 workouts, 2,370 lb volume, 1 PR, 5,200 ft elevation */
const FITNESS_FULL_CTX = {
  recap: {
    workoutsCompleted: 2,
    volumeLb: 2370,
    prCount: 1,
    hikeElevationFt: 5200,
  },
  logLatest: new Map<string, number | null>(),
  scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
  breakdown: [],
  targets: [],
};

/** Fitness ctx where nullable fields are null; zero-count fields are 0 (not null) */
const FITNESS_NULL_CTX = {
  recap: {
    workoutsCompleted: 0,
    volumeLb: null as number | null,
    prCount: 0,
    hikeElevationFt: null as number | null,
  },
  logLatest: new Map<string, number | null>(),
  scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
  breakdown: [],
  targets: [],
};

const PROJECT_BASE_RECAP = {
  workoutsCompleted: 0,
  volumeLb: null as number | null,
  prCount: 0,
  hikeElevationFt: null as number | null,
};

// ─── Part A: resolveStatSlot (pure) ──────────────────────────────────────────

describe("resolveStatSlot — fitness full ctx: byte-identical values", () => {
  it("resolves all four fitness slots to exact strings (fmtVolume, fmtElevation, String(n))", () => {
    const resolved = FITNESS_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, FITNESS_FULL_CTX),
    );

    expect(resolved).toEqual([
      { key: "workouts",  label: "WORKOUTS",  value: "2",        isNull: false },
      { key: "volume",    label: "VOLUME",    value: "2,370 lb", isNull: false },
      { key: "prs",       label: "NEW PRs",   value: "1",        isNull: false },
      { key: "elevation", label: "ELEVATION", value: "5,200 ft", isNull: false },
    ]);
  });

  it("int format uses String(n) — '2' not '2.0'", () => {
    const workoutsSlot = FITNESS_PRESENTATION.statSlots[0];
    const r = resolveStatSlot(workoutsSlot, FITNESS_FULL_CTX);
    // String(2) must equal "2" — not a float representation
    expect(r.value).toBe("2");
    expect(r.value).toBe(String(2));
  });

  it("fmtVolume: 2370 lb → '2,370 lb' with comma separator", () => {
    const volumeSlot = FITNESS_PRESENTATION.statSlots[1];
    const r = resolveStatSlot(volumeSlot, FITNESS_FULL_CTX);
    expect(r.value).toBe("2,370 lb");
    expect(r.isNull).toBe(false);
  });

  it("fmtElevation: 5200 ft → '5,200 ft' with comma separator", () => {
    const elevSlot = FITNESS_PRESENTATION.statSlots[3];
    const r = resolveStatSlot(elevSlot, FITNESS_FULL_CTX);
    expect(r.value).toBe("5,200 ft");
    expect(r.isNull).toBe(false);
  });
});

describe("resolveStatSlot — fitness null ctx: C-1 zero ≠ null invariant", () => {
  it("volume null → '—'/isNull:true; elevation null → '—'/isNull:true", () => {
    const [, volumeR, , elevR] = FITNESS_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, FITNESS_NULL_CTX),
    );
    expect(volumeR).toEqual({ key: "volume",    label: "VOLUME",    value: "—", isNull: true });
    expect(elevR).toEqual(  { key: "elevation", label: "ELEVATION", value: "—", isNull: true });
  });

  it("workoutsCompleted:0 → '0'/isNull:false (0 is not null)", () => {
    const [workoutsR] = FITNESS_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, FITNESS_NULL_CTX),
    );
    expect(workoutsR).toEqual({ key: "workouts", label: "WORKOUTS", value: "0", isNull: false });
  });

  it("prCount:0 → '0'/isNull:false (0 is not null)", () => {
    const [, , prsR] = FITNESS_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, FITNESS_NULL_CTX),
    );
    expect(prsR).toEqual({ key: "prs", label: "NEW PRs", value: "0", isNull: false });
  });
});

describe("resolveStatSlot — project MRR: logLatest honest dash invariant", () => {
  it("mrr logLatest=null → '—'/isNull:true (honest dash — NOT '$0')", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>([["mrr", null]]),
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
      breakdown: [],
      targets: [],
    };
    const mrrSlot = PROJECT_PRESENTATION.statSlots[0]; // {key:"mrr", format:"currency"}
    const r = resolveStatSlot(mrrSlot, ctx);

    expect(r).toEqual({ key: "mrr", label: "MRR", value: "—", isNull: true });
    // Honesty check: must never render "$0" when value was never logged
    expect(r.value).not.toBe("$0");
  });

  it("mrr logLatest missing entirely (Map has no 'mrr' key) → '—'/isNull:true", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>(), // empty — mrr never inserted
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
      breakdown: [],
      targets: [],
    };
    const mrrSlot = PROJECT_PRESENTATION.statSlots[0];
    const r = resolveStatSlot(mrrSlot, ctx);
    expect(r.value).toBe("—");
    expect(r.isNull).toBe(true);
  });

  it("mrr logLatest=1000 → '$1,000'/isNull:false (currency format with comma)", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>([["mrr", 1000]]),
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
      breakdown: [],
      targets: [],
    };
    const mrrSlot = PROJECT_PRESENTATION.statSlots[0];
    const r = resolveStatSlot(mrrSlot, ctx);
    expect(r).toEqual({ key: "mrr", label: "MRR", value: "$1,000", isNull: false });
  });

  it("mrr logLatest=500 → '$500'/isNull:false (sub-1000, no comma)", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>([["mrr", 500]]),
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
      breakdown: [],
      targets: [],
    };
    const mrrSlot = PROJECT_PRESENTATION.statSlots[0];
    const r = resolveStatSlot(mrrSlot, ctx);
    expect(r.value).toBe("$500");
    expect(r.isNull).toBe(false);
  });
});

describe("resolveStatSlot — project milestones: ScheduledItem agg (two-truths invariant)", () => {
  // The two-truths invariant: milestones slot reads from scheduledAgg (ScheduledItem rows)
  // NOT from a log:milestones_done logEntry. These are two separate data sources
  // that must not be confused.

  it("done:0/total:7 → '0/7'/isNull:false (ScheduledItem agg, not logEntry)", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>(),
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>([
        ["milestone", { done: 0, total: 7, open: 7 }],
      ]),
      breakdown: [],
      targets: [],
    };
    const milestonesSlot = PROJECT_PRESENTATION.statSlots[1]; // {key:"milestones", agg:"doneOverTotal"}
    const r = resolveStatSlot(milestonesSlot, ctx);
    expect(r).toEqual({ key: "milestones", label: "MILESTONES", value: "0/7", isNull: false });
  });

  it("done:3/total:7 → '3/7'/isNull:false", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>(),
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>([
        ["milestone", { done: 3, total: 7, open: 4 }],
      ]),
      breakdown: [],
      targets: [],
    };
    const milestonesSlot = PROJECT_PRESENTATION.statSlots[1];
    const r = resolveStatSlot(milestonesSlot, ctx);
    expect(r).toEqual({ key: "milestones", label: "MILESTONES", value: "3/7", isNull: false });
  });

  it("total:0 (no milestones tracked at all) → isNull:true (honest empty)", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>(),
      // No "milestone" key in scheduledAgg → fallback to {done:0,total:0,open:0}
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
      breakdown: [],
      targets: [],
    };
    const milestonesSlot = PROJECT_PRESENTATION.statSlots[1];
    const r = resolveStatSlot(milestonesSlot, ctx);
    // isNull: counts.total === 0 → true
    expect(r.isNull).toBe(true);
  });

  it("done:7/total:7 → '7/7'/isNull:false (all completed)", () => {
    const ctx = {
      recap: PROJECT_BASE_RECAP,
      logLatest: new Map<string, number | null>(),
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>([
        ["milestone", { done: 7, total: 7, open: 0 }],
      ]),
      breakdown: [],
      targets: [],
    };
    const milestonesSlot = PROJECT_PRESENTATION.statSlots[1];
    const r = resolveStatSlot(milestonesSlot, ctx);
    expect(r).toEqual({ key: "milestones", label: "MILESTONES", value: "7/7", isNull: false });
  });
});

// ─── Part B: computeWeeklyRecap (async, mocked) ───────────────────────────────
//
// Reference date: Wednesday 2026-06-17 noon UTC.
// Week window: Mon 2026-06-16 – Sun 2026-06-22.
//
// Fitness test: 2 workouts, volume=2370 lb, 1 PR in-window, hike 5200 ft.
// Project test: no workouts/hikes, MRR never logged, 7 planned milestones.

const RECAP_AS_OF = new Date("2026-06-17T12:00:00Z");

// Two workouts whose volume sums to 2370 lb:
//   W1: 100lb×10 + 100lb×10 = 2000 lb
//   W2:  37lb×10             =  370 lb
//                              --------
//                              2370 lb
const MOCK_WORKOUTS = [
  {
    id: "w1",
    startedAt: new Date("2026-06-16T08:00:00Z"),
    status: "completed",
    exercises: [
      { sets: [{ weightLb: 100, reps: 10 }, { weightLb: 100, reps: 10 }] },
    ],
  },
  {
    id: "w2",
    startedAt: new Date("2026-06-17T08:00:00Z"),
    status: "completed",
    exercises: [
      { sets: [{ weightLb: 37, reps: 10 }] },
    ],
  },
];

// One hike in the week window — 5,200 ft elevation
const MOCK_HIKE = [
  { id: "hike-1", elevationFt: 5200, route: "Bear Peak Trail", distanceMi: 8.2 },
];

// One exercise PR whose bestDate falls within Mon Jun 16 – Sun Jun 22
const MOCK_EXERCISE_SUMMARIES = [
  {
    name: "Goblet Squat",
    equipment: null,
    sessionCount: 5,
    totalSets: 20,
    primary: "rm" as const,
    bestValue: 200,
    bestRaw: { weightLb: 65, reps: 10, durationSec: null },
    bestDate: new Date("2026-06-17T08:00:00Z"),
  },
];

const MOCK_GAME_STATE_FITNESS = {
  goalKind: "fitness",
  level: 1,
  xp: 100,
  xpIntoLevel: 100,
  xpToNext: 200,
  progress: 0.5,
  attributes: [],
  streak: { current: 5, longest: 10, todayCounted: true },
  badges: [],
  recentEvents: [],
  questToday: null,
};

const MOCK_FITNESS_GOAL = {
  id: "goal-fitness-1",
  kind: "fitness",
  isFocus: true,
  objective: "Summit Mt. Elbert via Black Cloud Trail",
  targets: [],
  updatedAt: new Date("2026-06-01"),
  targetDate: null,
};

const MOCK_PROJECT_GOAL = {
  id: "goal-project-1",
  kind: "project",
  isFocus: true,
  objective: "Ship Chewgether to the App Store",
  targets: [],
  updatedAt: new Date("2026-06-01"),
  targetDate: new Date("2026-09-30"),
};

// ─── B-1: Fitness goal ────────────────────────────────────────────────────────

describe("computeWeeklyRecap — fitness goal: statSlots byte-identical to legacy fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pm.goal.findFirst.mockResolvedValue(MOCK_FITNESS_GOAL);
    pm.workout.findMany.mockResolvedValue(MOCK_WORKOUTS);
    pm.hike.findMany.mockResolvedValue(MOCK_HIKE);
    pm.baseline.findMany.mockResolvedValue([]); // no baselines this week → no highlight
    mockGetExerciseSummaries.mockResolvedValue(MOCK_EXERCISE_SUMMARIES);
    mockGetActiveProgram.mockResolvedValue(null); // no fitness plan — simplifies header math
    mockComputeGameState.mockResolvedValue(MOCK_GAME_STATE_FITNESS);
  });

  it("emits exactly 4 statSlots for a fitness goal", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    expect(recap.statSlots).toHaveLength(4);
  });

  it("statSlots keys are [workouts, volume, prs, elevation] in order", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    expect(recap.statSlots.map((s) => s.key)).toEqual([
      "workouts",
      "volume",
      "prs",
      "elevation",
    ]);
  });

  it("volume 2370 lb: statSlot '2,370 lb' matches legacy volumeLb", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    // Legacy field
    expect(recap.volumeLb).toBe(2370);
    // Stat slot — byte-identical to fmtVolume(2370)
    const volumeSlot = recap.statSlots.find((s) => s.key === "volume")!;
    expect(volumeSlot.value).toBe("2,370 lb");
    expect(volumeSlot.isNull).toBe(false);
  });

  it("elevation 5200 ft: statSlot '5,200 ft' matches legacy hikeElevationFt", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    expect(recap.hikeElevationFt).toBe(5200);
    const elevSlot = recap.statSlots.find((s) => s.key === "elevation")!;
    expect(elevSlot.value).toBe("5,200 ft");
    expect(elevSlot.isNull).toBe(false);
  });

  it("exact statSlot values for all four fitness slots: '2', '2,370 lb', '1', '5,200 ft'", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);

    expect(recap.workoutsCompleted).toBe(2);
    expect(recap.volumeLb).toBe(2370);
    expect(recap.prCount).toBe(1);
    expect(recap.hikeElevationFt).toBe(5200);

    expect(recap.statSlots).toEqual([
      { key: "workouts",  label: "WORKOUTS",  value: "2",        isNull: false },
      { key: "volume",    label: "VOLUME",    value: "2,370 lb", isNull: false },
      { key: "prs",       label: "NEW PRs",   value: "1",        isNull: false },
      { key: "elevation", label: "ELEVATION", value: "5,200 ft", isNull: false },
    ]);
  });

  it("legacy fields (workoutsCompleted/volumeLb/prCount/hikeElevationFt) are present alongside statSlots", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    // The legacy top-level fields must coexist with statSlots — neither replaces the other
    expect("workoutsCompleted" in recap).toBe(true);
    expect("volumeLb" in recap).toBe(true);
    expect("prCount" in recap).toBe(true);
    expect("hikeElevationFt" in recap).toBe(true);
    expect("statSlots" in recap).toBe(true);
    // Both carry the same data
    expect(recap.workoutsCompleted).toBe(2);
    expect(recap.statSlots[0].value).toBe("2");
  });
});

// ─── B-2: Project goal ────────────────────────────────────────────────────────

describe("computeWeeklyRecap — project goal: MRR null + milestones 0/7", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pm.goal.findFirst.mockResolvedValue(MOCK_PROJECT_GOAL);
    pm.workout.findMany.mockResolvedValue([]);
    pm.hike.findMany.mockResolvedValue([]);
    pm.logEntry.findFirst.mockResolvedValue(null); // MRR never logged → honest dash
    // 7 planned milestones, 0 done
    pm.scheduledItem.groupBy.mockResolvedValue([
      { status: "planned", _count: { _all: 7 } },
    ]);
    pm.baseline.findMany.mockResolvedValue([]);
    mockGetExerciseSummaries.mockResolvedValue([]);
    mockGetActiveProgram.mockResolvedValue(null);
    mockComputeGameState.mockResolvedValue({
      ...MOCK_GAME_STATE_FITNESS,
      goalKind: "project",
      streak: { current: 0, longest: 0, todayCounted: false },
    });
  });

  it("emits exactly 2 statSlots for a project goal", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    expect(recap.statSlots).toHaveLength(2);
  });

  it("mrr never logged → statSlot '—'/isNull:true (honest dash, NOT '$0')", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    const mrrSlot = recap.statSlots.find((s) => s.key === "mrr")!;
    expect(mrrSlot.value).toBe("—");
    expect(mrrSlot.isNull).toBe(true);
    expect(mrrSlot.value).not.toBe("$0");
  });

  it("milestones 0/7 → statSlot '0/7'/isNull:false (ScheduledItem agg, not logEntry)", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    const milestonesSlot = recap.statSlots.find((s) => s.key === "milestones")!;
    expect(milestonesSlot.value).toBe("0/7");
    expect(milestonesSlot.isNull).toBe(false);
  });

  it("exact statSlots for project: [{mrr, '—', true}, {milestones, '0/7', false}]", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    expect(recap.statSlots).toEqual([
      { key: "mrr",        label: "MRR",        value: "—",    isNull: true  },
      { key: "milestones", label: "MILESTONES",  value: "0/7",  isNull: false },
    ]);
  });

  it("legacy fitness fields (workoutsCompleted/volumeLb/prCount/hikeElevationFt) present + zero/null for empty project week", async () => {
    const recap = await computeWeeklyRecap(RECAP_AS_OF);
    // Legacy fields must coexist with project statSlots
    expect(recap.workoutsCompleted).toBe(0);
    expect(recap.volumeLb).toBeNull();
    expect(recap.prCount).toBe(0);
    expect(recap.hikeElevationFt).toBeNull();
    // Project slots correct count
    expect(recap.statSlots).toHaveLength(2);
  });
});
