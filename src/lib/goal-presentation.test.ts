// src/lib/goal-presentation.test.ts
// Pins resolveStatSlot (recap.ts) + presentationForGoal (goal-presentation.ts)
// against regressions. All cases use synthetic ctx — zero DB calls.
//
// DB-import gotcha: recap.ts transitively imports @/lib/db (via program, readiness,
// records, game/engine, calendar, goal-events, nutrition-plan, etc.). db.ts throws
// "DATABASE_URL is not set" at module load when env is absent. vi.mock is hoisted
// above imports by Vitest, so the throwing createClient() never runs. The single
// mock covers the full transitive chain; resolveStatSlot is pure and never touches
// prisma at runtime.
//
// Architecture critique C-1: isNull is `v === null` (recap.ts:196). For integer
// counts (workoutsCompleted:0, prCount:0), v === 0 !== null, so isNull:false.
// Do NOT assert isNull:true for zero-count slots.

import { describe, it, expect, vi } from "vitest";

// vi.mock is hoisted before imports — this is the critical ordering.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { resolveStatSlot } from "@/lib/recap";
import {
  presentationForGoal,
  FITNESS_PRESENTATION,
  PROJECT_PRESENTATION,
  DEFAULT_PRESENTATION,
} from "@/lib/goal-presentation";

// ─── Shared ctx helpers ───────────────────────────────────────────────────────

/** Full fitness ctx — 2 workouts, 2,370 lb volume, 1 PR, 5,200 ft elevation */
const FITNESS_FULL_CTX = {
  recap: {
    workoutsCompleted: 2,
    volumeLb: 2370,
    prCount: 1,
    hikeElevationFt: 5200,
  },
  logLatest: new Map<string, number | null>(),
  scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
  breakdown: [],
  targets: [],
};

/** Fitness ctx where numeric-nullable fields are null; zero-count fields are 0 */
const FITNESS_NULL_CTX = {
  recap: {
    workoutsCompleted: 0,
    volumeLb: null,
    prCount: 0,
    hikeElevationFt: null,
  },
  logLatest: new Map<string, number | null>(),
  scheduledAgg: new Map<string, { done: number; total: number; open: number }>(),
  breakdown: [],
  targets: [],
};

// ─── Case 1: Fitness byte-identical ──────────────────────────────────────────

describe("resolveStatSlot — fitness byte-identical values", () => {
  it("resolves all four fitness slots to exact strings and isNull:false", () => {
    const resolved = FITNESS_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, FITNESS_FULL_CTX),
    );

    expect(resolved.map((r) => r.value)).toEqual([
      "2",
      "2,370 lb",
      "1",
      "5,200 ft",
    ]);
    expect(resolved.map((r) => r.isNull)).toEqual([false, false, false, false]);
    expect(resolved.map((r) => r.key)).toEqual([
      "workouts",
      "volume",
      "prs",
      "elevation",
    ]);
    expect(resolved.map((r) => r.label)).toEqual([
      "WORKOUTS",
      "VOLUME",
      "NEW PRs",
      "ELEVATION",
    ]);
  });
});

// ─── Case 2: Fitness nulls (C-1 critical fix) ────────────────────────────────

describe("resolveStatSlot — fitness null/zero ctx", () => {
  it("volume and elevation are null → '—'/isNull:true; workouts and prs are 0 → '0'/isNull:false", () => {
    const resolved = FITNESS_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, FITNESS_NULL_CTX),
    );

    // All four slots explicitly asserted — C-1: 0 !== null so isNull:false for counts
    expect(resolved[0]).toEqual({ key: "workouts",  label: "WORKOUTS",  value: "0", isNull: false });
    expect(resolved[1]).toEqual({ key: "volume",    label: "VOLUME",    value: "—", isNull: true  });
    expect(resolved[2]).toEqual({ key: "prs",       label: "NEW PRs",   value: "0", isNull: false });
    expect(resolved[3]).toEqual({ key: "elevation", label: "ELEVATION", value: "—", isNull: true  });
  });
});

// ─── Case 3: presentationForGoal fitness ─────────────────────────────────────

