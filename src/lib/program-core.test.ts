// src/lib/program-core.test.ts
//
// #310 (CRUD + status) — Program core behavior:
//   - createProgramCore: draft-only creation (status never passed), guards.
//   - updateProgramCore: true PATCH semantics (only supplied fields written),
//     attributionRules validation (local schema pending src/lib/attribution-rules.ts
//     consolidation), merged-window guard, no-op path performs no write.
//   - setProgramStatusCore: one-active-per-user enforcement — friendly error
//     NAMING the current active Program on the pre-check path AND on the
//     P2002 race path (program_one_active_per_user partial unique index);
//     same-status idempotent no-op.
//
// #311 (membership + overview):
//   - attachGoalToProgramCore: R9 achieved-goal rejection (with reopen hint),
//     membership ≠ tracking (the update writes programId ONLY — never
//     active/isFocus), same-program idempotent no-op, cross-Program move.
//   - detachGoalFromProgramCore: idempotent no-op when already unset.
//   - attachPlanToProgramCore: plan-goal-not-a-member rejection, no-op,
//     membership-checked move.
//   - getProgramOverviewCore: overview shape (hasActivePlan mapping,
//     rotationPlan pick, attributionRules), active-Program resolution when
//     programId is omitted, friendly no-active error.
//
// House convention (mirrors goal-core.test.ts / activity-delete-cores.test.ts):
// vi.mock("@/lib/db") with getDb resolving to a fake scoped client whose
// $transaction executes the callback with a distinct tx client.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mockGetDb, prisma: {} }));

import { Prisma } from "@/generated/prisma/client";
import {
  createProgramCore,
  updateProgramCore,
  setProgramStatusCore,
  attachGoalToProgramCore,
  detachGoalFromProgramCore,
  attachPlanToProgramCore,
  getProgramOverviewCore,
} from "@/lib/program-core";

