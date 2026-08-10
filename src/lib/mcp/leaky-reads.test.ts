// src/lib/mcp/leaky-reads.test.ts
//
// E-3: Verify that the 5 MCP read tools that leaked userId now pass
// `omit: { userId: true }` in their Prisma query arguments.
//
// Strategy: mock `getDb` to return a fake Prisma client with vi.fn() spies.
// Call the tool handler (via a minimal fake McpServer that captures callbacks).
// Assert the spy was called WITH `omit: { userId: true }` in its args.
//
// NOTE: this tests QUERY CALL ARGS, not the mocked return payload.
// The mock ignores `omit` — only the production Prisma engine honours it.
// So we assert on what was PASSED TO PRISMA, not what came back.
// See architecture-critique.md §Issue 6 for why the payload approach is invalid.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file. Variables must be
// hoisted with vi.hoisted() to be accessible inside those factories.
const {
  mockFindMany,
  mockFindFirst,
  mockFindUniqueOrThrow,
  mockFindUnique,
  mockGoalUpdate,
  mockDb,
  mockComputeGameStateFresh,
  mockCompleteGoalCore,
  mockReopenGoalCore,
  mockRenderCompletionCard,
  mockSavedMealFindMany,
  mockSavedMealFindFirst,
  mockSavedMealFindUnique,
  mockSavedMealCreate,
  mockSavedMealUpdate,
  mockSavedMealDelete,
  mockNutritionLogCreate,
  mockBaselineFindFirst,
  mockBaselineFindUniqueOrThrow,
  mockBaselineCreate,
  mockBaselineUpdate,
  mockProgramFindFirst,
  mockProgramFindUnique,
  mockGoalFindMany,
  mockActivityLinkFindMany,
  mockScheduledItemFindMany,
  mockFoodUsageFindFirst,
  mockFoodUsageUpdate,
  mockFoodUsageCreate,
  mockFoodLibraryFindMany,
} = vi.hoisted(() => {
  const mockFindMany = vi.fn().mockResolvedValue([]);
  const mockFindFirst = vi.fn().mockResolvedValue(null);
  const mockFindUniqueOrThrow = vi.fn().mockResolvedValue({
    id: "goal-1",
    kind: "fitness",
    isFocus: true,
    active: true,
    name: "Test Goal",
    description: null,
    targetDate: null,
    targets: [],
    legend: null,
    attributionHints: [],
    coachFeasibility: null,
    feasibility: null,
    tracked: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    plans: [],
  });
  // Site 5: generate_completion_card's db.goal.findUnique(...) — separate spy
  // from findUniqueOrThrow (get_goal's site) since they're different Prisma calls.
  const mockFindUnique = vi.fn().mockResolvedValue(null);
  const mockGoalUpdate = vi.fn().mockResolvedValue({});

  // #275 SavedMeal tooling — dedicated spies (not the shared mockFindMany)
  // so upsert/scaling assertions can inspect exactly one model's calls.
  const mockSavedMealFindMany = vi.fn().mockResolvedValue([]);
  const mockSavedMealFindFirst = vi.fn().mockResolvedValue(null);
  const mockSavedMealFindUnique = vi.fn().mockResolvedValue(null);
  const mockSavedMealCreate = vi.fn().mockResolvedValue({ id: "sm-new", name: "Meal" });
  const mockSavedMealUpdate = vi.fn().mockResolvedValue({ id: "sm-1", name: "Meal" });
  const mockSavedMealDelete = vi.fn().mockResolvedValue({ id: "sm-1" });
  const mockNutritionLogCreate = vi.fn().mockResolvedValue({ id: "n-1" });

  // #276 Baseline.capped — dedicated write-path spies (findMany stays the
  // shared spy so the existing recent_history/weekly_summary omit counts hold).
  const mockBaselineFindFirst = vi.fn().mockResolvedValue(null);
  const mockBaselineFindUniqueOrThrow = vi.fn();
  const mockBaselineCreate = vi.fn().mockResolvedValue({ id: "b-new" });
  const mockBaselineUpdate = vi.fn();

  // #311 get_program_overview — dedicated spies (program model + goal.findMany)
  // so the overview's select-projection assertions inspect exactly its calls.
  const mockProgramFindFirst = vi.fn().mockResolvedValue(null);
  const mockProgramFindUnique = vi.fn().mockResolvedValue(null);
  const mockGoalFindMany = vi.fn().mockResolvedValue([]);

  // #278 list_activity_links — dedicated spy so its select/where assertions
  // inspect exactly the link query.
  const mockActivityLinkFindMany = vi.fn().mockResolvedValue([]);

  // #284 — dedicated spy: proves scheduledItemsToday reaches read tools ONLY
  // through resolveDay (mocked here), never via a duplicate handler query.
  // (The zero-Program legacy project branch of get_today_plan still queries it
  // directly — that pre-#283 path keeps its own coverage below.)
  const mockScheduledItemFindMany = vi.fn().mockResolvedValue([]);

  // Food-linked bundles — FoodUsage bump on saved-meal expansion (scoped
  // client) + FoodLibrary snapshot resolution at save_meal time (RAW prisma —
  // shared catalog, deliberately non-scoped).
  const mockFoodUsageFindFirst = vi.fn().mockResolvedValue(null);
  const mockFoodUsageUpdate = vi.fn().mockResolvedValue({});
  const mockFoodUsageCreate = vi.fn().mockResolvedValue({});
  const mockFoodLibraryFindMany = vi.fn().mockResolvedValue([]);

  const mockDb = {
    workout: { findMany: mockFindMany },
    measurement: { findMany: mockFindMany },
    // findFirst: get_session_brief's latestReviewNote lookup (#284 coverage).
    note: { findMany: mockFindMany, findFirst: mockFindFirst },
    baseline: {
      findMany: mockFindMany,
      findFirst: mockBaselineFindFirst,
      findUniqueOrThrow: mockBaselineFindUniqueOrThrow,
      create: mockBaselineCreate,
      update: mockBaselineUpdate,
    },
    hike: { findMany: mockFindMany },
    nutritionLog: { findMany: mockFindMany, create: mockNutritionLogCreate },
    bodyMetric: { findMany: mockFindMany },
    plan: { findFirst: mockFindFirst },
    goal: {
      findUniqueOrThrow: mockFindUniqueOrThrow,
      findUnique: mockFindUnique,
      // findFirst: the isFocus lookup in get_today_plan/get_session_brief (#283/#284).
      findFirst: mockFindFirst,
      findMany: mockGoalFindMany,
      update: mockGoalUpdate,
    },
    // #300: `count` serves getRotationOwnerGoal's tenant-shape branch; the 0
    // default keeps every fixture on the legacy zero-Program resolution path
    // (the focus-goal mock each test already wires).
    program: {
      findFirst: mockProgramFindFirst,
      findUnique: mockProgramFindUnique,
      count: vi.fn().mockResolvedValue(0),
    },
    activityGoalLink: { findMany: mockActivityLinkFindMany },
    scheduledItem: { findMany: mockScheduledItemFindMany },
    savedMeal: {
      findMany: mockSavedMealFindMany,
      findFirst: mockSavedMealFindFirst,
      findUnique: mockSavedMealFindUnique,
      create: mockSavedMealCreate,
      update: mockSavedMealUpdate,
      delete: mockSavedMealDelete,
    },
    foodUsage: {
      findFirst: mockFoodUsageFindFirst,
      update: mockFoodUsageUpdate,
      create: mockFoodUsageCreate,
    },
  };

  // complete_goal's before/after game-state diff + goal-completion cores —
  // mocked so the ceremony-payload test doesn't need a real DB round trip.
  const mockComputeGameStateFresh = vi.fn();
  const mockCompleteGoalCore = vi.fn();
  const mockReopenGoalCore = vi.fn();
  const mockRenderCompletionCard = vi.fn();

  return {
    mockFindMany,
    mockFindFirst,
    mockFindUniqueOrThrow,
    mockFindUnique,
    mockGoalUpdate,
    mockDb,
    mockComputeGameStateFresh,
    mockCompleteGoalCore,
    mockReopenGoalCore,
    mockRenderCompletionCard,
    mockSavedMealFindMany,
    mockSavedMealFindFirst,
    mockSavedMealFindUnique,
    mockSavedMealCreate,
    mockSavedMealUpdate,
    mockSavedMealDelete,
    mockNutritionLogCreate,
    mockBaselineFindFirst,
    mockBaselineFindUniqueOrThrow,
    mockBaselineCreate,
    mockBaselineUpdate,
    mockProgramFindFirst,
    mockProgramFindUnique,
    mockGoalFindMany,
    mockActivityLinkFindMany,
    mockScheduledItemFindMany,
    mockFoodUsageFindFirst,
    mockFoodUsageUpdate,
    mockFoodUsageCreate,
    mockFoodLibraryFindMany,
  };
});

// ── Module mocks (all hoisted before imports) ─────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    planDayOverride: { findMany: vi.fn().mockResolvedValue([]) },
    oAuthAuthCode: {},
    // save_meal foodId resolution — SHARED catalog read (deliberately raw).
    foodLibrary: { findMany: mockFoodLibraryFindMany },
  },
  getDb: vi.fn().mockResolvedValue(mockDb),
  injectUserId: (_model: string, _op: string, args: unknown) => args,
  forUser: vi.fn(),
}));

