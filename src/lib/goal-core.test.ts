// src/lib/goal-core.test.ts
// Regression tests for the kind-gated plan scaffolding (rhino.the.grey bug, 2026-06-18).
//
// Bug: createGoalCore / ensurePlanForGoalCore scaffolded a FITNESS program-template
// plan (baseline battery + phases) for ANY dated goal, regardless of kind — so a
// project goal (Instagram followers) got 24 default baseline markers bleeding onto
// the focus calendar. Fix: only kind === "fitness" scaffolds a plan.
//
// E4b-1 note: goal-core.ts was migrated from raw `prisma` to `getDb()` (ALS-scoped
// client). The mock now intercepts `getDb()` and returns a fake scoped client.
// The nested Goal→Plan create was also SPLIT: goal.create no longer nests plans;
// a separate tx.plan.create is called when needed. Assertions updated accordingly.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db — getDb() returns a fake scoped client configured per test.
// prisma is kept as an empty export so any stale import doesn't error; goal-core.ts
// no longer calls prisma.* directly after the E4b-1 migration.
vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));
// canonicalExerciseName is only invoked when attributionHints are present; passthrough.
vi.mock("@/lib/records", () => ({ canonicalExerciseName: (s: string) => s }));
// #280: goal-core imports setProgramStatusCore for the cross-Program shim —
// mocked so the shim tests assert the REUSE of set_program_status's mechanism
// without pulling program-core's real transaction logic.
vi.mock("@/lib/program-core", () => ({ setProgramStatusCore: vi.fn() }));

import {
  createGoalCore,
  ensurePlanForGoalCore,
  setFocusGoalCore,
  setFocusGoalProgramAwareCore,
} from "@/lib/goal-core";
import { getDb } from "@/lib/db";
import { setProgramStatusCore } from "@/lib/program-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

