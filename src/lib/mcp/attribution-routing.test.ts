// src/lib/mcp/attribution-routing.test.ts
//
// #308/#309 — the two attribution write-sites that live INSIDE tools.ts /
// project-tools.ts handler closures (logNutritionCore is module-private;
// log_metric creates its LogEntry inline) fire the auto-link hooks with the
// right client + args. Real registrations run against the FakeMcpServer
// (delete-tools-routing.test.ts idiom); the hooks are spied via a partial
// module mock — their BEHAVIOR is covered by attribution-hooks.test.ts, this
// file proves the ROUTING:
//   - log_metric      → mirrorActivityGoalLink(db, { log_entry, goalId, date })
//   - a hook failure is swallowed (the logged activity still succeeds).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAutoLinkNutrition, mockMirrorActivityGoalLink, mockGetDb } = vi.hoisted(() => ({
  mockAutoLinkNutrition: vi.fn(),
  mockMirrorActivityGoalLink: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: mockGetDb,
  prisma: {},
  injectUserId: (_m: string, _o: string, args: unknown) => args,
  forUser: vi.fn(),
}));

vi.mock("@/lib/attribution-hooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/attribution-hooks")>(
    "@/lib/attribution-hooks",
  );
  return {
    ...actual,
    autoLinkNutrition: mockAutoLinkNutrition,
    mirrorActivityGoalLink: mockMirrorActivityGoalLink,
  };
});

// Heavy/native leaves not exercised here (same set delete-tools-routing cuts).
vi.mock("@/lib/mcp/tools/github-tools", () => ({ registerGitHubTools: vi.fn() }));
vi.mock("@/lib/mcp/tools/render-tools", () => ({ registerRenderTools: vi.fn() }));
vi.mock("@/lib/recap-render", () => ({
  renderRecapCard: vi.fn(),
  renderCompletionCard: vi.fn(),
}));

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "@/lib/mcp/tools";

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

function payload(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ text: string }]; isError?: boolean };
  expect(r.isError ?? false).toBe(false);
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

// ── Fake clients ──────────────────────────────────────────────────────────────

function makeDb() {
  const tx = {
    nutritionLog: {
      create: vi.fn(async ({ data }: { data: { date: Date } }) => ({
        id: "n-tx",
        date: data.date,
      })),
    },
  };
  const db = {
    nutritionLog: {
      create: vi.fn(async ({ data }: { data: { date: Date } }) => ({
        id: "n-single",
        date: data.date,
      })),
    },
    logEntry: {
      create: vi.fn(async ({ data }: { data: { goalId: string; date: Date } }) => ({
        id: "e-created",
        goalId: data.goalId,
        metric: "mrr",
        value: 1200,
        text: null,
        date: data.date,
        source: "manual",
      })),
    },
    goal: {
      findUnique: vi.fn(async () => ({ id: "g-aws", kind: "project" })),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  mockGetDb.mockResolvedValue(db);
  return { db, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAutoLinkNutrition.mockResolvedValue([]);
  mockMirrorActivityGoalLink.mockResolvedValue([]);
});

// ── log_metric ────────────────────────────────────────────────────────────────

describe("log_metric → mirrorActivityGoalLink", () => {
  it("mirrors the created LogEntry's goalId with activityType log_entry", async () => {
    const { db } = makeDb();

    const res = await fakeServer.getHandler("log_metric")({
      goalId: "g-aws",
      metric: "mrr",
      value: 1200,
      date: "2026-08-10",
    });

    expect(payload(res).id).toBe("e-created");
    expect(mockMirrorActivityGoalLink).toHaveBeenCalledTimes(1);
    const [writer, args] = mockMirrorActivityGoalLink.mock.calls[0]!;
    expect(writer).toBe(db);
    expect(args).toEqual({
      activityType: "log_entry",
      activityId: "e-created",
      goalId: "g-aws",
      date: expect.any(Date),
    });
  });

  it("a hook failure is swallowed — the metric still logs", async () => {
    makeDb();
    mockMirrorActivityGoalLink.mockRejectedValueOnce(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await fakeServer.getHandler("log_metric")({
      goalId: "g-aws",
      metric: "mrr",
      value: 900,
    });

    expect(payload(res).id).toBe("e-created");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
