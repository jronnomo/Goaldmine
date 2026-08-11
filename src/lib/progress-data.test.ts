// src/lib/progress-data.test.ts
//
// The recomposed /progress assembler, end to end against a fake counting db:
//   - the three tenant shapes (Z / L / P) compose exactly the manifest the
//     report's §4.1/§4.2 diagrams draw — literal order, no runtime sort;
//   - the zero-Program tenant loses nothing structural (the stack shortens);
//   - the R23 fourth zero-state branch fires on the owner's real day-1 data;
//   - MEASURED query counts — the overhaul's acceptance arithmetic
//     (~445 → ~14 for the 3-member Program; ~956 → ~12 legacy). The exact
//     numbers are pinned so a regression (a new N+1, a lost cache()) fails
//     loudly.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake db (vi.hoisted) ─────────────────────────────────────────────────────

const H = vi.hoisted(() => {
  type HRow = Record<string, unknown>;
  const store: Record<string, HRow[]> = {
    goal: [],
    baseline: [],
    measurement: [],
    logEntry: [],
    workout: [],
    hike: [],
    program: [],
    plan: [],
    bodyMetric: [],
    footageMarker: [],
    // computeGameState's fan-out (the gated effort panel rides these):
    nutritionLog: [],
    note: [],
    mobilityCheckin: [],
    planDayOverride: [],
    gameBonusXp: [],
  };
  const calls: Record<string, number> = {};
  const bump = (m: string) => {
    calls[m] = (calls[m] ?? 0) + 1;
  };

  function matchScalar(value: unknown, cond: unknown): boolean {
    if (cond === null || typeof cond !== "object" || cond instanceof Date) {
      return (
        value === cond ||
        (cond instanceof Date && value instanceof Date && value.getTime() === cond.getTime())
      );
    }
    const c = cond as Record<string, unknown>;
    if ("lte" in c) {
      const b = c.lte as Date | number;
      const v = value as Date | number;
      if (v instanceof Date && b instanceof Date) {
        if (!(v.getTime() <= b.getTime())) return false;
      } else if (!(Number(v) <= Number(b))) return false;
    }
    if ("gte" in c) {
      const b = c.gte as Date | number;
      const v = value as Date | number;
      if (v instanceof Date && b instanceof Date) {
        if (!(v.getTime() >= b.getTime())) return false;
      } else if (!(Number(v) >= Number(b))) return false;
    }
    if ("in" in c) {
      if (!(c.in as unknown[]).includes(value)) return false;
    }
    if ("not" in c) {
      if (c.not === null) {
        if (value === null) return false;
      } else if (value === c.not) return false;
    }
    if ("some" in c) {
      // relation filter: { plans: { some: { id: X } } } — rows carry planIds.
      const someCond = c.some as Record<string, unknown>;
      const ids = (value as string[] | undefined) ?? [];
      if (!ids.includes(someCond.id as string)) return false;
    }
    return true;
  }

  function matchWhere(row: HRow, where: HRow | undefined): boolean {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (k === "OR") {
        if (!(cond as HRow[]).some((w) => matchWhere(row, w))) return false;
        continue;
      }
      if (k === "plans") {
        if (!matchScalar(row.planIds, cond)) return false;
        continue;
      }
      if (k === "workout") {
        if (!matchWhere(row.workout as HRow, cond as HRow)) return false;
        continue;
      }
      if (!matchScalar(row[k], cond)) return false;
    }
    return true;
  }

  type OrderSpec = Record<string, unknown>;
  function dirOf(v: unknown): "asc" | "desc" {
    if (typeof v === "string") return v as "asc" | "desc";
    // { sort: "asc", nulls: "last" }
    return ((v as Record<string, unknown>).sort as "asc" | "desc") ?? "asc";
  }
  function orderRows(rows: HRow[], orderBy: OrderSpec | OrderSpec[] | undefined): HRow[] {
    if (!orderBy) return rows;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const s of specs) {
        const [k, v] = Object.entries(s)[0]!;
        const dir = dirOf(v);
        const av = a[k];
        const bv = b[k];
        // nulls last regardless of direction (Prisma { nulls: "last" }).
        if (av == null && bv == null) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = av instanceof Date ? av.getTime() : (av as number | string);
        const bn = bv instanceof Date ? bv.getTime() : (bv as number | string);
        if (an === bn) continue;
        return (an < bn ? -1 : 1) * (dir === "asc" ? 1 : -1);
      }
      return 0;
    });
  }

  function makeModel(name: string) {
    const rowsOf = () => store[name]!;
    return {
      findFirst: async (args: HRow = {}) => {
        bump(name);
        const rows = orderRows(
          rowsOf().filter((r) => matchWhere(r, args.where as HRow)),
          args.orderBy as OrderSpec[],
        );
        return rows[0] ?? null;
      },
      findUnique: async (args: HRow = {}) => {
        bump(name);
        return rowsOf().find((r) => matchWhere(r, args.where as HRow)) ?? null;
      },
      findMany: async (args: HRow = {}) => {
        bump(name);
        let rows = orderRows(
          rowsOf().filter((r) => matchWhere(r, args.where as HRow)),
          args.orderBy as OrderSpec[],
        );
        if (typeof args.take === "number") rows = rows.slice(0, args.take);
        return rows;
      },
      count: async (args: HRow = {}) => {
        bump(name);
        return rowsOf().filter((r) => matchWhere(r, args.where as HRow)).length;
      },
      aggregate: async (args: HRow = {}) => {
        bump(name);
        const rows = rowsOf().filter((r) => matchWhere(r, args.where as HRow));
        const out: HRow = {};
        if (args._sum) {
          const sums: HRow = {};
          for (const f of Object.keys(args._sum as HRow)) {
            const vals = rows.map((r) => r[f]).filter((v): v is number => v != null);
            sums[f] = vals.length === 0 ? null : vals.reduce((s, v) => s + v, 0);
          }
          out._sum = sums;
        }
        if (args._max) {
          const maxs: HRow = {};
          for (const f of Object.keys(args._max as HRow)) {
            const vals = rows.map((r) => r[f]).filter((v): v is number => v != null);
            maxs[f] = vals.length === 0 ? null : Math.max(...vals);
          }
          out._max = maxs;
        }
        return out;
      },
    };
  }

  const fakeDb = Object.fromEntries(
    Object.keys(store).map((name) => [name, makeModel(name)]),
  ) as Record<string, ReturnType<typeof makeModel>>;

  return { store, calls, fakeDb };
});