vi.mock("@/lib/calendar", () => ({
  addDays: (d: Date, n: number) => new Date(d.getTime() + n * 86400000),
  startOfDay: (d: Date) => d,
  endOfDay: (d: Date) => d,
  endOfWeekSunday: (d: Date) => d,
  startOfWeekMonday: (d: Date) => d,
  parseDateKey: (s: string) => new Date(s),
  dateKey: (d: Date) => d.toISOString().slice(0, 10),
  // #282: the static default models a zero-Program tenant (program null,
  // empty item union / marks) so every pre-existing test keeps the legacy
  // handler paths; Program-shaped tests override per-block.
  resolveDay: vi
    .fn()
    .mockResolvedValue({ todayTask: "rest", program: null, scheduledItemsToday: [], goalMarks: [] }),
  rotationBaselineNamesForDate: vi.fn().mockReturnValue([]),
  templateForRotationDay: vi.fn().mockReturnValue(null),
  weekConflicts: vi.fn().mockResolvedValue([]),
}));
// B4/A3: get_week's anchor math and program.ts's coversDayKey now run through
// the REAL rotation-core, whose primitives come from calendar-core — this
// file's toy UTC-frame date world (identity startOfDay, raw-ms addDays, UTC
// dateKey) must cover those primitives too, or rotation-core would compute in
// USER_TZ while the mocked @/lib/calendar above computes in UTC and the two
// frames drift by the TZ offset. rotation-core itself stays real — its
// formulas are exactly what the S1/REQ-007a tests exercise.
vi.mock("@/lib/calendar-core", () => ({
  addDays: (d: Date, n: number) => new Date(d.getTime() + n * 86400000),
  startOfDay: (d: Date) => d,
  endOfDay: (d: Date) => d,
  dateKey: (d: Date) => d.toISOString().slice(0, 10),
  parseDateKey: (s: string) => new Date(s),
}));
vi.mock("@/lib/workout-core", () => ({
  createWorkoutCore: vi.fn(),
  updateWorkoutCore: vi.fn(),
  updateWorkoutSetCore: vi.fn(),
  workoutOpsCore: vi.fn(),
  deleteWorkoutCore: vi.fn(),
  deleteWorkoutsCore: vi.fn(),
  WorkoutOpSchema: { shape: {}, parse: vi.fn() },
}));
vi.mock("@/lib/hike-core", () => ({
  logHikeCore: vi.fn(),
  updateHikeCore: vi.fn(),
  deleteHikeCore: vi.fn(),
}));
vi.mock("@/lib/baseline-workout", () => ({
  appendBaselineToDayWorkout: vi.fn(),
  syncBaselineUpdateToWorkout: vi.fn(),
}));
// #272 delete cores — mocked so tools.ts registration doesn't pull real ones.
vi.mock("@/lib/measurement-core", () => ({ deleteMeasurementCore: vi.fn() }));
vi.mock("@/lib/nutrition-core", () => ({ deleteNutritionCore: vi.fn() }));
vi.mock("@/lib/baseline-core", () => ({ deleteBaselineCore: vi.fn() }));
vi.mock("@/lib/override-integrity", () => ({ orphanedOverrideWarning: vi.fn().mockReturnValue(null) }));
vi.mock("@/lib/goal-events", () => ({ getGoalEventsResult: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/goal-conflicts", () => ({ crossGoalConflicts: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/formatters", () => ({ formatWorkout: vi.fn().mockReturnValue("") }));
vi.mock("@/lib/goal-core", () => ({
  createGoalCore: vi.fn(),
  ensurePlanForGoalCore: vi.fn(),
  setGoalTrackedCore: vi.fn(),
  setPlanActiveCore: vi.fn(),
}));
vi.mock("@/lib/goal-flavors", () => ({
  isFlavorKey: vi.fn().mockReturnValue(false),
  legendForFlavor: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/goal-attribution", () => ({
  lastTrainedForGoals: vi.fn().mockResolvedValue(new Map()),
  relativeTrainedLabel: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/readiness", () => ({ computeReadiness: vi.fn().mockResolvedValue({ score: 0 }) }));
vi.mock("@/lib/legend", async () => {
  const { z } = await import("zod");
  return { LegendSchema: z.any() };
});
vi.mock("@/lib/program", async () => {
  // pickProgramForDate is pure and REQ-007a (get_week) tests below need its
  // real ordering/clamping behavior to exercise the S1 per-day-pick contract
  // faithfully — only the DB-backed lookups (getActiveProgram,
  // getPlanWindowCandidates) are mocked.
  const actual = await vi.importActual<typeof import("@/lib/program")>("@/lib/program");
  return {
    getActiveProgram: vi.fn().mockResolvedValue(null),
    // #284: get_week batches membership ONCE per call and threads it via
    // ctx.membership — the call-count assertion below depends on this spy.
    getActiveProgramMembership: vi.fn().mockResolvedValue(null),
    getPlanWindowCandidates: vi.fn().mockResolvedValue([]),
    pickProgramForDate: actual.pickProgramForDate,
  };
});
vi.mock("@/lib/goal-story", () => ({
  getGoalStory: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/day-template-validation", () => ({
  MAX_DAY_TEMPLATE_BYTES: 65536,
  assertDayTemplateWithinSize: vi.fn(),
  assertValidDayTemplate: vi.fn(),
}));
vi.mock("@/lib/day-template-ops", () => ({
  WorkoutJsonOpSchema: { shape: {}, parse: vi.fn() },
  applyWorkoutJsonOps: vi.fn(),
}));
vi.mock("@/lib/program-validation", () => ({ assertValidProgramTemplate: vi.fn() }));
vi.mock("@/lib/plan-lint", () => ({
  fingerprintFinding: vi.fn(),
  lintActivePlan: vi.fn().mockResolvedValue([]),
  lintTemplate: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/records", () => ({
  canonicalExerciseName: vi.fn((n: string) => n),
  getBaselineHistory: vi.fn().mockResolvedValue([]),
  getBaselineSchedule: vi.fn().mockResolvedValue([]),
  getBaselineSummaries: vi.fn().mockResolvedValue([]),
  getExerciseHistory: vi.fn().mockResolvedValue([]),
  getExerciseSummaries: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/nutrition-plan", async () => {
  // Real shapes + MACRO_KEYS (pure zod, no DB): the #275 saved-meal scaling
  // path (saved-meal.ts) iterates MACRO_KEYS — a stubbed [] would silently
  // drop every scaled macro in the log_nutrition tests below. Only the two
  // behavior-bearing functions stay stubbed.
  const actual = await vi.importActual<typeof import("@/lib/nutrition-plan")>("@/lib/nutrition-plan");
  return {
    ...actual,
    applyNutritionPlanPatch: vi.fn(),
    parseStoredNutritionPlan: vi.fn().mockReturnValue(null),
  };
});
vi.mock("@/lib/nutrition-log-ops", async () => {
  // Real parseStoredItems (pure, no DB): the saved-meal bundle path
  // (saved-meal.ts → parseSavedMealItems) validates rows through it — a
  // stubbed [] would empty every derived saved-meal expansion below (same
  // rationale as the nutrition-plan MACRO_KEYS partial mock above). Only the
  // behavior-bearing op machinery stays stubbed.
  const actual = await vi.importActual<typeof import("@/lib/nutrition-log-ops")>(
    "@/lib/nutrition-log-ops",
  );
  return {
    ...actual,
    NutritionLogOpSchema: { shape: {}, parse: vi.fn() },
    applyNutritionLogOps: vi.fn(),
    stripItemSource: vi.fn().mockImplementation((items: unknown[]) => items ?? []),
  };
});
vi.mock("@/lib/baseline-ops", () => ({
  BaselineOpSchema: { shape: {}, parse: vi.fn() },
  applyBaselineOps: vi.fn(),
  summarizeBaselineChanges: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/game/engine", () => ({
  computeGameState: vi.fn().mockResolvedValue({}),
  computeGameStateFresh: mockComputeGameStateFresh,
}));
vi.mock("@/lib/goal-completion", () => ({
  completeGoalCore: mockCompleteGoalCore,
  reopenGoalCore: mockReopenGoalCore,
}));
vi.mock("@/lib/game/attributes-registry", () => ({ rulePackForGoal: vi.fn().mockReturnValue({}) }));
vi.mock("@/lib/rarity", () => ({
  computeGoalFeasibility: vi.fn().mockResolvedValue({ score: 50, breakdown: [] }),
  computeStackRarity: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/rarity-core", () => ({
  RARITY_TIERS: [],
  parseCoachFeasibility: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/metrics-registry", () => ({
  GoalTargetSchema: { shape: {}, parse: vi.fn() },
  normalizeMetricKey: vi.fn((k: string) => k),
  BODY_METRIC_BY_KEY: {},
  BODY_METRICS: [],
  resolveBodyMetric: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/mcp/tools/project-tools", () => ({ registerProjectTools: vi.fn() }));
vi.mock("@/lib/mcp/tools/github-tools", () => ({ registerGitHubTools: vi.fn() }));
vi.mock("@/lib/mcp/tools/render-tools", () => ({ registerRenderTools: vi.fn() }));
vi.mock("@/lib/footage-core", () => ({ resolveWorkoutIdForDay: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/mcp/today-shapers", () => ({
  // #283: the merger (Program users) + the legacy nuller (zero-Program
  // project tenants). Both stubbed — this file asserts QUERY ARGS, not shapes.
  shapeProgramTodayPayload: vi.fn().mockReturnValue({}),
  shapeLegacyProjectTodayPayload: vi.fn().mockReturnValue({}),
}));
vi.mock("@/lib/recap", () => ({
  computeWeeklyRecap: vi.fn().mockResolvedValue({}),
  resolveHighlight: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/recap-render", () => ({
  renderRecapCard: vi.fn().mockResolvedValue(null),
  renderCompletionCard: mockRenderCompletionCard,
}));

// ── Imports (after all vi.mock calls) ─────────────────────────────────────────
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@/generated/prisma/client";
import { registerAll } from "@/lib/mcp/tools";
import { resolveDay } from "@/lib/calendar";
import { getActiveProgram, getActiveProgramMembership, getPlanWindowCandidates } from "@/lib/program";
import { getGoalStory } from "@/lib/goal-story";
import { getGoalEventsResult } from "@/lib/goal-events";

// ── Minimal fake McpServer that captures handlers by tool name ────────────────
type ToolCallback = (args: Record<string, unknown>) => Promise<unknown>;

class FakeMcpServer {
  private _handlers: Record<string, ToolCallback> = {};

  registerTool(name: string, _config: unknown, callback: ToolCallback) {
    this._handlers[name] = callback;
    return this;
  }

  getHandler(name: string): ToolCallback {
    const h = this._handlers[name];
    if (!h) throw new Error(`Tool "${name}" not registered`);
    return h;
  }
}

// Register all tools once
const fakeServer = new FakeMcpServer();
registerAll(fakeServer as unknown as McpServer);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("leaky-read omit — query call args", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFindMany).mockResolvedValue([]);
    vi.mocked(mockFindFirst).mockResolvedValue(null);
    vi.mocked(mockFindUniqueOrThrow).mockResolvedValue({
      id: "goal-1",
      kind: "fitness",
      isFocus: true,
      active: true,
      name: "Test Goal",
      description: null,
      targetDate: null,
      targets: [],
      legend: null,
      attributionHints: [],
      coachFeasibility: null,
      feasibility: null,
      tracked: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      plans: [],
    });
    vi.mocked(mockFindUnique).mockResolvedValue(null);
    vi.mocked(mockGoalUpdate).mockResolvedValue({});
    vi.mocked(mockComputeGameStateFresh).mockResolvedValue({ level: 1, xp: 0, badges: [] });
    vi.mocked(mockCompleteGoalCore).mockReset();
    vi.mocked(mockReopenGoalCore).mockReset();
    vi.mocked(mockRenderCompletionCard).mockReturnValue({
      arrayBuffer: async () => new ArrayBuffer(0),
    });
  });

  // ── Site 1: recent_history ──────────────────────────────────────────────────

  describe("recent_history", () => {
    it("workout.findMany (has include) called with omit: { userId: true }", async () => {
      const handler = fakeServer.getHandler("recent_history");
      await handler({ days: 7 });

      // workout.findMany has include: { exercises }; all other findMany calls
      // without include also have omit. Verify the workout call specifically.
      const callWithInclude = vi.mocked(mockFindMany).mock.calls.find((c) =>
        (c[0] as Record<string, unknown>).include != null,
      );
      expect(callWithInclude).toBeDefined();
      expect((callWithInclude![0] as Record<string, unknown>).omit).toEqual({ userId: true });
    });

    it("at least 5 findMany calls (non-bodyMetric) have omit: { userId: true }", async () => {
      const handler = fakeServer.getHandler("recent_history");
      await handler({ days: 7 });

      const callsWithOmit = vi.mocked(mockFindMany).mock.calls.filter(
        (c) => (c[0] as Record<string, unknown>).omit != null,
      );
      // workout + measurement + note + baseline + hike + nutritionLog = 6
      expect(callsWithOmit.length).toBeGreaterThanOrEqual(6);
      for (const c of callsWithOmit) {
        expect((c[0] as Record<string, unknown>).omit).toEqual({ userId: true });
      }
    });

    it("bodyMetric.findMany (DTO-mapped) does NOT get omit (correct: it is manually projected)", async () => {
      const handler = fakeServer.getHandler("recent_history");
      await handler({ days: 7 });

      // bodyMetric has orderBy: [{ date: "desc" }, { createdAt: "desc" }] — unique array shape
      const bodyMetricCall = vi.mocked(mockFindMany).mock.calls.find((c) => {
        const orderBy = (c[0] as Record<string, unknown>).orderBy;
        return Array.isArray(orderBy);
      });
      // bodyMetric query should NOT have omit (it's DTO-mapped instead)
      if (bodyMetricCall) {
        expect((bodyMetricCall[0] as Record<string, unknown>).omit).toBeUndefined();
      }
    });
  });

  // ── Site 2: weekly_summary_data ─────────────────────────────────────────────

  describe("weekly_summary_data", () => {
    it("all 6 findMany calls have omit: { userId: true }", async () => {
      const handler = fakeServer.getHandler("weekly_summary_data");
      await handler({ weekOffset: 0 });

      // weekly_summary_data has no bodyMetric query — all 6 findMany calls must have omit
      const allCalls = vi.mocked(mockFindMany).mock.calls;
      expect(allCalls.length).toBeGreaterThanOrEqual(6);
      for (const c of allCalls) {
        expect((c[0] as Record<string, unknown>).omit).toEqual({ userId: true });
      }
    });
  });

  // ── Site 3: get_goal ─────────────────────────────────────────────────────────

  describe("get_goal", () => {
    it("goal.findUniqueOrThrow called with omit: { userId: true } at Goal level", async () => {
      const handler = fakeServer.getHandler("get_goal");
      await handler({ goalId: "goal-1" });

      expect(vi.mocked(mockFindUniqueOrThrow)).toHaveBeenCalledWith(
        expect.objectContaining({ omit: { userId: true } }),
      );
    });

    it("plans included with omit: { userId: true } at Plan level", async () => {
      const handler = fakeServer.getHandler("get_goal");
      await handler({ goalId: "goal-1" });

      const callArgs = vi.mocked(mockFindUniqueOrThrow).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const include = callArgs.include as Record<string, unknown>;
      expect(include).toBeDefined();
      const plans = include.plans as Record<string, unknown>;
      expect(plans).toBeDefined();
      expect(plans.omit).toEqual({ userId: true });
    });

    it("triggerNote included with omit: { userId: true } at Note level (deeply nested)", async () => {
      const handler = fakeServer.getHandler("get_goal");
      await handler({ goalId: "goal-1" });

      const callArgs = vi.mocked(mockFindUniqueOrThrow).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const include = callArgs.include as Record<string, unknown>;
      const plans = include.plans as Record<string, unknown>;
      const plansInclude = plans.include as Record<string, unknown>;
      const revisions = plansInclude.revisions as Record<string, unknown>;
      const revisionsInclude = revisions.include as Record<string, unknown>;
      const triggerNote = revisionsInclude.triggerNote as Record<string, unknown>;
      expect(triggerNote.omit).toEqual({ userId: true });
    });
  });

  // ── Site 4: get_pending_notes ────────────────────────────────────────────────

  describe("get_pending_notes", () => {
    it("note.findMany called with omit: { userId: true }", async () => {
      const handler = fakeServer.getHandler("get_pending_notes");
      await handler({});

      // The pending-notes note.findMany has { resolvedAt: null } in where
      const noteCall = vi.mocked(mockFindMany).mock.calls.find((c) => {
        const where = (c[0] as Record<string, unknown>).where as Record<string, unknown> | undefined;
        return where != null && "resolvedAt" in where;
      });
      expect(noteCall).toBeDefined();
      expect((noteCall![0] as Record<string, unknown>).omit).toEqual({ userId: true });
    });
  });

  // ── Site 5: generate_completion_card (REQ-009/PRD §4.7) ─────────────────────

  describe("generate_completion_card", () => {
    it("goal.findUnique called with omit: { userId: true }", async () => {
      const handler = fakeServer.getHandler("generate_completion_card");
      // mockFindUnique defaults to null (goal not found) — this test only
      // asserts on the QUERY CALL ARGS, matching this suite's documented
      // strategy (see file header): the mock ignores `omit`, only the
      // production Prisma engine honours it.
      await handler({ goalId: "goal-1" });

      expect(vi.mocked(mockFindUnique)).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "goal-1" }, omit: { userId: true } }),
      );
    });
  });
});

// ── REQ-009/010/014a: goal-completion-ceremony tool-level tests ──────────────
// Not "leaky-read omit" tests — grouped in this file per the shared FakeMcpServer
// + registerAll(...) rig above (see task guidance: "extend leaky-reads' pattern
// in a suitable file"). Each block resets the shared mocks itself since it runs
// outside the omit-suite's beforeEach.

describe("update_goal — status:'achieved' redirect (REQ-010)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects status:'achieved' with the complete_goal/reopen_goal redirect message, before touching the DB", async () => {
    const handler = fakeServer.getHandler("update_goal");
    const result = (await handler({ goalId: "goal-1", status: "achieved" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Error: Use complete_goal to mark a goal achieved (it captures the completion snapshot, awards XP, and archives the goal). To un-achieve, use reopen_goal.",
    );
    // The redirect fires before any DB read — goal.findUnique must never be reached.
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("still allows status:'abandoned' through to the DB update path", async () => {
    vi.mocked(mockFindUnique).mockResolvedValueOnce({
      id: "goal-1",
      objective: "Old objective",
      targetDate: null,
      status: "active",
      notes: null,
    });
    vi.mocked(mockGoalUpdate).mockResolvedValueOnce({
      id: "goal-1",
      objective: "Old objective",
      targetDate: null,
      status: "abandoned",
    });

    const handler = fakeServer.getHandler("update_goal");
    const result = (await handler({ goalId: "goal-1", status: "abandoned" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as { goal: { status: string } };
    expect(payload.goal.status).toBe("abandoned");
  });
});

describe("complete_goal — ceremony payload (REQ-009, updated for REQ-008/V5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // REQ-008/V5 moved the pre/post computeGameStateFresh() diff OUT of this
  // handler and INTO completeGoalCore (goal-completion.ts) — the mocked
  // module boundary shifts with it: completeGoalCore's mock resolution now
  // supplies `ceremony` directly (as the real implementation would compute
  // it internally), and mockComputeGameStateFresh is no longer exercised by
  // this handler at all (the handler never imports/calls it anymore — see
  // goal-completion.test.ts for real-implementation coverage of the diff
  // itself, including its two-step persisted-snapshot write).
  it("returns the full ceremony payload shape, reading the badge/level diff off completeGoalCore's result", async () => {
    const snapshot = {
      version: 1 as const,
      completedDateKey: "2026-08-02",
      capturedAt: new Date().toISOString(),
      backdated: true,
      objective: "Summit Mt. Elbert",
      kind: "fitness",
      daysElapsed: 84,
      readiness: { score: 94, rawScore: 94, ceiling: 100, coverage: { tested: 4, total: 5 }, openGateCount: 0 },
      targets: [],
      targetsMet: 4,
      targetsTotal: 5,
      feasibilityTierAtCompletion: "rare",
      coachFeasibilityTier: null,
      plan: { planId: "plan-1", weeksTotal: 12, weeksElapsed: 12 },
      xpBasis: { weeks: 12, targetsMet: 4 },
      xpAwardedAtCompletion: 650,
      ceremony: {
        badgesUnlocked: [{ id: "goal-first", name: "First Summit" }],
        levelBefore: 3,
        levelAfter: 4,
      },
    };

    vi.mocked(mockCompleteGoalCore).mockResolvedValue({
      goal: {
        id: "goal-1",
        objective: "Summit Mt. Elbert",
        kind: "fitness",
        status: "achieved",
        completedAt: new Date("2026-08-02"),
        isFocus: false,
        active: false,
        createdAt: new Date("2026-05-01"),
        targetDate: new Date("2026-08-02"),
      },
      snapshot,
      ceremony: {
        badgesUnlocked: [{ id: "goal-first", name: "First Summit" }],
        levelBefore: 3,
        levelAfter: 4,
      },
      focusReleased: true,
      planDeactivatedIds: ["plan-1"],
      remainingActiveGoals: [{ id: "goal-2", objective: "Shred", kind: "fitness" }],
    });

    const handler = fakeServer.getHandler("complete_goal");
    const result = (await handler({ goalId: "goal-1", date: "2026-08-02" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;

    // Ceremony payload keys per PRD §4.2 — the coach narrates from these.
    // Unchanged from before REQ-008/V5 — this is the "byte-identical
    // response shape" this migration is required to preserve.
    for (const key of [
      "goal",
      "snapshot",
      "xp",
      "badgesUnlocked",
      "levelBefore",
      "levelAfter",
      "focusReleased",
      "planDeactivated",
      "remainingActiveGoals",
      "message",
    ]) {
      expect(payload).toHaveProperty(key);
    }

    expect(payload.levelBefore).toBe(3);
    expect(payload.levelAfter).toBe(4);
    expect(payload.badgesUnlocked).toEqual([{ id: "goal-first", name: "First Summit" }]);
    expect((payload.xp as { awarded: number; ruleId: string }).ruleId).toBe("goal.achieved");
    expect((payload.xp as { awarded: number }).awarded).toBe(650);
    expect((payload.goal as { completedAtDateKey: string }).completedAtDateKey).toBe("2026-08-02");
    expect(payload.focusReleased).toBe(true);
    expect(payload.remainingActiveGoals).toEqual([{ id: "goal-2", objective: "Shred", kind: "fitness" }]);
    // message still narrates the level-up the same way it always did.
    expect(payload.message).toContain("leveled up to 4");

    // The handler no longer calls computeGameStateFresh itself — that call
    // site moved into completeGoalCore (now fully mocked above).
    expect(mockComputeGameStateFresh).not.toHaveBeenCalled();
  });
});

describe("log_goal_retrospective — active-goal guard (REQ-014a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("errors when the goal is not achieved yet", async () => {
    vi.mocked(mockFindUnique).mockResolvedValueOnce({
      id: "goal-1",
      objective: "Summit Mt. Elbert",
      status: "active",
      retrospective: null,
    });

    const handler = fakeServer.getHandler("log_goal_retrospective");
    const result = (await handler({ goalId: "goal-1", reflection: "It went great." })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("complete the goal first");
    expect(mockGoalUpdate).not.toHaveBeenCalled();
  });
});

// ── REQ-007b: get_goal_story — leaky-reads coverage ──────────────────────────
// get_goal_story delegates entirely to the (mocked) getGoalStory assembly —
// there's no direct db query in the tools.ts handler to assert query args on
// (that's goal-story.test.ts's job, Stage B2). What this file's leaky-reads
// convention requires for a new read tool is a case proving the response the
// coach receives carries none of the forbidden content: private note types
// (standing_rule/review/open_item), triggerNote (PlanRevision.triggerNoteId
// can point at one — S5), or userId. Mocking getGoalStory per the rig's
// established "mock the dependency, assert the handler's payload" pattern
// used by the goal-completion-ceremony blocks above.
describe("get_goal_story — leaky-reads coverage (REQ-007b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the story bundle with no standing_rule/review/open_item content, no triggerNote, no userId", async () => {
    vi.mocked(getGoalStory).mockResolvedValueOnce({
      goal: {
        id: "goal-1",
        objective: "Summit Mt. Elbert",
        kind: "fitness",
        status: "achieved",
        createdAtKey: "2026-05-01",
        completedDateKey: "2026-08-02",
      },
      window: { startKey: "2026-05-01", endKey: "2026-08-02" },
      snapshot: null,
      readinessSeries: [{ dateKey: "2026-05-04", score: 20 }],
      targets: [],
      baselineArcs: [
        { testName: "1RM Back Squat", units: "lb", points: [{ dateKey: "2026-05-10", value: 200 }] },
      ],
      hikeArc: [
        {
          dateKey: "2026-08-02",
          route: "Elbert",
          distanceMi: 11,
          elevationFt: 4700,
          summitFt: 14440,
          packWeightLb: 20,
          durationMin: 480,
          status: "completed",
        },
      ],
      metricArcs: [],
      timeline: {
        planName: "Elbert Plan",
        startedOnKey: "2026-05-01",
        weeksTotal: 12,
        phases: [{ name: "Base", weekStart: 1, weekEnd: 4, startKey: "2026-05-01", endKey: "2026-05-28" }],
        // Intentionally triggerNote-FREE (S5) — the shape under test.
        revisions: [
          {
            id: "rev-1",
            createdAtKey: "2026-05-15",
            triggerSource: "coach",
            summary: "Deloaded week 3 after a rough session",
            reasoning: "Fatigue was accumulating faster than planned",
          },
        ],
      },
    });

    const handler = fakeServer.getHandler("get_goal_story");
    const result = (await handler({ goalId: "goal-1" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(vi.mocked(getGoalStory)).toHaveBeenCalledWith("goal-1");

    const text = result.content[0].text;
    for (const forbidden of ["standing_rule", "\"review\"", "open_item", "triggerNote", "userId"]) {
      expect(text).not.toContain(forbidden);
    }

    const payload = JSON.parse(text) as { timeline: { revisions: Array<Record<string, unknown>> } };
    // Every revision key is on the leaky-reads-safe allow-list (S5) — no
    // triggerNoteId, no raw note content of any kind.
    for (const revision of payload.timeline.revisions) {
      expect(Object.keys(revision).sort()).toEqual(
        ["createdAtKey", "id", "reasoning", "summary", "triggerSource"].sort(),
      );
    }
  });

  it("errors 'Goal not found' when getGoalStory returns null, without leaking anything else", async () => {
    vi.mocked(getGoalStory).mockResolvedValueOnce(null);

    const handler = fakeServer.getHandler("get_goal_story");
    const result = (await handler({ goalId: "goal-missing" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Goal not found: goal-missing");
  });
});

// ── REQ-007a: get_week — time-aware per-day resolution (S1, BINDING) ─────────
// get_week now fetches getActiveProgram + getPlanWindowCandidates ONCE for
// the whole week and picks per-day via the real (unmocked — see the
// "@/lib/program" mock factory above) pickProgramForDate, so a week
// straddling a plan transition resolves each day against its own covering
// plan instead of one program reused across all 7 days. resolveDay itself
// stays mocked (as everywhere else in this file) but with an isInPlan-aware
// implementation for this block only, so the guard's `days.some(isInPlan)`
// check and the per-day resolvedPlan fields are exercised faithfully without
// needing a live DB.
describe("get_week — time-aware per-day resolution (REQ-007a/S1)", () => {
  type FakeProgram = {
    id: string;
    name: string;
    source: "active" | "archived";
    startedOn: Date;
    template: { totalWeeks: number };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveProgram).mockResolvedValue(null);
    vi.mocked(getPlanWindowCandidates).mockResolvedValue([]);
    vi.mocked(getGoalEventsResult).mockResolvedValue({ events: [], focusGoalId: null } as never);
    vi.mocked(resolveDay).mockImplementation(((date: Date, ctx?: { program?: unknown }) => {
      const program = (ctx?.program ?? null) as FakeProgram | null;
      let isInPlan = false;
      if (program) {
        const daysDelta = Math.floor(
          (date.getTime() - new Date(program.startedOn).getTime()) / (24 * 3600 * 1000),
        );
        isInPlan = daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7;
      }
      return Promise.resolve({
        date,
        dateKey: date.toISOString().slice(0, 10),
        isInPlan,
        todayTask: isInPlan ? "workout" : "out_of_plan",
        resolvedPlan: program ? { id: program.id, name: program.name, source: program.source } : null,
      });
    }) as unknown as typeof resolveDay);
  });

  afterEach(() => {
    // Restore the file-wide static default so later describe blocks (if any
    // were ever appended after this one) don't inherit this block's
    // isInPlan-aware implementation.
    vi.mocked(resolveDay).mockResolvedValue({
      todayTask: "rest",
      program: null,
      scheduledItemsToday: [],
      goalMarks: [],
    } as never);
  });

  it("resolves a week under an ARCHIVED plan — no 'active plan window' error", async () => {
    vi.mocked(getPlanWindowCandidates).mockResolvedValue([
      {
        id: "plan-old",
        name: "Old Plan",
        startedOn: new Date("2020-01-05"),
        template: { totalWeeks: 8, phases: [], weeklySplit: [] },
        confirmedThroughDate: null,
        active: false,
        goalStatus: "achieved",
        goalCompletedAt: new Date("2020-02-01"),
      },
    ] as never);

    const handler = fakeServer.getHandler("get_week");
    const result = (await handler({ startDate: "2020-01-08" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as {
      error?: string;
      days: Array<{ resolvedPlan: { id: string; source: string } | null }>;
    };
    expect(payload.error).toBeUndefined();
    expect(payload.days).toHaveLength(7);
    for (const day of payload.days) {
      expect(day.resolvedPlan).toEqual({ id: "plan-old", name: "Old Plan", source: "archived" });
    }
  });

  it("errors 'Date is outside any plan window' for a week never covered by any plan", async () => {
    vi.mocked(getActiveProgram).mockResolvedValue({
      id: "active-1",
      name: "Current Plan",
      startedOn: new Date("2020-06-01"),
      template: { totalWeeks: 4, phases: [], weeklySplit: [] },
      confirmedThroughDate: null,
    } as never);
    vi.mocked(getPlanWindowCandidates).mockResolvedValue([]);

    const handler = fakeServer.getHandler("get_week");
    const result = (await handler({ startDate: "2021-01-01" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as { error?: string };
    expect(payload.error).toBe("Date is outside any plan window");
  });

  it("S1 acceptance: a transition week resolves day-by-day (days at/before completion archived, days after covered by nothing)", async () => {
    vi.mocked(getActiveProgram).mockResolvedValue(null);
    vi.mocked(getPlanWindowCandidates).mockResolvedValue([
      {
        id: "plan-old",
        name: "Elbert Plan",
        startedOn: new Date("2020-01-01"),
        template: { totalWeeks: 1, phases: [], weeklySplit: [] },
        confirmedThroughDate: null,
        active: false,
        goalStatus: "achieved",
        // S4 clamp: the plan's window (totalWeeks*7 = 7 days, 01-01..01-07)
        // gets cut short at the completion day — 01-04 is covered, 01-05
        // onward is NOT, even though it's still inside the raw template window.
        goalCompletedAt: new Date("2020-01-04"),
      },
    ] as never);

    const handler = fakeServer.getHandler("get_week");
    const result = (await handler({ startDate: "2020-01-04" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as {
      error?: string;
      startDate: string;
      days: Array<{
        isInPlan: boolean;
        resolvedPlan: { id: string; name: string; source: string } | null;
      }>;
    };

    expect(payload.error).toBeUndefined();
    expect(payload.startDate).toBe("2020-01-01");
    expect(payload.days).toHaveLength(7);

    // Days 0-3 (01-01..01-04): archived plan, covered up to and including
    // the completion day itself (S4: inclusive).
    for (let i = 0; i <= 3; i++) {
      expect(payload.days[i].isInPlan).toBe(true);
      expect(payload.days[i].resolvedPlan).toEqual({
        id: "plan-old",
        name: "Elbert Plan",
        source: "archived",
      });
    }
    // Days 4-6 (01-05..01-07): past the S4 completion clamp, and there is no
    // active program to fall back to — nothing covers them.
    for (let i = 4; i <= 6; i++) {
      expect(payload.days[i].isInPlan).toBe(false);
      expect(payload.days[i].resolvedPlan).toBeNull();
    }
  });
});

// ── #275: SavedMeal tools — leaky-reads coverage + upsert/scaling behavior ───
// list_saved_meals is a new READ tool → per repo convention it needs coverage
// here. The omit assertion follows this file's documented strategy (query CALL
// ARGS, not mocked returns). Tenant isolation itself is the scoped client's
// job (db.scoped.test.ts) — what this suite proves is that the handler reaches
// SavedMeal ONLY through the getDb() scoped client (mockDb), never the raw
// prisma singleton, so production rows are always the caller's own.
describe("list_saved_meals — leaky-reads coverage (#275)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockSavedMealFindMany).mockResolvedValue([
      {
        id: "sm-1",
        name: "Protein Brookie",
        items: [{ name: "Protein Brookie", qty: "1 brookie" }],
        macros: { calories: 310, fatG: 6.5, proteinG: 31, carbsG: 42.5 },
        defaultServings: 1,
        createdAt: new Date("2026-08-01"),
        updatedAt: new Date("2026-08-01"),
      },
    ]);
  });

  it("savedMeal.findMany called on the scoped client with omit: { userId: true }", async () => {
    const handler = fakeServer.getHandler("list_saved_meals");
    const result = (await handler({})) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(mockSavedMealFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ omit: { userId: true }, orderBy: { name: "asc" } }),
    );
  });

  it("payload carries the meal fields but no userId and no private note-type content", async () => {
    const handler = fakeServer.getHandler("list_saved_meals");
    const result = (await handler({})) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    const text = result.content[0].text;
    for (const forbidden of ["userId", "standing_rule", "\"review\"", "open_item"]) {
      expect(text).not.toContain(forbidden);
    }
    const payload = JSON.parse(text) as {
      count: number;
      savedMeals: Array<Record<string, unknown>>;
    };
    expect(payload.count).toBe(1);
    expect(payload.savedMeals[0]).toMatchObject({
      id: "sm-1",
      name: "Protein Brookie",
      defaultServings: 1,
    });
  });
});

describe("save_meal — upsert-by-name (#275)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockSavedMealFindFirst).mockResolvedValue(null);
    vi.mocked(mockSavedMealCreate).mockResolvedValue({ id: "sm-new", name: "Protein Brookie" });
    vi.mocked(mockSavedMealUpdate).mockResolvedValue({ id: "sm-1", name: "Protein Brookie" });
  });

  it("creates when no meal with that name exists (case-insensitive lookup)", async () => {
    const handler = fakeServer.getHandler("save_meal");
    const result = (await handler({
      name: "Protein Brookie",
      items: [{ name: "Protein Brookie", qty: "1 brookie" }],
      macros: { calories: 310, fatG: 6.5, proteinG: 31, carbsG: 42.5 },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockSavedMealFindFirst).toHaveBeenCalledWith({
      where: { name: { equals: "Protein Brookie", mode: "insensitive" } },
    });
    expect(mockSavedMealCreate).toHaveBeenCalledTimes(1);
    const data = (vi.mocked(mockSavedMealCreate).mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      name: "Protein Brookie",
      macros: { calories: 310, fatG: 6.5, proteinG: 31, carbsG: 42.5 },
      defaultServings: 1,
    });
    expect(mockSavedMealUpdate).not.toHaveBeenCalled();

    const payload = JSON.parse(result.content[0].text) as { updated: boolean };
    expect(payload.updated).toBe(false);
  });

  it("updates in place when the name already exists — no duplicate row", async () => {
    vi.mocked(mockSavedMealFindFirst).mockResolvedValue({ id: "sm-1", name: "protein brookie" });

    const handler = fakeServer.getHandler("save_meal");
    const result = (await handler({
      name: "Protein Brookie",
      items: [{ name: "Protein Brookie", qty: "1 brookie" }],
      defaultServings: 2,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockSavedMealUpdate).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockSavedMealUpdate).mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "sm-1" });
    // Latest casing wins; replace semantics: omitted macros clear stored ones.
    expect(call.data.name).toBe("Protein Brookie");
    expect(call.data.defaultServings).toBe(2);
    expect(call.data.macros).toBe(Prisma.DbNull);
    expect(mockSavedMealCreate).not.toHaveBeenCalled();

    const payload = JSON.parse(result.content[0].text) as { updated: boolean };
    expect(payload.updated).toBe(true);
  });

  it("rejects a whitespace-only name with a friendly error (Zod min(1) covers empty at the MCP layer)", async () => {
    const handler = fakeServer.getHandler("save_meal");
    const result = (await handler({
      name: "   ",
      items: [{ name: "Something" }],
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("non-empty name");
    expect(mockSavedMealCreate).not.toHaveBeenCalled();
    expect(mockSavedMealUpdate).not.toHaveBeenCalled();
  });
});

describe("delete_saved_meal (#275)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockSavedMealDelete).mockResolvedValue({ id: "sm-1" });
  });

  it("deletes by id through the scoped client", async () => {
    const handler = fakeServer.getHandler("delete_saved_meal");
    const result = (await handler({ id: "sm-1" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(mockSavedMealDelete).toHaveBeenCalledWith({ where: { id: "sm-1" } });
  });
});

describe("log_nutrition + savedMealId (#275)", () => {
  const brookieRow = {
    id: "sm-1",
    name: "Protein Brookie",
    items: [{ name: "Protein Brookie", qty: "1 brookie" }],
    macros: { calories: 310, fatG: 6.5, proteinG: 31, carbsG: 42.5 },
    defaultServings: 1,
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-01"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockSavedMealFindUnique).mockResolvedValue(brookieRow);
    vi.mocked(mockNutritionLogCreate).mockResolvedValue({ id: "n-1" });
  });

  it("derives items + scaled macros (servings ÷ defaultServings) in ONE nutritionLog.create", async () => {
    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({
      mealType: "snack",
      savedMealId: "sm-1",
      servings: 2,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockSavedMealFindUnique).toHaveBeenCalledWith({ where: { id: "sm-1" } });
    // Items + macros land in one row in one write — never desynced.
    expect(mockNutritionLogCreate).toHaveBeenCalledTimes(1);
    const data = (vi.mocked(mockNutritionLogCreate).mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.calories).toBe(620);
    expect(data.fatG).toBe(13);
    expect(data.proteinG).toBe(62);
    expect(data.carbsG).toBe(85);
    // Human-readable qty annotation when servings ≠ 1.
    expect(data.items).toEqual([{ name: "Protein Brookie", qty: "1 brookie ×2" }]);

    const payload = JSON.parse(result.content[0].text) as { message: string };
    expect(payload.message).toContain('saved meal "Protein Brookie"');
    expect(payload.message).toContain("2 servings");
  });

  it("explicit items/macros passed alongside savedMealId take precedence over derived values", async () => {
    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({
      mealType: "dinner",
      savedMealId: "sm-1",
      servings: 2,
      items: [{ name: "Custom item", qty: "1 plate" }],
      macros: { calories: 500 },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const data = (vi.mocked(mockNutritionLogCreate).mock.calls[0][0] as { data: Record<string, unknown> }).data;
    // Explicit macros replace the derived ones wholesale (no 620-cal bleed-through).
    expect(data.calories).toBe(500);
    expect(data.fatG).toBeUndefined();
    expect(data.proteinG).toBeUndefined();
    expect(data.items).toEqual([{ name: "Custom item", qty: "1 plate" }]);
  });

  it("unknown savedMealId → friendly not-found error, no raw Prisma exception, nothing written", async () => {
    vi.mocked(mockSavedMealFindUnique).mockResolvedValue(null);

    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({
      mealType: "lunch",
      savedMealId: "sm-missing",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Saved meal not found: sm-missing");
    expect(result.content[0].text).toContain("list_saved_meals");
    expect(mockNutritionLogCreate).not.toHaveBeenCalled();
  });

  it("regression: without savedMealId, behavior is unchanged (items+macros pass straight through)", async () => {
    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({
      mealType: "breakfast",
      items: [{ name: "Oatmeal", qty: "1 cup" }],
      macros: { calories: 300, proteinG: 12 },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockSavedMealFindUnique).not.toHaveBeenCalled();
    const data = (vi.mocked(mockNutritionLogCreate).mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.items).toEqual([{ name: "Oatmeal", qty: "1 cup" }]);
    expect(data.calories).toBe(300);
    expect(data.proteinG).toBe(12);

    const payload = JSON.parse(result.content[0].text) as { message: string };
    expect(payload.message).toBe("Nutrition logged");
  });

  it("no items and no savedMealId → friendly items-required error", async () => {
    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({ mealType: "lunch" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("items is required when savedMealId is not provided");
    expect(mockNutritionLogCreate).not.toHaveBeenCalled();
  });
});

// ── Food-linked bundles — MCP parity (save_meal snapshot + expansion bumps) ──
describe("save_meal + log_nutrition — food-linked bundles", () => {
  const BEEF_ROW = {
    id: "food-beef",
    barcode: null,
    name: "97% Lean Beef",
    brand: null,
    servingSize: null,
    basis: "100g",
    calories: 130,
    proteinG: 21,
    carbsG: 0,
    fatG: 4.5,
    fiberG: 0,
    sodiumMg: 65,
    source: "usda",
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-01"),
  };
  const BEEF_SOURCE = {
    basis: "100g",
    perBasis: { calories: 130, proteinG: 21, carbsG: 0, fatG: 4.5, fiberG: 0, sodiumMg: 65 },
    portions: [],
    foodId: "food-beef",
    brand: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("save_meal with a foodId item: snapshots the food from the SHARED catalog (raw prisma) at save time", async () => {
    vi.mocked(mockSavedMealFindFirst).mockResolvedValue(null);
    vi.mocked(mockSavedMealCreate).mockResolvedValue({ id: "sm-linked", name: "Beef Bowl" });
    vi.mocked(mockFoodLibraryFindMany).mockResolvedValue([BEEF_ROW]);

    const handler = fakeServer.getHandler("save_meal");
    const result = (await handler({
      name: "Beef Bowl",
      items: [{ name: "97% Lean Beef", foodId: "food-beef", amount: 200, unit: "g" }],
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    // Shared-catalog read — the deliberately NON-scoped singleton.
    expect(mockFoodLibraryFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["food-beef"] } },
    });
    const data = (vi.mocked(mockSavedMealCreate).mock.calls[0][0] as { data: { items: unknown[] } }).data;
    // Stored row carries the §B.5 save-time snapshot + computed per-item state.
    expect(data.items[0]).toEqual({
      name: "97% Lean Beef",
      qty: "200 g",
      foodId: "food-beef",
      amount: 200,
      unit: "g",
      itemMacros: { calories: 260, proteinG: 42, carbsG: 0, fatG: 9, fiberG: 0, sodiumMg: 130 },
      source: BEEF_SOURCE,
    });
  });

  it("save_meal with an unknown foodId: item stored text-only, message flags the unresolved id", async () => {
    vi.mocked(mockSavedMealFindFirst).mockResolvedValue(null);
    vi.mocked(mockSavedMealCreate).mockResolvedValue({ id: "sm-x", name: "Mystery" });
    vi.mocked(mockFoodLibraryFindMany).mockResolvedValue([]);

    const handler = fakeServer.getHandler("save_meal");
    const result = (await handler({
      name: "Mystery",
      items: [{ name: "Ghost food", foodId: "food-ghost", amount: 1, unit: "serving" }],
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const data = (vi.mocked(mockSavedMealCreate).mock.calls[0][0] as { data: { items: Array<Record<string, unknown>> } }).data;
    expect(data.items[0]!.source).toBeUndefined();
    expect(data.items[0]!.foodId).toBe("food-ghost"); // provenance kept
    const payload = JSON.parse(result.content[0].text) as { message: string };
    expect(payload.message).toContain("food-ghost");
    expect(payload.message).toContain("text-only");
  });

  it("log_nutrition(savedMealId) on a linked bundle: rows expand structurally AND each linked food's FoodUsage bumps", async () => {
    vi.mocked(mockSavedMealFindUnique).mockResolvedValue({
      id: "sm-linked",
      name: "Beef Bowl",
      items: [
        {
          name: "97% Lean Beef",
          qty: "200 g",
          foodId: "food-beef",
          amount: 200,
          unit: "g",
          itemMacros: { calories: 260, proteinG: 42, carbsG: 0, fatG: 9, fiberG: 0, sodiumMg: 130 },
          source: BEEF_SOURCE,
        },
      ],
      macros: { calories: 260, proteinG: 42, carbsG: 0, fatG: 9, fiberG: 0, sodiumMg: 130 },
      defaultServings: 1,
      createdAt: new Date("2026-08-01"),
      updatedAt: new Date("2026-08-01"),
    });
    vi.mocked(mockNutritionLogCreate).mockResolvedValue({ id: "n-2" });
    vi.mocked(mockFoodUsageFindFirst).mockResolvedValue(null);

    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({
      mealType: "dinner",
      savedMealId: "sm-linked",
      servings: 2,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const data = (vi.mocked(mockNutritionLogCreate).mock.calls[0][0] as { data: Record<string, unknown> }).data;
    // Full per-item fidelity: scaled amount, re-rendered qty, recomputed
    // itemMacros, save-time source — NO top-level foodId (hand-add parity).
    expect(data.items).toEqual([
      {
        name: "97% Lean Beef",
        qty: "400 g",
        amount: 400,
        unit: "g",
        source: BEEF_SOURCE,
        itemMacros: { calories: 520, proteinG: 84, carbsG: 0, fatG: 18, fiberG: 0, sodiumMg: 260 },
      },
    ]);
    // Row totals via the composer's recompose math (all six keys).
    expect(data.calories).toBe(520);
    expect(data.proteinG).toBe(84);
    expect(data.fatG).toBe(18);
    expect(data.sodiumMg).toBe(260);
    // FoodUsage counted exactly like an individual pick (first use → create,
    // portion memory at the SCALED amount).
    expect(mockFoodUsageFindFirst).toHaveBeenCalledWith({ where: { foodId: "food-beef" } });
    expect(mockFoodUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        foodId: "food-beef",
        usageCount: 1,
        lastAmount: 400,
        lastUnit: "g",
      }),
    });
  });

  it("explicit items alongside savedMealId → NO FoodUsage bump (the derived expansion was not logged)", async () => {
    vi.mocked(mockSavedMealFindUnique).mockResolvedValue({
      id: "sm-linked",
      name: "Beef Bowl",
      items: [{ name: "97% Lean Beef", foodId: "food-beef", amount: 200, unit: "g", source: BEEF_SOURCE }],
      macros: null,
      defaultServings: 1,
      createdAt: new Date("2026-08-01"),
      updatedAt: new Date("2026-08-01"),
    });
    vi.mocked(mockNutritionLogCreate).mockResolvedValue({ id: "n-3" });

    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({
      mealType: "dinner",
      savedMealId: "sm-linked",
      items: [{ name: "Custom plate", qty: "1 plate" }],
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockFoodUsageFindFirst).not.toHaveBeenCalled();
    expect(mockFoodUsageCreate).not.toHaveBeenCalled();
  });

  it("text-only saved meal → zero FoodUsage traffic (legacy path untouched)", async () => {
    vi.mocked(mockSavedMealFindUnique).mockResolvedValue({
      id: "sm-1",
      name: "Protein Brookie",
      items: [{ name: "Protein Brookie", qty: "1 brookie" }],
      macros: { calories: 310 },
      defaultServings: 1,
      createdAt: new Date("2026-08-01"),
      updatedAt: new Date("2026-08-01"),
    });
    vi.mocked(mockNutritionLogCreate).mockResolvedValue({ id: "n-4" });

    const handler = fakeServer.getHandler("log_nutrition");
    const result = (await handler({
      mealType: "snack",
      savedMealId: "sm-1",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockFoodUsageFindFirst).not.toHaveBeenCalled();
    expect(mockFoodUsageCreate).not.toHaveBeenCalled();
    expect(mockFoodUsageUpdate).not.toHaveBeenCalled();
  });
});

// ── #276: Baseline.capped — persistence round-trip via the mocked db ─────────
// capped is a DISPLAY annotation only (equipment-ceiling marker). These tests
// pin the write-path contract: log_baseline persists it (default false),
// the same-day dedupe path carries it through the in-place update, and
// update_baseline toggles it after the fact with patch semantics.
// readiness.ts / rarity-core.ts / records canonicalization are untouched.
describe("log_baseline / update_baseline — capped persistence (#276)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockBaselineFindFirst).mockResolvedValue(null);
    vi.mocked(mockBaselineCreate).mockResolvedValue({ id: "b-new" });
    vi.mocked(mockBaselineUpdate).mockResolvedValue({
      id: "b-1",
      testName: "8-Rep DB Press",
      date: new Date("2026-08-09"),
      value: 65,
      units: "lb",
      notes: null,
      capped: true,
    });
    vi.mocked(mockBaselineFindUniqueOrThrow).mockResolvedValue({
      id: "b-1",
      testName: "8-Rep DB Press",
      date: new Date("2026-08-09"),
      value: 65,
      units: "lb",
      notes: null,
      capped: false,
    });
  });

  it("log_baseline capped:true persists on the created row", async () => {
    const handler = fakeServer.getHandler("log_baseline");
    const result = (await handler({
      testName: "8-Rep DB Press",
      value: 65,
      units: "lb",
      capped: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockBaselineCreate).toHaveBeenCalledTimes(1);
    const data = (vi.mocked(mockBaselineCreate).mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.capped).toBe(true);
    expect(data.value).toBe(65);
  });

  it("log_baseline omitting capped defaults to false (regression: existing calls unaffected)", async () => {
    const handler = fakeServer.getHandler("log_baseline");
    const result = (await handler({
      testName: "Pull-up Max",
      value: 12,
      units: "reps",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const data = (vi.mocked(mockBaselineCreate).mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.capped).toBe(false);
  });

  it("log_baseline same-day re-log (dedupe path) carries capped through the in-place update", async () => {
    vi.mocked(mockBaselineFindFirst).mockResolvedValue({
      id: "b-existing",
      testName: "8-Rep DB Press",
      date: new Date("2026-08-09"),
      value: 60,
      units: "lb",
      notes: null,
      capped: false,
    });

    const handler = fakeServer.getHandler("log_baseline");
    const result = (await handler({
      testName: "8-Rep DB Press",
      value: 65,
      units: "lb",
      capped: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(mockBaselineCreate).not.toHaveBeenCalled();
    expect(mockBaselineUpdate).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockBaselineUpdate).mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "b-existing" });
    expect(call.data.capped).toBe(true);

    const payload = JSON.parse(result.content[0].text) as { deduped: boolean };
    expect(payload.deduped).toBe(true);
  });

  it("update_baseline toggles capped after the fact", async () => {
    const handler = fakeServer.getHandler("update_baseline");
    const result = (await handler({ id: "b-1", capped: true })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(mockBaselineUpdate).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockBaselineUpdate).mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "b-1" });
    expect(call.data).toEqual({ capped: true });
  });

  it("update_baseline without capped leaves it out of the patch (no accidental reset)", async () => {
    const handler = fakeServer.getHandler("update_baseline");
    const result = (await handler({ id: "b-1", value: 70 })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const call = vi.mocked(mockBaselineUpdate).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).toEqual({ value: 70 });
    expect("capped" in call.data).toBe(false);
  });
});

// ── get_program_overview — leaky-reads coverage (#311) ───────────────────────
// Strategy per the file header: assert on QUERY CALL ARGS. The overview must
// (a) never select userId on any of its three queries (Program, member Goals,
// rotation Plan), and (b) never read Note at all — a tool that issues no Note
// query cannot leak private note types (standing_rule/review/open_item).

describe("get_program_overview — leaky-reads coverage (#311)", () => {
  const PROGRAM_ROW = {
    id: "prog-1",
    name: "Fall Block",
    status: "active",
    startedOn: new Date("2026-09-01T06:00:00.000Z"),
    endsOn: null,
    notes: null,
    attributionRules: [{ match: { titleContains: ["hike"] }, goalIds: ["g-1"] }],
    createdAt: new Date("2026-08-09T12:00:00.000Z"),
    updatedAt: new Date("2026-08-09T12:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockProgramFindFirst).mockResolvedValue(PROGRAM_ROW);
    vi.mocked(mockProgramFindUnique).mockResolvedValue(PROGRAM_ROW);
    vi.mocked(mockGoalFindMany).mockResolvedValue([
      { id: "g-1", objective: "Summit", kind: "fitness", status: "active", plans: [{ id: "p-1" }] },
      { id: "g-2", objective: "Ship MVP", kind: "project", status: "active", plans: [] },
    ]);
    vi.mocked(mockFindFirst).mockResolvedValue({ id: "p-1", name: "Rotation", active: true });
  });

  it("omitted programId: program.findFirst uses an explicit select WITHOUT userId", async () => {
    const handler = fakeServer.getHandler("get_program_overview");
    await handler({});

    expect(vi.mocked(mockProgramFindFirst)).toHaveBeenCalledOnce();
    const args = vi.mocked(mockProgramFindFirst).mock.calls[0][0] as Record<string, unknown>;
    expect(args.where).toEqual({ status: "active" });
    const select = args.select as Record<string, unknown>;
    expect(select).toBeDefined();
    expect(select.userId).toBeUndefined();
    expect(select.id).toBe(true); // sanity: it IS a projection, not a full-row read
  });

  it("explicit programId: program.findUnique also selects WITHOUT userId", async () => {
    const handler = fakeServer.getHandler("get_program_overview");
    await handler({ programId: "prog-1" });

    expect(vi.mocked(mockProgramFindUnique)).toHaveBeenCalledOnce();
    const args = vi.mocked(mockProgramFindUnique).mock.calls[0][0] as Record<string, unknown>;
    expect(args.where).toEqual({ id: "prog-1" });
    expect((args.select as Record<string, unknown>).userId).toBeUndefined();
  });

  it("member-goal query selects only {id, objective, kind, status, plans:{id}} — no userId at either level", async () => {
    const handler = fakeServer.getHandler("get_program_overview");
    await handler({});

    expect(vi.mocked(mockGoalFindMany)).toHaveBeenCalledOnce();
    const args = vi.mocked(mockGoalFindMany).mock.calls[0][0] as Record<string, unknown>;
    expect(args.where).toEqual({ programId: "prog-1" });
    expect(args.select).toEqual({
      id: true,
      objective: true,
      kind: true,
      status: true,
      plans: { where: { active: true }, select: { id: true }, take: 1 },
    });
  });

  it("rotation-plan query selects only {id, name, active} — no userId", async () => {
    const handler = fakeServer.getHandler("get_program_overview");
    await handler({});

    // plan.findFirst is the shared mockFindFirst; the overview's call is the
    // one filtered by programId.
    const planCall = vi.mocked(mockFindFirst).mock.calls.find(
      (c) => ((c[0] as Record<string, unknown>).where as Record<string, unknown>)?.programId === "prog-1",
    );
    expect(planCall).toBeDefined();
    expect((planCall![0] as Record<string, unknown>).select).toEqual({
      id: true,
      name: true,
      active: true,
    });
  });

  it("issues NO Note reads at all (private note types cannot leak from this tool)", async () => {
    const handler = fakeServer.getHandler("get_program_overview");
    await handler({});

    // mockFindMany backs workout/measurement/NOTE/baseline/hike/nutritionLog/
    // bodyMetric — zero calls means zero Note reads (goal.findMany is a
    // dedicated spy and does not route here).
    expect(vi.mocked(mockFindMany)).not.toHaveBeenCalled();
  });

  it("payload shape: program + memberGoals(hasActivePlan) + rotationPlan + attributionRules, and no userId key anywhere", async () => {
    const handler = fakeServer.getHandler("get_program_overview");
    const result = (await handler({})) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "attributionRules",
      "memberGoals",
      "program",
      "rotationPlan",
    ]);
    expect(payload.memberGoals).toEqual([
      { id: "g-1", objective: "Summit", kind: "fitness", status: "active", hasActivePlan: true },
      { id: "g-2", objective: "Ship MVP", kind: "project", status: "active", hasActivePlan: false },
    ]);
    expect((payload.program as Record<string, unknown>).startedOn).toBe("2026-09-01"); // dateKey, not ISO instant
    expect(result.content[0].text).not.toContain("userId");
  });
});

// ── list_activity_links — leaky-reads coverage (#278) ────────────────────────
// New READ tool → per repo convention it needs coverage here. Strategy per
// the file header: assert on QUERY CALL ARGS — the link query must use an
// explicit select WITHOUT userId (at both the link and joined-goal levels),
// must range-filter on activityDate (never createdAt), and the tool must
// never read Note at all.

describe("list_activity_links — leaky-reads coverage (#278)", () => {
  const LINK_ROW = {
    id: "link-1",
    activityType: "workout",
    activityId: "w-1",
    goalId: "g-1",
    source: "auto",
    note: null,
    activityDate: new Date("2026-08-05T06:00:00.000Z"),
    createdAt: new Date("2026-08-05T23:00:00.000Z"),
    goal: { objective: "Handstand" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFindUnique).mockResolvedValue({ id: "g-1" }); // goal existence check
    vi.mocked(mockProgramFindFirst).mockResolvedValue({ id: "prog-1", name: "Phase 2A" });
    vi.mocked(mockGoalFindMany).mockResolvedValue([{ id: "g-1" }, { id: "g-2" }]);
    vi.mocked(mockActivityLinkFindMany).mockResolvedValue([LINK_ROW]);
  });

  it("link query uses an explicit select WITHOUT userId — and the joined goal selects objective only", async () => {
    const handler = fakeServer.getHandler("list_activity_links");
    await handler({ goalId: "g-1" });

    expect(vi.mocked(mockActivityLinkFindMany)).toHaveBeenCalledOnce();
    const args = vi.mocked(mockActivityLinkFindMany).mock.calls[0][0] as Record<string, unknown>;
    const select = args.select as Record<string, unknown>;
    expect(select).toBeDefined();
    expect(select.userId).toBeUndefined();
    expect(select.id).toBe(true); // sanity: a projection, not a full-row read
    expect(select.goal).toEqual({ select: { objective: true } }); // no goal.userId either
  });

  it("from/to filter on activityDate, NOT createdAt (retroactive-attribution trap)", async () => {
    const handler = fakeServer.getHandler("list_activity_links");
    await handler({ goalId: "g-1", from: "2026-08-01", to: "2026-08-07" });

    const args = vi.mocked(mockActivityLinkFindMany).mock.calls[0][0] as Record<string, unknown>;
    const where = args.where as Record<string, unknown>;
    expect(where.activityDate).toBeDefined();
    expect(where.createdAt).toBeUndefined();
  });

  it("omitted goalId resolves the ACTIVE Program's member goals (program.findFirst + goal.findMany id-projection)", async () => {
    const handler = fakeServer.getHandler("list_activity_links");
    await handler({});

    expect(vi.mocked(mockProgramFindFirst)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mockProgramFindFirst).mock.calls[0][0] as Record<string, unknown>).select,
    ).toEqual({ id: true, name: true });
    expect(vi.mocked(mockGoalFindMany)).toHaveBeenCalledWith({
      where: { programId: "prog-1" },
      select: { id: true },
    });
    const args = vi.mocked(mockActivityLinkFindMany).mock.calls[0][0] as Record<string, unknown>;
    expect((args.where as Record<string, unknown>).goalId).toEqual({ in: ["g-1", "g-2"] });
  });

  it("issues NO Note reads at all (private note types cannot leak from this tool)", async () => {
    const handler = fakeServer.getHandler("list_activity_links");
    await handler({ goalId: "g-1" });

    // mockFindMany backs workout/measurement/NOTE/baseline/hike/nutritionLog/
    // bodyMetric — zero calls means zero Note reads.
    expect(vi.mocked(mockFindMany)).not.toHaveBeenCalled();
  });

  it("payload: links carry goalObjective + dateKey activityDate, and no userId key anywhere", async () => {
    const handler = fakeServer.getHandler("list_activity_links");
    const result = (await handler({ goalId: "g-1" })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["count", "links", "scope", "truncated"]);
    const links = payload.links as Array<Record<string, unknown>>;
    expect(links[0].goalObjective).toBe("Handstand");
    expect(links[0].activityDate).toBe("2026-08-05"); // dateKey, not ISO instant
    expect(result.content[0].text).not.toContain("userId");
  });
});

// ── #283/#284: program-shaped day — leaky-reads coverage ─────────────────────
//
// The four read tools' program context flows OUT of resolveDay's #282 fields
// (calendar.ts). resolveDay is mocked file-wide here, so the query-arg
// coverage for its internal scheduledItem/goal member queries lives in
// src/lib/calendar.test.ts (userId-free select assertions on the mocked
// scoped db) — this block covers what the TOOLS add on top:
//   - get_today_plan's per-goal feasibility query (the only NEW Prisma query
//     issued directly by a handler in this sprint) projects without userId,
//   - get_week batches getActiveProgramMembership ONCE and threads it via
//     ctx.membership to all 7 resolveDay calls,
//   - get_day / get_session_brief derive their program context from resolveDay
//     alone (no duplicate scheduledItem query) and leak no userId.
describe("program-shaped day — #283/#284 coverage", () => {
  const PROGRAM_DAY = {
    todayTask: "workout",
    isInPlan: true,
    weekIndex: 2,
    program: {
      id: "prog-1",
      name: "Phase 2A",
      status: "active",
      startedOn: new Date("2026-05-25"),
      endsOn: null,
      memberGoals: [
        { id: "g-handstand", objective: "Freestanding handstand", kind: "fitness", status: "active" },
        { id: "g-aws", objective: "AWS SAA cert", kind: "project", status: "active" },
      ],
    },
    scheduledItemsToday: [
      {
        id: "si-1",
        goalId: "g-aws",
        goalObjective: "AWS SAA cert",
        type: "task",
        title: "Practice exam #3",
        detail: null,
        status: "planned",
        completedAt: null,
      },
    ],
    goalMarks: [
      { goalId: "g-handstand", objective: "Freestanding handstand", kind: "fitness", claims: ["rotation", "nutrition"] },
      { goalId: "g-aws", objective: "AWS SAA cert", kind: "project", claims: ["scheduled_item"] },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFindMany).mockResolvedValue([]);
    vi.mocked(mockFindFirst).mockResolvedValue(null);
    vi.mocked(getActiveProgram).mockResolvedValue(null);
    vi.mocked(getActiveProgramMembership).mockResolvedValue(null);
    vi.mocked(getPlanWindowCandidates).mockResolvedValue([]);
    // Full GoalEventsResult shape — get_session_brief maps otherGoalsMeta.
    vi.mocked(getGoalEventsResult).mockResolvedValue({
      events: [],
      focusGoalId: null,
      otherGoalsMeta: [],
    } as never);
    vi.mocked(resolveDay).mockResolvedValue({
      todayTask: "rest",
      program: null,
      scheduledItemsToday: [],
      goalMarks: [],
    } as never);
  });

  it("get_today_plan (Program path): per-goal feasibility query projects {id, kind, targetDate, targets} — no userId", async () => {
    vi.mocked(resolveDay).mockResolvedValue(PROGRAM_DAY as never);
    vi.mocked(mockGoalFindMany).mockResolvedValue([
      { id: "g-aws", kind: "project", targetDate: null, targets: [] },
    ]);

    const handler = fakeServer.getHandler("get_today_plan");
    await handler({});

    const feasCall = vi.mocked(mockGoalFindMany).mock.calls.find(
      (c) => (c[0] as { where?: { id?: { in?: string[] } } })?.where?.id?.in !== undefined,
    );
    expect(feasCall).toBeDefined();
    const args = feasCall![0] as { where: { id: { in: string[] } }; select: Record<string, unknown> };
    // Only ACTIVE project-kind member goals are fetched.
    expect(args.where.id.in).toEqual(["g-aws"]);
    expect(args.select).toEqual({ id: true, kind: true, targetDate: true, targets: true });
    expect(Object.keys(args.select)).not.toContain("userId");
    // The handler adds no duplicate scheduledItem query — the union came from resolveDay.
    expect(vi.mocked(mockScheduledItemFindMany)).not.toHaveBeenCalled();
  });

  it("get_today_plan (zero-Program fitness path): no feasibility query, no scheduledItem query — legacy behavior intact", async () => {
    const handler = fakeServer.getHandler("get_today_plan");
    const result = (await handler({})) as { content: Array<{ type: string; text: string }> };

    expect(vi.mocked(mockGoalFindMany)).not.toHaveBeenCalled();
    expect(vi.mocked(mockScheduledItemFindMany)).not.toHaveBeenCalled();
    // The additive #282 keys ride along as null/[] for legacy tenants.
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.program).toBeNull();
    expect(payload.scheduledItemsToday).toEqual([]);
    expect(payload.goalMarks).toEqual([]);
  });

  it("get_day passes resolveDay's program fields through verbatim, with no userId anywhere", async () => {
    vi.mocked(resolveDay).mockResolvedValue(PROGRAM_DAY as never);

    const handler = fakeServer.getHandler("get_day");
    const result = (await handler({ date: "2026-06-01" })) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(result.content[0].text) as {
      program: { id: string; memberGoals: unknown[] };
      scheduledItemsToday: Array<{ goalId: string }>;
      goalMarks: Array<{ claims: string[] }>;
    };
    expect(payload.program.id).toBe("prog-1");
    expect(payload.program.memberGoals).toHaveLength(2);
    expect(payload.scheduledItemsToday[0].goalId).toBe("g-aws");
    expect(payload.goalMarks[0].claims).toContain("rotation");
    expect(result.content[0].text).not.toContain("userId");
    expect(vi.mocked(mockScheduledItemFindMany)).not.toHaveBeenCalled();
  });

  it("get_week fetches membership ONCE and threads it to all 7 resolveDay calls via ctx.membership", async () => {
    const membership = {
      id: "prog-1",
      name: "Phase 2A",
      status: "active",
      startedOn: new Date("2026-05-25"),
      endsOn: null,
      notes: null,
      attributionRules: null,
      memberGoals: PROGRAM_DAY.program.memberGoals,
    };
    vi.mocked(getActiveProgramMembership).mockResolvedValue(membership as never);
    vi.mocked(getActiveProgram).mockResolvedValue({
      id: "plan-active",
      name: "Handstand Block",
      startedOn: new Date("2026-05-25"),
      template: { totalWeeks: 4, phases: [], weeklySplit: [] },
      confirmedThroughDate: null,
    } as never);
    vi.mocked(getGoalEventsResult).mockResolvedValue({ events: [], focusGoalId: null } as never);
    vi.mocked(resolveDay).mockResolvedValue({ ...PROGRAM_DAY, isInPlan: true } as never);

    const handler = fakeServer.getHandler("get_week");
    await handler({ startDate: "2026-05-27" });

    expect(vi.mocked(getActiveProgramMembership)).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(resolveDay).mock.calls;
    expect(calls).toHaveLength(7);
    for (const call of calls) {
      const ctx = call[1] as { membership?: unknown };
      expect(ctx.membership).toBe(membership);
    }
  });

  it("get_week (pure-project Program, no rotation plan): honest message + program block instead of 'create a goal'", async () => {
    vi.mocked(getActiveProgramMembership).mockResolvedValue({
      id: "prog-chew",
      name: "chewgether $1k/mo",
      status: "active",
      startedOn: new Date("2026-07-01"),
      endsOn: null,
      notes: null,
      attributionRules: null,
      memberGoals: [
        { id: "g-chewgether", objective: "Launch Chewgether to $1k MRR", kind: "project", status: "active" },
      ],
    } as never);
    // No plans at all: getActiveProgram null + zero candidates → anchorPick null.
    vi.mocked(getActiveProgram).mockResolvedValue(null);
    vi.mocked(getPlanWindowCandidates).mockResolvedValue([]);

    const handler = fakeServer.getHandler("get_week");
    const result = (await handler({ startDate: "2026-07-06" })) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(result.content[0].text) as {
      days: unknown[];
      program?: { name: string };
      message?: string;
    };
    expect(payload.days).toEqual([]);
    expect(payload.program?.name).toBe("chewgether $1k/mo");
    expect(payload.message).toContain("no rotation plan");
    expect(payload.message).not.toContain("create a goal");
    expect(result.content[0].text).not.toContain("userId");
  });

  it("get_week (zero-Program empty state): legacy 'create a goal' message byte-identical", async () => {
    const handler = fakeServer.getHandler("get_week");
    const result = (await handler({ startDate: "2026-07-06" })) as {
      content: Array<{ type: string; text: string }>;
    };
    const payload = JSON.parse(result.content[0].text) as { message?: string; program?: unknown };
    expect(payload.message).toBe(
      "No active program yet — create a goal with a target date to generate a plan.",
    );
    expect(payload.program).toBeUndefined();
  });

  it("get_session_brief derives its program block from resolveDay alone — no extra queries, rotation owner from goalMarks, no userId", async () => {
    vi.mocked(resolveDay).mockResolvedValue(PROGRAM_DAY as never);

    const handler = fakeServer.getHandler("get_session_brief");
    const result = (await handler({})) as { content: Array<{ type: string; text: string }> };

    const payload = JSON.parse(result.content[0].text) as {
      program: {
        name: string;
        memberGoalCount: number;
        rotationOwnerObjective: string | null;
        scheduledItemsToday: Array<{ goalId: string; title: string }>;
      } | null;
    };
    expect(payload.program).not.toBeNull();
    expect(payload.program!.name).toBe("Phase 2A");
    expect(payload.program!.memberGoalCount).toBe(2);
    expect(payload.program!.rotationOwnerObjective).toBe("Freestanding handstand");
    expect(payload.program!.scheduledItemsToday).toEqual([
      { goalId: "g-aws", goalObjective: "AWS SAA cert", type: "task", title: "Practice exam #3", status: "planned" },
    ]);
    expect(vi.mocked(mockScheduledItemFindMany)).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain("userId");
  });

  it("get_session_brief: zero-Program tenants get program: null (legacy shape + one additive key)", async () => {
    const handler = fakeServer.getHandler("get_session_brief");
    const result = (await handler({})) as { content: Array<{ type: string; text: string }> };
    const payload = JSON.parse(result.content[0].text) as { program: unknown };
    expect(payload.program).toBeNull();
  });
});
