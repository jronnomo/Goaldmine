// src/lib/goal-completion-core.test.ts
// Pure-function unit tests — no mocks, no DB. Covers buildCompletionSnapshot's
// met/unmet target math, zero-target goals, backdated flag, weeks-basis
// (plan / plan-less / plan-longer-than-elapsed), the defensive parsers, and
// game/rules.ts's goalAchievedXp boundary cases (REQ-003).

import { describe, expect, it } from "vitest";
import { parseDateKey } from "@/lib/calendar-core";
import {
  buildCompletionSnapshot,
  parseCompletionSnapshot,
  parseGoalRetrospective,
  type BuildCompletionSnapshotInputs,
} from "@/lib/goal-completion-core";
import { goalAchievedXp } from "@/lib/game/rules";

describe("goalAchievedXp", () => {
  it("(0,0) === base only (150)", () => {
    expect(goalAchievedXp(0, 0)).toBe(150);
  });

  it("(12,5) === max (700) — exactly at both caps", () => {
    expect(goalAchievedXp(12, 5)).toBe(700);
  });

  it("(99,99) === max (700) — caps enforced far beyond both thresholds", () => {
    expect(goalAchievedXp(99, 99)).toBe(700);
  });

  it("clamps negative inputs to 0 rather than subtracting XP", () => {
    expect(goalAchievedXp(-5, -3)).toBe(150);
  });

  it("scales linearly below the caps", () => {
    // 150 + 4*25 + 2*50 = 350
    expect(goalAchievedXp(4, 2)).toBe(350);
  });
});

// Base inputs shared across tests — override per-case via spread.
function baseInputs(overrides: Partial<BuildCompletionSnapshotInputs> = {}): BuildCompletionSnapshotInputs {
  return {
    goal: { objective: "Summit Mt. Elbert", kind: "fitness", createdAt: parseDateKey("2026-01-01") },
    completedAt: parseDateKey("2026-03-01"),
    completedDateKey: "2026-03-01",
    capturedAt: parseDateKey("2026-03-01"),
    readiness: null,
    targets: [],
    feasibilityTierAtCompletion: null,
    coachFeasibilityTier: null,
    plan: { planId: null, weeksTotal: null, startedOn: null },
    xpAwardedAtCompletion: 150,
    ...overrides,
  };
}

describe("buildCompletionSnapshot — targets met/unmet", () => {
  it("marks a target with progress >= 1 as met", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        targets: [
          { metric: "m1", label: "Pull-ups", units: "reps", start: 5, final: 15, target: 15, progress: 1 },
        ],
      }),
    );
    expect(snap.targets).toHaveLength(1);
    expect(snap.targets[0]!.met).toBe(true);
    expect(snap.targetsMet).toBe(1);
    expect(snap.targetsTotal).toBe(1);
  });

  it("marks a target with progress > 1 (overshoot) as met", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        targets: [
          { metric: "m1", label: "Pull-ups", units: "reps", start: 5, final: 20, target: 15, progress: 1.33 },
        ],
      }),
    );
    expect(snap.targets[0]!.met).toBe(true);
  });

  it("marks a target with progress < 1 as unmet", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        targets: [
          { metric: "m1", label: "Pull-ups", units: "reps", start: 5, final: 10, target: 15, progress: 0.5 },
        ],
      }),
    );
    expect(snap.targets[0]!.met).toBe(false);
    expect(snap.targetsMet).toBe(0);
  });

  it("marks a target with null progress (untested) as unmet", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        targets: [
          { metric: "m1", label: "Pull-ups", units: "reps", start: null, final: null, target: 15, progress: null },
        ],
      }),
    );
    expect(snap.targets[0]!.met).toBe(false);
    expect(snap.targetsMet).toBe(0);
    expect(snap.targetsTotal).toBe(1);
  });

  it("counts a mix of met/unmet targets correctly", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        targets: [
          { metric: "m1", label: "A", units: "reps", start: 0, final: 10, target: 10, progress: 1 },
          { metric: "m2", label: "B", units: "lb", start: 100, final: 120, target: 150, progress: 0.4 },
          { metric: "m3", label: "C", units: "sec", start: 30, final: 10, target: 10, progress: 1 },
        ],
      }),
    );
    expect(snap.targetsMet).toBe(2);
    expect(snap.targetsTotal).toBe(3);
  });
});

