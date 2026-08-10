// src/lib/hike-core.test.ts
//
// #298 — logHikeCore's DEFAULT attribution (what a null/omitted goalId means):
//   - Program tenant: the ROTATION-OWNING goal when it is fitness; else the
//     single active fitness member if exactly one; else (>1 fitness member,
//     no fitness rotation owner) the default is AMBIGUOUS and new attribution
//     writes are REJECTED with a friendly "pass goalId" error — never a
//     silent misattribution. Finalize-in-place is exempt (the planned row's
//     stored goalId stays authoritative). A Program with zero fitness
//     members keeps the legacy focus fallback (goal-focus.ts).
//   - Zero-Program tenant: byte-identical legacy behavior — null means
//     "focus goal at read time", resolved inside getRotationOwnerGoal's
//     legacy branch.
//
// House convention: vi.mock("@/lib/db") dual-export. @/lib/program and
// @/lib/goal-focus are module-mocked (their own contracts live in
// program.test.ts / the goal-focus readers); attribution-hooks is stubbed —
// the mirror matrix lives in attribution-hooks.test.ts and the end-to-end
// wiring in attribution-wiring.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockGetRotationOwnerGoal, mockGetMembership, mockGetFocusGoal, mockMirror } =
  vi.hoisted(() => ({
    mockGetDb: vi.fn(),
    mockGetRotationOwnerGoal: vi.fn(),
    mockGetMembership: vi.fn(),
    mockGetFocusGoal: vi.fn(),
    mockMirror: vi.fn(async () => undefined),
  }));

vi.mock("@/lib/db", () => ({ prisma: {}, getDb: mockGetDb }));
vi.mock("@/lib/program", () => ({
  getRotationOwnerGoal: mockGetRotationOwnerGoal,
  getActiveProgramMembership: mockGetMembership,
}));
vi.mock("@/lib/goal-focus", () => ({ getFocusGoal: mockGetFocusGoal }));
vi.mock("@/lib/attribution-hooks", () => ({
  mirrorActivityGoalLink: mockMirror,
  swallowAutoLinkError: () => () => undefined,
}));

import { logHikeCore } from "@/lib/hike-core";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const HIKE_INPUT = {
  date: new Date("2026-08-15T15:00:00Z"),
  route: "Mirror Lake",
  distanceMi: 8,
  elevationFt: 1800,
  durationMin: 240,
};

function membership(memberGoals: { id: string; kind: string; status: string }[]) {
  return {
    id: "prog-1",
    name: "Phase 2A",
    status: "active",
    startedOn: new Date("2026-08-01T06:00:00Z"),
    endsOn: null,
    notes: null,
    attributionRules: null,
    memberGoals: memberGoals.map((g) => ({ objective: g.id, ...g })),
  };
}

function mkDb() {
  const db = {
    goal: {
      findFirst: vi.fn(async () => null as unknown),
      findUnique: vi.fn(async () => null as unknown),
    },
    hike: {
      findFirst: vi.fn(async () => null as unknown),
      findUnique: vi.fn(async () => null as unknown),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "h-created",
        ...data,
      })),
      update: vi.fn(),
    },
  };
  mockGetDb.mockResolvedValue(db);
  return db;
}

const PROGRAM_OWNER_FITNESS = {
  mode: "program" as const,
  goalId: "g-owner",
  goalKind: "fitness",
  planId: "plan-rot",
};
const PROGRAM_NO_OWNER = {
  mode: "program" as const,
  goalId: null,
  goalKind: null,
  planId: null,
};
const LEGACY = (goalId: string | null) => ({
  mode: "legacy" as const,
  goalId,
  goalKind: goalId ? "fitness" : null,
  planId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockMirror.mockResolvedValue(undefined);
});

// ── Zero-Program tenants: byte-identical legacy behavior ────────────────────

describe("logHikeCore default attribution — zero-Program tenants (legacy, byte-identical)", () => {
  it("no goalId → the legacy focus goal id (from the seam's legacy branch), membership never probed", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(LEGACY("g-focus"));

    await logHikeCore(HIKE_INPUT);

    expect(db.hike.create).toHaveBeenCalledTimes(1);
    expect(db.hike.create.mock.calls[0]![0].data.goalId).toBe("g-focus");
    expect(mockGetMembership).not.toHaveBeenCalled();
    expect(mockGetFocusGoal).not.toHaveBeenCalled();
  });

  it("no goalId, no focus goal → null attribution (unchanged legacy shape)", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(LEGACY(null));

    const res = await logHikeCore(HIKE_INPUT);

    expect(res.id).toBe("h-created");
    expect(db.hike.create.mock.calls[0]![0].data.goalId).toBeNull();
  });
});

