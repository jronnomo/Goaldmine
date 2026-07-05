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
// Dual-export: @/lib/db exports both `prisma` and `getDb`; getDb is inert here (pure-function source).
vi.mock("@/lib/db", () => ({ prisma: {}, getDb: vi.fn() }));

import { resolveStatSlot } from "@/lib/recap";
import {
  presentationForGoal,
  statSlotsForGoal,
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

  it("all 4 slots have source.from === 'recapField'", () => {
    const p = presentationForGoal({ kind: "fitness" });
    expect(p.statSlots.every((s) => s.source.from === "recapField")).toBe(true);
  });

  it("restCopy is non-null (fitness has a recovery tip)", () => {
    const p = presentationForGoal({ kind: "fitness" });
    expect(p.restCopy).not.toBeNull();
  });

  it("legendDefault is 'fitness'", () => {
    const p = presentationForGoal({ kind: "fitness" });
    expect(p.legendDefault).toBe("fitness");
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

  it("DEFAULT_PRESENTATION.restCopy is null (recovery tip is fitness-specific)", () => {
    expect(DEFAULT_PRESENTATION.restCopy).toBeNull();
  });
});

// ─── Case 5a: presentationForGoal project — structural assertions ─────────────

describe("presentationForGoal — project kind (structural)", () => {
  it("ringLabel is 'PROGRESS', not 'TRACTION'", () => {
    const p = presentationForGoal({ kind: "project" });
    expect(p.ringLabel).toBe("PROGRESS");
    expect(p.ringLabel).not.toBe("TRACTION");
  });

  it("has exactly 2 statSlots", () => {
    const p = presentationForGoal({ kind: "project" });
    expect(p.statSlots).toHaveLength(2);
  });

  it("MRR slot: source logLatest/mrr, format currency", () => {
    const p = presentationForGoal({ kind: "project" });
    const mrr = p.statSlots[0];
    expect(mrr.key).toBe("mrr");
    expect(mrr.source.from).toBe("logLatest");
    expect(
      (mrr.source as { from: "logLatest"; metricKey: string }).metricKey,
    ).toBe("mrr");
    expect(mrr.format).toBe("currency");
  });

  it("MILESTONES slot: source scheduledItem/milestone/doneOverTotal, format ratioOfTotal", () => {
    const p = presentationForGoal({ kind: "project" });
    const milestones = p.statSlots[1];
    expect(milestones.key).toBe("milestones");
    expect(milestones.source.from).toBe("scheduledItem");
    const src = milestones.source as {
      from: "scheduledItem";
      itemType: string;
      agg: string;
    };
    expect(src.itemType).toBe("milestone");
    expect(src.agg).toBe("doneOverTotal");
    expect(milestones.format).toBe("ratioOfTotal");
  });

  it("restCopy is null (no recovery tip for project kind)", () => {
    const p = presentationForGoal({ kind: "project" });
    expect(p.restCopy).toBeNull();
  });

  it("legendDefault is 'project'", () => {
    const p = presentationForGoal({ kind: "project" });
    expect(p.legendDefault).toBe("project");
  });
});

// ─── Case 5b: Project Chewgether — MRR null + milestones 0/7 ─────────────────

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

// ─── Case 7: Anti-vertical guardrail — project NEVER grows Subs/Conversion ───

describe("PROJECT_PRESENTATION anti-vertical guardrail", () => {
  it("does not declare Subs or Conversion slots — only data-backed slots exist", () => {
    const keys = PROJECT_PRESENTATION.statSlots.map((s) => s.key);
    expect(keys).not.toContain("subs");
    expect(keys).not.toContain("conversion");
    // Positive sanity: only the two declared slots are present
    expect(keys).toEqual(["mrr", "milestones"]);
  });
});

// ─── Case 8: statSlotsForGoal — career-flavored project goal ─────────────────
// Fixture is an inline literal (career-template shape), NOT an import of
// CAREER_DEFAULT_TARGETS — that constant is owned by metrics-registry.ts and
// this suite must not couple to it.

describe("statSlotsForGoal — career-flavored project goal (no mrr target)", () => {
  const careerGoal = {
    kind: "project",
    targets: [
      { metric: "log:applications_sent", label: "Applications sent", units: "apps", direction: "increase", target: 50, weight: 0.3, cumulative: true },
      { metric: "log:interviews", label: "Interviews landed", units: "interviews", direction: "increase", target: 8, weight: 0.25, cumulative: true },
      { metric: "log:outreach_messages", label: "Outreach messages", units: "messages", direction: "increase", target: 60, weight: 0.2, cumulative: true },
      { metric: "log:coffee_chats", label: "Coffee chats", units: "chats", direction: "increase", target: 10, weight: 0.15, cumulative: true },
      { metric: "log:connections", label: "LinkedIn connections", units: "connections", direction: "increase", target: 500, weight: 0.1 },
    ],
  };

  it("returns exactly 2 slots, top-weighted first (applications_sent then interviews)", () => {
    const slots = statSlotsForGoal(careerGoal);
    expect(slots).toHaveLength(2);
    expect(slots[0].key).toBe("applications_sent");
    expect(slots[1].key).toBe("interviews");
  });

  it("slot source is targetCurrent with the matching metric string", () => {
    const slots = statSlotsForGoal(careerGoal);
    expect(slots[0].source).toEqual({ from: "targetCurrent", metric: "log:applications_sent" });
    expect(slots[1].source).toEqual({ from: "targetCurrent", metric: "log:interviews" });
  });

  it("label is uppercased + ellipsis-truncated to ≤14 chars; format is int", () => {
    const slots = statSlotsForGoal(careerGoal);
    // "APPLICATIONS SENT" (17 chars) → slice(0,13) + "…" = "APPLICATIONS …"
    expect(slots[0].label).toBe("APPLICATIONS …");
    // "INTERVIEWS LANDED" (17 chars) → "INTERVIEWS LA…"
    expect(slots[1].label).toBe("INTERVIEWS LA…");
    expect(slots[0].label.length).toBeLessThanOrEqual(14);
    expect(slots[1].label.length).toBeLessThanOrEqual(14);
    expect(slots[0].format).toBe("int");
    expect(slots[1].format).toBe("int");
  });

  it("a short label (≤14 chars) passes through uppercased, no ellipsis", () => {
    const slots = statSlotsForGoal({
      kind: "project",
      targets: [
        { metric: "log:coffee_chats", label: "Coffee chats", weight: 1 },
      ],
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].label).toBe("COFFEE CHATS");
  });
});

describe("statSlotsForGoal — mrr-guard (mrr-bearing goal unchanged)", () => {
  it("project goal WITH a log:mrr target falls back to PROJECT_PRESENTATION.statSlots", () => {
    const goal = {
      kind: "project",
      targets: [{ metric: "log:mrr", label: "MRR", units: "usd", direction: "increase", target: 10000, weight: 1 }],
    };
    expect(statSlotsForGoal(goal)).toEqual(PROJECT_PRESENTATION.statSlots);
  });

  it("bare 'mrr' metric spelling also triggers the guard (defense-in-depth)", () => {
    const goal = {
      kind: "project",
      targets: [{ metric: "mrr", label: "MRR", units: "usd", direction: "increase", target: 10000, weight: 1 }],
    };
    expect(statSlotsForGoal(goal)).toEqual(PROJECT_PRESENTATION.statSlots);
  });
});

describe("statSlotsForGoal — fallback cases", () => {
  it("project goal with no targets → PROJECT_PRESENTATION.statSlots", () => {
    expect(statSlotsForGoal({ kind: "project", targets: [] })).toEqual(PROJECT_PRESENTATION.statSlots);
  });

  it("project goal with malformed targets → PROJECT_PRESENTATION.statSlots, never throws", () => {
    expect(() => statSlotsForGoal({ kind: "project", targets: "not-an-array" })).not.toThrow();
    expect(statSlotsForGoal({ kind: "project", targets: "not-an-array" })).toEqual(PROJECT_PRESENTATION.statSlots);
    expect(statSlotsForGoal({ kind: "project", targets: { foo: "bar" } })).toEqual(PROJECT_PRESENTATION.statSlots);
    expect(statSlotsForGoal({ kind: "project", targets: null })).toEqual(PROJECT_PRESENTATION.statSlots);
    expect(statSlotsForGoal({ kind: "project", targets: [null, 42, "x"] })).toEqual(PROJECT_PRESENTATION.statSlots);
  });

  it("project goal whose targets all lack numeric weights → fallback (no rankable targets)", () => {
    const goal = {
      kind: "project",
      targets: [{ metric: "log:applications_sent", label: "Applications sent", weight: "heavy" }],
    };
    expect(statSlotsForGoal(goal)).toEqual(PROJECT_PRESENTATION.statSlots);
  });

  it("fitness kind → FITNESS_PRESENTATION.statSlots regardless of targets shape", () => {
    expect(statSlotsForGoal({ kind: "fitness", targets: [] })).toEqual(FITNESS_PRESENTATION.statSlots);
    expect(
      statSlotsForGoal({
        kind: "fitness",
        targets: [{ metric: "log:applications_sent", label: "Applications sent", weight: 1 }],
      }),
    ).toEqual(FITNESS_PRESENTATION.statSlots);
  });

  it("unknown/missing kind → DEFAULT_PRESENTATION.statSlots", () => {
    expect(statSlotsForGoal({ kind: "galaxy-brain" })).toEqual(DEFAULT_PRESENTATION.statSlots);
    expect(statSlotsForGoal(null)).toEqual(DEFAULT_PRESENTATION.statSlots);
    expect(statSlotsForGoal(undefined)).toEqual(DEFAULT_PRESENTATION.statSlots);
  });
});