describe("presentationForGoal — fitness kind", () => {
  it("returns FITNESS_PRESENTATION with correct ringLabel, headerStyle, and slot labels", () => {
    const p = presentationForGoal({ kind: "fitness" });

    expect(p.ringLabel).toBe("READINESS");
    expect(p.headerStyle).toBe("program-week");
    expect(p.statSlots.map((s) => s.label)).toEqual([
      "WORKOUTS",
      "VOLUME",
      "NEW PRs",
      "ELEVATION",
    ]);
  });
});

// ─── Case 4: Default fallback ─────────────────────────────────────────────────

describe("presentationForGoal — default fallback", () => {
  it("null → __default__ with fitness slots", () => {
    const p = presentationForGoal(null);
    expect(p.kind).toBe("__default__");
    expect(p.statSlots.map((s) => s.label)).toEqual([
      "WORKOUTS",
      "VOLUME",
      "NEW PRs",
      "ELEVATION",
    ]);
    expect(p.statSlots.map((s) => s.key)).toEqual([
      "workouts",
      "volume",
      "prs",
      "elevation",
    ]);
  });

  it("undefined → __default__", () => {
    expect(presentationForGoal(undefined).kind).toBe("__default__");
  });

  it("unknown kind → __default__ with fitness slots", () => {
    const p = presentationForGoal({ kind: "galaxy-brain" });
    expect(p.kind).toBe("__default__");
    expect(p.statSlots.map((s) => s.label)).toEqual([
      "WORKOUTS",
      "VOLUME",
      "NEW PRs",
      "ELEVATION",
    ]);
    expect(p.statSlots.map((s) => s.key)).toEqual([
      "workouts",
      "volume",
      "prs",
      "elevation",
    ]);
  });

  it("DEFAULT_PRESENTATION kind is __default__", () => {
    expect(DEFAULT_PRESENTATION.kind).toBe("__default__");
  });
});

// ─── Case 5: Project Chewgether — MRR null + milestones 0/7 ──────────────────

describe("resolveStatSlot — project Chewgether (mrr null, milestones 0/7)", () => {
  it("presentationForGoal returns PROGRESS ring + weeks-to-target header", () => {
    const p = presentationForGoal({ kind: "project" });
    expect(p.ringLabel).toBe("PROGRESS");
    expect(p.headerStyle).toBe("weeks-to-target");
  });

  it("mrr=null → '—'/isNull:true; milestones 0/7 → '0/7'/isNull:false", () => {
    const ctx = {
      recap: {
        workoutsCompleted: 0,
        volumeLb: null,
        prCount: 0,
        hikeElevationFt: null,
      },
      logLatest: new Map<string, number | null>([["mrr", null]]),
      // open is REQUIRED by StatSlotCtx (recap.ts:168) — omitting causes tsc error
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>([
        ["milestone", { done: 0, total: 7, open: 7 }],
      ]),
      breakdown: [],
      targets: [],
    };

    const resolved = PROJECT_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, ctx),
    );

    expect(resolved).toEqual([
      { key: "mrr",        label: "MRR",        value: "—",    isNull: true  },
      { key: "milestones", label: "MILESTONES",  value: "0/7",  isNull: false },
    ]);
  });
});

// ─── Case 6: Milestone progress (done:3, total:7) ────────────────────────────

describe("resolveStatSlot — milestone progress 3/7", () => {
  it("done:3/total:7 → '3/7'/isNull:false — proves ScheduledItem aggregate backs the slot", () => {
    const ctx = {
      recap: {
        workoutsCompleted: 0,
        volumeLb: null,
        prCount: 0,
        hikeElevationFt: null,
      },
      logLatest: new Map<string, number | null>([["mrr", null]]),
      scheduledAgg: new Map<string, { done: number; total: number; open: number }>([
        ["milestone", { done: 3, total: 7, open: 4 }],
      ]),
      breakdown: [],
      targets: [],
    };

    const resolved = PROJECT_PRESENTATION.statSlots.map((s) =>
      resolveStatSlot(s, ctx),
    );

    // milestones slot is index 1
    expect(resolved[1]).toEqual({
      key: "milestones",
      label: "MILESTONES",
      value: "3/7",
      isNull: false,
    });
  });
});
