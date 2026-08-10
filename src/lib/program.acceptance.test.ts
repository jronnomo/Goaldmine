// src/lib/program.acceptance.test.ts
//
// #281 — Backend acceptance slice for the Program-first seam (#277), pulled
// forward from Sprint 5 so the riskiest sprint of the redesign ships with its
// own regression net. Asserts RAW getActiveProgram() / getActiveProgramMembership()
// output ONLY — deliberately NOT get_today_plan/get_day/get_week/
// get_session_brief payload shapes (those merges are Sprint 5 scope; asserting
// payload visibility here would violate the sprint boundary).
//
// House convention: vi.mock("@/lib/db") dual-export (prisma + getDb), matching
// program.test.ts / db.scoped.test.ts — no new fixture style. The scoped-db
// stub here is ROUTING-FAITHFUL: plan/program/goal accessors run real
// where/orderBy filtering over in-memory fixture rows, so these tests exercise
// SELECTION against data shapes, not hand-wired per-call mock returns. A
// future Sprint 5 dev extends the fixtures (add payload-layer assertions on
// top) without rewriting them.
//
// The five scenarios (issue #281 ACs + the retired-Program boundary from
// #277's AC):
//   1. Founder "Phase 2A"  — active Program, three member goals, one owns the
//      rotation via an attached active Plan.
//   2. chewgether          — active Program, one project member goal, ZERO
//      Plan rows anywhere.
//   3. Critique Critical#1 — active Program + plan-less member goal + an
//      unrelated DORMANT active:true Plan outside the Program (the
//      founding-bug regression).
//   4. Zero Program rows   — legacy isFocus-tiebreak path, byte-identical
//      (the per-tenant rollout gate).
//   5. Programs all archived — null via the Program-aware path (retirement
//      never regresses to isFocus behavior).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import { getDb } from "@/lib/db";
import { getActiveProgram, getActiveProgramMembership } from "@/lib/program";
import { parseDateKey } from "@/lib/calendar";
import type { ProgramTemplate } from "@/lib/program-template";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

// ─── Routing-faithful in-memory fixture db ──────────────────────────────────

type ProgramRow = {
  id: string;
  name: string;
  status: string;
  startedOn: Date;
  endsOn: Date | null;
  notes: string | null;
  attributionRules: unknown;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};

type GoalRow = {
  id: string;
  objective: string;
  kind: string;
  status: string;
  isFocus: boolean;
  programId: string | null;
  userId: string;
  createdAt: Date;
};

type PlanRow = {
  id: string;
  name: string;
  startedOn: Date;
  planJson: ProgramTemplate;
  confirmedThroughDate: Date | null;
  active: boolean;
  programId: string | null;
  updatedAt: Date;
  goal: { isFocus: boolean };
};

type Fixture = {
  programs: ProgramRow[];
  goals: GoalRow[];
  plans: PlanRow[];
};

/**
 * Builds the getDb()-shaped scoped stub over fixture rows. Each accessor
 * applies the ACTUAL where/orderBy the code under test passes — a query the
 * production DB would answer differently fails here too (e.g. an unscoped
 * `plan.findFirst({ active: true })` finds scenario 3's dormant plan exactly
 * like Postgres would — which is the whole point of that regression test).
 */
function mkFixtureDb(fixture: Fixture) {
  const planFindFirst = vi.fn().mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => {
      const where = args?.where ?? {};
      let rows = fixture.plans;
      if (where.active !== undefined) rows = rows.filter((r) => r.active === where.active);
      if (where.programId !== undefined) rows = rows.filter((r) => r.programId === where.programId);
      const orderBy = Array.isArray(args?.orderBy)
        ? args.orderBy
        : args?.orderBy
          ? [args.orderBy]
          : [];
      const sorted = [...rows].sort((a, b) => {
        for (const clause of orderBy) {
          if (clause?.goal?.isFocus === "desc" && a.goal.isFocus !== b.goal.isFocus) {
            return a.goal.isFocus ? -1 : 1;
          }
          if (clause?.updatedAt === "desc") {
            const d = b.updatedAt.getTime() - a.updatedAt.getTime();
            if (d !== 0) return d;
          }
        }
        return 0;
      });
      return sorted[0] ?? null;
    },
  );

  const db = {
    program: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const where = args?.where ?? {};
        const rows =
          where.status !== undefined
            ? fixture.programs.filter((r) => r.status === where.status)
            : fixture.programs;
        return rows[0] ?? null;
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count: vi.fn().mockImplementation(async (args: any) => {
        const where = args?.where ?? {};
        const rows =
          where.status !== undefined
            ? fixture.programs.filter((r) => r.status === where.status)
            : fixture.programs;
        return rows.length;
      }),
    },
    goal: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn().mockImplementation(async (args: any) => {
        let rows = fixture.goals;
        if (args?.where?.programId !== undefined) {
          rows = rows.filter((g) => g.programId === args.where.programId);
        }
        const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (args?.select) {
          return sorted.map((g) =>
            Object.fromEntries(
              Object.keys(args.select)
                .filter((k) => args.select[k])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((k) => [k, (g as any)[k]]),
            ),
          );
        }
        return sorted;
      }),
    },
    plan: { findFirst: planFindFirst },
  };
  return { db, planFindFirst };
}

