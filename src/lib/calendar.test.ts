// src/lib/calendar.test.ts
//
// First-ever behavioral coverage for resolveDay + getCalendarMonth, added for
// REQ-003 (Goal Story & Time-Aware History, Stage B1). Prior to this story
// neither function had a dedicated test file — the risk this suite closes is
// explicitly risk #1 in the architecture blueprint: "Today-page regression."
//
// House convention: vi.mock("@/lib/db") dual-export (prisma + getDb). Both
// program.ts (getActiveProgram/getPlanWindowCandidates) and calendar.ts call
// getDb() — they resolve to the SAME mocked scoped-db object here, exactly as
// in production (one getDb() call composes both modules).
//
// @/lib/goal-events is partially mocked (importOriginal + override
// getGoalEventsResult only) so the pure eventsByDateKey/otherGoalEvents
// helpers stay real while the DB-touching lookup is stubbed to an empty
// result — none of these tests exercise cross-goal event data.
//
// Fake system time is pinned throughout so "today" / "past" are deterministic
// regardless of the real wall clock the suite happens to run under.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFindUnique, mockOverrideFindMany, mockGetDb } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockOverrideFindMany: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    planDayOverride: {
      findUnique: mockFindUnique,
      findMany: mockOverrideFindMany,
    },
  },
  getDb: mockGetDb,
}));

vi.mock("@/lib/goal-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/goal-events")>();
  return {
    ...actual,
    getGoalEventsResult: vi.fn().mockResolvedValue({ events: [], focusGoalId: null, otherGoalsMeta: [] }),
  };
});

import { resolveDay, getCalendarMonth, parseDateKey, startOfDay } from "@/lib/calendar";
import type { ProgramForDate } from "@/lib/program";
import type { ProgramTemplate } from "@/lib/program-template";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function template(overrides: Partial<ProgramTemplate> = {}): ProgramTemplate {
  return {
    name: "Test",
    totalWeeks: 12,
    phases: [],
    weeklySplit: [],
    baselineWeek: [],
    hikingSuperset: { type: "straight", exercises: [] },
    dailyMobility: { durationMin: 10, exercises: [] },
    goals: [],
    ...overrides,
  } as unknown as ProgramTemplate;
}

