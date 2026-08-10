// src/lib/mcp/delete-tools-routing.test.ts
//
// #272 — MCP call sites route through the shared delete cores (the dashboard
// side is covered by src/lib/activity-delete-routing.test.ts). Real tools.ts
// and project-tools.ts registrations run against a FakeMcpServer (the
// leaky-reads.test.ts harness); the delete cores are spied via partial module
// mocks so each handler invocation proves BOTH the routing and the preserved
// response envelope (messages, orphanedOverrideWarning suffix, delete_metric's
// friendly not-found error).

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Core spies ────────────────────────────────────────────────────────────────
const {
  mockDeleteWorkoutCore,
  mockDeleteHikeCore,
  mockDeleteMeasurementCore,
  mockDeleteNutritionCore,
  mockDeleteBaselineCore,
  mockDeleteLogEntryCore,
  mockOrphanedOverrideWarning,
} = vi.hoisted(() => ({
  mockDeleteWorkoutCore: vi.fn(),
  mockDeleteHikeCore: vi.fn(),
  mockDeleteMeasurementCore: vi.fn(),
  mockDeleteNutritionCore: vi.fn(),
  mockDeleteBaselineCore: vi.fn(),
  mockDeleteLogEntryCore: vi.fn(),
  mockOrphanedOverrideWarning: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────
// Handlers under test never touch the db directly anymore; registration never
// does. A bare mock keeps the whole graph DB-free.
vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
  prisma: {},
  injectUserId: (_m: string, _o: string, args: unknown) => args,
  forUser: vi.fn(),
}));

// Partial mocks: keep the real schemas/functions registration needs, spy only
// the delete cores.
vi.mock("@/lib/workout-core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workout-core")>("@/lib/workout-core");
  return { ...actual, deleteWorkoutCore: mockDeleteWorkoutCore };
});
vi.mock("@/lib/hike-core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hike-core")>("@/lib/hike-core");
  return { ...actual, deleteHikeCore: mockDeleteHikeCore };
});
vi.mock("@/lib/override-integrity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/override-integrity")>("@/lib/override-integrity");
  return { ...actual, orphanedOverrideWarning: mockOrphanedOverrideWarning };
});
vi.mock("@/lib/measurement-core", () => ({ deleteMeasurementCore: mockDeleteMeasurementCore }));
vi.mock("@/lib/nutrition-core", () => ({ deleteNutritionCore: mockDeleteNutritionCore }));
vi.mock("@/lib/baseline-core", () => ({ deleteBaselineCore: mockDeleteBaselineCore }));
vi.mock("@/lib/log-entry-core", () => ({ deleteLogEntryCore: mockDeleteLogEntryCore }));

// Heavy/native leaves not exercised here (same set leaky-reads.test.ts cuts).
vi.mock("@/lib/mcp/tools/github-tools", () => ({ registerGitHubTools: vi.fn() }));
vi.mock("@/lib/mcp/tools/render-tools", () => ({ registerRenderTools: vi.fn() }));
vi.mock("@/lib/recap-render", () => ({
  renderRecapCard: vi.fn(),
  renderCompletionCard: vi.fn(),
}));

// ── Imports (after all vi.mock calls) ─────────────────────────────────────────
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "@/lib/mcp/tools";

// Minimal fake McpServer that captures handlers by tool name (leaky-reads idiom).
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

const fakeServer = new FakeMcpServer();
registerAll(fakeServer as unknown as McpServer);

/** Unwrap safe()'s jsonResult envelope. */
function payload(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ text: string }]; isError?: boolean };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