describe("createGoalCore — kind-gated plan scaffolding", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;
  // B7/G7: the scaffold default is Program-aware — the fake db carries a
  // program.findFirst. Default null = zero-Program tenant = legacy behavior,
  // so every pre-B7 test in this describe runs unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let programFindFirst: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedData = undefined;
    programFindFirst = vi.fn().mockResolvedValue(null);

    // tx is the transaction callback arg — must have both goal and plan ops after the split.
    txMock = {
      goal: {
        count: vi.fn().mockResolvedValue(1), // an existing focus goal → don't steal focus
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn().mockImplementation((args: any) => {
          capturedData = args.data;
          // E4b-1 split: goal.create no longer contains plans — plan is created separately.
          return { id: "g1" };
        }),
      },
      plan: {
        create: vi.fn().mockResolvedValue({ id: "p1" }),
      },
    };

    // getDb() returns a fake scoped client whose $transaction executes the callback with txMock.
    mockGetDb.mockResolvedValue({
      goal: { findUnique: vi.fn() }, // for copyFromGoalId path (not exercised in these tests)
      program: { findFirst: programFindFirst },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(txMock)),
    });
  });

  it("project goal WITH a target date scaffolds NO plan (the regression)", async () => {
    const r = await createGoalCore({
      objective: "Grow @rhino.the.grey to 100k",
      targetDate: new Date("2027-06-01"),
      kind: "project",
      targets: [],
    });
    expect(capturedData.plans).toBeUndefined(); // no fitness plan, no baseline battery
    expect(capturedData.kind).toBe("project");
    expect(r.planId).toBeNull();
    expect(r.scaffolded).toBe(false);
    expect(txMock.plan.create).not.toHaveBeenCalled();
  });

  it("fitness goal WITH a target date DOES scaffold a plan (coexistence preserved)", async () => {
    const r = await createGoalCore({
      objective: "Summit Mt. Elbert",
      targetDate: new Date("2027-06-01"),
      kind: "fitness",
      targets: [],
    });
    // After split: goal.create has no nested plans field; plan is created via tx.plan.create
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).toHaveBeenCalledOnce();
    expect(txMock.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ goalId: "g1" }) }),
    );
    expect(r.planId).toBe("p1");
    expect(r.scaffolded).toBe(true);
  });

  it("kind defaults to fitness when omitted (back-compat — still scaffolds with a date)", async () => {
    await createGoalCore({ objective: "x", targetDate: new Date("2027-06-01"), targets: [] });
    expect(capturedData.kind).toBe("fitness");
    // After split: plans are not nested in goal.create; plan.create is called separately
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).toHaveBeenCalledOnce();
  });

  it("project goal WITHOUT a date scaffolds no plan", async () => {
    await createGoalCore({ objective: "someday", targetDate: null, kind: "project", targets: [] });
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).not.toHaveBeenCalled();
  });

  it("fitness goal WITHOUT a date scaffolds no plan (someday)", async () => {
    await createGoalCore({ objective: "someday-fit", targetDate: null, kind: "fitness", targets: [] });
    expect(capturedData.plans).toBeUndefined();
    expect(txMock.plan.create).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B7/G7 (integration gate — examples/goaldmine-integration-blockers.md §1):
  // "Create a non-hike dated goal → no Elbert-flavored baseline battery is
  // auto-stamped." Scaffolding is Program-aware + opt-in: an ACTIVE Program
  // suppresses the auto-scaffold (the Program owns the rotation); zero-Program
  // tenants keep the legacy scaffold byte-identical; scaffoldPlan overrides
  // both defaults; the someday/kind hard gates are NOT overridable.
  // ───────────────────────────────────────────────────────────────────────────
  describe("Program-aware scaffold default + scaffoldPlan override (B7/G7)", () => {
    it("active-Program tenant: dated fitness goal scaffolds NOTHING (scaffolded:false, planId null)", async () => {
      programFindFirst.mockResolvedValue({ id: "prog-2A" });

      const r = await createGoalCore({
        objective: "Freestanding handstand",
        targetDate: new Date("2027-06-01"),
        kind: "fitness",
        targets: [],
      });

      expect(txMock.plan.create).not.toHaveBeenCalled(); // no Elbert battery stamped
      expect(r.planId).toBeNull();
      expect(r.scaffolded).toBe(false);
      // the default consulted the tenant's ACTIVE Program (scoped client)
      expect(programFindFirst).toHaveBeenCalledWith({
        where: { status: "active" },
        select: { id: true },
      });
      // the goal itself is still created normally
      expect(capturedData.objective).toBe("Freestanding handstand");
    });

    it("zero-Program tenant: legacy scaffold unchanged — generic template pinned by name/weeks", async () => {
      // 70 days out ⇒ weeksBetween ceils to exactly 10 weeks.
      const target = new Date(Date.now() + 70 * 24 * 60 * 60 * 1000);

      const r = await createGoalCore({
        objective: "Summit Mt. Elbert",
        targetDate: target,
        kind: "fitness",
        targets: [],
      });

      expect(r.scaffolded).toBe(true);
      expect(r.planId).toBe("p1");
      expect(txMock.plan.create).toHaveBeenCalledOnce();
      const planData = txMock.plan.create.mock.calls[0][0].data;
      // Pin the legacy scaffold exactly: name/weeks/active + the generic
      // program template (THE Elbert-flavored one) + the initial revision.
      expect(planData.goalId).toBe("g1");
      expect(planData.name).toBe("Summit Mt. Elbert — 10-week plan");
      expect(planData.weeks).toBe(10);
      expect(planData.active).toBe(true);
      expect(planData.endsOn).toBe(target);
      expect(planData.planJson.name).toBe("Mt. Elbert + Shred 90-Day");
      expect(planData.planJson.totalWeeks).toBe(10);
      expect(planData.planJson.phases).toHaveLength(3);
      expect(planData.revisions.create.triggerSource).toBe("manual");
      expect(planData.revisions.create.summary).toBe("Initial plan from program template");
    });

    it("scaffoldPlan:true under an active Program forces the scaffold (and skips the Program lookup)", async () => {
      programFindFirst.mockResolvedValue({ id: "prog-2A" });

      const r = await createGoalCore({
        objective: "Bench 225",
        targetDate: new Date("2027-06-01"),
        kind: "fitness",
        targets: [],
        scaffoldPlan: true,
      });

      expect(txMock.plan.create).toHaveBeenCalledOnce();
      expect(r.planId).toBe("p1");
      expect(r.scaffolded).toBe(true);
      // explicit override never consults Program state
      expect(programFindFirst).not.toHaveBeenCalled();
    });

    it("scaffoldPlan:false for a zero-Program (legacy) tenant suppresses the scaffold", async () => {
      const r = await createGoalCore({
        objective: "Couch to 5k",
        targetDate: new Date("2027-06-01"),
        kind: "fitness",
        targets: [],
        scaffoldPlan: false,
      });

      expect(txMock.plan.create).not.toHaveBeenCalled();
      expect(r.planId).toBeNull();
      expect(r.scaffolded).toBe(false);
      expect(programFindFirst).not.toHaveBeenCalled();
    });

    it("scaffoldPlan:true cannot override the kind hard gate — dated project goal still scaffolds nothing", async () => {
      const r = await createGoalCore({
        objective: "Ship the app",
        targetDate: new Date("2027-06-01"),
        kind: "project",
        targets: [],
        scaffoldPlan: true,
      });

      expect(txMock.plan.create).not.toHaveBeenCalled();
      expect(r.scaffolded).toBe(false);
      expect(programFindFirst).not.toHaveBeenCalled(); // ineligible → no lookup either
    });

    it("scaffoldPlan:true cannot override the someday hard gate — dateless fitness goal still scaffolds nothing", async () => {
      const r = await createGoalCore({
        objective: "someday-forced",
        targetDate: null,
        kind: "fitness",
        targets: [],
        scaffoldPlan: true,
      });

      expect(txMock.plan.create).not.toHaveBeenCalled();
      expect(r.scaffolded).toBe(false);
      expect(programFindFirst).not.toHaveBeenCalled();
    });

    it("Program rows exist but none ACTIVE (retired) → still the legacy scaffold path", async () => {
      // findFirst({ status: "active" }) returns null for a retired-Program
      // tenant — same as zero rows. The default must scaffold.
      programFindFirst.mockResolvedValue(null);

      const r = await createGoalCore({
        objective: "Post-season rebuild",
        targetDate: new Date("2027-06-01"),
        kind: "fitness",
        targets: [],
      });

      expect(txMock.plan.create).toHaveBeenCalledOnce();
      expect(r.scaffolded).toBe(true);
    });
  });
});