/** A minimal scoped-db stub — every model resolveDay/getCalendarMonth/program.ts
 *  can touch, defaulted to empty/null so an un-configured call is harmless. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkDb(overrides: Record<string, any> = {}) {
  return {
    plan: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // #277: getActiveProgram() is Program-first — default models a
    // ZERO-Program-rows tenant (legacy path), which is the world every
    // fixture in this suite describes; behavior is byte-identical there.
    program: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    workout: { findMany: vi.fn().mockResolvedValue([]) },
    note: { findMany: vi.fn().mockResolvedValue([]) },
    // #282: goal.findMany serves getActiveProgramMembership (member list) and
    // resolveDay's member-goal detail query — only reached when program.findFirst
    // returns an active Program row, so the default [] is inert for legacy fixtures.
    goal: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    nutritionLog: { findMany: vi.fn().mockResolvedValue([]) },
    hike: { findMany: vi.fn().mockResolvedValue([]) },
    baseline: { findMany: vi.fn().mockResolvedValue([]) },
    scheduledItem: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
  mockOverrideFindMany.mockResolvedValue([]);
  mockGetDb.mockResolvedValue(mkDb());
  // Pinned "now" — 2026-06-01 in USER_TZ (America/Denver, MDT = UTC-6). Every
  // fixture date below is either exactly this ("today" case) or safely
  // earlier ("past"/"archived" cases) — deterministic regardless of the real
  // wall clock.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T18:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── resolveDay — TODAY regression (ctx-absent, real getProgramForDate) ──────

describe("resolveDay — today, ctx-absent (Today-page regression, risk #1)", () => {
  it("active plan covering today resolves identically to the pre-REQ-003 shape: isInPlan, rotationDay 1/week 1, activeWorkout, resolvedPlan {source:'active'}", async () => {
    const today = parseDateKey("2026-06-01"); // matches the pinned system time's USER_TZ day
    const activePlanRow = {
      id: "plan-active",
      name: "Current Plan",
      startedOn: today,
      planJson: template({
        weeklySplit: [
          { dayOfWeek: 1, title: "Lower A", category: "lower", summary: "", blocks: [] },
        ],
      }),
      confirmedThroughDate: null,
    };
    const planFindFirst = vi.fn().mockResolvedValue(activePlanRow);
    const planFindMany = vi.fn().mockResolvedValue([]);
    mockGetDb.mockResolvedValue(
      mkDb({ plan: { findFirst: planFindFirst, findMany: planFindMany } }),
    );

    const r = await resolveDay(today, { goalEvents: [], focusGoalId: null });

    expect(r.isInPlan).toBe(true);
    expect(r.rotationDay).toBe(1);
    expect(r.weekIndex).toBe(1);
    expect(r.todayTask).toBe("workout");
    expect(r.activeWorkout?.title).toBe("Lower A");
    expect(r.resolvedPlan).toEqual({ id: "plan-active", name: "Current Plan", source: "active" });
    // Today/future path never needs the archived-plan candidate query — the
    // fast-path in getProgramForDate is preserved.
    expect(planFindMany).not.toHaveBeenCalled();
    // Override lookup keys on the resolved (active) plan's id — unchanged.
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { planId_date: { planId: "plan-active", date: startOfDay(today) } },
    });
    // #282 regression guard: a ZERO-Program-rows tenant (this fixture) gets the
    // additive keys as null/[]/[], never a synthesized program from the legacy
    // isFocus path — and every pre-existing key above stayed byte-identical.
    expect(r.program).toBeNull();
    expect(r.scheduledItemsToday).toEqual([]);
    expect(r.goalMarks).toEqual([]);
  });

  it("#282: zero-Program tenant never triggers the scheduledItem/member-goal queries", async () => {
    const today = parseDateKey("2026-06-01");
    const scheduledItemFindMany = vi.fn().mockResolvedValue([]);
    const goalFindMany = vi.fn().mockResolvedValue([]);
    mockGetDb.mockResolvedValue(
      mkDb({
        scheduledItem: { findMany: scheduledItemFindMany },
        goal: { findFirst: vi.fn().mockResolvedValue(null), findMany: goalFindMany },
      }),
    );

    const r = await resolveDay(today, { goalEvents: [], focusGoalId: null });

    expect(r.program).toBeNull();
    expect(scheduledItemFindMany).not.toHaveBeenCalled();
    expect(goalFindMany).not.toHaveBeenCalled();
  });
});

// ─── resolveDay — #282: program-shaped keys (Phase-2A fixture) ───────────────
//
// Fixture models the founder's Phase 2A: an active Program whose rotation is
// owned by the handstand goal (its Plan is the Program-attached active plan),
// plus two non-rotation members — a fitness cut goal (baseline target, no
// plan) and a project AWS goal (scheduled item today, no plan).
describe("resolveDay — #282 program + scheduledItemsToday + goalMarks", () => {
  const TODAY = () => parseDateKey("2026-06-01"); // pinned system time's USER_TZ day

  const PROGRAM_ROW = {
    id: "prog-1",
    name: "Phase 2A",
    status: "active",
    startedOn: parseDateKey("2026-05-25"),
    endsOn: null,
    notes: null,
    attributionRules: null,
  };

  const MEMBER_GOAL_ROWS = [
    { id: "g-handstand", objective: "Freestanding handstand", kind: "fitness", status: "active" },
    { id: "g-cut", objective: "10% body fat", kind: "fitness", status: "active" },
    { id: "g-aws", objective: "AWS SAA cert", kind: "project", status: "active" },
  ];

  // Detail query rows (select: { id, targets, plans }): handstand owns the
  // active rotation plan; cut carries a baseline:<testName> target metric.
  const MEMBER_GOAL_DETAIL_ROWS = [
    { id: "g-handstand", targets: [], plans: [{ id: "plan-active" }] },
    { id: "g-cut", targets: [{ metric: "baseline:Plank Max Hold", targetValue: 120 }], plans: [] },
    { id: "g-aws", targets: [{ metric: "log:practice_exams", targetValue: 6 }], plans: [] },
  ];

  const ACTIVE_PLAN_ROW = {
    id: "plan-active",
    name: "Handstand Block",
    startedOn: parseDateKey("2026-06-01"),
    planJson: template({
      weeklySplit: [
        { dayOfWeek: 1, title: "Handstand Skill A", category: "upper", summary: "", blocks: [] },
      ],
      baselineWeek: [
        {
          dayOfWeek: 1,
          title: "Baseline check",
          tests: [
            {
              testName: "Plank Max Hold",
              units: "sec",
              protocol: "Max-duration front plank.",
              retestWeeks: [6],
            },
          ],
        },
      ],
    }),
    confirmedThroughDate: null,
  };

  const AWS_ITEM_ROW = {
    id: "si-1",
    goalId: "g-aws",
    type: "task",
    title: "Practice exam #3",
    detail: "Domains 1-2 focus",
    status: "planned",
    completedAt: null,
  };

  /** Wires mkDb for the Phase-2A shape. goal.findMany serves BOTH the
   *  membership query (select has no `plans`) and the member-detail query
   *  (select includes `plans`) — switch on the select shape. */
  function mkPhase2ADb() {
    const scheduledItemFindMany = vi.fn().mockResolvedValue([AWS_ITEM_ROW]);
    const goalFindMany = vi.fn().mockImplementation((args: { select?: { plans?: unknown } }) =>
      Promise.resolve(args?.select?.plans ? MEMBER_GOAL_DETAIL_ROWS : MEMBER_GOAL_ROWS),
    );
    const db = mkDb({
      program: {
        findFirst: vi.fn().mockResolvedValue(PROGRAM_ROW),
        count: vi.fn().mockResolvedValue(1),
      },
      plan: {
        findFirst: vi.fn().mockResolvedValue(ACTIVE_PLAN_ROW),
        findMany: vi.fn().mockResolvedValue([]),
      },
      goal: { findFirst: vi.fn().mockResolvedValue(null), findMany: goalFindMany },
      scheduledItem: { findMany: scheduledItemFindMany },
    });
    return { db, scheduledItemFindMany, goalFindMany };
  }

  it("program carries the Program row's own id/name/status/window + all member goals", async () => {
    const { db } = mkPhase2ADb();
    mockGetDb.mockResolvedValue(db);

    const r = await resolveDay(TODAY(), { goalEvents: [], focusGoalId: null });

    expect(r.program).toEqual({
      id: "prog-1",
      name: "Phase 2A",
      status: "active",
      startedOn: PROGRAM_ROW.startedOn,
      endsOn: null,
      memberGoals: MEMBER_GOAL_ROWS,
    });
    // resolvedPlan is UNTOUCHED by #282 — still the rotation-plan pointer.
    expect(r.resolvedPlan).toEqual({ id: "plan-active", name: "Handstand Block", source: "active" });
  });

  it("scheduledItemsToday unions items across member goals — including a goal that owns no Plan — with goalId + goalObjective per row", async () => {
    const { db, scheduledItemFindMany } = mkPhase2ADb();
    mockGetDb.mockResolvedValue(db);

    const r = await resolveDay(TODAY(), { goalEvents: [], focusGoalId: null });

    expect(r.scheduledItemsToday).toEqual([
      {
        id: "si-1",
        goalId: "g-aws",
        goalObjective: "AWS SAA cert",
        type: "task",
        title: "Practice exam #3",
        detail: "Domains 1-2 focus",
        status: "planned",
        completedAt: null,
      },
    ]);
    // Single findMany over ALL member ids, this date's window, explicit
    // userId-free select (leaky-reads guarantee lives at the query shape).
    const args = scheduledItemFindMany.mock.calls[0]![0];
    expect(args.where.goalId.in).toEqual(["g-handstand", "g-cut", "g-aws"]);
    expect(args.select).toEqual({
      id: true,
      goalId: true,
      type: true,
      title: true,
      detail: true,
      status: true,
      completedAt: true,
    });
    expect(Object.keys(args.select)).not.toContain("userId");
  });

  it("goalMarks: rotation claim on the plan-owning goal, baseline:<testName> via target-metric match, scheduled_item on the project goal, nutrition on fitness kinds", async () => {
    const { db, goalFindMany } = mkPhase2ADb();
    mockGetDb.mockResolvedValue(db);

    const r = await resolveDay(TODAY(), { goalEvents: [], focusGoalId: null });

    expect(r.goalMarks).toEqual([
      { goalId: "g-handstand", objective: "Freestanding handstand", kind: "fitness", claims: ["rotation", "nutrition"] },
      { goalId: "g-cut", objective: "10% body fat", kind: "fitness", claims: ["baseline:Plank Max Hold", "nutrition"] },
      { goalId: "g-aws", objective: "AWS SAA cert", kind: "project", claims: ["scheduled_item"] },
    ]);
    // The member-detail query stays a userId-free projection.
    const detailCall = goalFindMany.mock.calls.find(
      (c) => (c[0] as { select?: { plans?: unknown } })?.select?.plans,
    );
    expect(detailCall).toBeDefined();
    expect((detailCall![0] as { select: Record<string, unknown> }).select).toEqual({
      id: true,
      targets: true,
      plans: { select: { id: true } },
    });
  });

  it("non-active member goals appear in goalMarks with claims: [] (defensive filter mirroring attribution.ts)", async () => {
    const pausedMember = { id: "g-paused", objective: "Paused goal", kind: "fitness", status: "paused" };
    const { db } = mkPhase2ADb();
    (db.goal.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { select?: { plans?: unknown } }) =>
        Promise.resolve(
          args?.select?.plans
            ? [...MEMBER_GOAL_DETAIL_ROWS, { id: "g-paused", targets: [], plans: [] }]
            : [...MEMBER_GOAL_ROWS, pausedMember],
        ),
    );
    mockGetDb.mockResolvedValue(db);

    const r = await resolveDay(TODAY(), { goalEvents: [], focusGoalId: null });

    expect(r.goalMarks.find((m) => m.goalId === "g-paused")).toEqual({
      goalId: "g-paused",
      objective: "Paused goal",
      kind: "fitness",
      claims: [],
    });
  });

  it("chewgether shape: active Program with zero active Plans — program populated, rotation fields stay 'no rotation', no cross-goal plan leak", async () => {
    const { db } = mkPhase2ADb();
    // No Plan attached to the Program: the seam returns null ("no rotation").
    (db.plan.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    mockGetDb.mockResolvedValue(db);

    const r = await resolveDay(TODAY(), { goalEvents: [], focusGoalId: null });

    expect(r.program?.id).toBe("prog-1");
    expect(r.isInPlan).toBe(false);
    expect(r.todayTask).toBe("out_of_plan");
    expect(r.rotationDay).toBeNull();
    expect(r.weekIndex).toBeNull();
    expect(r.resolvedPlan).toBeNull();
    // Items still surface — the day is program-shaped even with no rotation.
    expect(r.scheduledItemsToday).toHaveLength(1);
    // No member goal owns the (absent) rotation → no rotation claim anywhere.
    expect(r.goalMarks.every((m) => !m.claims.includes("rotation"))).toBe(true);
  });

  it("ctx.membership (explicit value) short-circuits the lookup; ctx.membership null skips the program-shaped work entirely", async () => {
    const { db, scheduledItemFindMany } = mkPhase2ADb();
    const programFindFirst = db.program.findFirst as ReturnType<typeof vi.fn>;
    mockGetDb.mockResolvedValue(db);

    const membership = {
      id: "prog-1",
      name: "Phase 2A",
      status: "active",
      startedOn: PROGRAM_ROW.startedOn,
      endsOn: null,
      notes: null,
      attributionRules: null,
      memberGoals: MEMBER_GOAL_ROWS,
    };
    const programForDate = {
      id: "plan-active",
      name: "Handstand Block",
      startedOn: ACTIVE_PLAN_ROW.startedOn,
      template: ACTIVE_PLAN_ROW.planJson,
      confirmedThroughDate: null,
      source: "active" as const,
    };

    const r = await resolveDay(TODAY(), {
      goalEvents: [],
      focusGoalId: null,
      program: programForDate,
      membership,
      // #297: the day-driving goal is batched by range callers too — with all
      // three provided, resolveDay must not touch the Program table at all.
      dayGoal: { id: "g-handstand", targetDate: null, objective: "Freestanding handstand" },
    });
    // Program resolution, membership, AND the day goal all came from ctx — the
    // Program table was never consulted (get_week's 7-day batching contract).
    expect(programFindFirst).not.toHaveBeenCalled();
    expect(r.program?.id).toBe("prog-1");
    expect(r.scheduledItemsToday).toHaveLength(1);

    scheduledItemFindMany.mockClear();
    const r2 = await resolveDay(TODAY(), {
      goalEvents: [],
      focusGoalId: null,
      program: programForDate,
      membership: null,
      dayGoal: null,
    });
    // Explicit null = caller already determined "no active Program".
    expect(r2.program).toBeNull();
    expect(r2.scheduledItemsToday).toEqual([]);
    expect(r2.goalMarks).toEqual([]);
    expect(scheduledItemFindMany).not.toHaveBeenCalled();
  });
});

