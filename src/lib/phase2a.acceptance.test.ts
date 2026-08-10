// src/lib/phase2a.acceptance.test.ts
//
// #287 — RFC §3 acceptance case, end-to-end at the payload level (RFC
// deliverable 7): "An end-to-end Vitest seeds exactly this and asserts the
// merged payload + three readiness deltas from one day's logs."
//
// The Phase 2A world is seeded from the REAL spec builders
// (src/lib/phase2a-spec.ts) — Program + 3 goals + the 20-week rotation plan +
// the G4 attributionRule — over the routing-faithful in-memory fixture
// pattern established by program.acceptance.test.ts: every accessor applies
// the ACTUAL where/orderBy/select the code under test passes, so these tests
// exercise SELECTION against data shapes, not hand-wired per-call returns.
//
// The RFC §3 Monday (2026-08-17 — week 2, rotation day 1, no baselines due,
// no override):
//   - one Workout titled "Fasted incline walk" → the Program attributionRule
//     (buildG4AttributionRule) links it to cut + AWS + handstand: THREE
//     ActivityGoalLink writes from ONE log call (gate G4);
//   - one log_metric study_hours LogEntry (goal-scoped, cumulative);
//   - one NutritionLog;
//   - a weigh-in Measurement + a body-fat Measurement + two Baseline results.
//
// Asserted:
//   (1) the merged get_today_plan payload (resolveDay + the real
//       shapeProgramTodayPayload — the exact handler composition): rotation
//       session, AWS study ScheduledItem, cut weigh-in item, goalMarks for
//       ALL THREE goals;
//   (2) three attribution links from the one workout write (+ the nutrition
//       and log_metric link paths);
//   (3) compute_readiness on each goal moves from the same day's logs —
//       cut via weightLb/bodyFatPct Measurements, handstand via a logged
//       baseline, AWS via the study-hours cumulative sum (computeReadiness
//       called directly against the fixture db);
//   (4) the chewgether-shape guard at the payload level: an active Program
//       with no rotation plan + an unrelated DORMANT active:true Plan outside
//       the Program → out_of_plan payload, NO cross-goal plan leak
//       (plan-critique Critical #1, re-asserted post-merge).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockOverrideFindUnique, mockGetDb } = vi.hoisted(() => ({
  mockOverrideFindUnique: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    planDayOverride: {
      findUnique: mockOverrideFindUnique,
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
  getDb: mockGetDb,
}));

vi.mock("@/lib/goal-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/goal-events")>();
  return {
    ...actual,
    getGoalEventsResult: vi
      .fn()
      .mockResolvedValue({ events: [], focusGoalId: null, otherGoalsMeta: [] }),
  };
});

import { resolveDay, parseDateKey, dateKey, startOfDay } from "@/lib/calendar";
import { shapeProgramTodayPayload } from "@/lib/mcp/today-shapers";
import { computeReadiness } from "@/lib/readiness";
import {
  autoLinkWorkout,
  autoLinkNutrition,
  mirrorActivityGoalLink,
  type AttributionLinkWriter,
} from "@/lib/attribution-hooks";
import { ACTIVITY_LINK_TYPE } from "@/lib/activity-links";
import {
  PHASE2A_GOAL1_ID,
  PHASE2A_PROGRAM,
  PHASE2A_GOAL1,
  PHASE2A_GOAL2,
  PHASE2A_GOAL3,
  PHASE2A_PLAN,
  buildG4AttributionRule,
  buildPhase2aRotationTemplate,
} from "@/lib/phase2a-spec";
import type { GoalTarget } from "@/lib/metrics-registry";

// ─── The RFC §3 Monday ──────────────────────────────────────────────────────

const GOAL_CUT_ID = "goal-cut";
const GOAL_AWS_ID = "goal-aws";
const PROGRAM_ID = "prog-phase2a";
const PLAN_ID = "plan-phase2a-rotation";