describe("ensurePlanForGoalCore — kind gate (dated-upgrade path)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = {
      goal: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("non-fitness goal returns no plan and never opens a transaction", async () => {
    fakeDb.goal.findUnique.mockResolvedValue({ kind: "project" });
    const r = await ensurePlanForGoalCore("g1", new Date("2027-06-01"));
    expect(r).toEqual({ planId: null, created: false });
    expect(fakeDb.$transaction).not.toHaveBeenCalled(); // short-circuits before scaffolding
  });

  it("missing goal throws", async () => {
    fakeDb.goal.findUnique.mockResolvedValue(null);
    await expect(ensurePlanForGoalCore("missing", new Date("2027-06-01"))).rejects.toThrow();
  });
});

// REQ-006 (goal completion ceremony): a completed goal is archived by
// completeGoalCore (isFocus=false, active=false, plans deactivated) —
// setFocusGoalCore must refuse to re-focus it until reopen_goal restores it.
describe("setFocusGoalCore — refuses achieved goals", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    txMock = {
      goal: {
        findUnique: vi.fn().mockResolvedValue({
          id: "g1",
          kind: "fitness",
          objective: "Summit Mt. Elbert",
          status: "achieved",
        }),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      plan: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    };
    fakeDb = {
      goal: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("throws a reopen-first error and never touches isFocus/active", async () => {
    await expect(setFocusGoalCore("g1")).rejects.toThrow(/reopen it first|reopen_goal/i);
    expect(txMock.goal.updateMany).not.toHaveBeenCalled();
    expect(txMock.goal.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setFocusGoalProgramAwareCore (#280 — the set_active_goal Program shim)
//
// The fake db serves BOTH the shim's own reads (program.findFirst,
// program.count, goal.findUnique with the program join) and the inner
// setFocusGoalCore call (goal.findFirst for old focus + $transaction).
// setProgramStatusCore is mocked (see the vi.mock above) — the shim must
// REUSE set_program_status's mechanism, so the assertion is on the calls.
// ─────────────────────────────────────────────────────────────────────────────
describe("setFocusGoalProgramAwareCore — Program blast-radius shim (#280)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;

  const TARGET_BASE = {
    id: "g-target",
    kind: "fitness",
    objective: "Handstand",
    status: "active",
  };

  function wire({
    activeProgram = null,
    target = null,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activeProgram?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target?: any;
  }) {
    txMock = {
      goal: {
        // inner setFocusGoalCore re-reads the target inside its transaction
        findUnique: vi.fn().mockResolvedValue({ ...TARGET_BASE }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      plan: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    };
    fakeDb = {
      program: {
        findFirst: vi.fn().mockResolvedValue(activeProgram),
      },
      goal: {
        // shim's target lookup (with program join) AND inner core's old-focus
        // findFirst
        findUnique: vi.fn().mockResolvedValue(target),
        findFirst: vi.fn().mockResolvedValue({ id: "g-old-focus" }),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
    };
    mockGetDb.mockResolvedValue(fakeDb);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setProgramStatusCore).mockResolvedValue({
      id: "x",
      name: "x",
      previousStatus: "active",
      status: "archived",
      changed: true,
    });
  });

  it("no active Program (zero rows OR retired): legacy focus switch, Program state untouched", async () => {
    wire({ activeProgram: null });

    const r = await setFocusGoalProgramAwareCore("g-target");

    expect(setProgramStatusCore).not.toHaveBeenCalled();
    expect(r.program).toEqual({ action: "none" });
    expect(r.goal.id).toBe("g-target");
    expect(r.previousFocusGoalId).toBe("g-old-focus");
    // the legacy core actually ran (isFocus cleared + set)
    expect(txMock.goal.updateMany).toHaveBeenCalledWith({ data: { isFocus: false } });
    expect(txMock.goal.update).toHaveBeenCalledWith({
      where: { id: "g-target" },
      data: { isFocus: true, active: true },
    });
    // the shim's target pre-read is skipped entirely on the legacy path
    expect(fakeDb.goal.findUnique).not.toHaveBeenCalled();
  });

  it("same-Program switch: focus moves, Program.status untouched", async () => {
    wire({
      activeProgram: { id: "prog-A", name: "Phase 2A" },
      target: { ...TARGET_BASE, programId: "prog-A", program: { id: "prog-A", name: "Phase 2A" } },
    });

    const r = await setFocusGoalProgramAwareCore("g-target");

    expect(setProgramStatusCore).not.toHaveBeenCalled();
    expect(r.program).toEqual({ action: "none" });
    expect(txMock.goal.update).toHaveBeenCalled(); // focus write happened
  });

  it("Program-less target while a Program is active: focus moves, Program untouched, warning attached", async () => {
    wire({
      activeProgram: { id: "prog-A", name: "Phase 2A" },
      target: { ...TARGET_BASE, programId: null, program: null },
    });

    const r = await setFocusGoalProgramAwareCore("g-target");

    expect(setProgramStatusCore).not.toHaveBeenCalled();
    expect(r.program.action).toBe("none");
    expect(r.program.warning).toMatch(/still owns the day's rotation/);
    expect(r.program.warning).toContain("Phase 2A");
  });

  it("cross-Program switch WITHOUT confirmProgramSwitch: refused with an error naming BOTH Programs, nothing written", async () => {
    wire({
      activeProgram: { id: "prog-A", name: "Phase 2A" },
      target: { ...TARGET_BASE, programId: "prog-B", program: { id: "prog-B", name: "Winter Block" } },
    });

    await expect(setFocusGoalProgramAwareCore("g-target")).rejects.toThrow(
      /Phase 2A[\s\S]*Winter Block|Winter Block[\s\S]*Phase 2A/,
    );
    expect(setProgramStatusCore).not.toHaveBeenCalled();
    expect(fakeDb.$transaction).not.toHaveBeenCalled(); // focus untouched too
  });

  it("cross-Program switch WITH confirmProgramSwitch: archives the current Program, activates the target's (set_program_status mechanism, in order), then focuses", async () => {
    wire({
      activeProgram: { id: "prog-A", name: "Phase 2A" },
      target: { ...TARGET_BASE, programId: "prog-B", program: { id: "prog-B", name: "Winter Block" } },
    });

    const r = await setFocusGoalProgramAwareCore("g-target", { confirmProgramSwitch: true });

    expect(vi.mocked(setProgramStatusCore).mock.calls).toEqual([
      ["prog-A", "archived"], // archive first — one-active index forbids activate-first
      ["prog-B", "active"],
    ]);
    expect(r.program).toEqual({
      action: "switched",
      previousProgram: { id: "prog-A", name: "Phase 2A", status: "archived" },
      activatedProgram: { id: "prog-B", name: "Winter Block" },
    });
    expect(txMock.goal.update).toHaveBeenCalledWith({
      where: { id: "g-target" },
      data: { isFocus: true, active: true },
    });
  });

  it("achieved target: refused BEFORE any Program write (the archive-then-discover trap)", async () => {
    wire({
      activeProgram: { id: "prog-A", name: "Phase 2A" },
      target: { ...TARGET_BASE, status: "achieved", programId: "prog-B", program: { id: "prog-B", name: "Winter Block" } },
    });

    await expect(
      setFocusGoalProgramAwareCore("g-target", { confirmProgramSwitch: true }),
    ).rejects.toThrow(/reopen it first|reopen_goal/i);
    expect(setProgramStatusCore).not.toHaveBeenCalled();
  });

  it("unknown target goal: clean error, no Program writes", async () => {
    wire({
      activeProgram: { id: "prog-A", name: "Phase 2A" },
      target: null,
    });

    await expect(setFocusGoalProgramAwareCore("g-missing")).rejects.toThrow(
      "Goal not found: g-missing",
    );
    expect(setProgramStatusCore).not.toHaveBeenCalled();
  });
});
