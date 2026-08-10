// src/lib/progress-program.test.ts
// Pure-helper coverage for the #292 /progress Program extension. The
// zero-Program regression contract lives here: nonMemberGoals(goals, null)
// must return the INPUT ARRAY REFERENCE so the legacy readiness loop renders
// byte-identically for tenants without a Program. DB mocked per the repo's
// compare.test.ts convention (the module's transitive imports touch @/lib/db).

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn().mockResolvedValue({}),
}));

import {
  claimFromBreakdown,
  groupMetricRows,
  nonMemberGoals,
  resolveProgressPrimaryGoals,
  PROGRESS_SERIES_MAX_POINTS,
  PROGRESS_SERIES_BATCH_SIZE,
} from "@/lib/progress-program";
import type { TargetProgress } from "@/lib/readiness";
import type { GoalTarget } from "@/lib/goal-targets";

function target(overrides: Partial<GoalTarget> = {}): GoalTarget {
  return {
    metric: "baseline:Pull-Up Max Reps",
    label: "Pull-up max reps",
    units: "reps",
    direction: "increase",
    target: 25,
    weight: 0.1,
    ...overrides,
  } as GoalTarget;
}

function bd(overrides: Partial<TargetProgress> = {}): TargetProgress {
  return {
    target: target(),
    current: 25,
    start: 25,
    progress: 1,
    ...overrides,
  };
}