function template(totalWeeks: number): ProgramTemplate {
  return { totalWeeks } as unknown as ProgramTemplate;
}

const USER = "usr_founder";
const T0 = new Date("2026-08-01T00:00:00Z");

// ─── Scenario 1: Founder Phase 2A ───────────────────────────────────────────

const PHASE2A_RULES = [
  {
    match: { titleContains: ["incline walk"] },
    goalIds: ["goal-cut", "goal-aws"],
    note: "Monday Z2 walk doubles as AWS audio time and advances the cut",
  },
];

function phase2aFixture(): Fixture {
  const programId = "prog-phase2a";
  return {
    programs: [
      {
        id: programId,
        name: "Phase 2A — handstand + cut + AWS",
        status: "active",
        startedOn: parseDateKey("2026-08-18"),
        endsOn: parseDateKey("2026-12-28"),
        notes: "Handstand owns the rotation; cut + AWS ride along.",
        attributionRules: PHASE2A_RULES,
        userId: USER,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    goals: [
      {
        id: "goal-handstand",
        objective: "Freestanding handstand, 10s hold",
        kind: "fitness",
        status: "active",
        isFocus: true,
        programId,
        userId: USER,
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: "goal-cut",
        objective: "10% body fat",
        kind: "fitness",
        status: "active",
        isFocus: false,
        programId,
        userId: USER,
        createdAt: new Date("2026-08-02T00:00:00Z"),
      },
      {
        id: "goal-aws",
        objective: "AWS SAA certification",
        kind: "project",
        status: "active",
        isFocus: false,
        programId,
        userId: USER,
        createdAt: new Date("2026-08-03T00:00:00Z"),
      },
    ],
    plans: [
      // The rotation document — attached to the Program via Plan.programId
      // (the backfill invariant: Goal.programId alone is NOT enough).
      {
        id: "plan-handstand-rotation",
        name: "Phase 2A rotation",
        startedOn: parseDateKey("2026-08-18"),
        planJson: template(19),
        confirmedThroughDate: null,
        active: true,
        programId,
        updatedAt: new Date("2026-08-18T00:00:00Z"),
        goal: { isFocus: true },
      },
      // Elbert's retired plan still exists in history — inactive, outside the
      // Program. Must never surface.
      {
        id: "plan-elbert-retired",
        name: "Mt. Elbert build",
        startedOn: parseDateKey("2026-05-01"),
        planJson: template(14),
        confirmedThroughDate: parseDateKey("2026-08-08"),
        active: false,
        programId: null,
        updatedAt: new Date("2026-08-09T00:00:00Z"),
        goal: { isFocus: false },
      },
    ],
  };
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("#281 acceptance — scenario 1: founder Phase 2A (active Program, three member goals, one owns the rotation)", () => {
  it("getActiveProgram() returns the handstand goal's Plan snapshot — .id is that PLAN's id, never the Program's", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(phase2aFixture()).db);

    const result = await getActiveProgram();

    expect(result).toEqual({
      id: "plan-handstand-rotation",
      name: "Phase 2A rotation",
      startedOn: parseDateKey("2026-08-18"),
      template: template(19),
      confirmedThroughDate: null,
    });
    // The frozen contract, stated positively: a Plan id (downstream
    // PlanDayOverride lookups key on it) — not prog-phase2a.
    expect(result?.id).not.toBe("prog-phase2a");
  });

  it("getActiveProgramMembership() lists ALL THREE member goals (rotation owner + plan-less members alike) under the Program's own id", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(phase2aFixture()).db);

    const membership = await getActiveProgramMembership();

    expect(membership).toEqual({
      id: "prog-phase2a",
      name: "Phase 2A — handstand + cut + AWS",
      status: "active",
      startedOn: parseDateKey("2026-08-18"),
      endsOn: parseDateKey("2026-12-28"),
      notes: "Handstand owns the rotation; cut + AWS ride along.",
      attributionRules: PHASE2A_RULES,
      memberGoals: [
        {
          id: "goal-handstand",
          objective: "Freestanding handstand, 10s hold",
          kind: "fitness",
          status: "active",
        },
        { id: "goal-cut", objective: "10% body fat", kind: "fitness", status: "active" },
        { id: "goal-aws", objective: "AWS SAA certification", kind: "project", status: "active" },
      ],
    });
    // Tenant hygiene: the raw rows carry userId; the membership shape never does.
    expect(membership && "userId" in membership).toBe(false);
  });
});

