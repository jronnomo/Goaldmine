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

  const mockDb = {
    workout: { findMany: mockFindMany },
    measurement: { findMany: mockFindMany },
    note: { findMany: mockFindMany },
    baseline: { findMany: mockFindMany },
    hike: { findMany: mockFindMany },
    nutritionLog: { findMany: mockFindMany },
    bodyMetric: { findMany: mockFindMany },
    plan: { findFirst: mockFindFirst },
    goal: { findUniqueOrThrow: mockFindUniqueOrThrow, findUnique: mockFindUnique, update: mockGoalUpdate },
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
  };
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
vi.mock("@/lib/program", async () => {
  // pickProgramForDate is pure and REQ-007a (get_week) tests below need its
  // real ordering/clamping behavior to exercise the S1 per-day-pick contract
  // faithfully — only the DB-backed lookups (getActiveProgram,
  // getPlanWindowCandidates) are mocked.
  const actual = await vi.importActual<typeof import("@/lib/program")>("@/lib/program");
  return {
    getActiveProgram: vi.fn().mockResolvedValue(null),
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
vi.mock("@/lib/mcp/today-shapers", () => ({ shapeProjectTodayPayload: vi.fn().mockReturnValue({}) }));
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
import { registerAll } from "@/lib/mcp/tools";
import { resolveDay } from "@/lib/calendar";
import { getActiveProgram, getPlanWindowCandidates } from "@/lib/program";
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
    vi.mocked(resolveDay).mockResolvedValue({ todayTask: "rest" } as never);
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
