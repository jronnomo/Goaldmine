// src/lib/mcp/render-tools.test.ts
//
// #298 — queue_render_job's default goalId resolution: the ROTATION-OWNING
// goal under a Program; zero-Program tenants keep the legacy focus default
// (resolved inside getRotationOwnerGoal's legacy branch) with the legacy
// error copy byte-identical. Explicit goalId is untouched.
//
// Harness: registerRenderTools against a minimal fake McpServer (the
// leaky-reads registerAll harness is overkill for one pack — render-tools is
// standalone and imports nothing from tools.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockGetRotationOwnerGoal } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetRotationOwnerGoal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {}, getDb: mockGetDb }));
vi.mock("@/lib/goal-focus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goal-focus")>()),
  getRotationOwnerGoal: mockGetRotationOwnerGoal,
}));

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRenderTools } from "@/lib/mcp/tools/render-tools";

// ── Fake server: capture handlers by tool name ───────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;
const tools = new Map<string, { meta: { description: string }; handler: ToolHandler }>();
registerRenderTools({
  registerTool: (name: string, meta: { description: string }, handler: ToolHandler) => {
    tools.set(name, { meta, handler });
  },
} as unknown as McpServer);

const queueRenderJob = tools.get("queue_render_job")!;

function mkDb() {
  const db = {
    goal: { findUnique: vi.fn(async () => null as unknown) },
    dayRenderJob: {
      findUnique: vi.fn(async () => null as unknown),
      update: vi.fn(),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "job-1",
        date: data.date,
        status: "pending",
      })),
    },
  };
  mockGetDb.mockResolvedValue(db);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queue_render_job — #298 default goal resolution", () => {
  it("tool description no longer sells the focus-goal default; it names the rotation owner", () => {
    expect(queueRenderJob.meta.description).toMatch(/rotation-owning goal/i);
    expect(queueRenderJob.meta.description).not.toMatch(/isFocus=true/);
  });

  it("Program tenant, goalId omitted → the rotation-owning goal keys the job", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "program",
      goalId: "g-owner",
      goalKind: "fitness",
      planId: "plan-rot",
    });

    const res = await queueRenderJob.handler({
      date: "2026-08-15",
      clipforgeProjectId: "cf-1",
    });

    expect(res.isError).not.toBe(true);
    expect(db.dayRenderJob.create.mock.calls[0]![0].data.goalId).toBe("g-owner");
    // Explicit-goalId validation path untouched — never consulted here.
    expect(db.goal.findUnique).not.toHaveBeenCalled();
  });

  it("Program tenant with NO rotation owner → error asks for an explicit goalId (no focus regression)", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "program",
      goalId: null,
      goalKind: null,
      planId: null,
    });

    const res = await queueRenderJob.handler({
      date: "2026-08-15",
      clipforgeProjectId: "cf-1",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/no rotation plan.*Pass goalId explicitly/i);
    expect(db.dayRenderJob.create).not.toHaveBeenCalled();
  });

  it("zero-Program tenant, goalId omitted → the legacy focus goal keys the job", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "legacy",
      goalId: "g-focus",
      goalKind: "fitness",
      planId: null,
    });

    await queueRenderJob.handler({ date: "2026-08-15", clipforgeProjectId: "cf-1" });

    expect(db.dayRenderJob.create.mock.calls[0]![0].data.goalId).toBe("g-focus");
  });

  it("zero-Program tenant, no focus goal → the legacy error copy is byte-identical", async () => {
    mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "legacy",
      goalId: null,
      goalKind: null,
      planId: null,
    });

    const res = await queueRenderJob.handler({
      date: "2026-08-15",
      clipforgeProjectId: "cf-1",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe(
      "Error: No focus goal is set. Pass goalId explicitly, or set a goal to focus with set_active_goal first.",
    );
  });

  it("explicit goalId short-circuits the seam entirely (validated as before)", async () => {
    const db = mkDb();
    db.goal.findUnique.mockResolvedValue({ id: "g-explicit" });

    const res = await queueRenderJob.handler({
      date: "2026-08-15",
      clipforgeProjectId: "cf-1",
      goalId: "g-explicit",
    });

    expect(res.isError).not.toBe(true);
    expect(mockGetRotationOwnerGoal).not.toHaveBeenCalled();
    expect(db.dayRenderJob.create.mock.calls[0]![0].data.goalId).toBe("g-explicit");
  });
});
