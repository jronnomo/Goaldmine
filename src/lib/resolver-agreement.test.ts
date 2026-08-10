// src/lib/resolver-agreement.test.ts
//
// G6 agreement suite (blockers doc §1 G6 / B4, run amendment A3): for a month
// containing (a) an override day, (b) a baseline-due day, (c) a deferral day,
// and (d) an out-of-plan day, the calendar month cell, resolveDay, and the
// get_day path must agree on template identity, baseline count, and override
// presence for every date.
//
// "get_day" here is exercised as resolveDay(parseDateKey(dateKey)) — that IS
// the tool's entire handler body (mcp/tools.ts get_day: `return await
// resolveDay(parseDateKey(date))`). The month cell comes from the real
// getCalendarMonth → buildCell. Since the B4 consolidation, both surfaces
// take their decisions from rotation-core (rotationPosition +
// mergeDayOverride) — this suite is the regression net that keeps them
// agreeing.
//
// Mock conventions mirror calendar.test.ts (house style): vi.mock("@/lib/db")
// dual-export, goal-events partially mocked, fake timers pinned.

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
    getGoalEventsResult: vi
      .fn()
      .mockResolvedValue({ events: [], focusGoalId: null, otherGoalsMeta: [] }),
  };
});

import {
  resolveDay,
  getCalendarMonth,
  parseDateKey,
  dateKey,
  type CalendarDayCell,
  type ResolvedDay,
} from "@/lib/calendar";
import type { ProgramTemplate, DayTemplate } from "@/lib/program-template";

// ─── Fixture: a 2-week plan with all four G6 scenario days in June 2026 ──────

const PLAN_ID = "plan-g6";
const STARTED_ON = parseDateKey("2026-06-01"); // a Monday → rotation days align

const WEEKLY_SPLIT: DayTemplate[] = [
  { dayOfWeek: 1, title: "Upper A", category: "upper", summary: "", blocks: [] },
  { dayOfWeek: 2, title: "Lower B", category: "lower", summary: "", blocks: [] },
  { dayOfWeek: 3, title: "Zone 2 C", category: "zone2-mobility", summary: "", blocks: [] },
  { dayOfWeek: 4, title: "Push C", category: "upper", summary: "", blocks: [] },
  { dayOfWeek: 5, title: "Pull D", category: "upper", summary: "", blocks: [] },
  { dayOfWeek: 6, title: "Long Haul", category: "long-endurance", summary: "", blocks: [] },
  { dayOfWeek: 7, title: "Rest", category: "rest", summary: "", blocks: [] },
] as unknown as DayTemplate[];

const TEMPLATE = {
  name: "G6 fixture",
  totalWeeks: 2,
  phases: [],
  weeklySplit: WEEKLY_SPLIT,
  baselineWeek: [
    {
      dayOfWeek: 4,
      title: "Test day",
      tests: [{ testName: "Plank Hold", units: "sec", protocol: "", retestWeeks: [2] }],
    },
  ],
  goals: [],
} as unknown as ProgramTemplate;

// Scenario (a): coach override on 2026-06-03 (week 1, rotation day 3).
const OVERRIDE_ROW = {
  id: "ov-1",
  planId: PLAN_ID,
  date: parseDateKey("2026-06-03"),
  workoutJson: {
    dayOfWeek: 3,
    title: "Coach Swap",
    category: "upper",
    summary: "swapped",
    blocks: [],
  },
  baselineTestNames: null,
  nutritionText: null,
  nutritionPlan: null,
  mobilityText: null,
  notes: null,
};

// Scenario (c): planned hike on 2026-06-05 (week 1, rotation day 5, non-rest).
const PLANNED_HIKE = {
  id: "hike-1",
  date: parseDateKey("2026-06-05"),
  status: "planned",
  route: "Ridge loop",
  distanceMi: 6,
  elevationFt: 1500,
  packWeightLb: null,
  durationMin: 180,
};

const ACTIVE_PLAN_ROW = {
  id: PLAN_ID,
  name: "G6 plan",
  startedOn: STARTED_ON,
  planJson: TEMPLATE,
  confirmedThroughDate: null,
};

const CANDIDATE_ROW = {
  id: PLAN_ID,
  name: "G6 plan",
  startedOn: STARTED_ON,
  planJson: TEMPLATE,
  confirmedThroughDate: null,
  active: true,
  goal: { status: "active", completedAt: null },
};

