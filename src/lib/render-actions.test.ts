// src/lib/render-actions.test.ts
//
// #298 — queueRenderJob's goal resolution (the (goalId, date) unique key):
// the ROTATION-OWNING goal under a Program; zero-Program tenants keep the
// legacy focus-goal default (resolved inside getRotationOwnerGoal's legacy
// branch) with the legacy error copy byte-identical. UPSERT mechanics
// themselves are unchanged and covered by the existing tool-side flows.
//
// House convention: vi.mock("@/lib/db") (only getDb is imported here);
// next/cache mocked like day-log-actions.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { mockGetDb, mockGetRotationOwnerGoal } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetRotationOwnerGoal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mockGetDb }));
vi.mock("@/lib/program", () => ({ getRotationOwnerGoal: mockGetRotationOwnerGoal }));

import { queueRenderJob } from "@/lib/render-actions";

function mkDb() {
  const db = {
    dayRenderJob: {
      findUnique: vi.fn(async () => null as unknown),
      update: vi.fn(async () => ({})),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "job-1",
        ...data,
      })),
    },
  };
  mockGetDb.mockResolvedValue(db);
  return db;
}

function form(dateKey = "2026-08-15", clipforgeProjectId = "cf-1"): FormData {
  const f = new FormData();
  f.set("dateKey", dateKey);
  f.set("clipforgeProjectId", clipforgeProjectId);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queueRenderJob — #298 rotation-owner goal resolution", () => {
  it("Program tenant: the job is keyed to the rotation-owning goal", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "program",
      goalId: "g-owner",
      goalKind: "fitness",
      planId: "plan-rot",
    });

    const res = await queueRenderJob(form());

    expect(res.message).toBe("Render job queued.");
    expect(db.dayRenderJob.findUnique).toHaveBeenCalledWith({
      where: { goalId_date: { goalId: "g-owner", date: expect.any(Date) } },
    });
    expect(db.dayRenderJob.create.mock.calls[0]![0].data.goalId).toBe("g-owner");
  });

  it("Program tenant with NO rotation owner: throws the Program-specific guidance (never a silent focus regression)", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "program",
      goalId: null,
      goalKind: null,
      planId: null,
    });

    await expect(queueRenderJob(form())).rejects.toThrow(/no rotation plan/i);
    expect(db.dayRenderJob.create).not.toHaveBeenCalled();
  });

  it("zero-Program tenant: the legacy focus goal keys the job (byte-identical resolution)", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "legacy",
      goalId: "g-focus",
      goalKind: "fitness",
      planId: null,
    });

    await queueRenderJob(form());

    expect(db.dayRenderJob.create.mock.calls[0]![0].data.goalId).toBe("g-focus");
  });

  it("zero-Program tenant with no focus goal: the legacy error copy is unchanged", async () => {
    mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "legacy",
      goalId: null,
      goalKind: null,
      planId: null,
    });

    await expect(queueRenderJob(form())).rejects.toThrow(
      "No focus goal is set. Ask your coach to set a focus goal first.",
    );
  });
});