function p2002(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

const PROGRAM_ROW = {
  id: "prog-1",
  name: "Fall Block",
  status: "draft",
  startedOn: new Date("2026-09-01T06:00:00.000Z"),
  endsOn: null as Date | null,
  notes: null as string | null,
  attributionRules: null as unknown,
  createdAt: new Date("2026-08-09T12:00:00.000Z"),
  updatedAt: new Date("2026-08-09T12:00:00.000Z"),
};

// ─────────────────────────────────────────────────────────────────────────────
// createProgramCore
// ─────────────────────────────────────────────────────────────────────────────

describe("createProgramCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = {
      program: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn(async (args: any) => ({ ...PROGRAM_ROW, ...args.data })),
      },
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("creates with the supplied fields and NEVER passes status (draft comes from the schema default)", async () => {
    const startedOn = new Date("2026-09-01T06:00:00.000Z");
    const endsOn = new Date("2026-12-01T07:00:00.000Z");
    await createProgramCore({ name: "  Fall Block  ", startedOn, endsOn, notes: "  base build  " });

    expect(fakeDb.program.create).toHaveBeenCalledOnce();
    const args = fakeDb.program.create.mock.calls[0][0];
    expect(args.data).toEqual({
      name: "Fall Block", // trimmed
      startedOn,
      endsOn,
      notes: "base build", // trimmed
    });
    expect(args.data.status).toBeUndefined(); // draft default — activation is set_program_status's job
    expect(args.select.userId).toBeUndefined(); // projection never selects userId
  });

  it("normalizes blank notes to null and omitted endsOn to null", async () => {
    await createProgramCore({ name: "P", startedOn: new Date("2026-09-01T06:00:00.000Z"), notes: "  " });
    const args = fakeDb.program.create.mock.calls[0][0];
    expect(args.data.notes).toBeNull();
    expect(args.data.endsOn).toBeNull();
  });

  it("rejects a blank name", async () => {
    await expect(
      createProgramCore({ name: "   ", startedOn: new Date("2026-09-01T06:00:00.000Z") }),
    ).rejects.toThrow("name required");
    expect(fakeDb.program.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid startedOn", async () => {
    await expect(
      createProgramCore({ name: "P", startedOn: new Date("garbage") }),
    ).rejects.toThrow("invalid startedOn");
  });

  it("rejects endsOn before startedOn", async () => {
    await expect(
      createProgramCore({
        name: "P",
        startedOn: new Date("2026-09-01T06:00:00.000Z"),
        endsOn: new Date("2026-08-01T06:00:00.000Z"),
      }),
    ).rejects.toThrow(/endsOn is before startedOn/);
    expect(fakeDb.program.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgramCore
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgramCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = {
      program: {
        findUnique: vi.fn(async () => ({ ...PROGRAM_ROW })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: vi.fn(async (args: any) => ({ ...PROGRAM_ROW, ...args.data })),
      },
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("round trip: writes ONLY the supplied fields (true PATCH)", async () => {
    const r = await updateProgramCore("prog-1", { name: "Renamed Block" });
    expect(fakeDb.program.update).toHaveBeenCalledOnce();
    const args = fakeDb.program.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "prog-1" });
    expect(args.data).toEqual({ name: "Renamed Block" }); // exactly one key — startedOn/endsOn/notes untouched
    expect(r.changed).toEqual(["name"]);
    expect(r.program.name).toBe("Renamed Block");
  });

  it("null clears endsOn / notes; attributionRules null becomes Prisma.JsonNull", async () => {
    fakeDb.program.findUnique.mockResolvedValue({
      ...PROGRAM_ROW,
      endsOn: new Date("2026-12-01T07:00:00.000Z"),
      notes: "old",
    });
    const r = await updateProgramCore("prog-1", { endsOn: null, notes: null, attributionRules: null });
    const args = fakeDb.program.update.mock.calls[0][0];
    expect(args.data.endsOn).toBeNull();
    expect(args.data.notes).toBeNull();
    expect(args.data.attributionRules).toBe(Prisma.JsonNull);
    expect(r.changed).toEqual(["endsOn", "notes", "attributionRules"]);
  });

  it("valid attributionRules pass through; invalid shape is rejected with a friendly error", async () => {
    const rules = [
      { match: { titleContains: ["hike"] }, goalIds: ["g1"], note: "hikes → g1" },
    ];
    await updateProgramCore("prog-1", { attributionRules: rules });
    expect(fakeDb.program.update.mock.calls[0][0].data.attributionRules).toEqual(rules);

    // empty match {} would match every activity — rejected
    await expect(
      updateProgramCore("prog-1", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attributionRules: [{ match: {}, goalIds: ["g1"] }] as any,
      }),
    ).rejects.toThrow(/attributionRules invalid/);

    // rule with zero goalIds is an authoring mistake — rejected
    await expect(
      updateProgramCore("prog-1", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attributionRules: [{ match: { source: "strong" }, goalIds: [] }] as any,
      }),
    ).rejects.toThrow(/attributionRules invalid/);
  });

  it("no-op call (no fields) returns the current row and performs NO write", async () => {
    const r = await updateProgramCore("prog-1", {});
    expect(r.changed).toEqual([]);
    expect(r.program.id).toBe("prog-1");
    expect(fakeDb.program.update).not.toHaveBeenCalled();
  });

  it("unknown id throws a friendly not-found", async () => {
    fakeDb.program.findUnique.mockResolvedValue(null);
    await expect(updateProgramCore("nope", { name: "X" })).rejects.toThrow(
      "Program not found: nope",
    );
  });

  it("merged-window guard: patching startedOn past the existing endsOn is rejected", async () => {
    fakeDb.program.findUnique.mockResolvedValue({
      ...PROGRAM_ROW,
      endsOn: new Date("2026-10-01T06:00:00.000Z"),
    });
    await expect(
      updateProgramCore("prog-1", { startedOn: new Date("2026-11-01T06:00:00.000Z") }),
    ).rejects.toThrow(/endsOn is before startedOn/);
    expect(fakeDb.program.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setProgramStatusCore — one-active enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("setProgramStatusCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = {
      program: {
        findUnique: vi.fn(async () => ({ id: "prog-2", name: "Winter Block", status: "draft" })),
        findFirst: vi.fn(async () => null),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: vi.fn(async (args: any) => ({ id: "prog-2", name: "Winter Block", status: args.data.status })),
      },
    };
    fakeDb = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (cb: any) => cb(tx)),
      program: { findFirst: vi.fn(async () => null) },
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("second activate (pre-check path): friendly error NAMING the current active Program; no update runs", async () => {
    tx.program.findFirst.mockResolvedValue({ id: "prog-1", name: "Fall Block" });
    await expect(setProgramStatusCore("prog-2", "active")).rejects.toThrow(
      /Program "Fall Block" \(prog-1\) is already active — only one Program can be active per user/,
    );
    expect(tx.program.update).not.toHaveBeenCalled();
    // pre-check excludes the program being activated (self-activate must stay legal)
    expect(tx.program.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "active", NOT: { id: "prog-2" } } }),
    );
  });

  it("second activate (P2002 race path): pre-check passes, update trips program_one_active_per_user → same friendly error naming the winner", async () => {
    tx.program.findFirst.mockResolvedValue(null); // race: winner commits after our pre-check
    tx.program.update.mockRejectedValue(p2002());
    fakeDb.program.findFirst.mockResolvedValue({ id: "prog-1", name: "Fall Block" }); // post-abort winner lookup
    await expect(setProgramStatusCore("prog-2", "active")).rejects.toThrow(
      /Program "Fall Block" \(prog-1\) is already active/,
    );
    expect(fakeDb.program.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "active", NOT: { id: "prog-2" } } }),
    );
  });

  it("P2002 race with an unnameable winner still produces a friendly one-active error (never a raw unique-violation)", async () => {
    tx.program.update.mockRejectedValue(p2002());
    fakeDb.program.findFirst.mockResolvedValue(null); // winner not visible (e.g. flipped again)
    await expect(setProgramStatusCore("prog-2", "active")).rejects.toThrow(
      /only one Program can be active per user/,
    );
  });

  it("activating when nothing else is active succeeds", async () => {
    const r = await setProgramStatusCore("prog-2", "active");
    expect(r).toEqual({
      id: "prog-2",
      name: "Winter Block",
      previousStatus: "draft",
      status: "active",
      changed: true,
    });
    expect(tx.program.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prog-2" }, data: { status: "active" } }),
    );
  });

  it("non-active transitions skip the one-active pre-check entirely", async () => {
    tx.program.findUnique.mockResolvedValue({ id: "prog-2", name: "Winter Block", status: "active" });
    const r = await setProgramStatusCore("prog-2", "archived");
    expect(r.changed).toBe(true);
    expect(r.previousStatus).toBe("active");
    expect(tx.program.findFirst).not.toHaveBeenCalled();
  });

  it("same-status call is an idempotent no-op (changed:false), not an error", async () => {
    tx.program.findUnique.mockResolvedValue({ id: "prog-2", name: "Winter Block", status: "archived" });
    const r = await setProgramStatusCore("prog-2", "archived");
    expect(r).toEqual({
      id: "prog-2",
      name: "Winter Block",
      previousStatus: "archived",
      status: "archived",
      changed: false,
    });
    expect(tx.program.update).not.toHaveBeenCalled();
  });

  it("unknown id throws a friendly not-found", async () => {
    tx.program.findUnique.mockResolvedValue(null);
    await expect(setProgramStatusCore("nope", "active")).rejects.toThrow("Program not found: nope");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// attachGoalToProgramCore (#311)
// ─────────────────────────────────────────────────────────────────────────────

describe("attachGoalToProgramCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = {
      goal: {
        findUnique: vi.fn(async () => ({
          id: "g1",
          objective: "Summit Mt. Elbert",
          status: "active",
          programId: null as string | null,
        })),
        update: vi.fn(async () => ({ id: "g1" })),
      },
      program: {
        findUnique: vi.fn(async () => ({ id: "prog-1", name: "Fall Block" })),
      },
    };
    mockGetDb.mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    });
  });

  it("R9: an achieved goal is rejected with the reopen hint; no write runs", async () => {
    tx.goal.findUnique.mockResolvedValue({
      id: "g1",
      objective: "Summit Mt. Elbert",
      status: "achieved",
      programId: null,
    });
    await expect(attachGoalToProgramCore("g1", "prog-1")).rejects.toThrow(
      /an achieved goal cannot be attached to a Program \(R9\)\. Reopen it first \(reopen_goal\)/,
    );
    expect(tx.goal.update).not.toHaveBeenCalled();
  });

  it("attaches an active goal: sets programId and NOTHING else (membership ≠ tracking)", async () => {
    const r = await attachGoalToProgramCore("g1", "prog-1");
    expect(tx.goal.update).toHaveBeenCalledOnce();
    const args = tx.goal.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "g1" });
    expect(args.data).toEqual({ programId: "prog-1" }); // exactly one key — active/isFocus untouched
    expect(r).toEqual({
      goalId: "g1",
      goalObjective: "Summit Mt. Elbert",
      programId: "prog-1",
      programName: "Fall Block",
      previousProgramId: null,
      changed: true,
    });
  });

  it("works for project-kind goals too (kind is never inspected — any non-achieved goal attaches)", async () => {
    tx.goal.findUnique.mockResolvedValue({
      id: "g2",
      objective: "Ship chewgether MVP",
      status: "active",
      programId: null,
    });
    const r = await attachGoalToProgramCore("g2", "prog-1");
    expect(r.changed).toBe(true);
    expect(tx.goal.update.mock.calls[0][0].data).toEqual({ programId: "prog-1" });
  });

  it("moving from another Program succeeds and reports previousProgramId", async () => {
    tx.goal.findUnique.mockResolvedValue({
      id: "g1",
      objective: "Summit Mt. Elbert",
      status: "active",
      programId: "prog-0",
    });
    const r = await attachGoalToProgramCore("g1", "prog-1");
    expect(r.changed).toBe(true);
    expect(r.previousProgramId).toBe("prog-0");
  });

  it("re-attaching to the same Program is an idempotent no-op (no write)", async () => {
    tx.goal.findUnique.mockResolvedValue({
      id: "g1",
      objective: "Summit Mt. Elbert",
      status: "active",
      programId: "prog-1",
    });
    const r = await attachGoalToProgramCore("g1", "prog-1");
    expect(r.changed).toBe(false);
    expect(tx.goal.update).not.toHaveBeenCalled();
  });

  it("friendly not-found for goal and for program", async () => {
    tx.goal.findUnique.mockResolvedValue(null);
    await expect(attachGoalToProgramCore("nope", "prog-1")).rejects.toThrow("Goal not found: nope");

    tx.goal.findUnique.mockResolvedValue({
      id: "g1",
      objective: "X",
      status: "active",
      programId: null,
    });
    tx.program.findUnique.mockResolvedValue(null);
    await expect(attachGoalToProgramCore("g1", "gone")).rejects.toThrow("Program not found: gone");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detachGoalFromProgramCore (#311)
// ─────────────────────────────────────────────────────────────────────────────

describe("detachGoalFromProgramCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = {
      goal: {
        findUnique: vi.fn(async () => ({
          id: "g1",
          objective: "Summit Mt. Elbert",
          programId: "prog-1" as string | null,
        })),
        update: vi.fn(async () => ({ id: "g1" })),
      },
    };
    mockGetDb.mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    });
  });

  it("clears programId and reports the previous membership", async () => {
    const r = await detachGoalFromProgramCore("g1");
    expect(tx.goal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "g1" }, data: { programId: null } }),
    );
    expect(r).toEqual({
      goalId: "g1",
      goalObjective: "Summit Mt. Elbert",
      previousProgramId: "prog-1",
      changed: true,
    });
  });

  it("idempotent: detaching a goal with no Program is a no-op success, NOT an error", async () => {
    tx.goal.findUnique.mockResolvedValue({
      id: "g1",
      objective: "Summit Mt. Elbert",
      programId: null,
    });
    const r = await detachGoalFromProgramCore("g1");
    expect(r).toEqual({
      goalId: "g1",
      goalObjective: "Summit Mt. Elbert",
      previousProgramId: null,
      changed: false,
    });
    expect(tx.goal.update).not.toHaveBeenCalled();
  });

  it("friendly not-found for an unknown goal", async () => {
    tx.goal.findUnique.mockResolvedValue(null);
    await expect(detachGoalFromProgramCore("nope")).rejects.toThrow("Goal not found: nope");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// attachPlanToProgramCore (#311)
// ─────────────────────────────────────────────────────────────────────────────

describe("attachPlanToProgramCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = {
      plan: {
        findUnique: vi.fn(async () => ({
          id: "p1",
          name: "Elbert — 12-week plan",
          goalId: "g1",
          programId: null as string | null,
        })),
        update: vi.fn(async () => ({ id: "p1" })),
      },
      program: {
        findUnique: vi.fn(async () => ({ id: "prog-1", name: "Fall Block" })),
      },
      goal: {
        findUnique: vi.fn(async () => ({
          id: "g1",
          objective: "Summit Mt. Elbert",
          programId: "prog-1" as string | null,
        })),
      },
    };
    mockGetDb.mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    });
  });

  it("rejects a plan whose goal is NOT a member of the Program (membership before content)", async () => {
    tx.goal.findUnique.mockResolvedValue({
      id: "g1",
      objective: "Summit Mt. Elbert",
      programId: null, // goal not attached
    });
    await expect(attachPlanToProgramCore("p1", "prog-1")).rejects.toThrow(
      /which is not a member of Program "Fall Block" — attach the goal first \(attach_goal_to_program\)/,
    );
    expect(tx.plan.update).not.toHaveBeenCalled();
  });

  it("attaches when the plan's goal is a member; writes programId only", async () => {
    const r = await attachPlanToProgramCore("p1", "prog-1");
    expect(tx.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" }, data: { programId: "prog-1" } }),
    );
    expect(r).toEqual({
      planId: "p1",
      planName: "Elbert — 12-week plan",
      goalId: "g1",
      programId: "prog-1",
      programName: "Fall Block",
      previousProgramId: null,
      changed: true,
    });
  });

  it("re-attaching the same plan to the same Program is an idempotent no-op", async () => {
    tx.plan.findUnique.mockResolvedValue({
      id: "p1",
      name: "Elbert — 12-week plan",
      goalId: "g1",
      programId: "prog-1",
    });
    const r = await attachPlanToProgramCore("p1", "prog-1");
    expect(r.changed).toBe(false);
    expect(tx.plan.update).not.toHaveBeenCalled();
  });

  it("friendly not-found for plan and for program", async () => {
    tx.plan.findUnique.mockResolvedValue(null);
    await expect(attachPlanToProgramCore("nope", "prog-1")).rejects.toThrow("Plan not found: nope");

    tx.plan.findUnique.mockResolvedValue({
      id: "p1",
      name: "P",
      goalId: "g1",
      programId: null,
    });
    tx.program.findUnique.mockResolvedValue(null);
    await expect(attachPlanToProgramCore("p1", "gone")).rejects.toThrow("Program not found: gone");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getProgramOverviewCore (#311)
// ─────────────────────────────────────────────────────────────────────────────

describe("getProgramOverviewCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;

  const RULES = [{ match: { titleContains: ["hike"] }, goalIds: ["g1"] }];

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = {
      program: {
        findUnique: vi.fn(async () => ({ ...PROGRAM_ROW, attributionRules: RULES })),
        findFirst: vi.fn(async () => ({ ...PROGRAM_ROW, status: "active", attributionRules: RULES })),
      },
      goal: {
        findMany: vi.fn(async () => [
          { id: "g1", objective: "Summit Mt. Elbert", kind: "fitness", status: "active", plans: [{ id: "p1" }] },
          { id: "g2", objective: "Ship chewgether MVP", kind: "project", status: "active", plans: [] },
        ]),
      },
      plan: {
        findFirst: vi.fn(async () => ({ id: "p1", name: "Elbert — 12-week plan", active: true })),
      },
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("omitted programId resolves the ACTIVE Program (status filter, never a raw findMany)", async () => {
    const r = await getProgramOverviewCore();
    expect(fakeDb.program.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "active" } }),
    );
    expect(fakeDb.program.findUnique).not.toHaveBeenCalled();
    expect(r.program.status).toBe("active");
  });

  it("explicit programId resolves via findUnique (draft/archived programs are inspectable)", async () => {
    const r = await getProgramOverviewCore("prog-1");
    expect(fakeDb.program.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prog-1" } }),
    );
    expect(fakeDb.program.findFirst).not.toHaveBeenCalled();
    expect(r.program.id).toBe("prog-1");
  });

  it("overview shape: memberGoals carry hasActivePlan (mapped from active-plan presence), rotationPlan and attributionRules surface", async () => {
    const r = await getProgramOverviewCore("prog-1");
    expect(r.memberGoals).toEqual([
      { id: "g1", objective: "Summit Mt. Elbert", kind: "fitness", status: "active", hasActivePlan: true },
      { id: "g2", objective: "Ship chewgether MVP", kind: "project", status: "active", hasActivePlan: false },
    ]);
    expect(r.rotationPlan).toEqual({ id: "p1", name: "Elbert — 12-week plan", active: true });
    expect(r.attributionRules).toEqual(RULES);

    // member query is scoped to this program and only asks for the active plan's id
    const goalArgs = fakeDb.goal.findMany.mock.calls[0][0];
    expect(goalArgs.where).toEqual({ programId: "prog-1" });
    expect(goalArgs.select.plans).toEqual({ where: { active: true }, select: { id: true }, take: 1 });

    // rotation plan: active preferred, else newest
    const planArgs = fakeDb.plan.findFirst.mock.calls[0][0];
    expect(planArgs.where).toEqual({ programId: "prog-1" });
    expect(planArgs.orderBy).toEqual([{ active: "desc" }, { createdAt: "desc" }]);
  });

  it("rotationPlan is null when no plan is attached; attributionRules null-normalized", async () => {
    fakeDb.plan.findFirst.mockResolvedValue(null);
    fakeDb.program.findUnique.mockResolvedValue({ ...PROGRAM_ROW, attributionRules: null });
    const r = await getProgramOverviewCore("prog-1");
    expect(r.rotationPlan).toBeNull();
    expect(r.attributionRules).toBeNull();
  });

  it("no active Program + omitted programId → friendly error pointing at create/activate", async () => {
    fakeDb.program.findFirst.mockResolvedValue(null);
    await expect(getProgramOverviewCore()).rejects.toThrow(
      /No active Program — pass programId explicitly, or create one \(create_program\)/,
    );
  });

  it("unknown explicit programId → friendly not-found", async () => {
    fakeDb.program.findUnique.mockResolvedValue(null);
    await expect(getProgramOverviewCore("nope")).rejects.toThrow("Program not found: nope");
  });
});