describe("#281 acceptance — scenario 2: chewgether (active Program, one project member goal, ZERO Plan rows anywhere)", () => {
  const chewgetherFixture = (): Fixture => ({
    programs: [
      {
        id: "prog-chewgether",
        name: "chewgether $1k/mo",
        status: "active",
        startedOn: parseDateKey("2026-09-01"),
        endsOn: null,
        notes: null,
        attributionRules: null,
        userId: USER,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    goals: [
      {
        id: "goal-chewgether",
        objective: "chewgether to $1k MRR",
        kind: "project",
        status: "active",
        isFocus: false,
        programId: "prog-chewgether",
        userId: USER,
        createdAt: T0,
      },
    ],
    plans: [], // the defining trait: no Plan has ever existed for this user
  });

  it("getActiveProgram() returns null ('no rotation today') — no error, no isFocus fall-through", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(chewgetherFixture()).db);

    await expect(getActiveProgram()).resolves.toBeNull();
  });

  it("getActiveProgramMembership() STILL returns the Program shape with its member goal listed", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(chewgetherFixture()).db);

    const membership = await getActiveProgramMembership();

    expect(membership).toEqual({
      id: "prog-chewgether",
      name: "chewgether $1k/mo",
      status: "active",
      startedOn: parseDateKey("2026-09-01"),
      endsOn: null,
      notes: null,
      attributionRules: null,
      memberGoals: [
        {
          id: "goal-chewgether",
          objective: "chewgether to $1k MRR",
          kind: "project",
          status: "active",
        },
      ],
    });
  });
});

describe("#281 acceptance — scenario 3: plan-critique Critical #1 regression (dormant unrelated active Plan must never surface)", () => {
  // Active Program with a plan-less member goal, PLUS an unrelated goal that
  // owns a dormant active:true Plan OUTSIDE the Program. Made maximally
  // vicious: the unrelated goal is isFocus:true, so the pre-#277 legacy query
  // would have picked its plan FIRST. Multiple active:true Plans across goals
  // is the normal steady state (goal-core keeps them active per-goal) — the
  // founding bug was exactly this fall-through.
  const critical1Fixture = (): Fixture => ({
    programs: [
      {
        id: "prog-solo-project",
        name: "Pure project block",
        status: "active",
        startedOn: parseDateKey("2026-09-01"),
        endsOn: null,
        notes: null,
        attributionRules: null,
        userId: USER,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    goals: [
      {
        id: "goal-member-project",
        objective: "Ship the thing",
        kind: "project",
        status: "active",
        isFocus: false,
        programId: "prog-solo-project",
        userId: USER,
        createdAt: T0,
      },
      {
        id: "goal-unrelated-fitness",
        objective: "Old fitness goal, paused",
        kind: "fitness",
        status: "active",
        isFocus: true, // legacy query would rank this plan first — the trap
        programId: null,
        userId: USER,
        createdAt: T0,
      },
    ],
    plans: [
      {
        id: "plan-dormant-unrelated",
        name: "Dormant rotation",
        startedOn: parseDateKey("2026-06-01"),
        planJson: template(12),
        confirmedThroughDate: null,
        active: true, // active flag still set — dormant, not deactivated
        programId: null, // NOT attached to the Program
        updatedAt: new Date("2026-07-15T00:00:00Z"),
        goal: { isFocus: true },
      },
    ],
  });

  it("getActiveProgram() returns null — the dormant Plan never becomes 'the day', and every plan query is programId-scoped", async () => {
    const { db, planFindFirst } = mkFixtureDb(critical1Fixture());
    mockGetDb.mockResolvedValue(db);

    const result = await getActiveProgram();

    expect(result).toBeNull();
    // The teeth: the fixture db WOULD have returned plan-dormant-unrelated to
    // any unscoped { active: true } query (exactly like Postgres). Prove no
    // such query was ever issued.
    expect(planFindFirst).toHaveBeenCalled();
    for (const call of planFindFirst.mock.calls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((call[0] as any)?.where?.programId).toBe("prog-solo-project");
    }
  });

  it("getActiveProgramMembership() still returns the Program with its plan-less member goal (membership ≠ rotation)", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(critical1Fixture()).db);

    const membership = await getActiveProgramMembership();

    expect(membership?.id).toBe("prog-solo-project");
    expect(membership?.memberGoals).toEqual([
      { id: "goal-member-project", objective: "Ship the thing", kind: "project", status: "active" },
    ]);
  });
});

