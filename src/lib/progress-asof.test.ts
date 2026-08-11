// src/lib/progress-asof.test.ts
//
// The As-Of Snapshot Table's safety argument (UXR-PROG-18/19/20):
//
//  1. PARITY — for the real Phase 2A acceptance fixtures (all three goals),
//     computeReadiness routed through the table produces snapshots deep-equal
//     to the direct per-metric-query path, at every cursor. The table is a
//     TRANSPORT, not new math.
//  2. BYTE-IDENTITY edges (UXR-PROG-20): (a) the (date,id) tiebreak on
//     same-day rows; (b) endOfDay(cursor) bucketing, never raw <=;
//     (c) cumulative log:* → null at zero rows, never 0.
//  3. HAZARD B — per-cursor override maps: the readiness arc must move when
//     the underlying rolling window moves across cursors (a hoisted map
//     flattens the arc into a plausible lie; no other test asserts arc shape).
//  4. QUERY COUNTS — the acceptance target of the overhaul: the table path
//     costs its ≤6 bounded scans ONCE, then 0 queries per cursor, vs the
//     direct path's per-target-per-cursor fan-out. Counted by the fake-db
//     call counter below.
//
// The fake db implements exactly the query shapes the resolvers use
// (goal-targets.ts / records.getExerciseHistory / readiness gate extras),
// with per-model call counting.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake db — built inside vi.hoisted so the vi.mock factory can see it ─────

type Row = Record<string, unknown>;

const H = vi.hoisted(() => {
  type HRow = Record<string, unknown>;
  const store: {
    goals: HRow[];
    baselines: HRow[];
    measurements: HRow[];
    logEntries: HRow[];
    workouts: HRow[];
    hikes: HRow[];
  } = { goals: [], baselines: [], measurements: [], logEntries: [], workouts: [], hikes: [] };
  const calls: Record<string, number> = {};
  const bump = (model: string) => {
    calls[model] = (calls[model] ?? 0) + 1;
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
      const bound = c.lte as Date | number;
      const v = value as Date | number;
      if (v instanceof Date && bound instanceof Date) {
        if (!(v.getTime() <= bound.getTime())) return false;
      } else if (!(Number(v) <= Number(bound))) return false;
    }
    if ("gte" in c) {
      const bound = c.gte as Date | number;
      const v = value as Date | number;
      if (v instanceof Date && bound instanceof Date) {
        if (!(v.getTime() >= bound.getTime())) return false;
      } else if (!(Number(v) >= Number(bound))) return false;
    }
    if ("in" in c) {
      if (!(c.in as unknown[]).includes(value)) return false;
    }
    if ("not" in c) {
      if (c.not === null) {
        if (value === null) return false;
      } else if (value === c.not) return false;
    }
    return true;
  }

  function matchWhere(row: HRow, where: HRow | undefined): boolean {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (k === "OR") {
        if (!(cond as HRow[]).some((w) => matchWhere(row, w))) return false;
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
  function orderRows(rows: HRow[], orderBy: OrderSpec | OrderSpec[] | undefined): HRow[] {
    if (!orderBy) return rows;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    const flat: [string[], "asc" | "desc"][] = specs.map((s) => {
      const [k, v] = Object.entries(s)[0]!;
      if (typeof v === "object" && v !== null) {
        const [k2, v2] = Object.entries(v as HRow)[0]!;
        return [[k, k2], v2 as "asc" | "desc"];
      }
      return [[k], v as "asc" | "desc"];
    });
    const val = (r: HRow, path: string[]) =>
      path.reduce<unknown>((acc, k) => (acc as HRow)?.[k], r);
    return [...rows].sort((a, b) => {
      for (const [path, dir] of flat) {
        const av = val(a, path);
        const bv = val(b, path);
        const an = av instanceof Date ? av.getTime() : (av as number | string);
        const bn = bv instanceof Date ? bv.getTime() : (bv as number | string);
        if (an === bn) continue;
        const less = an < bn;
        return (less ? -1 : 1) * (dir === "asc" ? 1 : -1);
      }
      return 0;
    });
  }

  function makeModel(name: string, rowsOf: () => HRow[]) {
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
            const vals = rows
              .map((r) => r[f])
              .filter((v): v is number => v !== null && v !== undefined);
            sums[f] = vals.length === 0 ? null : vals.reduce((s, v) => s + v, 0);
          }
          out._sum = sums;
        }
        if (args._max) {
          const maxs: HRow = {};
          for (const f of Object.keys(args._max as HRow)) {
            const vals = rows
              .map((r) => r[f])
              .filter((v): v is number => v !== null && v !== undefined);
            maxs[f] = vals.length === 0 ? null : Math.max(...vals);
          }
          out._max = maxs;
        }
        return out;
      },
    };
  }

  // workoutExercise is a VIEW over store.workouts (for getExerciseHistory).
  const workoutExerciseRows = (): HRow[] =>
    store.workouts.flatMap((w) =>
      (w.exercises as HRow[]).map((ex) => ({
        ...ex,
        workoutId: w.id,
        workout: { id: w.id, userId: w.userId, startedAt: w.startedAt, title: w.title ?? null },
      })),
    );

  const fakeDb = {
    goal: makeModel("goal", () => store.goals),
    baseline: makeModel("baseline", () => store.baselines),
    measurement: makeModel("measurement", () => store.measurements),
    logEntry: makeModel("logEntry", () => store.logEntries),
    workout: makeModel("workout", () => store.workouts),
    hike: makeModel("hike", () => store.hikes),
    workoutExercise: makeModel("workoutExercise", workoutExerciseRows),
  };

  return { store, calls, fakeDb };
});