// ─── resolveDay — historical resolution via ctx.program (archived plan) ─────

describe("resolveDay — historical resolution via ctx.program (archived plan)", () => {
  const ARCHIVED_PROGRAM: ProgramForDate = {
    id: "plan-archived",
    name: "Old Plan",
    startedOn: parseDateKey("2025-01-05"),
    confirmedThroughDate: null,
    source: "archived",
    template: template({
      weeklySplit: [
        { dayOfWeek: 1, title: "Baseline check", category: "lower", summary: "", blocks: [] },
        { dayOfWeek: 2, title: "Upper A", category: "upper", summary: "", blocks: [] },
      ],
      baselineWeek: [
        {
          dayOfWeek: 1,
          title: "Baseline check",
          tests: [
            {
              testName: "Pull-Up Max Reps",
              units: "reps",
              protocol: "Strict pull-ups to failure.",
              retestWeeks: [6, 12],
            },
          ],
        },
      ],
    }),
  };

  // 2025-01-05 = rotation day 1, week 1 (has the baseline test due).
  const BASELINE_DAY = parseDateKey("2025-01-05");
  // 2025-01-06 = rotation day 2, week 1 (no baseline entry — plain workout day).
  const PLAIN_DAY = parseDateKey("2025-01-06");

  it("isInPlan/rotationDay/weekIndex/resolvedPlan/confidence resolve against the injected archived plan, not the (absent) active plan", async () => {
    const r = await resolveDay(PLAIN_DAY, {
      goalEvents: [],
      focusGoalId: null,
      program: ARCHIVED_PROGRAM,
    });

    expect(r.isInPlan).toBe(true);
    expect(r.rotationDay).toBe(2);
    expect(r.weekIndex).toBe(1);
    expect(r.activeWorkout?.title).toBe("Upper A");
    expect(r.resolvedPlan).toEqual({ id: "plan-archived", name: "Old Plan", source: "archived" });
    expect(r.confidence).toBe("past");
  });

  it("an override keyed to the ARCHIVED plan's own id is visible — the core time-aware-history fix", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-1",
      workoutJson: { dayOfWeek: 2, title: "Swapped for a race", category: "upper", summary: "", blocks: [] },
      baselineTestNames: null,
      nutritionText: null,
      nutritionPlan: null,
      mobilityText: null,
      notes: null,
    });

    const r = await resolveDay(PLAIN_DAY, {
      goalEvents: [],
      focusGoalId: null,
      program: ARCHIVED_PROGRAM,
    });

    // The lookup must have used the ARCHIVED plan's id, not any active plan.
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { planId_date: { planId: "plan-archived", date: startOfDay(PLAIN_DAY) } },
    });
    expect(r.isOverride).toBe(true);
    expect(r.activeWorkout?.title).toBe("Swapped for a race");
  });

  it("baselinesDue is populated via checkpointWindows against the archived program's own startedOn/rotation", async () => {
    const r = await resolveDay(BASELINE_DAY, {
      goalEvents: [],
      focusGoalId: null,
      program: ARCHIVED_PROGRAM,
    });

    expect(r.baselinesDue).toHaveLength(1);
    expect(r.baselinesDue[0]?.test.testName).toBe("Pull-Up Max Reps");
    expect(r.baselinesDue[0]?.checkpoint).toBe("initial");
    expect(r.baselinesDue[0]?.loggedOnDate).toBeNull();
  });
});