/** Routing-faithful-enough hike filter: applies the status + date-range
 *  conditions both call sites actually pass. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hikeFindMany(args: any) {
  const where = args?.where ?? {};
  let rows = [PLANNED_HIKE];
  if (typeof where.status === "string") rows = rows.filter((h) => h.status === where.status);
  else if (Array.isArray(where.status?.in)) rows = rows.filter((h) => where.status.in.includes(h.status));
  if (where.date?.gte) rows = rows.filter((h) => h.date.getTime() >= where.date.gte.getTime());
  if (where.date?.lte) rows = rows.filter((h) => h.date.getTime() <= where.date.lte.getTime());
  return Promise.resolve(rows);
}

function mkDb() {
  return {
    plan: {
      findFirst: vi.fn().mockResolvedValue(ACTIVE_PLAN_ROW),
      findMany: vi.fn().mockResolvedValue([CANDIDATE_ROW]),
    },
    // Zero-Program tenant: legacy isFocus path (byte-identical world for G6).
    program: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    workout: { findMany: vi.fn().mockResolvedValue([]) },
    note: { findMany: vi.fn().mockResolvedValue([]) },
    goal: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    nutritionLog: { findMany: vi.fn().mockResolvedValue([]) },
    hike: { findMany: vi.fn().mockImplementation(hikeFindMany) },
    baseline: { findMany: vi.fn().mockResolvedValue([]) },
    scheduledItem: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDb.mockResolvedValue(mkDb());
  // resolveDay's per-date override lookup (unique on planId+date).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFindUnique.mockImplementation(async (args: any) => {
    const w = args?.where?.planId_date;
    if (
      w &&
      w.planId === PLAN_ID &&
      w.date.getTime() === OVERRIDE_ROW.date.getTime()
    ) {
      return OVERRIDE_ROW;
    }
    return null;
  });
  // getCalendarMonth's bulk override fetch.
  mockOverrideFindMany.mockResolvedValue([OVERRIDE_ROW]);
  // Pinned "today": 2026-06-10 in USER_TZ (12:00 local, MDT) — inside the plan
  // window, after the hike day (past) and before the retest day (future).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-10T18:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── The agreement contract ──────────────────────────────────────────────────

function unloggedBaselineCount(r: ResolvedDay): number {
  return r.baselinesDue.filter((b) => b.loggedOnDate === null).length;
}

function prescriptionTitle(r: ResolvedDay): string | null {
  return (r.activeWorkout ?? r.deferredWorkout)?.title ?? null;
}

function expectAgreement(cell: CalendarDayCell, r: ResolvedDay, dk: string) {
  const ctx = `date ${dk}`;
  expect(cell.isInPlan, `${ctx} isInPlan`).toBe(r.isInPlan);
  expect(cell.rotationDay, `${ctx} rotationDay`).toBe(r.rotationDay);
  expect(cell.weekIndex, `${ctx} weekIndex`).toBe(r.weekIndex);
  // Template identity: the cell's label is the prescription (no completed
  // workouts in this fixture); resolveDay's is activeWorkout ?? deferredWorkout.
  expect(cell.dayTitle, `${ctx} template identity`).toBe(prescriptionTitle(r));
  // Baseline count: the cell counts UNLOGGED scheduled tests; resolveDay lists
  // all due with per-test loggedOnDate.
  expect(cell.baselinesDue, `${ctx} baseline count`).toBe(unloggedBaselineCount(r));
  // Override presence: any override row on the governing plan for this date.
  expect(cell.hasOverride, `${ctx} override presence`).toBe(r.override !== null);
  // Same governing plan + confidence derivation — meaningful only in-plan:
  // out-of-window dates deliberately diverge by design (cell.planSource is
  // undefined when !isInPlan, while resolveDay's resolvedPlan keeps the
  // active-plan fall-through pointer; nothing renders from either).
  if (cell.isInPlan) {
    expect(cell.planSource, `${ctx} plan source`).toBe(r.resolvedPlan?.source);
  }
  expect(cell.confidence, `${ctx} confidence`).toBe(r.confidence);
}

describe("G6 — calendar cell / resolveDay / get_day agreement (override, baseline, deferral, out-of-plan days)", () => {
  it("every June 2026 day agrees across the month cell, resolveDay(cell.date), and the get_day path (resolveDay(parseDateKey))", async () => {
    const month = await getCalendarMonth({ year: 2026, month: 5 }); // June 2026
    const june = month.cells.filter((c) => c.dateKey.startsWith("2026-06"));
    expect(june).toHaveLength(30);

    for (const cell of june) {
      // get_day path: resolveDay(parseDateKey(date)) — the tool handler verbatim.
      const viaGetDay = await resolveDay(parseDateKey(cell.dateKey));
      expectAgreement(cell, viaGetDay, cell.dateKey);

      // Day-detail path: resolveDay(cell's own Date instant) — a different
      // input instant for the same USER_TZ day must resolve identically.
      const viaCellDate = await resolveDay(cell.date);
      expect(dateKey(viaCellDate.date)).toBe(cell.dateKey);
      expectAgreement(cell, viaCellDate, `${cell.dateKey} (cell.date instant)`);
    }
  });

  it("(a) override day 2026-06-03: all surfaces show the override template and flag the override", async () => {
    const month = await getCalendarMonth({ year: 2026, month: 5 });
    const cell = month.cells.find((c) => c.dateKey === "2026-06-03")!;
    const r = await resolveDay(parseDateKey("2026-06-03"));

    expect(r.isOverride).toBe(true);
    expect(r.todayTask).toBe("workout");
    expect(r.activeWorkout?.title).toBe("Coach Swap");
    expect(r.override).not.toBeNull();
    expect(cell.dayTitle).toBe("Coach Swap");
    expect(cell.hasOverride).toBe(true);
    expect(cell.baselinesDue).toBe(0);
    expectAgreement(cell, r, "2026-06-03");
  });

  it("(b) baseline-due day 2026-06-11 (week-2 retest, unlogged): the test steps in, the rotation session steps aside, the cell counts 1 due", async () => {
    const month = await getCalendarMonth({ year: 2026, month: 5 });
    const cell = month.cells.find((c) => c.dateKey === "2026-06-11")!;
    const r = await resolveDay(parseDateKey("2026-06-11"));

    expect(r.todayTask).toBe("baseline");
    expect(r.activeWorkout).toBeNull();
    expect(r.deferredWorkout?.title).toBe("Push C");
    expect(r.baselinesDue).toHaveLength(1);
    expect(r.baselinesDue[0]!.test.testName).toBe("Plank Hold");
    expect(r.baselinesDue[0]!.checkpoint).toBe("retest");
    expect(r.baselinesDue[0]!.loggedOnDate).toBeNull();
    expect(cell.baselinesDue).toBe(1);
    expect(cell.dayTitle).toBe("Push C");
    expect(cell.hasOverride).toBe(false);
    expectAgreement(cell, r, "2026-06-11");
  });

  it("(c) deferral day 2026-06-05 (planned hike on a training day): the hike is the task, both surfaces keep the rotation session's identity", async () => {
    const month = await getCalendarMonth({ year: 2026, month: 5 });
    const cell = month.cells.find((c) => c.dateKey === "2026-06-05")!;
    const r = await resolveDay(parseDateKey("2026-06-05"));

    expect(r.todayTask).toBe("hike");
    expect(r.plannedHikeToday?.route).toBe("Ridge loop");
    expect(r.activeWorkout).toBeNull();
    expect(r.deferredWorkout?.title).toBe("Pull D");
    expect(cell.plannedHikeCount).toBe(1);
    expect(cell.dayTitle).toBe("Pull D");
    expectAgreement(cell, r, "2026-06-05");
  });

  it("(d) out-of-plan day 2026-06-20 (past the 2-week window): both surfaces agree there is no day to resolve", async () => {
    const month = await getCalendarMonth({ year: 2026, month: 5 });
    const cell = month.cells.find((c) => c.dateKey === "2026-06-20")!;
    const r = await resolveDay(parseDateKey("2026-06-20"));

    expect(r.isInPlan).toBe(false);
    expect(r.todayTask).toBe("out_of_plan");
    expect(r.activeWorkout).toBeNull();
    expect(r.deferredWorkout).toBeNull();
    expect(cell.isInPlan).toBe(false);
    expect(cell.dayTitle).toBeNull();
    expect(cell.rotationDay).toBeNull();
    expect(cell.baselinesDue).toBe(0);
    expectAgreement(cell, r, "2026-06-20");
  });

  it("(b') week-1 initial 2026-06-04 also agrees (initial checkpoint, distinct from the week-2 retest)", async () => {
    const month = await getCalendarMonth({ year: 2026, month: 5 });
    const cell = month.cells.find((c) => c.dateKey === "2026-06-04")!;
    const r = await resolveDay(parseDateKey("2026-06-04"));

    expect(r.todayTask).toBe("baseline");
    expect(r.baselinesDue[0]!.checkpoint).toBe("initial");
    expect(cell.baselinesDue).toBe(1);
    expect(cell.dayTitle).toBe("Push C");
    expectAgreement(cell, r, "2026-06-04");
  });
});