function errorText(result: unknown): string {
  const r = result as { content: [{ text: string }]; isError?: boolean };
  expect(r.isError).toBe(true);
  return r.content[0].text;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("delete_workout → deleteWorkoutCore", () => {
  it("routes through the core and preserves the response envelope", async () => {
    mockDeleteWorkoutCore.mockResolvedValue({ id: "w1" });

    const res = await fakeServer.getHandler("delete_workout")({ id: "w1" });

    expect(mockDeleteWorkoutCore).toHaveBeenCalledExactlyOnceWith("w1");
    expect(payload(res)).toEqual({ id: "w1", message: "Workout deleted" });
  });
});

describe("delete_hike → deleteHikeCore", () => {
  it("routes through the core; no stranded override → plain message", async () => {
    mockDeleteHikeCore.mockResolvedValue({ id: "h1", date: new Date("2026-07-04T12:00:00Z") });
    mockOrphanedOverrideWarning.mockResolvedValue(null);

    const res = await fakeServer.getHandler("delete_hike")({ id: "h1" });

    expect(mockDeleteHikeCore).toHaveBeenCalledExactlyOnceWith("h1");
    expect(payload(res)).toEqual({ id: "h1", message: "Hike deleted" });
  });

  it("appends the orphanedOverrideWarning using the core's pre-captured date", async () => {
    const date = new Date("2026-07-04T12:00:00Z");
    mockDeleteHikeCore.mockResolvedValue({ id: "h1", date });
    mockOrphanedOverrideWarning.mockResolvedValue("a mirror override on 2026-07-04 now points at nothing");

    const res = await fakeServer.getHandler("delete_hike")({ id: "h1" });

    expect(mockOrphanedOverrideWarning).toHaveBeenCalledWith(date);
    expect(payload(res).message).toBe(
      "Hike deleted — a mirror override on 2026-07-04 now points at nothing",
    );
  });
});

describe("delete_measurement → deleteMeasurementCore", () => {
  it("routes through the core and preserves the response envelope", async () => {
    mockDeleteMeasurementCore.mockResolvedValue({ id: "m1" });

    const res = await fakeServer.getHandler("delete_measurement")({ id: "m1" });

    expect(mockDeleteMeasurementCore).toHaveBeenCalledExactlyOnceWith("m1");
    expect(payload(res)).toEqual({ id: "m1", message: "Measurement deleted" });
  });
});

describe("delete_nutrition → deleteNutritionCore", () => {
  it("routes through the core and preserves the response envelope", async () => {
    mockDeleteNutritionCore.mockResolvedValue({ id: "n1", mealType: "lunch" });

    const res = await fakeServer.getHandler("delete_nutrition")({ id: "n1" });

    expect(mockDeleteNutritionCore).toHaveBeenCalledExactlyOnceWith("n1");
    expect(payload(res)).toEqual({ id: "n1", message: "Nutrition deleted" });
  });
});

describe("delete_baseline → deleteBaselineCore", () => {
  it("routes through the core (which owns the workout-sync side effect) and preserves the message", async () => {
    mockDeleteBaselineCore.mockResolvedValue({
      id: "b1",
      testName: "Max Pull-ups",
      date: new Date("2026-06-01T12:00:00Z"),
    });

    const res = await fakeServer.getHandler("delete_baseline")({ id: "b1" });

    expect(mockDeleteBaselineCore).toHaveBeenCalledExactlyOnceWith("b1");
    expect(payload(res)).toEqual({ id: "b1", message: "Baseline deleted (workout synced)" });
  });
});

describe("delete_metric (project-tools) → deleteLogEntryCore", () => {
  it("routes through the core and preserves the confirmation envelope", async () => {
    mockDeleteLogEntryCore.mockResolvedValue({ id: "e1", metric: "mrr", value: 1200 });

    const res = await fakeServer.getHandler("delete_metric")({ id: "e1" });

    expect(mockDeleteLogEntryCore).toHaveBeenCalledExactlyOnceWith("e1");
    expect(payload(res)).toEqual({
      id: "e1",
      metric: "mrr",
      value: 1200,
      deleted: true,
      message: "Metric entry deleted.",
    });
  });

  it("core null (P2025) maps to the exact friendly second-delete error", async () => {
    mockDeleteLogEntryCore.mockResolvedValue(null);

    const res = await fakeServer.getHandler("delete_metric")({ id: "gone-1" });

    expect(errorText(res)).toBe("Error: Log entry not found: gone-1");
  });
});