// ─── resolveDay — ctx.program explicitly null ────────────────────────────────

describe("resolveDay — ctx.program explicitly null (no plan covers this date)", () => {
  it("out_of_plan, resolvedPlan null — no lookup performed, no plan data leaks in", async () => {
    const planFindFirst = vi.fn().mockResolvedValue({
      id: "plan-should-not-be-used",
      name: "Should not be used",
      startedOn: parseDateKey("2020-01-01"),
      planJson: template(),
      confirmedThroughDate: null,
    });
    mockGetDb.mockResolvedValue(mkDb({ plan: { findFirst: planFindFirst, findMany: vi.fn().mockResolvedValue([]) } }));

    const r = await resolveDay(parseDateKey("2026-01-15"), {
      goalEvents: [],
      focusGoalId: null,
      program: null,
    });

    expect(r.isInPlan).toBe(false);
    expect(r.todayTask).toBe("out_of_plan");
    expect(r.activeWorkout).toBeNull();
    expect(r.deferredWorkout).toBeNull();
    expect(r.resolvedPlan).toBeNull();
    // getActiveProgram/getProgramForDate must never be consulted — the caller
    // already determined "no plan covers this date".
    expect(planFindFirst).not.toHaveBeenCalled();
  });
});

// ─── getCalendarMonth — mixed month: active tail + archived head ────────────