describe("#281 acceptance — scenario 4: zero Program rows (per-tenant rollout gate — legacy isFocus tiebreak unchanged)", () => {
  // Pre-Program tenant with TWO active plans: the focus goal's (updated
  // earlier) and a non-focus goal's (updated later). Legacy semantics pick
  // the FOCUS plan — isFocus desc outranks updatedAt desc. If the seam ever
  // reordered or altered the legacy branch, the fresher non-focus plan would
  // win and this fails.
  const legacyTenantFixture = (): Fixture => ({
    programs: [], // never adopted Programs
    goals: [
      {
        id: "goal-legacy-focus",
        objective: "Legacy focus goal",
        kind: "fitness",
        status: "active",
        isFocus: true,
        programId: null,
        userId: "usr_legacy",
        createdAt: T0,
      },
      {
        id: "goal-legacy-other",
        objective: "Legacy secondary goal",
        kind: "fitness",
        status: "active",
        isFocus: false,
        programId: null,
        userId: "usr_legacy",
        createdAt: T0,
      },
    ],
    plans: [
      {
        id: "plan-legacy-focus",
        name: "Focus goal plan",
        startedOn: parseDateKey("2026-07-01"),
        planJson: template(8),
        confirmedThroughDate: parseDateKey("2026-07-20"),
        active: true,
        programId: null,
        updatedAt: new Date("2026-07-01T00:00:00Z"), // OLDER update
        goal: { isFocus: true },
      },
      {
        id: "plan-legacy-fresher",
        name: "Non-focus goal plan",
        startedOn: parseDateKey("2026-07-10"),
        planJson: template(6),
        confirmedThroughDate: null,
        active: true,
        programId: null,
        updatedAt: new Date("2026-08-01T00:00:00Z"), // NEWER update — must still lose
        goal: { isFocus: false },
      },
    ],
  });

  it("getActiveProgram() resolves via the legacy path: focus goal's plan wins exactly as pre-#277", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(legacyTenantFixture()).db);

    const result = await getActiveProgram();

    expect(result).toEqual({
      id: "plan-legacy-focus",
      name: "Focus goal plan",
      startedOn: parseDateKey("2026-07-01"),
      template: template(8),
      confirmedThroughDate: parseDateKey("2026-07-20"),
    });
  });

  it("getActiveProgramMembership() is null for a pre-Program tenant (no Program, no membership)", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(legacyTenantFixture()).db);

    await expect(getActiveProgramMembership()).resolves.toBeNull();
  });
});

describe("#281 acceptance — scenario 5: Programs exist but ALL archived/completed (retired user never regresses to isFocus behavior)", () => {
  const retiredFixture = (): Fixture => ({
    programs: [
      {
        id: "prog-done",
        name: "Finished block",
        status: "completed",
        startedOn: parseDateKey("2026-03-01"),
        endsOn: parseDateKey("2026-06-01"),
        notes: null,
        attributionRules: null,
        userId: USER,
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: "prog-shelved",
        name: "Shelved block",
        status: "archived",
        startedOn: parseDateKey("2026-06-15"),
        endsOn: null,
        notes: null,
        attributionRules: null,
        userId: USER,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    goals: [],
    plans: [
      // A leftover active:true plan that the LEGACY query would happily pick.
      {
        id: "plan-leftover",
        name: "Leftover rotation",
        startedOn: parseDateKey("2026-03-01"),
        planJson: template(12),
        confirmedThroughDate: null,
        active: true,
        programId: null,
        updatedAt: T0,
        goal: { isFocus: true },
      },
    ],
  });

  it("getActiveProgram() returns null via the Program-aware path — the plan table is never even queried", async () => {
    const { db, planFindFirst } = mkFixtureDb(retiredFixture());
    mockGetDb.mockResolvedValue(db);

    const result = await getActiveProgram();

    expect(result).toBeNull();
    expect(planFindFirst).not.toHaveBeenCalled();
  });

  it("getActiveProgramMembership() is null (no ACTIVE Program)", async () => {
    mockGetDb.mockResolvedValue(mkFixtureDb(retiredFixture()).db);

    await expect(getActiveProgramMembership()).resolves.toBeNull();
  });
});