const MONDAY_KEY = "2026-08-17"; // week 2, rotation day 1 — Upper, no tests due
const MONDAY = parseDateKey(MONDAY_KEY);
const MONDAY_MORNING = new Date("2026-08-17T13:00:00.000Z"); // 07:00 MDT
const SUNDAY_KEY = "2026-08-16"; // the day BEFORE any Phase 2A logging

// ─── Fixture world (all rows dated the Monday) ──────────────────────────────

type Row = Record<string, unknown>;

type World = {
  programs: {
    id: string;
    name: string;
    status: string;
    startedOn: Date;
    endsOn: Date | null;
    notes: string | null;
    attributionRules: unknown;
  }[];
  goals: {
    id: string;
    objective: string;
    kind: string;
    status: string;
    isFocus: boolean;
    programId: string | null;
    targets: readonly GoalTarget[];
    attributionHints: readonly string[] | null;
    targetDate: Date | null;
    githubRepo: string | null;
    createdAt: Date;
    updatedAt: Date;
    plans: { id: string }[];
  }[];
  plans: {
    id: string;
    name: string;
    startedOn: Date;
    planJson: unknown;
    confirmedThroughDate: Date | null;
    active: boolean;
    programId: string | null;
    goalId: string;
    updatedAt: Date;
    goal: { isFocus: boolean };
  }[];
  scheduledItems: {
    id: string;
    goalId: string;
    date: Date;
    type: string;
    title: string;
    detail: string | null;
    status: string;
    completedAt: Date | null;
  }[];
  workouts: {
    id: string;
    title: string;
    status: string;
    source: string;
    startedAt: Date;
    notes: string | null;
    exercises: { id: string; name: string; sets: Row[] }[];
  }[];
  logEntries: { id: string; goalId: string; metric: string; value: number | null; date: Date }[];
  nutritionLogs: {
    id: string;
    date: Date;
    mealType: string;
    items: unknown;
    notes: string | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  }[];
  baselines: { id: string; testName: string; value: number; units: string; date: Date }[];
  measurements: { id: string; date: Date; weightLb: number | null; bodyFatPct: number | null }[];
  hikes: Row[];
  notes: Row[];
};