describe("getCalendarMonth — mixed month (archived plan covers the head, active covers the tail)", () => {
  it("per-cell planSource is correct; overrides from BOTH plans resolve via the composite key; archived cells carry no conflict", async () => {
    // Archived plan: 2026-01-01 .. 2026-01-21 (3 weeks), goal achieved same day
    // the window ends (S4 clamp is a no-op here — plain past coverage).
    const archivedTemplate = template({
      weeklySplit: [
        { dayOfWeek: 1, title: "Lower A", category: "lower", summary: "", blocks: [] },
        // Rotation day 6 lands on 2026-01-06 (startedOn 01-01 = day 1) — set
        // long-endurance so a same-week planned hike WOULD trip "long-effort"
        // if the (wrong) active-program-relative week bucket leaked in.
        { dayOfWeek: 6, title: "Long hike day", category: "long-endurance", summary: "", blocks: [] },
      ],
      totalWeeks: 3,
    });
    const archivedPlanRow = {
      id: "plan-archived",
      name: "Old Plan",
      startedOn: parseDateKey("2026-01-01"),
      planJson: archivedTemplate,
      confirmedThroughDate: null,
      active: false,
      goal: { status: "achieved", completedAt: parseDateKey("2026-01-21") },
    };

    // Active plan: 2026-01-22 onward (contiguous with the archived head, no gap).
    const activeTemplate = template({
      weeklySplit: [
        { dayOfWeek: 4, title: "Upper B", category: "upper", summary: "", blocks: [] },
      ],
      totalWeeks: 4,
    });
    const activePlanRow = {
      id: "plan-active",
      name: "Current Plan",
      startedOn: parseDateKey("2026-01-22"),
      planJson: activeTemplate,
      confirmedThroughDate: null,
      active: true,
      goal: { status: "active", completedAt: null },
    };

    const planFindFirst = vi.fn().mockResolvedValue(activePlanRow);
    const planFindMany = vi.fn().mockResolvedValue([archivedPlanRow, activePlanRow]);

    // 2026-01-25 is rotation day 4 relative to the ACTIVE plan (started 01-22:
    // 22=day1,23=day2,24=day3,25=day4) — matches the Upper B override below.
    // 2026-01-24 is a PLANNED hike inside the ACTIVE plan's own week 1
    // (01-22..01-28) — this is the exact same week-index (1) as the ARCHIVED
    // cell being tested (01-01..01-07 is ALSO week 1, relative to the
    // archived plan). Without the archived-cell conflict skip, buildCell
    // would read this active-relative week-1 hike bucket and wrongly flag
    // "long-effort" on the archived long-endurance day below.
    const hikeRow = { id: "hike-1", date: parseDateKey("2026-01-24"), status: "planned" };

    const overrideRows = [
      {
        id: "ov-archived",
        planId: "plan-archived",
        date: parseDateKey("2026-01-10"),
        workoutJson: { dayOfWeek: 1, title: "Archived override", category: "lower", summary: "", blocks: [] },
        nutritionText: null,
        mobilityText: null,
        baselineTestNames: null,
      },
      {
        id: "ov-active",
        planId: "plan-active",
        date: parseDateKey("2026-01-25"),
        workoutJson: { dayOfWeek: 4, title: "Active override", category: "upper", summary: "", blocks: [] },
        nutritionText: null,
        mobilityText: null,
        baselineTestNames: null,
      },
    ];

    mockGetDb.mockResolvedValue(
      mkDb({
        plan: { findFirst: planFindFirst, findMany: planFindMany },
        goal: { findFirst: vi.fn().mockResolvedValue({ id: "goal-1", targetDate: null, objective: "Test goal", legend: null, kind: "fitness" }) },
        hike: { findMany: vi.fn().mockResolvedValue([hikeRow]) },
      }),
    );
    mockOverrideFindMany.mockResolvedValue(overrideRows);

    const { cells } = await getCalendarMonth({ year: 2026, month: 0 });

    const archivedCell = cells.find((c) => c.dateKey === "2026-01-10");
    const archivedLongDay = cells.find((c) => c.dateKey === "2026-01-06");
    const activeCell = cells.find((c) => c.dateKey === "2026-01-25");

    // planSource + override picked up via the composite planId|dateKey key.
    expect(archivedCell?.planSource).toBe("archived");
    expect(archivedCell?.isInPlan).toBe(true);
    expect(archivedCell?.hasOverride).toBe(true);
    expect(archivedCell?.dayTitle).toBe("Archived override");

    expect(activeCell?.planSource).toBe("active");
    expect(activeCell?.isInPlan).toBe(true);
    expect(activeCell?.hasOverride).toBe(true);
    expect(activeCell?.dayTitle).toBe("Active override");

    // The archived long-endurance day must NOT show a conflict, despite a
    // planned hike existing in what would be the colliding week-index bucket
    // if it were (wrongly) read from the active program's grouping.
    expect(archivedLongDay?.planSource).toBe("archived");
    expect(archivedLongDay?.conflict).toBeNull();

    // Sanity: prove the override query was scoped to both candidate plan ids.
    const overrideCallArgs = mockOverrideFindMany.mock.calls[0]![0];
    expect(overrideCallArgs.where.planId.in).toEqual(
      expect.arrayContaining(["plan-archived", "plan-active"]),
    );
  });
});