describe("buildCompletionSnapshot — zero-target goal", () => {
  it("readiness null + targetsMet 0/0 when the goal has no targets", () => {
    const snap = buildCompletionSnapshot(baseInputs({ readiness: null, targets: [] }));
    expect(snap.readiness).toBeNull();
    expect(snap.targets).toEqual([]);
    expect(snap.targetsMet).toBe(0);
    expect(snap.targetsTotal).toBe(0);
  });
});

describe("buildCompletionSnapshot — backdated flag", () => {
  it("backdated true when completedDateKey is before today's dateKey (capturedAt)", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        completedAt: parseDateKey("2026-02-01"),
        completedDateKey: "2026-02-01",
        capturedAt: parseDateKey("2026-03-15"),
      }),
    );
    expect(snap.backdated).toBe(true);
  });

  it("backdated false when completedDateKey equals today's dateKey (capturedAt)", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        completedAt: parseDateKey("2026-03-15"),
        completedDateKey: "2026-03-15",
        capturedAt: parseDateKey("2026-03-15"),
      }),
    );
    expect(snap.backdated).toBe(false);
  });
});

describe("buildCompletionSnapshot — weeks basis", () => {
  it("plan present: xpBasis.weeks = min(plan.weeksTotal, fullWeeksElapsed)", () => {
    // 2026-01-01 -> 2026-03-01 is 59 days = 8 full weeks elapsed; plan caps at 6.
    const snap = buildCompletionSnapshot(
      baseInputs({
        plan: { planId: "plan1", weeksTotal: 6, startedOn: parseDateKey("2026-01-01") },
      }),
    );
    expect(snap.plan.weeksElapsed).toBe(8);
    expect(snap.xpBasis.weeks).toBe(6);
  });

  it("plan longer than elapsed: xpBasis.weeks = fullWeeksElapsed (not weeksTotal)", () => {
    // Same 8-week elapsed window, but the plan itself is 20 weeks — min picks elapsed.
    const snap = buildCompletionSnapshot(
      baseInputs({
        plan: { planId: "plan1", weeksTotal: 20, startedOn: parseDateKey("2026-01-01") },
      }),
    );
    expect(snap.plan.weeksElapsed).toBe(8);
    expect(snap.xpBasis.weeks).toBe(8);
  });

  it("plan-less goal: xpBasis.weeks falls back to floor(daysElapsed/7)", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        plan: { planId: null, weeksTotal: null, startedOn: null },
      }),
    );
    // createdAt 2026-01-01 -> completedAt 2026-03-01 = 59 days -> floor(59/7) = 8.
    expect(snap.daysElapsed).toBe(59);
    expect(snap.plan.weeksElapsed).toBeNull();
    expect(snap.xpBasis.weeks).toBe(8);
  });

  it("plan with startedOn but no weeksTotal also falls back to floor(daysElapsed/7)", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        plan: { planId: "plan1", weeksTotal: null, startedOn: parseDateKey("2026-01-01") },
      }),
    );
    expect(snap.plan.weeksElapsed).toBe(8); // still computed and surfaced...
    expect(snap.xpBasis.weeks).toBe(8); // ...and here it coincides with the fallback.
  });
});