describe("nonMemberGoals — the zero-Program byte-identical contract", () => {
  const goals = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("memberIds === null (no active Program) returns the SAME array reference untouched", () => {
    const out = nonMemberGoals(goals, null);
    expect(out).toBe(goals); // reference equality — not a copy
  });

  it("filters member goals out, preserving order of the rest", () => {
    const out = nonMemberGoals(goals, ["b"]);
    expect(out).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("empty member list keeps all goals (filtered copy)", () => {
    const out = nonMemberGoals(goals, []);
    expect(out).toEqual(goals);
  });
});

// ─── #301: resolveProgressPrimaryGoals — the page's single-goal gates ────────

describe("resolveProgressPrimaryGoals (#301 — rotation owner / legacy focus)", () => {
  const mk = (id: string, kind = "fitness", isFocus = false) => ({ id, kind, isFocus });
  const PROGRAM = (goalId: string | null) => ({ mode: "program" as const, goalId });
  const LEGACY = { mode: "legacy" as const, goalId: null };

  it("program mode: the rotation owner is the primary goal; no first-goal fallback", () => {
    const goals = [mk("g-other"), mk("g-owner")];
    const out = resolveProgressPrimaryGoals(goals, PROGRAM("g-owner"));
    expect(out.primaryGoal?.id).toBe("g-owner");
    expect(out.primaryProjectGoal).toBeNull(); // fitness owner → no project gates
  });

  it("program mode: a project-kind rotation owner also drives the project gates", () => {
    const goals = [mk("g-fit"), mk("g-aws", "project")];
    const out = resolveProgressPrimaryGoals(goals, PROGRAM("g-aws"));
    expect(out.primaryGoal?.id).toBe("g-aws");
    expect(out.primaryProjectGoal?.id).toBe("g-aws");
  });

  it("program mode with NO rotation owner: both null — gates stay off (never an arbitrary member)", () => {
    const goals = [mk("g-a"), mk("g-b")];
    const out = resolveProgressPrimaryGoals(goals, PROGRAM(null));
    expect(out.primaryGoal).toBeNull();
    expect(out.primaryProjectGoal).toBeNull();
  });

  it("program mode: an owner whose goal is not in the active list resolves null (paused owner)", () => {
    const out = resolveProgressPrimaryGoals([mk("g-a")], PROGRAM("g-gone"));
    expect(out.primaryGoal).toBeNull();
  });

  it("legacy mode: byte-identical derivations — find(isFocus) ?? first ?? null, and find(isFocus && project)", () => {
    const focusProject = mk("g-proj", "project", true);
    const goals = [mk("g-a"), focusProject, mk("g-b")];
    const out = resolveProgressPrimaryGoals(goals, LEGACY);
    expect(out.primaryGoal?.id).toBe("g-proj");
    expect(out.primaryProjectGoal?.id).toBe("g-proj");

    // No focus flag anywhere → first active goal wins the weight gate,
    // project gates stay off — exactly the pre-#301 expressions.
    const noFocus = resolveProgressPrimaryGoals([mk("g-a"), mk("g-b", "project")], LEGACY);
    expect(noFocus.primaryGoal?.id).toBe("g-a");
    expect(noFocus.primaryProjectGoal).toBeNull();

    // Empty list → null (unchanged).
    expect(resolveProgressPrimaryGoals([], LEGACY).primaryGoal).toBeNull();
  });

  it("dedupe property: a member rotation owner renders ONCE — excluded from the legacy loop, picked as primary", () => {
    // The page pipeline: memberGoalIds → nonMemberGoals() strips members from
    // the legacy readiness loop, while the owner still drives the gates.
    const activeGoals = [mk("g-owner"), mk("g-member"), mk("g-solo")];
    const memberGoalIds = ["g-owner", "g-member"];

    const legacyLoopGoals = nonMemberGoals(activeGoals, memberGoalIds);
    const { primaryGoal } = resolveProgressPrimaryGoals(activeGoals, PROGRAM("g-owner"));

    expect(primaryGoal?.id).toBe("g-owner");
    // The owner is NOT double-rendered: it is absent from the legacy loop
    // (it lives in ProgramReadinessSection's member arcs)…
    expect(legacyLoopGoals.map((g) => g.id)).toEqual(["g-solo"]);
    // …i.e. exactly one of the two render surfaces carries it.
    const inMemberSection = memberGoalIds.includes("g-owner");
    const inLegacyLoop = legacyLoopGoals.some((g) => g.id === "g-owner");
    expect(inMemberSection).toBe(true);
    expect(inLegacyLoop).toBe(false);
  });

  it("dedupe property (defensive edge): an owner OUTSIDE the membership renders once too — via the legacy loop only", () => {
    const activeGoals = [mk("g-owner-detached"), mk("g-member")];
    const legacyLoopGoals = nonMemberGoals(activeGoals, ["g-member"]);
    expect(legacyLoopGoals.map((g) => g.id)).toEqual(["g-owner-detached"]);
  });
});

describe("claimFromBreakdown", () => {
  it("maintenance = start === target (the cliff case)", () => {
    expect(claimFromBreakdown("g", "Handstand", bd()).maintenance).toBe(true);
    expect(
      claimFromBreakdown("g", "Handstand", bd({ start: 20 })).maintenance,
    ).toBe(false);
    expect(
      claimFromBreakdown("g", "Handstand", bd({ start: null })).maintenance,
    ).toBe(false);
  });

  it("carries weight/direction/gating through for the stakes copy", () => {
    const c = claimFromBreakdown(
      "g",
      "Body comp",
      bd({ target: target({ weight: 0.15, gating: true, direction: "decrease" }) }),
    );
    expect(c.weight).toBe(0.15);
    expect(c.gating).toBe(true);
    expect(c.direction).toBe("decrease");
  });
});

describe("groupMetricRows — DISTINCT metric across member goals", () => {
  it("a metric shared by two goals yields ONE row with two claims and two target lines", () => {
    const rows = groupMetricRows([
      { goalId: "g-hand", objective: "Handstand", breakdown: [bd()] },
      {
        goalId: "g-cut",
        objective: "Body comp",
        breakdown: [bd({ target: target({ weight: 0.15 }) })],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].claims.map((c) => c.goalId)).toEqual(["g-hand", "g-cut"]);
    expect(rows[0].targetLines).toEqual([
      { value: 25, label: "Handstand" },
      { value: 25, label: "Body comp" },
    ]);
  });

  it("distinct metrics get their own rows in first-seen member order", () => {
    const rows = groupMetricRows([
      {
        goalId: "g-hand",
        objective: "Handstand",
        breakdown: [
          bd(),
          bd({ target: target({ metric: "baseline:Wall Handstand Hold", label: "Hold" }) }),
        ],
      },
      {
        goalId: "g-cut",
        objective: "Body comp",
        breakdown: [bd({ target: target({ metric: "weightLb", label: "Weight", units: "lb" }) })],
      },
    ]);
    expect(rows.map((r) => r.metricKey)).toEqual([
      "baseline:Pull-Up Max Reps",
      "baseline:Wall Handstand Hold",
      "weightLb",
    ]);
  });

  it("registry metrics resolve label/units from METRIC_BY_ID (weightLb → Body weight, lb)", () => {
    const rows = groupMetricRows([
      {
        goalId: "g-cut",
        objective: "Body comp",
        breakdown: [bd({ target: target({ metric: "weightLb", label: "custom", units: "x" }) })],
      },
    ]);
    expect(rows[0].label).toBe("Body weight");
    expect(rows[0].units).toBe("lb");
  });
});

describe("sampling knobs (UXR-PV-52)", () => {
  it("maxPoints 26 within the researched [20–52] band; batchSize 4 within [3–4]", () => {
    expect(PROGRESS_SERIES_MAX_POINTS).toBe(26);
    expect(PROGRESS_SERIES_BATCH_SIZE).toBe(4);
  });
});
