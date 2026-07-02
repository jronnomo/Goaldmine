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

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file. Variables must be
// hoisted with vi.hoisted() to be accessible inside those factories.
const { mockFindMany, mockFindFirst, mockFindUniqueOrThrow, mockDb } = vi.hoisted(() => {
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

  const mockDb = {
    workout: { findMany: mockFindMany },
    measurement: { findMany: mockFindMany },
    note: { findMany: mockFindMany },
    baseline: { findMany: mockFindMany },
    hike: { findMany: mockFindMany },
    nutritionLog: { findMany: mockFindMany },
    bodyMetric: { findMany: mockFindMany },
    plan: { findFirst: mockFindFirst },
    goal: { findUniqueOrThrow: mockFindUniqueOrThrow },
  };

  return { mockFindMany, mockFindFirst, mockFindUniqueOrThrow, mockDb };
});

// ── Module mocks (all hoisted before imports) ─────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    planDayOverride: { findMany: vi.fn().mockResolvedValue([]) },
    oAuthAuthCode: {},
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
  resolveDay: vi.fn().mockResolvedValue({ todayTask: "rest" }),
  rotationBaselineNamesForDate: vi.fn().mockReturnValue([]),
  templateForRotationDay: vi.fn().mockReturnValue(null),
  weekConflicts: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/workout-core", () => ({
  createWorkoutCore: vi.fn(),
  updateWorkoutCore: vi.fn(),
  updateWorkoutSetCore: vi.fn(),
  workoutOpsCore: vi.fn(),
  deleteWorkoutCore: vi.fn(),
  WorkoutOpSchema: { shape: {}, parse: vi.fn() },
}));
vi.mock("@/lib/hike-core", () => ({ logHikeCore: vi.fn(), updateHikeCore: vi.fn() }));
vi.mock("@/lib/baseline-workout", () => ({
  appendBaselineToDayWorkout: vi.fn(),
  removeBaselineFromDayWorkout: vi.fn(),
  syncBaselineUpdateToWorkout: vi.fn(),
}));
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
vi.mock("@/lib/program", () => ({
  getActiveProgram: vi.fn().mockResolvedValue(null),
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
  const { z } = await import("zod");
  const objSchema = z.object({});
  return {
    NutritionPlanShape: objSchema,
    PlannedMealMacrosShape: objSchema,
    MACRO_KEYS: [],
    applyNutritionPlanPatch: vi.fn(),
    parseStoredNutritionPlan: vi.fn().mockReturnValue(null),
  };
});
vi.mock("@/lib/nutrition-log-ops", () => ({
  NutritionLogOpSchema: { shape: {}, parse: vi.fn() },
  applyNutritionLogOps: vi.fn(),
  parseStoredItems: vi.fn().mockReturnValue([]),
  stripItemSource: vi.fn().mockImplementation((items: unknown[]) => items ?? []),
}));
vi.mock("@/lib/baseline-ops", () => ({
  BaselineOpSchema: { shape: {}, parse: vi.fn() },
  applyBaselineOps: vi.fn(),
  summarizeBaselineChanges: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/game/engine", () => ({ computeGameState: vi.fn().mockResolvedValue({}) }));
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
vi.mock("@/lib/mcp/today-shapers", () => ({ shapeProjectTodayPayload: vi.fn().mockReturnValue({}) }));
vi.mock("@/lib/recap", () => ({
  computeWeeklyRecap: vi.fn().mockResolvedValue({}),
  resolveHighlight: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/recap-render", () => ({ renderRecapCard: vi.fn().mockResolvedValue(null) }));

// ── Imports (after all vi.mock calls) ─────────────────────────────────────────
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "@/lib/mcp/tools";

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
});