const store = H.store;
const calls = H.calls;

function totalCalls(): number {
  return Object.values(calls).reduce((s, n) => s + n, 0);
}
function resetCalls() {
  for (const k of Object.keys(calls)) delete calls[k];
}

vi.mock("@/lib/db", () => ({
  prisma: H.fakeDb,
  getDb: async () => H.fakeDb,
  getScopedUserId: async () => "u1",
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { computeReadiness } from "@/lib/readiness";
import {
  buildAsOfTable,
  buildCurrentOverrides,
  buildStartOverrides,
} from "@/lib/progress-asof";
import type { GoalTarget } from "@/lib/goal-targets";
import { PHASE2A_GOAL1, PHASE2A_GOAL2, PHASE2A_GOAL3, PHASE2A_GOAL1_ID } from "@/lib/phase2a-spec";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GOAL1 = { id: PHASE2A_GOAL1_ID, targets: PHASE2A_GOAL1.targets as GoalTarget[] };
const GOAL2 = { id: "goal2-bodyfat", targets: PHASE2A_GOAL2.targets as GoalTarget[] };
const GOAL3 = { id: "goal3-aws", targets: PHASE2A_GOAL3.targets as GoalTarget[] };

let idSeq = 0;
const nid = (p: string) => `${p}-${String(++idSeq).padStart(4, "0")}`;

function hsWorkout(dateIso: string, durations: (number | null)[], extra?: { name: string; sets: Row[] }): Row {
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
      ...(extra ? [{ ...extra, equipment: null, orderIndex: 1 }] : []),
    ],
  };
}

function seedPhase2a() {
  idSeq = 0;
  store.goals = [
    { id: GOAL1.id, targets: GOAL1.targets },
    { id: GOAL2.id, targets: GOAL2.targets },
    { id: GOAL3.id, targets: GOAL3.targets },
  ];
  store.baselines = [
    { id: nid("b"), testName: "Freestanding Handstand Hold", value: 10, units: "sec", capped: false, notes: null, date: new Date("2026-08-10T18:00:00Z") },
    { id: nid("b"), testName: "Pull-Up Max Reps", value: 25, units: "reps", capped: false, notes: null, date: new Date("2026-08-13T18:00:00Z") },
    { id: nid("b"), testName: "L-Sit (Parallettes)", value: 32, units: "sec", capped: false, notes: null, date: new Date("2026-08-13T19:00:00Z") },
    { id: nid("b"), testName: "Freestanding Handstand Hold", value: 14, units: "sec", capped: false, notes: null, date: new Date("2026-09-05T18:00:00Z") },
  ];
  store.measurements = [
    { id: nid("m"), date: new Date("2026-08-10T14:00:00Z"), weightLb: 155, bodyFatPct: null },
    { id: nid("m"), date: new Date("2026-08-24T14:00:00Z"), weightLb: 153.2, bodyFatPct: null },
    { id: nid("m"), date: new Date("2026-09-03T14:00:00Z"), weightLb: 152.4, bodyFatPct: 16.4 },
    { id: nid("m"), date: new Date("2026-09-14T14:00:00Z"), weightLb: 151, bodyFatPct: null },
  ];
  store.logEntries = [
    { id: nid("l"), goalId: GOAL3.id, metric: "study_hours", value: 2.5, date: new Date("2026-08-20T20:00:00Z") },
    { id: nid("l"), goalId: GOAL3.id, metric: "study_hours", value: 3, date: new Date("2026-08-27T20:00:00Z") },
    { id: nid("l"), goalId: GOAL3.id, metric: "sections_done", value: 3, date: new Date("2026-08-27T21:00:00Z") },
  ];
  // Rolling universe: sessions Aug 26 → Sep 18 (the storyboard's shape) +
  // one untimed handstand workout + one unrelated workout.
  store.workouts = [
    hsWorkout("2026-08-26T17:00:00Z", [8, 12, 6]), // ≥10 hit
    hsWorkout("2026-09-01T17:00:00Z", [4, 6]), // stub (no ≥10)
    hsWorkout("2026-09-05T17:00:00Z", [14, 9]), // ≥10
    hsWorkout("2026-09-09T17:00:00Z", [21, 12]), // ≥20
    hsWorkout("2026-09-14T17:00:00Z", [22, 8, 20]), // ≥20 ×2
    hsWorkout("2026-09-18T17:00:00Z", [25, 21, 6]), // ≥20 ×2
    // Untimed handstand training day — matched, not a session (F3):
    {
      id: nid("w"),
      userId: "u1",
      title: null,
      status: "completed",
      startedAt: new Date("2026-09-16T17:00:00Z"),
      exercises: [
        {
          name: "Freestanding Handstand Hold",
          equipment: null,
          orderIndex: 0,
          sets: [{ setIndex: 0, weightLb: null, reps: null, durationSec: null, distanceMi: null }],
        },
      ],
    },
    // Unrelated strength day (exercise:* + PR material):
    {
      id: nid("w"),
      userId: "u1",
      title: null,
      status: "completed",
      startedAt: new Date("2026-09-02T17:00:00Z"),
      exercises: [
        {
          name: "Goblet Squat",
          equipment: "dumbbell",
          orderIndex: 0,
          sets: [
            { setIndex: 0, weightLb: 65, reps: 8, durationSec: null, distanceMi: null },
            { setIndex: 1, weightLb: 65, reps: 10, durationSec: null, distanceMi: null },
          ],
        },
      ],
    },
  ];
  store.hikes = [
    { id: nid("h"), goalId: "goal-hike", date: new Date("2026-08-15T16:00:00Z"), status: "completed", distanceMi: 6.4, elevationFt: 2517, packWeightLb: 18, summitFt: 2517 },
    { id: nid("h"), goalId: "goal-hike", date: new Date("2026-09-06T16:00:00Z"), status: "completed", distanceMi: 5.5, elevationFt: 2100, packWeightLb: null, summitFt: 12500 },
  ];
}

/** Weekly Sunday-ish cursors spanning the fixture window (mid-day instants —
 *  deliberately NOT end-of-day, so the endOfDay bucketing is exercised). */
const CURSORS = [
  "2026-08-10T15:00:00Z",
  "2026-08-16T15:00:00Z",
  "2026-08-23T15:00:00Z",
  "2026-08-30T15:00:00Z",
  "2026-09-06T15:00:00Z",
  "2026-09-13T15:00:00Z",
  "2026-09-20T15:00:00Z",
].map((s) => new Date(s));
const NOW = new Date("2026-09-20T15:00:00Z");

async function tableSnapshot(table: Awaited<ReturnType<typeof buildAsOfTable>>, goal: { id: string; targets: GoalTarget[] }, cursor: Date) {
  const startOverrides = buildStartOverrides(table, goal);
  return computeReadiness(goal.targets, cursor, goal.id, {
    currentOverrides: buildCurrentOverrides(table, goal, cursor), // rebuilt per cursor (Hazard B)
    startOverrides,
  });
}

beforeEach(() => {
  seedPhase2a();
  resetCalls();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("As-Of table parity — the table is a transport, not new math", () => {
  for (const goal of [GOAL1, GOAL2, GOAL3]) {
    it(`snapshots deep-equal the direct path at every cursor (${goal.id})`, async () => {
      const table = await buildAsOfTable({ goals: [GOAL1, GOAL2, GOAL3], until: NOW });
      for (const cursor of CURSORS) {
        const direct = await computeReadiness(goal.targets, cursor, goal.id);
        const routed = await tableSnapshot(table, goal, cursor);
        expect(routed).toEqual(direct);
      }
    });
  }

  it("workout:count + hike:* + exercise:* families are parity-covered too", async () => {
    const synth = {
      id: "goal-hike",
      targets: [
        { metric: "workout:count", label: "Sessions", units: "sessions", direction: "increase", target: 100, weight: 0.25 },
        { metric: "hike:prep_completion", label: "Qualifying hikes", units: "hikes", direction: "increase", target: 4, weight: 0.25 },
        { metric: "hike:total_elevation_ft", label: "Total climb", units: "ft", direction: "increase", target: 20000, weight: 0.25 },
        { metric: "exercise:Goblet Squat", label: "Goblet 1RM", units: "lb", direction: "increase", target: 100, weight: 0.25 },
      ] as GoalTarget[],
    };
    store.goals.push({ id: synth.id, targets: synth.targets });
    const table = await buildAsOfTable({ goals: [synth], until: NOW });
    for (const cursor of CURSORS) {
      const direct = await computeReadiness(synth.targets, cursor, synth.id);
      const routed = await tableSnapshot(table, synth, cursor);
      expect(routed).toEqual(direct);
    }
  });
});

describe("byte-identity edges (UXR-PROG-20)", () => {
  it("(a) same-day baselines resolve by the (date,id) tiebreak identically on both paths", async () => {
    const day = new Date("2026-09-10T18:00:00Z");
    store.baselines.push(
      { id: "tie-a", testName: "Pull-Up Max Reps", value: 23, units: "reps", capped: false, notes: null, date: day },
      { id: "tie-b", testName: "Pull-Up Max Reps", value: 26, units: "reps", capped: false, notes: null, date: day },
    );
    const cursor = new Date("2026-09-12T10:00:00Z");
    const table = await buildAsOfTable({ goals: [GOAL2], until: NOW });
    const direct = await computeReadiness(GOAL2.targets, cursor, GOAL2.id);
    const routed = await tableSnapshot(table, GOAL2, cursor);
    expect(routed).toEqual(direct);
    // And the pick is the id-desc winner, deterministically:
    const row = routed.breakdown.find((b) => b.target.metric === "baseline:Pull-Up Max Reps")!;
    expect(row.current).toBe(26);
  });

  it("(b) a row logged later on the cursor's own day still counts — endOfDay bucketing", async () => {
    // Cursor 15:00Z; the Aug 10 baseline is dated 18:00Z the same day.
    const cursor = new Date("2026-08-10T15:00:00Z");
    const table = await buildAsOfTable({ goals: [GOAL1], until: NOW });
    const routed = await tableSnapshot(table, GOAL1, cursor);
    const fh = routed.breakdown.find((b) => b.target.metric === "baseline:Freestanding Handstand Hold")!;
    expect(fh.current).toBe(10); // included despite date > raw cursor instant
  });

  it("(c) cumulative log:* with zero rows is null, not 0 — on both paths", async () => {
    store.logEntries = [];
    const cursor = CURSORS[3]!;
    const table = await buildAsOfTable({ goals: [GOAL3], until: NOW });
    const direct = await computeReadiness(GOAL3.targets, cursor, GOAL3.id);
    const routed = await tableSnapshot(table, GOAL3, cursor);
    expect(routed).toEqual(direct);
    const cum = routed.breakdown.find((b) => b.target.metric === "log:study_hours")!;
    expect(cum.current).toBeNull(); // NOT 0
    expect(routed.missing.some((t) => t.metric === "log:study_hours")).toBe(true);
  });
});

describe("Hazard B — the readiness arc must keep its shape", () => {
  it("per-cursor rebuilt maps produce a moving rolling value across cursors", async () => {
    const table = await buildAsOfTable({ goals: [GOAL1], until: NOW });
    const values: (number | null)[] = [];
    for (const cursor of CURSORS) {
      const snap = await tableSnapshot(table, GOAL1, cursor);
      const row = snap.breakdown.find((b) => b.target.metric === "rolling:hs_sessions_10s_of6")!;
      values.push(row.current);
    }
    // Before any session: null. After sessions accumulate: rising hit counts.
    expect(values[0]).toBeNull();
    const numeric = values.filter((v): v is number => v !== null);
    expect(new Set(numeric).size).toBeGreaterThan(1); // the arc MOVES — a flattened arc fails here
    // And the last cursor equals the direct value:
    const direct = await computeReadiness(GOAL1.targets, CURSORS.at(-1)!, GOAL1.id);
    const dRow = direct.breakdown.find((b) => b.target.metric === "rolling:hs_sessions_10s_of6")!;
    expect(values.at(-1)).toBe(dRow.current);
  });
});

describe("query counts — the overhaul's acceptance arithmetic", () => {
  it("table path: ≤6 bounded scans once, then ZERO queries per cursor", async () => {
    resetCalls();
    const table = await buildAsOfTable({ goals: [GOAL1, GOAL2, GOAL3], until: NOW });
    const buildCost = totalCalls();
    // Families for the three goals: baseline + measurement + log + workouts = 4 scans.
    expect(buildCost).toBeLessThanOrEqual(6);
    expect(buildCost).toBe(4);

    resetCalls();
    for (const goal of [GOAL1, GOAL2, GOAL3]) {
      for (const cursor of CURSORS) {
        await tableSnapshot(table, goal, cursor);
      }
    }
    expect(totalCalls()).toBe(0); // 21 evaluations, zero round-trips
  });

  it("direct path pays per-target-per-cursor; the table collapses it >10×", async () => {
    resetCalls();
    for (const goal of [GOAL1, GOAL2, GOAL3]) {
      for (const cursor of CURSORS) {
        await computeReadiness(goal.targets, cursor, goal.id);
      }
    }
    const directCost = totalCalls();
    // Goal1: 5 baseline currents + 3 rolling × 2 = 11/cursor; Goal2: 3+1(bodyFat start); Goal3: 3.
    // 7 cursors × (11 + 4 + 3) = 126.
    expect(directCost).toBeGreaterThanOrEqual(100);

    resetCalls();
    const table = await buildAsOfTable({ goals: [GOAL1, GOAL2, GOAL3], until: NOW });
    for (const goal of [GOAL1, GOAL2, GOAL3]) {
      for (const cursor of CURSORS) {
        await tableSnapshot(table, goal, cursor);
      }
    }
    const tableCost = totalCalls();
    expect(tableCost).toBe(4);
    expect(directCost / tableCost).toBeGreaterThan(10);
  });
});

describe("start coverage + bound degradation", () => {
  it("bodyFatPct start (deliberately omitted in the spec) resolves through the scan — earliest reading", async () => {
    const table = await buildAsOfTable({ goals: [GOAL2], until: NOW });
    const starts = buildStartOverrides(table, GOAL2);
    expect(starts.get("bodyFatPct")).toBe(16.4); // the only BF reading
    // weightLb / baseline targets carry explicit starts → never in the map.
    expect(starts.has("weightLb")).toBe(false);
    expect(starts.has("baseline:Pull-Up Max Reps")).toBe(false);
  });

  it("a bound-hit scan withholds starts (fall through to the true resolver) instead of guessing", async () => {
    const table = await buildAsOfTable({ goals: [GOAL2], until: NOW });
    // Simulate the bound-hit flag — the accessor must report uncovered.
    (table.boundHit as { measurements: boolean }).measurements = true;
    const r = table.startFor(GOAL2.id, GOAL2.targets.find((t) => t.metric === "bodyFatPct")!);
    expect(r.covered).toBe(false);
  });
});