function buildWorld(): World {
  const template = buildPhase2aRotationTemplate();
  const g4Rule = buildG4AttributionRule({
    cut: GOAL_CUT_ID,
    aws: GOAL_AWS_ID,
    handstand: PHASE2A_GOAL1_ID,
  });

  return {
    programs: [
      {
        id: PROGRAM_ID,
        name: PHASE2A_PROGRAM.name,
        status: "active",
        startedOn: parseDateKey(PHASE2A_PROGRAM.startedOnKey),
        endsOn: parseDateKey(PHASE2A_PROGRAM.endsOnKey),
        notes: PHASE2A_PROGRAM.notes,
        attributionRules: [g4Rule],
      },
    ],
    goals: [
      {
        id: PHASE2A_GOAL1_ID,
        objective: PHASE2A_GOAL1.objective,
        kind: "fitness",
        status: "active",
        isFocus: true,
        programId: PROGRAM_ID,
        targets: PHASE2A_GOAL1.targets,
        attributionHints: PHASE2A_GOAL1.attributionHints,
        targetDate: parseDateKey(PHASE2A_GOAL1.targetDateKey),
        githubRepo: null,
        createdAt: new Date("2026-08-10T00:00:00.000Z"),
        updatedAt: new Date("2026-08-10T00:00:00.000Z"),
        plans: [{ id: PLAN_ID }],
      },
      {
        id: GOAL_CUT_ID,
        objective: PHASE2A_GOAL2.objective,
        kind: PHASE2A_GOAL2.kind,
        status: "active",
        isFocus: false,
        programId: PROGRAM_ID,
        targets: PHASE2A_GOAL2.targets,
        attributionHints: PHASE2A_GOAL2.attributionHints, // null per spec
        targetDate: parseDateKey(PHASE2A_GOAL2.targetDateKey),
        githubRepo: null,
        createdAt: new Date("2026-08-10T00:01:00.000Z"),
        updatedAt: new Date("2026-08-10T00:01:00.000Z"),
        plans: [],
      },
      {
        id: GOAL_AWS_ID,
        objective: PHASE2A_GOAL3.objective,
        kind: PHASE2A_GOAL3.kind,
        status: "active",
        isFocus: false,
        programId: PROGRAM_ID,
        targets: PHASE2A_GOAL3.targets,
        attributionHints: null,
        targetDate: null, // readiness-gated, not date-driven
        githubRepo: null,
        createdAt: new Date("2026-08-10T00:02:00.000Z"),
        updatedAt: new Date("2026-08-10T00:02:00.000Z"),
        plans: [],
      },
    ],
    plans: [
      {
        id: PLAN_ID,
        name: PHASE2A_PLAN.name,
        startedOn: parseDateKey(PHASE2A_PLAN.startedOnKey),
        planJson: template,
        confirmedThroughDate: null,
        active: true,
        programId: PROGRAM_ID,
        goalId: PHASE2A_GOAL1_ID,
        updatedAt: new Date("2026-08-10T00:00:00.000Z"),
        goal: { isFocus: true },
      },
    ],
    scheduledItems: [
      {
        id: "si-aws-study",
        goalId: GOAL_AWS_ID,
        date: MONDAY,
        type: "study",
        title: "AWS study block — Cantrill, treadmill lectures",
        detail: "Mon fasted-walk morning: lectures on the treadmill.",
        status: "planned",
        completedAt: null,
      },
      {
        id: "si-cut-weighin",
        goalId: GOAL_CUT_ID,
        date: MONDAY,
        type: "task",
        title: "Weekly weigh-in + waist tape",
        detail: "Fasted, navel tape, note.",
        status: "planned",
        completedAt: null,
      },
    ],
    workouts: [
      {
        id: "w-walk",
        title: "Fasted incline walk",
        status: "completed",
        source: "manual",
        startedAt: MONDAY_MORNING,
        notes: null,
        exercises: [
          {
            id: "we-1",
            name: "Incline Treadmill Walk",
            sets: [{ weightLb: null, reps: null, durationSec: 2700, distanceMi: null }],
          },
        ],
      },
    ],
    logEntries: [
      { id: "le-study", goalId: GOAL_AWS_ID, metric: "study_hours", value: 1.5, date: MONDAY_MORNING },
    ],
    nutritionLogs: [
      {
        id: "nl-1",
        date: new Date("2026-08-17T15:00:00.000Z"),
        mealType: "breakfast",
        items: [{ name: "Greek yogurt", qty: "1 cup" }],
        notes: null,
        calories: 320,
        proteinG: 34,
        carbsG: 30,
        fatG: 6,
        fiberG: 2,
        sodiumMg: 90,
      },
    ],
    baselines: [
      // Handstand readiness mover (rung-1 metric) + the lean-mass canary that
      // both Goal 1 and Goal 2 target.
      { id: "b-hold", testName: "Freestanding Handstand Hold", value: 5, units: "sec", date: MONDAY_MORNING },
      { id: "b-pullup", testName: "Pull-Up Max Reps", value: 25, units: "reps", date: MONDAY_MORNING },
    ],
    measurements: [
      { id: "m-weight", date: MONDAY_MORNING, weightLb: 152, bodyFatPct: null },
      { id: "m-bf", date: MONDAY_MORNING, weightLb: null, bodyFatPct: 22 },
    ],
    hikes: [] as Row[],
    notes: [] as Row[],
  };
}

// ─── Routing-faithful scoped-db stub ─────────────────────────────────────────