// ─── resolveDay — orphanedOverride (bug #266) ────────────────────────────────
//
// Prior to the fix, orphanedOverride was `isOverride && plannedHikeToday === null &&
// isMirrorOverride(workoutTemplate)`. reconcileLongEffort unconditionally nulls
// plannedHikeToday whenever isOverride is true (it's suppressed, not "no backing hike"),
// so the expression algebraically reduced to `isOverride && isMirrorOverride(workoutTemplate)`
// — every summit-day (long-endurance mirror) override was flagged as orphaned/phantom
// regardless of whether a real Hike row backed it. The fix reuses
// override-integrity.ts's OVERRIDE_MIRROR_KINDS registry (matchingMirrorKind +
// kind.backingDateKeys()) to do a real any-status "does a Hike row exist on this date"
// check — the same definition the lint_plan path already uses.
describe("resolveDay — orphanedOverride (bug #266: any-status backing check, not plannedHikeToday)", () => {
  const PROGRAM: ProgramForDate = {
    id: "plan-1",
    name: "Plan",
    startedOn: parseDateKey("2026-01-01"),
    confirmedThroughDate: null,
    source: "active",
    template: template({
      weeklySplit: [{ dayOfWeek: 1, title: "Lower A", category: "lower", summary: "", blocks: [] }],
      totalWeeks: 12,
    }),
  };
  // Rotation day 1, week 1 relative to PROGRAM.startedOn — value is otherwise
  // irrelevant since the override below fully replaces the rotation template.
  const DAY = parseDateKey("2026-01-01");

  const MIRROR_OVERRIDE = {
    id: "override-1",
    workoutJson: {
      dayOfWeek: 1,
      title: "Longs Peak — Dress Rehearsal",
      category: "long-endurance", // matches OVERRIDE_MIRROR_KINDS' hike-mirror heuristic
      summary: "",
      blocks: [],
    },
    baselineTestNames: null,
    nutritionText: null,
    nutritionPlan: null,
    mobilityText: null,
    notes: null,
  };

  it("true positive: override day, mirror-kind (long-endurance) template, NO backing Hike row of any status on the date -> orphanedOverride true", async () => {
    mockFindUnique.mockResolvedValue(MIRROR_OVERRIDE);
    mockGetDb.mockResolvedValue(mkDb({ hike: { findMany: vi.fn().mockResolvedValue([]) } }));

    const r = await resolveDay(DAY, { goalEvents: [], focusGoalId: null, program: PROGRAM });

    expect(r.isOverride).toBe(true);
    expect(r.orphanedOverride).toBe(true);
  });

  it.each(["completed", "skipped"] as const)(
    "false-positive regression: override day, mirror-kind template, a backing Hike row with status '%s' on the date -> orphanedOverride false",
    async (status) => {
      mockFindUnique.mockResolvedValue(MIRROR_OVERRIDE);
      mockGetDb.mockResolvedValue(
        mkDb({
          hike: { findMany: vi.fn().mockResolvedValue([{ id: "hike-1", date: DAY, status }]) },
        }),
      );

      const r = await resolveDay(DAY, { goalEvents: [], focusGoalId: null, program: PROGRAM });

      expect(r.isOverride).toBe(true);
      expect(r.orphanedOverride).toBe(false);
    },
  );

  it("non-override day (no PlanDayOverride row at all) -> orphanedOverride false regardless of hike presence", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGetDb.mockResolvedValue(mkDb({ hike: { findMany: vi.fn().mockResolvedValue([]) } }));

    const r = await resolveDay(DAY, { goalEvents: [], focusGoalId: null, program: PROGRAM });

    expect(r.isOverride).toBe(false);
    expect(r.orphanedOverride).toBe(false);
  });
});