describe("parseCompletionSnapshot", () => {
  const validSnapshot = buildCompletionSnapshot(
    baseInputs({
      readiness: { score: 90, rawScore: 92, ceiling: 100, coverage: { tested: 2, total: 2 }, openGateCount: 0 },
      targets: [
        { metric: "m1", label: "A", units: "reps", start: 0, final: 10, target: 10, progress: 1 },
      ],
      feasibilityTierAtCompletion: "rare",
      coachFeasibilityTier: null,
      plan: { planId: "plan1", weeksTotal: 6, startedOn: parseDateKey("2026-01-01") },
    }),
  );

  it("round-trips a valid snapshot through JSON", () => {
    const json = JSON.parse(JSON.stringify(validSnapshot));
    const parsed = parseCompletionSnapshot(json);
    expect(parsed).toEqual(validSnapshot);
  });

  it("returns null for garbage input", () => {
    expect(parseCompletionSnapshot(null)).toBeNull();
    expect(parseCompletionSnapshot(undefined)).toBeNull();
    expect(parseCompletionSnapshot("not an object")).toBeNull();
    expect(parseCompletionSnapshot(42)).toBeNull();
    expect(parseCompletionSnapshot([])).toBeNull();
    expect(parseCompletionSnapshot({})).toBeNull();
  });

  it("returns null when version is missing or wrong", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { version, ...rest } = validSnapshot;
    expect(parseCompletionSnapshot(rest)).toBeNull();
    expect(parseCompletionSnapshot({ ...validSnapshot, version: 2 })).toBeNull();
    expect(parseCompletionSnapshot({ ...validSnapshot, version: "1" })).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { objective, ...rest } = validSnapshot;
    expect(parseCompletionSnapshot(rest)).toBeNull();
  });

  it("returns null when a target row is malformed", () => {
    expect(
      parseCompletionSnapshot({
        ...validSnapshot,
        targets: [{ metric: "m1" /* missing label/units/target/met */ }],
      }),
    ).toBeNull();
  });

  it("returns null when readiness is present but malformed", () => {
    expect(
      parseCompletionSnapshot({
        ...validSnapshot,
        readiness: { score: 90 /* missing rawScore/ceiling/coverage/openGateCount */ },
      }),
    ).toBeNull();
  });

  it("accepts a null readiness (zero-target goal)", () => {
    const zeroTargetSnap = buildCompletionSnapshot(baseInputs());
    const json = JSON.parse(JSON.stringify(zeroTargetSnap));
    expect(parseCompletionSnapshot(json)).toEqual(zeroTargetSnap);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// readinessSeries (REQ-002 / S8) — optional field, version stays 1.
// Malformed series must OMIT the field, never fail the whole parse.
// ─────────────────────────────────────────────────────────────────────────

describe("readinessSeries — build + parse", () => {
  it("buildCompletionSnapshot spreads the series through when the caller supplies one", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        readinessSeries: [
          { dateKey: "2026-01-05", score: 10 },
          { dateKey: "2026-01-12", score: 25 },
        ],
      }),
    );
    expect(snap.readinessSeries).toEqual([
      { dateKey: "2026-01-05", score: 10 },
      { dateKey: "2026-01-12", score: 25 },
    ]);
  });

  it("buildCompletionSnapshot OMITS the key entirely when the caller supplies none (not null, not [])", () => {
    const snap = buildCompletionSnapshot(baseInputs());
    expect(snap.readinessSeries).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(snap, "readinessSeries")).toBe(false);
  });

  it("round-trips a snapshot WITH a readinessSeries through JSON", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({
        readinessSeries: [
          { dateKey: "2026-01-05", score: 10 },
          { dateKey: "2026-01-12", score: 25 },
        ],
      }),
    );
    const json = JSON.parse(JSON.stringify(snap));
    expect(parseCompletionSnapshot(json)).toEqual(snap);
  });

  it("round-trips a snapshot with NO readinessSeries through JSON (legacy-row shape)", () => {
    const snap = buildCompletionSnapshot(baseInputs());
    const json = JSON.parse(JSON.stringify(snap));
    const parsed = parseCompletionSnapshot(json);
    expect(parsed).toEqual(snap);
    expect(parsed!.readinessSeries).toBeUndefined();
  });

  it("S8: a non-array readinessSeries omits ONLY that field — the rest of the snapshot still parses", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({ readinessSeries: [{ dateKey: "2026-01-05", score: 10 }] }),
    );
    const json = JSON.parse(JSON.stringify(snap));
    const corrupted = { ...json, readinessSeries: "not an array" };

    const parsed = parseCompletionSnapshot(corrupted);

    expect(parsed).not.toBeNull();
    expect(parsed!.readinessSeries).toBeUndefined();
    expect(parsed!.objective).toBe(snap.objective);
    expect(parsed!.targetsMet).toBe(snap.targetsMet);
  });

  it("S8: a malformed series ELEMENT (missing score) omits the field but keeps the rest of the snapshot", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({ readinessSeries: [{ dateKey: "2026-01-05", score: 10 }] }),
    );
    const json = JSON.parse(JSON.stringify(snap));
    const corrupted = { ...json, readinessSeries: [{ dateKey: "2026-01-05" }] };

    const parsed = parseCompletionSnapshot(corrupted);

    expect(parsed).not.toBeNull();
    expect(parsed!.readinessSeries).toBeUndefined();
    expect(parsed!.daysElapsed).toBe(snap.daysElapsed);
  });

  it("S8: a series element with the wrong dateKey type omits the field", () => {
    const snap = buildCompletionSnapshot(
      baseInputs({ readinessSeries: [{ dateKey: "2026-01-05", score: 10 }] }),
    );
    const json = JSON.parse(JSON.stringify(snap));
    const corrupted = { ...json, readinessSeries: [{ dateKey: 20260105, score: 10 }] };

    const parsed = parseCompletionSnapshot(corrupted);

    expect(parsed).not.toBeNull();
    expect(parsed!.readinessSeries).toBeUndefined();
  });
});