/** Apply a Prisma-style select projection (one nested relation level). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function project(row: any, select: any): any {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    const spec = select[key];
    if (!spec) continue;
    if (typeof spec === "object" && spec.select && Array.isArray(row[key])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out[key] = row[key].map((r: any) => project(r, spec.select));
    } else {
      out[key] = row[key];
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inDateRange(value: Date, cond: any): boolean {
  if (!cond) return true;
  if (cond.gte && value.getTime() < new Date(cond.gte).getTime()) return false;
  if (cond.lte && value.getTime() > new Date(cond.lte).getTime()) return false;
  if (cond.lt && value.getTime() >= new Date(cond.lt).getTime()) return false;
  return true;
}

 
function byDate(order: "asc" | "desc") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (a: any, b: any) =>
    order === "asc"
      ? a.date.getTime() - b.date.getTime()
      : b.date.getTime() - a.date.getTime();
}

function mkPhase2aDb(world: World) {
  const db = {
    program: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async (args: any) => {
        const rows =
          args?.where?.status !== undefined
            ? world.programs.filter((p) => p.status === args.where.status)
            : world.programs;
        return rows[0] ?? null;
      }),
      count: vi.fn(async () => world.programs.length),
    },
    goal: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async (args: any) => {
        let rows = world.goals;
        if (args?.where?.isFocus !== undefined) rows = rows.filter((g) => g.isFocus === args.where.isFocus);
        const sorted = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        const row = sorted[0] ?? null;
        return row ? project(row, args?.select) : null;
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async (args: any) => {
        let rows = world.goals;
        if (args?.where?.programId !== undefined) rows = rows.filter((g) => g.programId === args.where.programId);
        if (args?.where?.id?.in) rows = rows.filter((g) => args.where.id.in.includes(g.id));
        const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return sorted.map((g) => project(g, args?.select));
      }),
    },
    plan: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async (args: any) => {
        let rows = world.plans;
        if (args?.where?.active !== undefined) rows = rows.filter((p) => p.active === args.where.active);
        if (args?.where?.programId !== undefined) rows = rows.filter((p) => p.programId === args.where.programId);
        return rows[0] ?? null;
      }),
      findMany: vi.fn(async () => world.plans),
    },
    workout: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async (args: any) =>
        world.workouts.filter((w) => inDateRange(w.startedAt as Date, args?.where?.startedAt)),
      ),
    },
    scheduledItem: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async (args: any) => {
        let rows = world.scheduledItems;
        if (args?.where?.goalId?.in) rows = rows.filter((s) => args.where.goalId.in.includes(s.goalId));
        if (args?.where?.goalId && typeof args.where.goalId === "string") {
          rows = rows.filter((s) => s.goalId === args.where.goalId);
        }
        rows = rows.filter((s) => inDateRange(s.date, args?.where?.date));
        return rows.map((s) => project(s, args?.select));
      }),
    },
    nutritionLog: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async (args: any) =>
        world.nutritionLogs.filter((n) => inDateRange(n.date, args?.where?.date)),
      ),
    },
    hike: {
      findMany: vi.fn(async () => world.hikes),
    },
    note: {
      findMany: vi.fn(async () => world.notes),
    },
    baseline: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async (args: any) => {
        let rows = world.baselines;
        if (args?.where?.testName) rows = rows.filter((b) => b.testName === args.where.testName);
        rows = rows.filter((b) => inDateRange(b.date, args?.where?.date));
        const order = args?.orderBy?.date === "desc" ? "desc" : "asc";
        return [...rows].sort(byDate(order))[0] ?? null;
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async (args: any) => {
        let rows = world.baselines;
        if (args?.where?.OR) {
           
          rows = rows.filter((b) =>
            args.where.OR.some(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (cond: any) => b.testName === cond.testName && inDateRange(b.date, cond.date),
            ),
          );
        }
        return [...rows].sort(byDate("asc"));
      }),
    },
    measurement: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async (args: any) => {
        let rows = world.measurements;
        if (args?.where?.weightLb?.not === null) rows = rows.filter((m) => m.weightLb !== null);
        if (args?.where?.bodyFatPct?.not === null) rows = rows.filter((m) => m.bodyFatPct !== null);
        rows = rows.filter((m) => inDateRange(m.date, args?.where?.date));
        const order = args?.orderBy?.date === "desc" ? "desc" : "asc";
        return [...rows].sort(byDate(order))[0] ?? null;
      }),
    },
    logEntry: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aggregate: vi.fn(async (args: any) => {
        let rows = world.logEntries;
        if (args?.where?.goalId) rows = rows.filter((e) => e.goalId === args.where.goalId);
        if (args?.where?.metric) rows = rows.filter((e) => e.metric === args.where.metric);
        if (args?.where?.value?.not === null) rows = rows.filter((e) => e.value !== null);
        rows = rows.filter((e) => inDateRange(e.date, args?.where?.date));
        const sum = rows.reduce((s, e) => s + (e.value ?? 0), 0);
        return { _sum: { value: rows.length > 0 ? sum : null } };
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async (args: any) => {
        let rows = world.logEntries;
        if (args?.where?.goalId) rows = rows.filter((e) => e.goalId === args.where.goalId);
        if (args?.where?.metric) rows = rows.filter((e) => e.metric === args.where.metric);
        if (args?.where?.value?.not === null) rows = rows.filter((e) => e.value !== null);
        rows = rows.filter((e) => inDateRange(e.date, args?.where?.date));
        const order = args?.orderBy?.date === "desc" ? "desc" : "asc";
        return [...rows].sort(byDate(order))[0] ?? null;
      }),
    },
  };
  return db;
}

/** Link-write capture — the AttributionLinkWriter seam (same shape the scoped
 *  client satisfies), so link WRITES are observable without a live DB. */