// ── Program tenants: rotation-owner default + the ambiguity ladder ──────────

describe("logHikeCore default attribution — Program tenants (#298)", () => {
  it("fitness rotation owner → the owner is the default; no membership probe, no focus fallback", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(PROGRAM_OWNER_FITNESS);

    await logHikeCore(HIKE_INPUT);

    expect(db.hike.create.mock.calls[0]![0].data.goalId).toBe("g-owner");
    expect(mockGetMembership).not.toHaveBeenCalled();
    expect(mockGetFocusGoal).not.toHaveBeenCalled();
  });

  it("no rotation owner + exactly ONE active fitness member → that member is the default", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(PROGRAM_NO_OWNER);
    mockGetMembership.mockResolvedValue(
      membership([
        { id: "g-hike", kind: "fitness", status: "active" },
        { id: "g-aws", kind: "project", status: "active" },
        { id: "g-old", kind: "fitness", status: "achieved" }, // non-active: not a candidate
      ]),
    );

    await logHikeCore(HIKE_INPUT);

    expect(db.hike.create.mock.calls[0]![0].data.goalId).toBe("g-hike");
    expect(mockGetFocusGoal).not.toHaveBeenCalled();
  });

  it("no rotation owner + MULTIPLE active fitness members → rejects with the friendly pass-goalId error; nothing written", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(PROGRAM_NO_OWNER);
    mockGetMembership.mockResolvedValue(
      membership([
        { id: "g-cut", kind: "fitness", status: "active" },
        { id: "g-handstand", kind: "fitness", status: "active" },
      ]),
    );

    await expect(logHikeCore(HIKE_INPUT)).rejects.toThrow(
      /multiple fitness member goals.*pass goalId/i,
    );
    expect(db.hike.create).not.toHaveBeenCalled();
    expect(db.hike.update).not.toHaveBeenCalled();
  });

  it("ambiguous default + EXPLICIT goalId → no error; the explicit goal wins (validated as before)", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(PROGRAM_NO_OWNER);
    mockGetMembership.mockResolvedValue(
      membership([
        { id: "g-cut", kind: "fitness", status: "active" },
        { id: "g-handstand", kind: "fitness", status: "active" },
      ]),
    );
    db.goal.findUnique.mockResolvedValue({ id: "g-cut", active: true });

    const res = await logHikeCore({ ...HIKE_INPUT, goalId: "g-cut" });

    expect(res.id).toBe("h-created");
    expect(db.hike.create.mock.calls[0]![0].data.goalId).toBe("g-cut");
  });

  it("ambiguous default + finalize-in-place (replacesPlannedHikeId) → no error; the stored goalId stays authoritative and the mirror degrades to it", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(PROGRAM_NO_OWNER);
    mockGetMembership.mockResolvedValue(
      membership([
        { id: "g-cut", kind: "fitness", status: "active" },
        { id: "g-handstand", kind: "fitness", status: "active" },
      ]),
    );
    db.hike.findUnique.mockResolvedValue({
      id: "h-planned",
      status: "planned",
      goalId: "g-cut",
      date: HIKE_INPUT.date,
    });
    db.hike.update.mockResolvedValue({
      id: "h-planned",
      status: "completed",
      goalId: "g-cut",
      date: HIKE_INPUT.date,
    });

    const res = await logHikeCore({ ...HIKE_INPUT, replacesPlannedHikeId: "h-planned" });

    expect(res.finalized).toBe(true);
    expect(mockMirror).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ activityId: "h-planned", goalId: "g-cut" }),
    );
  });

  it("Program with ZERO fitness members (pure-project shape) → legacy focus fallback via getFocusGoal", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(PROGRAM_NO_OWNER);
    mockGetMembership.mockResolvedValue(
      membership([{ id: "g-aws", kind: "project", status: "active" }]),
    );
    mockGetFocusGoal.mockResolvedValue({ id: "g-legacy-focus" });

    await logHikeCore(HIKE_INPUT);

    expect(db.hike.create.mock.calls[0]![0].data.goalId).toBe("g-legacy-focus");
  });

  it("planned-dedup null-attribution match keys off the NEW default: resolved==default widens the match to legacy null rows", async () => {
    const db = mkDb();
    mockGetRotationOwnerGoal.mockResolvedValue(PROGRAM_OWNER_FITNESS);

    await logHikeCore({ ...HIKE_INPUT, status: "planned" });

    // The idempotency probe ran with the OR-null widening because the
    // resolved goal IS the default (rotation owner).
    expect(db.hike.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "planned",
          OR: [{ goalId: "g-owner" }, { goalId: null }],
        }),
      }),
    );
  });
});