const store = H.store;
const calls = H.calls;
const totalCalls = () => Object.values(calls).reduce((s, n) => s + n, 0);
const resetCalls = () => {
  for (const k of Object.keys(calls)) delete calls[k];
};

vi.mock("@/lib/db", () => ({
  prisma: H.fakeDb,
  getDb: async () => H.fakeDb,
  getScopedUserId: async () => "u1",
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { getProgressPageData, manifestKeys, stripTracksFor, retestWeeksFor } from "@/lib/progress-data";
import { PHASE2A_GOAL1, PHASE2A_GOAL2, PHASE2A_GOAL3, PHASE2A_GOAL1_ID } from "@/lib/phase2a-spec";
import type { GoalTarget } from "@/lib/goal-targets";
import type { ProgramTemplate } from "@/lib/program-template";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-10T15:00:00Z"); // Program day 1
const LATER = new Date("2026-09-20T15:00:00Z"); // mid Block 1

const TEMPLATE = {
  totalWeeks: 20,
  phases: [
    { index: 0, name: "Recovery + Baselines + DEXA Prep", weeks: [1, 2] },
    { index: 1, name: "Skill Acquisition + Moderate Deficit", weeks: [3, 4, 5, 6, 7, 8] },
  ],
  baselineWeek: [
    {
      dayOfWeek: 1,
      tests: [
        {
          testName: "Freestanding Handstand Hold",
          units: "sec",
          protocol: "",
          initialWeek: 1,
          retestWeeks: [10, 19],
        },
        {
          testName: "Pull-Up Max Reps",
          units: "reps",
          protocol: "",
          initialWeek: 1,
          retestWeeks: [10, 19],
        },
      ],
    },
  ],
  weeklySplit: [],
} as unknown as ProgramTemplate;

let idSeq = 0;
const nid = (p: string) => `${p}-${String(++idSeq).padStart(4, "0")}`;

function goalRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: nid("g"),
    objective: "Goal",
    kind: "fitness",
    status: "active",
    active: true,
    isFocus: false,
    targetDate: new Date("2026-12-31T00:00:00Z"),
    createdAt: new Date("2026-08-09T00:00:00Z"),
    legend: null,
    targets: [],
    completionSnapshot: null,
    programId: null,
    planIds: [] as string[],
    ...over,
  };
}

function hsWorkout(dateIso: string, durations: (number | null)[]): Record<string, unknown> {
  return {
    id: nid("w"),
    userId: "u1",
    title: null,
    status: "completed",
    startedAt: new Date(dateIso),
    exercises: [
      {
        name: "Freestanding Handstand Hold",
        equipment: null,
        orderIndex: 0,
        sets: durations.map((d, i) => ({
          setIndex: i,
          weightLb: null,
          reps: null,
          durationSec: d,
          distanceMi: null,
        })),
      },
    ],
  };
}

function reset() {
  idSeq = 0;
  for (const k of Object.keys(store)) store[k] = [];
  resetCalls();
}

function seedProgram(opts?: { withWorkouts?: boolean }) {
  reset();
  store.program = [
    {
      id: "prog1",
      status: "active",
      name: "Phase 2A",
      startedOn: new Date("2026-08-10T06:00:00Z"),
      endsOn: new Date("2026-12-31T06:00:00Z"),
      notes: null,
      attributionRules: null,
    },
  ];
  store.plan = [
    {
      id: "plan1",
      programId: "prog1",
      active: true,
      name: "Phase 2A rotation",
      startedOn: new Date("2026-08-10T06:00:00Z"),
      updatedAt: new Date("2026-08-10T06:00:00Z"),
      planJson: TEMPLATE,
      confirmedThroughDate: null,
      weeks: 20,
    },
  ];
  store.goal = [
    goalRow({
      id: PHASE2A_GOAL1_ID,
      objective: PHASE2A_GOAL1.objective,
      targets: PHASE2A_GOAL1.targets as GoalTarget[],
      programId: "prog1",
      planIds: ["plan1"],
      createdAt: new Date("2026-08-09T00:00:00Z"),
    }),
    goalRow({
      id: "g2-bodyfat",
      objective: PHASE2A_GOAL2.objective,
      targets: PHASE2A_GOAL2.targets as GoalTarget[],
      programId: "prog1",
      createdAt: new Date("2026-08-09T01:00:00Z"),
    }),
    goalRow({
      id: "g3-aws",
      objective: PHASE2A_GOAL3.objective,
      kind: "project",
      targetDate: null,
      targets: PHASE2A_GOAL3.targets as GoalTarget[],
      programId: "prog1",
      createdAt: new Date("2026-08-09T02:00:00Z"),
    }),
  ];
  store.baseline = [
    {
      id: nid("b"),
      testName: "Freestanding Handstand Hold",
      value: 10,
      units: "sec",
      capped: false,
      notes: null,
      date: new Date("2026-08-10T02:00:00Z"),
    },
  ];
  store.measurement = [
    { id: nid("m"), date: new Date("2026-08-10T14:00:00Z"), weightLb: 155, bodyFatPct: null },
  ];
  if (opts?.withWorkouts) {
    store.workout = [
      hsWorkout("2026-08-26T17:00:00Z", [8, 12]),
      hsWorkout("2026-09-01T17:00:00Z", [4, 6]),
      hsWorkout("2026-09-05T17:00:00Z", [14]),
      hsWorkout("2026-09-09T17:00:00Z", [21, 12]),
      hsWorkout("2026-09-14T17:00:00Z", [22, 8, 20]),
      hsWorkout("2026-09-18T17:00:00Z", [25, 21, 6]),
    ];
    store.measurement.push(
      { id: nid("m"), date: new Date("2026-09-03T14:00:00Z"), weightLb: 152.4, bodyFatPct: 16.4 },
      { id: nid("m"), date: new Date("2026-09-14T14:00:00Z"), weightLb: 151, bodyFatPct: null },
    );
  }
}

function seedLegacy() {
  reset();
  store.goal = [
    goalRow({
      id: "gl-deadlift",
      objective: "Deadlift 405 lb",
      isFocus: true,
      targets: [
        {
          metric: "baseline:Deadlift 5RM",
          label: "Deadlift 5RM",
          units: "lb",
          direction: "increase",
          start: 315,
          target: 405,
          weight: 0.6,
        },
        {
          metric: "weightLb",
          label: "Body weight",
          units: "lb",
          direction: "increase",
          start: 150,
          target: 160,
          weight: 0.4,
        },
      ] satisfies GoalTarget[],
    }),
  ];
  store.baseline = [
    {
      id: nid("b"),
      testName: "Deadlift 5RM",
      value: 365,
      units: "lb",
      capped: false,
      notes: null,
      date: new Date("2026-08-02T02:00:00Z"),
    },
  ];
  store.measurement = [
    { id: nid("m"), date: new Date("2026-08-01T14:00:00Z"), weightLb: 150, bodyFatPct: null },
  ];
  store.hike = [
    {
      id: nid("h"),
      route: "Mission Peak",
      status: "completed",
      date: new Date("2026-08-05T16:00:00Z"),
      distanceMi: 6.4,
      elevationFt: 2517,
    },
  ];
}

beforeEach(() => reset());

// ─────────────────────────────────────────────────────────────────────────────

describe("shape Z — the zero-row invited user", () => {
  it("composes hero + records + empty; no zeros, no export CTA, nothing computed", async () => {
    const data = await getProgressPageData(NOW);
    expect(data.shape).toBe("zero");
    expect(manifestKeys(data)).toEqual(["hero", "records", "empty"]);
    expect(data.recordsFeed).toEqual([]);
    expect(data.goalStrips).toEqual([]);
  });

  it("costs single-digit queries (was 12 issued pre-overhaul)", async () => {
    resetCalls();
    await getProgressPageData(NOW);
    expect(totalCalls()).toBeLessThanOrEqual(8);
  });
});

describe("shape P — 3-member Program, day 1 (the owner's real first render)", () => {
  it("composes the manifest in literal order — one Tier-1 in the fold, recap LAST", async () => {
    seedProgram();
    const data = await getProgressPageData(NOW);
    expect(data.shape).toBe("program");
    expect(manifestKeys(data)).toEqual([
      "hero",
      "jump",
      "program-band",
      "rule-repeatability",
      "repeatability",
      `goal-strip-${PHASE2A_GOAL1_ID}`,
      "goal-strip-g2-bodyfat",
      "goal-strip-g3-aws",
      "next-readings", // day 1: S1 initial checkpoints are live (the graft)
      "records",
      "rule-effort", // mirrors key 10 — leaves WITH it on zero-Program tenants
      "effort", // gated: ships only with the Stage-2 spine (this PR)
      "baselines",
      "body-composition", // owned by Goal 2 (G3 per-goal owner)
      "metrics",
      "recap-cta",
    ]);
  });

  it("★ R23: day-1 Goal 1 has tested>0 && rawScore===0 — the fourth branch's data", async () => {
    seedProgram();
    const data = await getProgressPageData(NOW);
    const g1 = data.goalStrips.find((s) => s.model.goal.id === PHASE2A_GOAL1_ID)!;
    expect(g1.model.snapshot).not.toBeNull();
    expect(g1.model.snapshot!.coverage.tested).toBeGreaterThan(0);
    expect(g1.model.snapshot!.rawScore).toBe(0);
  });

  it("the Seam Strip carries Goal 1's three nested tracks over ONE session universe", async () => {
    seedProgram({ withWorkouts: true });
    const data = await getProgressPageData(LATER);
    expect(data.seamStrip).not.toBeNull();
    const strip = data.seamStrip!;
    expect(strip.goalId).toBe(PHASE2A_GOAL1_ID);
    expect(strip.exercise).toBe("Freestanding Handstand Hold");
    expect(strip.window).toBe(6);
    expect(strip.tracks.map((t) => t.metricKey)).toEqual([
      "rolling:hs_sessions_10s_of6",
      "rolling:hs_sessions_20s_of6",
      "rolling:hs_triple20_of6",
    ]);
    expect(strip.slots).toHaveLength(6);
    expect(strip.tracks[0]!.hits).toBe(5);
    expect(strip.tracks[1]!.hits).toBe(3);
    expect(strip.tracks[2]!.hits).toBe(0);
    // R24 footer derivable from the template:
    expect(strip.retestWeeks).toEqual([10, 19]);
  });

  it("the readiness series MOVES as the rolling window fills (Hazard B, end to end)", async () => {
    seedProgram({ withWorkouts: true });
    const data = await getProgressPageData(LATER);
    const g1 = data.goalStrips.find((s) => s.model.goal.id === PHASE2A_GOAL1_ID)!;
    const series = g1.model.series!;
    expect(series.length).toBeGreaterThanOrEqual(3);
    expect(new Set(series).size).toBeGreaterThan(1); // not a flattened arc
  });

  it("MEASURED query count — the ~445 → ~14 acceptance target (+10 gated effort)", async () => {
    seedProgram({ withWorkouts: true });
    resetCalls();
    await getProgressPageData(LATER);
    const total = totalCalls();
    // Measured in THIS env: 33. Production is ~26 — React cache() dedupes
    // the repeated getActiveProgram/getRotationOwnerGoal inside one RSC
    // render; outside a render (node test) cache() is a passthrough.
    // Breakdown: page 18 (resolution 8 + activeGoals 1 + table 4 +
    // allBaselines 1 + hikes21d 1 + bodyMetric 1 + true-start 1 + footage 1)
    // + computeGameState 15 test-env (its own program/plan/goal resolution 6
    // passthrough + the 9-scan all-time fan-out) — the +10 the sign-off
    // gated to this PR (UXR-PROG-44), riding the −400+ removals.
    expect(total).toBe(33);
    // And the shape of the win: ~78 cursor evaluations cost ZERO queries —
    // total is independent of goals × cursors.
  });

  it("the gated effort panel: Program-window attribute deltas, nothing else (R-SPLIT)", async () => {
    seedProgram({ withWorkouts: true });
    const data = await getProgressPageData(LATER);
    expect(data.effort).not.toBeNull();
    const effort = data.effort!;
    expect(effort.rows.map((r) => r.id)).toEqual(["STR", "END", "MOB", "CON"]);
    expect(effort.windowStartKey).toBe("2026-08-10");
    // The model carries window deltas ONLY — no level, no streak, no total:
    expect(Object.keys(effort)).toEqual(["rows", "windowStartKey", "windowEndKey"]);
    // Training happened in the window → some attribute earned XP:
    expect(effort.rows.some((r) => r.xp > 0)).toBe(true);
  });
});

describe("shape L — zero-Program legacy tenant", () => {
  it("the SAME stack, shorter: no band, no metrics lid, nothing orphaned", async () => {
    seedLegacy();
    const data = await getProgressPageData(NOW);
    expect(data.shape).toBe("legacy");
    const keys = manifestKeys(data);
    expect(keys).not.toContain("program-band");
    expect(keys).not.toContain("metrics");
    expect(keys).not.toContain("rule-effort");
    expect(keys).not.toContain("effort");
    // No rolling targets → no repeatability AND no dangling rule:
    expect(keys).not.toContain("repeatability");
    expect(keys).not.toContain("rule-repeatability");
    // Still structural: strips + records + baselines + body-comp + recap.
    expect(keys).toContain("goal-strip-gl-deadlift");
    expect(keys).toContain("records");
    expect(keys).toContain("baselines");
    expect(keys).toContain("body-composition");
    expect(keys.at(-1)).toBe("recap-cta");
  });

  it("legacy strips flow through the SAME grammar (mode live, snapshot present)", async () => {
    seedLegacy();
    const data = await getProgressPageData(NOW);
    const strip = data.goalStrips[0]!;
    expect(strip.model.mode).toBe("live");
    expect(strip.model.snapshot).not.toBeNull();
    expect(strip.identity?.glyphFilled).toBe("●"); // C-3: the legacy goal keeps a mark
  });

  it("the mixed-kind feed interleaves baseline + hike (glyph column earns its keep)", async () => {
    seedLegacy();
    const data = await getProgressPageData(new Date("2026-08-10T15:00:00Z"));
    const kinds = new Set(data.recordsFeed.map((i) => i.kind));
    expect(kinds.has("baseline")).toBe(true);
    expect(kinds.has("hike")).toBe(true);
  });

  it("MEASURED query count — the ~956 → ~12 acceptance target", async () => {
    seedLegacy();
    resetCalls();
    await getProgressPageData(NOW);
    const total = totalCalls();
    // Measured: 15, and identical in production (the legacy branch calls
    // getActiveProgram once). Breakdown: getRotationOwnerGoal 2 (count +
    // focus goal) + membership 1 + getActiveProgram 3 (findFirst + count +
    // legacy plan.findFirst) + activeGoals 1 + table 3 (baseline/measurement/
    // workout) + allBaselines 1 + hikes 1 + bodyMetric 1 + true-start 1 +
    // footage 1 = 15. Was ~956 for a 3-year goal (unsampled serial series).
    expect(total).toBe(15);
  });
});

describe("frozen members (R9)", () => {
  it("an achieved member renders frozen — no recompute, snapshot score + series from the freeze", async () => {
    seedProgram();
    store.goal.push(
      goalRow({
        id: "g4-done",
        objective: "Climb Elbert",
        status: "achieved",
        active: false,
        programId: "prog1",
        completionSnapshot: {
          version: 1,
          completedDateKey: "2026-08-08",
          capturedAt: "2026-08-09T00:00:00Z",
          backdated: true,
          objective: "Climb Elbert",
          kind: "fitness",
          daysElapsed: 400,
          readiness: {
            score: 89,
            rawScore: 89,
            ceiling: 100,
            openGateCount: 0,
            coverage: { tested: 9, total: 9 },
          },
          readinessSeries: [
            { dateKey: "2026-07-01", score: 70 },
            { dateKey: "2026-08-08", score: 89 },
          ],
          targets: [],
          targetsMet: 8,
          targetsTotal: 9,
          feasibilityTierAtCompletion: null,
          coachFeasibilityTier: null,
          plan: { planId: null, weeksTotal: null, weeksElapsed: null },
          xpBasis: { weeks: 57, targetsMet: 8 },
          xpAwardedAtCompletion: 700,
        },
      }),
    );
    const data = await getProgressPageData(NOW);
    const frozen = data.goalStrips.find((s) => s.model.goal.id === "g4-done");
    expect(frozen).toBeDefined();
    expect(frozen!.model.mode).toBe("frozen");
    expect(frozen!.model.frozenScore).toBe(89);
    expect(frozen!.model.series).toEqual([70, 89]);
  });
});

describe("pure helpers", () => {
  it("stripTracksFor orders the ladder shallowest → deepest and drops mismatched tracks", () => {
    const grouped = stripTracksFor({ targets: PHASE2A_GOAL1.targets as GoalTarget[] });
    expect(grouped).not.toBeNull();
    expect(grouped!.tracks.map((t) => t.params.minSeconds)).toEqual([10, 20, 20]);
    expect(grouped!.tracks[2]!.params.hitsPerSession).toBe(3);
  });

  it("retestWeeksFor matches the exercise's baseline test through the canonical map", () => {
    expect(retestWeeksFor(TEMPLATE, "Freestanding Handstand Hold")).toEqual([10, 19]);
    expect(retestWeeksFor(TEMPLATE, "Bench Press")).toBeNull();
    expect(retestWeeksFor(null, "Freestanding Handstand Hold")).toBeNull();
  });
});