describe("parseGoalRetrospective", () => {
  const valid = {
    version: 1 as const,
    updatedAt: "2026-03-01T00:00:00.000Z",
    authoredWith: "user+coach" as const,
    reflection: "This was the hardest and best thing I've done.",
    wins: ["Consistent training", "Hit every retest"],
    challenges: ["Winter motivation dip"],
    lessons: ["Backdating completion is fine"],
    nextSteps: ["Pick the next summit"],
  };

  it("round-trips a valid retrospective through JSON", () => {
    const json = JSON.parse(JSON.stringify(valid));
    expect(parseGoalRetrospective(json)).toEqual(valid);
  });

  it("round-trips a minimal retrospective (no optional lists)", () => {
    const minimal = {
      version: 1 as const,
      updatedAt: "2026-03-01T00:00:00.000Z",
      authoredWith: "user" as const,
      reflection: "Just a short note.",
    };
    const json = JSON.parse(JSON.stringify(minimal));
    expect(parseGoalRetrospective(json)).toEqual(minimal);
  });

  it("returns null for garbage input", () => {
    expect(parseGoalRetrospective(null)).toBeNull();
    expect(parseGoalRetrospective(undefined)).toBeNull();
    expect(parseGoalRetrospective("nope")).toBeNull();
    expect(parseGoalRetrospective([])).toBeNull();
    expect(parseGoalRetrospective({})).toBeNull();
  });

  it("returns null for the wrong version", () => {
    expect(parseGoalRetrospective({ ...valid, version: 2 })).toBeNull();
  });

  it("returns null for an invalid authoredWith value", () => {
    expect(parseGoalRetrospective({ ...valid, authoredWith: "coach" })).toBeNull();
  });

  it("returns null when reflection is missing or non-string", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { reflection, ...rest } = valid;
    expect(parseGoalRetrospective(rest)).toBeNull();
    expect(parseGoalRetrospective({ ...valid, reflection: 5 })).toBeNull();
  });

  it("returns null when an optional list is present but malformed", () => {
    expect(parseGoalRetrospective({ ...valid, wins: "not an array" })).toBeNull();
    expect(parseGoalRetrospective({ ...valid, wins: [1, 2, 3] })).toBeNull();
  });
});