function mkLinkWriter() {
  const written: Array<{
    activityType: string;
    activityId: string;
    goalId: string;
    source: string;
    activityDate: Date;
  }> = [];
  const writer: AttributionLinkWriter = {
    activityGoalLink: {
      async createMany(args) {
        written.push(...args.data);
        return { count: args.data.length };
      },
    },
  };
  return { writer, written };
}

// ─── Chewgether-shape world (assertion 4) ────────────────────────────────────

function buildChewgetherWorld(): World {
  return {
    programs: [
      {
        id: "prog-chew",
        name: "chewgether $1k/mo",
        status: "active",
        startedOn: parseDateKey("2026-09-01"),
        endsOn: null,
        notes: null,
        attributionRules: null,
      },
    ],
    goals: [
      {
        id: "goal-chew",
        objective: "chewgether to $1k MRR",
        kind: "project",
        status: "active",
        isFocus: false,
        programId: "prog-chew",
        targets: [],
        attributionHints: null,
        targetDate: null,
        githubRepo: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        plans: [],
      },
      // The vicious part of Critical #1: an unrelated goal OUTSIDE the
      // Program still owns a DORMANT active:true Plan and is even isFocus.
      {
        id: "goal-dormant",
        objective: "Old fitness goal",
        kind: "fitness",
        status: "active",
        isFocus: true,
        programId: null,
        targets: [],
        attributionHints: null,
        targetDate: null,
        githubRepo: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        plans: [{ id: "plan-dormant" }],
      },
    ],
    plans: [
      {
        id: "plan-dormant",
        name: "Dormant unrelated rotation",
        startedOn: parseDateKey("2026-08-01"),
        planJson: buildPhase2aRotationTemplate(),
        confirmedThroughDate: null,
        active: true, // multiple active Plans across goals IS the steady state
        programId: null,
        goalId: "goal-dormant",
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        goal: { isFocus: true },
      },
    ],
    scheduledItems: [],
    workouts: [],
    logEntries: [],
    nutritionLogs: [],
    baselines: [],
    measurements: [],
    hikes: [],
    notes: [],
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockOverrideFindUnique.mockResolvedValue(null); // no override on the Monday
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-17T18:00:00.000Z")); // Monday noon MDT
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── (1) The merged get_today_plan payload ───────────────────────────────────

describe("#287 (1) — merged get_today_plan payload for the RFC §3 Monday", () => {
  it("one merged day: rotation session + AWS study item + cut weigh-in + goalMarks for all three goals", async () => {
    mockGetDb.mockResolvedValue(mkPhase2aDb(buildWorld()));

    const r = await resolveDay(new Date());
    const payload = shapeProgramTodayPayload(
      r,
      {
        id: PHASE2A_GOAL1_ID,
        kind: "fitness",
        objective: PHASE2A_GOAL1.objective,
        githubRepo: null,
      },
      [],
      new Map(),
    );

    // Rotation session from the Program's plan (week 2, day 1 — spec's Monday).
    expect(payload.dateKey).toBe(MONDAY_KEY);
    expect(payload.isInPlan).toBe(true);
    expect(payload.weekIndex).toBe(2);
    expect(payload.rotationDay).toBe(1);
    expect(payload.todayTask).toBe("workout");
    expect(payload.activeWorkout?.title).toBe("Upper — Pressing Anchor");
    expect(payload.resolvedPlan).toEqual({ id: PLAN_ID, name: PHASE2A_PLAN.name, source: "active" });
    // Week 2: the Session-1 battery is week 1 / retests are weeks 10+19 —
    // nothing due, no deferral.
    expect(payload.baselinesDue).toEqual([]);
    expect(payload.workoutDeferredForBaseline).toBe(false);

    // Program context: all three member goals.
    expect(payload.program?.id).toBe(PROGRAM_ID);
    expect(payload.program?.memberGoals.map((g) => g.id)).toEqual([
      PHASE2A_GOAL1_ID,
      GOAL_CUT_ID,
      GOAL_AWS_ID,
    ]);

    // scheduledItemsToday union: AWS study block + the cut's weigh-in, each
    // carrying its owning goal.
    expect(payload.scheduledItemsToday.map((s) => [s.id, s.goalId])).toEqual([
      ["si-aws-study", GOAL_AWS_ID],
      ["si-cut-weighin", GOAL_CUT_ID],
    ]);
    const awsItem = payload.scheduledItemsToday.find((s) => s.goalId === GOAL_AWS_ID)!;
    expect(awsItem.goalObjective).toBe(PHASE2A_GOAL3.objective);

    // todayItems (saved-prompt shape) mirrors the union with goal badges.
    expect(payload.todayItems.map((t) => t.goalId).sort()).toEqual([GOAL_AWS_ID, GOAL_CUT_ID].sort());

    // goalMarks: every member goal claims its service of the day.
    const marksByGoal = new Map(payload.goalMarks.map((m) => [m.goalId, m.claims]));
    expect(marksByGoal.get(PHASE2A_GOAL1_ID)).toEqual(["rotation", "nutrition"]);
    expect(marksByGoal.get(GOAL_CUT_ID)).toEqual(["scheduled_item", "nutrition"]);
    expect(marksByGoal.get(GOAL_AWS_ID)).toEqual(["scheduled_item"]);

    // goalSections keyed by goalId, each member's own items partitioned.
    expect(Object.keys(payload.goalSections).sort()).toEqual(
      [PHASE2A_GOAL1_ID, GOAL_CUT_ID, GOAL_AWS_ID].sort(),
    );
    expect(payload.goalSections[GOAL_AWS_ID]!.todayItems.map((t) => t.id)).toEqual(["si-aws-study"]);
    expect(payload.goalSections[GOAL_CUT_ID]!.todayItems.map((t) => t.id)).toEqual(["si-cut-weighin"]);
    expect(payload.goalSections[PHASE2A_GOAL1_ID]!.todayItems).toEqual([]);

    // The day's logged activity rides the same payload.
    expect(payload.workouts.map((w) => w.title)).toEqual(["Fasted incline walk"]);
    expect(payload.loggedNutrition).toHaveLength(1);
  });
});

// ─── (2) Attribution: one walk write → three links ───────────────────────────

describe("#287 (2) — the G4 attribution case (one log call, three links)", () => {
  it("autoLinkWorkout('Fasted incline walk') writes THREE auto links — handstand + cut + AWS — via the Program rule", async () => {
    mockGetDb.mockResolvedValue(mkPhase2aDb(buildWorld()));
    const { writer, written } = mkLinkWriter();

    const linked = await autoLinkWorkout(writer, {
      workoutId: "w-walk",
      title: "Fasted incline walk",
      source: "manual",
      status: "completed",
      startedAt: MONDAY_MORNING,
      exerciseNames: ["Incline Treadmill Walk"],
    });

    // Member-goal order (attachment order), deduplicated.
    expect(linked).toEqual([PHASE2A_GOAL1_ID, GOAL_CUT_ID, GOAL_AWS_ID]);
    expect(written).toHaveLength(3);
    for (const row of written) {
      expect(row.activityType).toBe(ACTIVITY_LINK_TYPE.workout);
      expect(row.activityId).toBe("w-walk");
      expect(row.source).toBe("auto");
      expect(dateKey(row.activityDate)).toBe(MONDAY_KEY);
      expect(row.activityDate.getTime()).toBe(startOfDay(MONDAY_MORNING).getTime());
    }
    expect(written.map((w) => w.goalId).sort()).toEqual(
      [PHASE2A_GOAL1_ID, GOAL_CUT_ID, GOAL_AWS_ID].sort(),
    );
  });

  it("the log_metric LogEntry mirrors to AWS; the meal links to both fitness goals and never the project goal", async () => {
    mockGetDb.mockResolvedValue(mkPhase2aDb(buildWorld()));

    const mirror = mkLinkWriter();
    const mirrored = await mirrorActivityGoalLink(mirror.writer, {
      activityType: ACTIVITY_LINK_TYPE.logEntry,
      activityId: "le-study",
      goalId: GOAL_AWS_ID,
      date: MONDAY_MORNING,
    });
    expect(mirrored).toEqual([GOAL_AWS_ID]);
    expect(mirror.written.map((w) => [w.activityType, w.goalId])).toEqual([
      [ACTIVITY_LINK_TYPE.logEntry, GOAL_AWS_ID],
    ]);

    const meal = mkLinkWriter();
    const mealLinks = await autoLinkNutrition(meal.writer, {
      nutritionLogId: "nl-1",
      date: new Date("2026-08-17T15:00:00.000Z"),
    });
    expect(mealLinks).toEqual([PHASE2A_GOAL1_ID, GOAL_CUT_ID]);
    expect(meal.written.map((w) => w.goalId)).not.toContain(GOAL_AWS_ID);
  });
});

// ─── (3) Three readiness deltas from one day's logs ──────────────────────────

describe("#287 (3) — compute_readiness moves independently for all three goals from the same Monday", () => {
  it("cut via weightLb/bodyFatPct, handstand via logged baselines, AWS via the study-hours cumulative sum", async () => {
    mockGetDb.mockResolvedValue(mkPhase2aDb(buildWorld()));
    const before = parseDateKey(SUNDAY_KEY);
    const after = parseDateKey(MONDAY_KEY);

    // Handstand (Goal 1), spec v4 9-row table: the 5 s hold is TESTED but
    // reads 0 progress — it sits below the explicit start:10 (video-verified
    // 2026-08-09), and computeReadiness never auto-overwrites an explicit
    // start (a fatigued sub-10 reading is a fatigue reading, not a corrected
    // baseline). The movement comes from the 25-rep lean-mass canary
    // clearing its maintain target at weight 0.07.
    const g1Before = await computeReadiness(PHASE2A_GOAL1.targets, before, PHASE2A_GOAL1_ID);
    const g1After = await computeReadiness(PHASE2A_GOAL1.targets, after, PHASE2A_GOAL1_ID);
    expect(g1Before.score).toBe(0);
    expect(g1After.score).toBe(7); // 0.12·0 + 0.07·1 → raw 7 (log:hs_* rows untested → 0 at full denominator weight)
    expect(g1After.ceiling).toBe(80); // both v4 gates open: triple20-of-6 untested + wall HSPU untested
    expect(g1After.coverage).toEqual({ tested: 2, total: 9 });
    const holdAfter = g1After.breakdown.find(
      (b) => b.target.metric === "baseline:Freestanding Handstand Hold",
    )!;
    expect(holdAfter.current).toBe(5); // most-recent-by-date wins the CURRENT…
    expect(holdAfter.start).toBe(10); // …but the explicit start is never auto-overwritten
    expect(holdAfter.progress).toBe(0); // clamped — honest regression handling

    // Cut (Goal 2): weigh-in 152 vs explicit 155→143 proxy + DEXA-ish 22%
    // (auto-captured start — tested at 0 progress) + the lean-mass canary.
    const g2Before = await computeReadiness(PHASE2A_GOAL2.targets, before, GOAL_CUT_ID);
    const g2After = await computeReadiness(PHASE2A_GOAL2.targets, after, GOAL_CUT_ID);
    expect(g2Before.score).toBe(0);
    expect(g2After.score).toBe(25); // 0.4·0.25 + 0.15·1 → raw 25
    expect(g2After.ceiling).toBe(100); // no gating targets on the cut
    expect(g2After.coverage).toEqual({ tested: 3, total: 3 });

    // AWS (Goal 3): 1.5 study hours accumulate toward 120 (cumulative sum);
    // the practice-exam gate stays open.
    const g3Before = await computeReadiness(PHASE2A_GOAL3.targets, before, GOAL_AWS_ID);
    const g3After = await computeReadiness(PHASE2A_GOAL3.targets, after, GOAL_AWS_ID);
    expect(g3Before.score).toBe(0);
    expect(g3After.score).toBe(1); // 0.45·(1.5/120) → raw 0.5625 → 1
    expect(g3After.ceiling).toBe(80);
    const study = g3After.breakdown.find((b) => b.target.metric === "log:study_hours")!;
    expect(study.current).toBe(1.5); // the SUM of increments, not a snapshot

    // The deltas are three INDEPENDENT movements from one day's logging.
    for (const [b, a] of [
      [g1Before.score, g1After.score],
      [g2Before.score, g2After.score],
      [g3Before.score, g3After.score],
    ] as const) {
      expect(a).toBeGreaterThan(b);
    }
  });
});

// ─── (4) chewgether-shape guard at the payload level ─────────────────────────

describe("#287 (4) — active Program with no rotation + dormant unrelated active Plan: no cross-goal leak in the payload", () => {
  it("resolves out_of_plan with null rotation fields while keeping Program membership — the dormant plan never surfaces", async () => {
    mockGetDb.mockResolvedValue(mkPhase2aDb(buildChewgetherWorld()));

    const r = await resolveDay(new Date());
    const payload = shapeProgramTodayPayload(r, null, [], new Map());

    // The founding-bug guard: the dormant active:true Plan outside the
    // Program must NOT become "the day".
    expect(payload.resolvedPlan).toBeNull();
    expect(payload.isInPlan).toBe(false);
    expect(payload.todayTask).toBe("out_of_plan");
    expect(payload.activeWorkout).toBeNull();
    expect(payload.deferredWorkout).toBeNull();
    expect(payload.rotationDay).toBeNull();
    expect(payload.weekIndex).toBeNull();
    expect(payload.baselinesDue).toEqual([]);

    // ...while the Program's own context is fully present (chewgether shape).
    expect(payload.program?.id).toBe("prog-chew");
    expect(payload.program?.memberGoals.map((g) => g.id)).toEqual(["goal-chew"]);
    expect(payload.goalSections["goal-chew"]).toBeDefined();
    expect(payload.goalMarks).toEqual([
      { goalId: "goal-chew", objective: "chewgether to $1k MRR", kind: "project", claims: [] },
    ]);
  });
});
