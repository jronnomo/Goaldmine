// src/lib/mcp/idempotency-tools.test.ts
//
// #274 — integration-style coverage of the requestId threading in tools.ts:
// the REAL registered log_note handler (via registerAll + a fake McpServer,
// same harness as leaky-reads.test.ts) is called twice against a mocked db.
//
//   - same requestId twice  → exactly ONE note.create; the second response is
//     the stored first result replayed verbatim (+ replayed:true)
//   - no requestId          → two creates, zero receipts (today's behavior,
//     byte-for-byte — regression guard)
//   - different requestIds  → two creates, two receipts (regression guard)
//
// The mock block mirrors leaky-reads.test.ts: tools.ts's module graph is
// stubbed except the subject under test (@/lib/mcp/idempotency stays REAL,
// as do the pure tool-helpers that shape the response envelope).

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────
const { mockNoteCreate, receiptFindFirst, receiptCreate, mockDb, resetStores } = vi.hoisted(() => {
  // In-memory WriteReceipt table honoring @@unique([userId, requestId]) for
  // the single mocked user: dup insert throws a P2002-shaped error.
  const receiptRows: { requestId: string; toolName: string; resultJson: unknown }[] = [];

  const receiptFindFirst = vi.fn(
    async (args: { where: { requestId: string } }) =>
      receiptRows.find((r) => r.requestId === args.where.requestId) ?? null,
  );
  const receiptCreate = vi.fn(
    async (args: { data: { requestId: string; toolName: string; resultJson: unknown } }) => {
      if (receiptRows.some((r) => r.requestId === args.data.requestId)) {
        throw Object.assign(new Error("Unique constraint failed on WriteReceipt"), {
          code: "P2002",
        });
      }
      receiptRows.push(args.data);
      return { id: `receipt-${receiptRows.length}`, ...args.data };
    },
  );

  let noteSeq = 0;
  const mockNoteCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: `note-${++noteSeq}`,
    ...args.data,
  }));

  const mockDb = {
    note: { create: mockNoteCreate },
    writeReceipt: { findFirst: receiptFindFirst, create: receiptCreate },
  };

  const resetStores = () => {
    receiptRows.length = 0;
    noteSeq = 0;
  };

  return { mockNoteCreate, receiptFindFirst, receiptCreate, mockDb, resetStores };
});

// ── Module mocks (hoisted before imports; mirrors leaky-reads.test.ts) ───────

vi.mock("@/lib/db", () => ({
  prisma: {},
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
  getPlanWindowCandidates: vi.fn().mockResolvedValue([]),
  pickProgramForDate: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/goal-story", () => ({ getGoalStory: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/day-template-validation", () => ({
  MAX_DAY_TEMPLATE_BYTES: 65536,
  assertDayTemplateWithinSize: vi.fn(),
  assertValidDayTemplate: vi.fn(),
  assertBaselineDecisionMade: vi.fn(),
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
  computeGameStateFresh: vi.fn(),
}));
vi.mock("@/lib/goal-completion", () => ({
  completeGoalCore: vi.fn(),
  reopenGoalCore: vi.fn(),
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
  BODY_METRIC_BY_KEY: new Map(),
  BODY_METRICS: [],
  resolveBodyMetric: vi.fn().mockReturnValue(null),
  resolveTemplateTargets: vi.fn().mockReturnValue([]),
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
  renderCompletionCard: vi.fn(),
}));

// ── Imports (after all vi.mock calls) ─────────────────────────────────────────
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "@/lib/mcp/tools";

// ── Minimal fake McpServer that captures handlers by tool name ────────────────
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolCallback = (args: Record<string, unknown>) => Promise<ToolResult>;

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

const fakeServer = new FakeMcpServer();
registerAll(fakeServer as unknown as McpServer);
const logNote = fakeServer.getHandler("log_note");

function parsePayload(result: ToolResult): Record<string, unknown> {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("log_note × withWriteReceipt (registered handler, mocked db)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("same requestId twice → ONE underlying create; second response replays the first verbatim", async () => {
    const args = { body: "PR on pull-ups", type: "journal", requestId: "11111111-aaaa-bbbb-cccc-000000000001" };

    const first = parsePayload(await logNote(args));
    const second = parsePayload(await logNote(args));

    // exactly one write hit the db
    expect(mockNoteCreate).toHaveBeenCalledTimes(1);
    // one receipt stored, for this key + tool
    expect(receiptCreate).toHaveBeenCalledTimes(1);
    expect(receiptCreate.mock.calls[0]![0].data).toMatchObject({
      requestId: args.requestId,
      toolName: "log_note",
    });

    // identical result both times, modulo the replay marker
    expect(first).toEqual({ id: "note-1", message: "Note logged" });
    expect(second).toEqual({ ...first, replayed: true });
  });

  it("no requestId → two calls produce two writes and zero receipts (non-idempotent behavior preserved)", async () => {
    const args = { body: "no key, no dedupe", type: "journal" };

    const first = parsePayload(await logNote(args));
    const second = parsePayload(await logNote(args));

    expect(mockNoteCreate).toHaveBeenCalledTimes(2);
    expect(receiptFindFirst).not.toHaveBeenCalled();
    expect(receiptCreate).not.toHaveBeenCalled();
    expect(first.replayed).toBeUndefined();
    expect(second.replayed).toBeUndefined();
    expect(first.id).not.toBe(second.id); // genuinely two rows
  });

  it("different requestIds → two writes, two receipts (only an EXACT key match replays)", async () => {
    const first = parsePayload(
      await logNote({ body: "note A", type: "journal", requestId: "key-A" }),
    );
    const second = parsePayload(
      await logNote({ body: "note B", type: "journal", requestId: "key-B" }),
    );

    expect(mockNoteCreate).toHaveBeenCalledTimes(2);
    expect(receiptCreate).toHaveBeenCalledTimes(2);
    expect(first.id).not.toBe(second.id);
    expect(second.replayed).toBeUndefined();
  });

  it("failed write is not receipted — the same key can retry for real", async () => {
    mockNoteCreate.mockRejectedValueOnce(new Error("db hiccup"));

    const errored = await logNote({ body: "flaky", type: "journal", requestId: "key-retry" });
    expect(errored.isError).toBe(true);
    expect(receiptCreate).not.toHaveBeenCalled();

    // legitimate retry with the SAME key now succeeds and receipts normally
    const retried = parsePayload(await logNote({ body: "flaky", type: "journal", requestId: "key-retry" }));
    expect(retried.replayed).toBeUndefined();
    expect(receiptCreate).toHaveBeenCalledTimes(1);
  });
});
