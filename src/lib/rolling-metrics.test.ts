// src/lib/rolling-metrics.test.ts
//
// Pure-math matrix for the rolling:* session-consistency family
// (rolling-metrics.ts) + GoalTargetSchema/RollingParamsSchema refinement
// coverage (metrics-registry.ts). Everything here is pure and client-safe —
// no DB, no mocking (conventions mirror rarity-core.test.ts).
//
// The doctrine under test (examples/phase2a-goals-import-spec.md §rolling):
// window 6, N-of-window hit bars, triple20 = 3× ≥20s within ≤5 attempts in
// one block, qualifying-session universe, and MUST-REGRESS window roll-out.

import { describe, it, expect } from "vitest";
import {
  rollingSessionAttempts,
  isRollingHitSession,
  computeRollingHits,
  computeRollingValueFromWorkouts,
  rollingParamsFromTargets,
  canonicalizeRollingTargets,
} from "@/lib/rolling-metrics";
import {
  GoalTargetSchema,
  RollingParamsSchema,
  ROLLING_METRIC_PREFIX,
  type GoalTarget,
  type RollingParams,
} from "@/lib/metrics-registry";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Simple bar: one ≥20s hold makes a hit-session (defaults: hits 1, window 6). */
const SIMPLE_20S: RollingParams = {
  exercise: "Freestanding Handstand Hold",
  minSeconds: 20,
};

/** The spec's triple20: 3× ≥20s within ≤5 attempts in one block, of last 6. */
const TRIPLE_20: RollingParams = {
  exercise: "Freestanding Handstand Hold",
  minSeconds: 20,
  hitsPerSession: 3,
  attemptCap: 5,
  window: 6,
};

// ─── rollingSessionAttempts — session universe + attempt sequence ─────────────

describe("rollingSessionAttempts — session universe + attempt-sequence doctrine", () => {
  it("no matching exercise → null (workout is not a session)", () => {
    const attempts = rollingSessionAttempts(
      [{ name: "Bench Press", sets: [{ durationSec: 30 }] }],
      "Freestanding Handstand Hold",
    );
    expect(attempts).toBeNull();
  });

  it("matching exercise but ALL sets duration-less → null (timed holds define the session)", () => {
    const attempts = rollingSessionAttempts(
      [{ name: "Freestanding Handstand Hold", sets: [{ durationSec: null }, { durationSec: null }] }],
      "Freestanding Handstand Hold",
    );
    expect(attempts).toBeNull();
  });

  it("duration-less sets are dropped — not attempts, no attemptCap slot", () => {
    const attempts = rollingSessionAttempts(
      [
        {
          name: "Freestanding Handstand Hold",
          sets: [{ durationSec: 8 }, { durationSec: null }, { durationSec: 21 }],
        },
      ],
      "Freestanding Handstand Hold",
    );
    // null dropped; order preserved
    expect(attempts).toEqual([8, 21]);
  });

  it("alias-map folding: params 'Plank' matches sets logged under 'Plank Max Hold'", () => {
    const attempts = rollingSessionAttempts(
      [{ name: "Plank Max Hold", sets: [{ durationSec: 120 }] }],
      "Plank",
    );
    expect(attempts).toEqual([120]);
  });

  it("alias matching is case-insensitive for CURATED names ('pull up' → Pull-Up)", () => {
    const attempts = rollingSessionAttempts(
      [{ name: "pull up", sets: [{ durationSec: 40 }] }],
      "Pull-Up",
    );
    expect(attempts).toEqual([40]);
  });

  it("UNMAPPED names match exact-trimmed only — a case variant forks the universe until curated (gotchas §B-2)", () => {
    // canonicalExerciseName passes unmapped names through trimmed, case-preserved.
    const trimmed = rollingSessionAttempts(
      [{ name: "  Freestanding Handstand Hold  ", sets: [{ durationSec: 25 }] }],
      "Freestanding Handstand Hold",
    );
    expect(trimmed).toEqual([25]);

    const caseVariant = rollingSessionAttempts(
      [{ name: "freestanding handstand hold", sets: [{ durationSec: 25 }] }],
      "Freestanding Handstand Hold",
    );
    // NOT a match — same rule that fragments PRs/records for uncurated spellings.
    expect(caseVariant).toBeNull();
  });

  it("multiple matching exercises in one workout merge into ONE attempt sequence in stable (orderIndex, setIndex) order", () => {
    // Caller passes exercises ordered by orderIndex (the resolver's query does);
    // merged order = first exercise's sets, then the second's.
    const attempts = rollingSessionAttempts(
      [
        { name: "Freestanding Handstand Hold", sets: [{ durationSec: 5 }, { durationSec: 21 }] },
        { name: "Toe Pulls (wall)", sets: [{ durationSec: 60 }] }, // non-matching, ignored
        { name: "Freestanding Handstand Hold", sets: [{ durationSec: 23 }] },
      ],
      "Freestanding Handstand Hold",
    );
    expect(attempts).toEqual([5, 21, 23]);
  });
});

// ─── isRollingHitSession — hit test per session ───────────────────────────────

describe("isRollingHitSession — no attemptCap", () => {
  it("empty attempt sequence → false", () => {
    expect(isRollingHitSession([], SIMPLE_20S)).toBe(false);
  });

  it("default hitsPerSession=1: a single qualifying hold anywhere is a hit", () => {
    expect(isRollingHitSession([3, 7, 25], SIMPLE_20S)).toBe(true);
  });

  it("exactly-threshold duration qualifies (≥ is inclusive: 20 vs minSeconds 20)", () => {
    expect(isRollingHitSession([20], SIMPLE_20S)).toBe(true);
  });

  it("sub-threshold near-miss does NOT qualify (19 vs 20)", () => {
    expect(isRollingHitSession([19, 19, 19], SIMPLE_20S)).toBe(false);
  });

  it("hitsPerSession=3 without a cap: 3 qualifying holds anywhere in the session pass", () => {
    const params: RollingParams = { ...SIMPLE_20S, hitsPerSession: 3 };
    expect(isRollingHitSession([21, 2, 3, 22, 4, 5, 6, 23], params)).toBe(true);
  });

  it("hitsPerSession=3: only 2 qualifying → false", () => {
    const params: RollingParams = { ...SIMPLE_20S, hitsPerSession: 3 };
    expect(isRollingHitSession([21, 2, 3, 22, 4], params)).toBe(false);
  });
});

describe("isRollingHitSession — attemptCap sliding span", () => {
  it("3 hits at attempt positions [1,3,5] pass cap 5 (span of exactly 5 consecutive attempts)", () => {
    // qualifying at 1-indexed positions 1, 3, 5 — misses occupy the slots between.
    expect(isRollingHitSession([25, 5, 22, 4, 30], TRIPLE_20)).toBe(true);
  });

  it("3 hits at positions [1,3,7] FAIL cap 5 (no 5-attempt span holds all three)", () => {
    expect(isRollingHitSession([25, 5, 22, 4, 3, 2, 30], TRIPLE_20)).toBe(false);
  });

  it("exactly-cap boundary: 2 hits spanning positions [1,5] pass cap 5; [1,6] fail", () => {
    const params: RollingParams = { ...SIMPLE_20S, hitsPerSession: 2, attemptCap: 5 };
    expect(isRollingHitSession([25, 1, 2, 3, 21], params)).toBe(true); // span = 5 = cap
    expect(isRollingHitSession([25, 1, 2, 3, 4, 21], params)).toBe(false); // span = 6 > cap
  });

  it("cap larger than the attempt count degrades to the whole-session test", () => {
    const params: RollingParams = { ...SIMPLE_20S, hitsPerSession: 2, attemptCap: 10 };
    expect(isRollingHitSession([21, 3, 22], params)).toBe(true);
  });

  it("hits later in a long grind still count — the span slides, it is not anchored at attempt 1", () => {
    // 8 attempts; the 3 hits land at positions 4,6,8 → span 5 ≤ cap 5.
    expect(isRollingHitSession([2, 3, 4, 21, 5, 22, 6, 23], TRIPLE_20)).toBe(true);
  });

  it("defensive: attemptCap < hitsPerSession (unrepresentable via schema) can never pass", () => {
    const params: RollingParams = { ...SIMPLE_20S, hitsPerSession: 3, attemptCap: 2 };
    expect(isRollingHitSession([25, 25, 25], params)).toBe(false);
  });

  it("cap 1: each attempt stands alone — one qualifying hold passes hitsPerSession 1", () => {
    const params: RollingParams = { ...SIMPLE_20S, hitsPerSession: 1, attemptCap: 1 };
    expect(isRollingHitSession([3, 25, 4], params)).toBe(true);
    expect(isRollingHitSession([3, 4], params)).toBe(false);
  });
});

// ─── computeRollingHits — the trailing-window value ──────────────────────────

describe("computeRollingHits — trailing window + MUST-REGRESS", () => {
  const hit = [25]; // one qualifying attempt
  const miss = [5]; // one sub-threshold attempt

  it("empty history → null (untested — never a numeric 0)", () => {
    expect(computeRollingHits([], SIMPLE_20S)).toBeNull();
  });

  it("one session, no hit → 0 (tested and honest zero, distinct from null)", () => {
    expect(computeRollingHits([miss], SIMPLE_20S)).toBe(0);
  });

  it("window roll-out REGRESSION: a hit at session −7 stops counting under window 6", () => {
    // Newest-first: six misses, then the old hit as the 7th-newest session.
    const sessions = [miss, miss, miss, miss, miss, miss, hit];
    expect(computeRollingHits(sessions, SIMPLE_20S)).toBe(0); // default window 6
    expect(computeRollingHits(sessions, { ...SIMPLE_20S, window: 7 })).toBe(1);
  });

  it("counts hit-sessions within the window (4-of-6 bar shape)", () => {
    const sessions = [hit, miss, hit, hit, miss, hit];
    expect(computeRollingHits(sessions, SIMPLE_20S)).toBe(4);
  });

  it("fewer sessions than the window: value counts what exists (2 hits of 3 sessions ever)", () => {
    expect(computeRollingHits([hit, miss, hit], SIMPLE_20S)).toBe(2);
  });

  it("value is capped by the window: 8 straight hit-sessions → 6 under window 6", () => {
    const sessions = Array.from({ length: 8 }, () => hit);
    expect(computeRollingHits(sessions, SIMPLE_20S)).toBe(6);
  });

  it("window 1: only the newest session matters", () => {
    expect(computeRollingHits([miss, hit], { ...SIMPLE_20S, window: 1 })).toBe(0);
    expect(computeRollingHits([hit, miss], { ...SIMPLE_20S, window: 1 })).toBe(1);
  });
});

// ─── computeRollingValueFromWorkouts — end-to-end pure pipeline ───────────────

describe("computeRollingValueFromWorkouts — end-to-end", () => {
  const hs = (durations: (number | null)[]) => ({
    exercises: [
      { name: "Freestanding Handstand Hold", sets: durations.map((d) => ({ durationSec: d })) },
    ],
  });
  const otherWorkout = { exercises: [{ name: "Bench Press", sets: [{ durationSec: null }] }] };

  it("zero workouts → null (untested)", () => {
    expect(computeRollingValueFromWorkouts([], SIMPLE_20S)).toBeNull();
  });

  it("workouts exist but none is a qualifying session → null", () => {
    expect(computeRollingValueFromWorkouts([otherWorkout, otherWorkout], SIMPLE_20S)).toBeNull();
  });

  it("non-session workouts are SKIPPED — they do not consume window slots", () => {
    // 7 workouts newest-first: hit, 5 non-sessions, hit. Both holds are within
    // the trailing 6 SESSIONS (there are only 2 sessions) even though 7 workouts exist.
    const workouts = [hs([25]), otherWorkout, otherWorkout, otherWorkout, otherWorkout, otherWorkout, hs([22])];
    expect(computeRollingValueFromWorkouts(workouts, SIMPLE_20S)).toBe(2);
  });

  it("triple20 realistic block: 3× ≥20s inside 5 attempts in ≥1 of last 6 sessions", () => {
    // Newest-first: today's block lands the triple (positions 2,3,5 of a 6-attempt
    // block → span 4 ≤ 5); the five prior sessions were near-misses.
    const workouts = [
      hs([12, 21, 22, 8, 20, 5]),
      hs([19, 18]),
      hs([21, 21]), // only 2 hits — not a triple
      hs([5]),
      hs([22, 3, 3, 3, 3, 21]), // 2 hits, span 6 — not a triple anyway
      hs([10]),
    ];
    expect(computeRollingValueFromWorkouts(workouts, TRIPLE_20)).toBe(1);
  });

  it("regression scenario end-to-end: the same triple20 rolls out after 6 newer sessions", () => {
    const tripleSession = hs([21, 22, 23]);
    const missSession = hs([10, 12]);
    const before = [missSession, missSession, tripleSession];
    const after = [missSession, missSession, missSession, missSession, missSession, missSession, tripleSession];
    expect(computeRollingValueFromWorkouts(before, TRIPLE_20)).toBe(1);
    expect(computeRollingValueFromWorkouts(after, TRIPLE_20)).toBe(0);
  });
});

// ─── rollingParamsFromTargets — tolerant stored-JSON reader ──────────────────

describe("rollingParamsFromTargets — tolerant reader", () => {
  const goodTarget = {
    metric: "rolling:hs_triple20_of6",
    label: "3× ≥20s in one session — last 6",
    units: "of 6",
    direction: "increase",
    target: 1,
    weight: 0.2,
    rolling: TRIPLE_20,
  };

  it("extracts params for the matching metric", () => {
    expect(rollingParamsFromTargets([goodTarget], "rolling:hs_triple20_of6")).toEqual(TRIPLE_20);
  });

  it("non-array / null / object JSON → null", () => {
    expect(rollingParamsFromTargets(null, "rolling:x")).toBeNull();
    expect(rollingParamsFromTargets(undefined, "rolling:x")).toBeNull();
    expect(rollingParamsFromTargets({ metric: "rolling:x" }, "rolling:x")).toBeNull();
  });

  it("metric present but rolling params absent (legacy JSON) → null", () => {
    expect(
      rollingParamsFromTargets([{ ...goodTarget, rolling: undefined }], "rolling:hs_triple20_of6"),
    ).toBeNull();
  });

  it("malformed params are rejected: empty exercise, non-positive minSeconds, wrong types", () => {
    const base = { ...goodTarget };
    expect(
      rollingParamsFromTargets([{ ...base, rolling: { ...TRIPLE_20, exercise: "" } }], base.metric),
    ).toBeNull();
    expect(
      rollingParamsFromTargets([{ ...base, rolling: { ...TRIPLE_20, minSeconds: 0 } }], base.metric),
    ).toBeNull();
    expect(
      rollingParamsFromTargets([{ ...base, rolling: { ...TRIPLE_20, minSeconds: -5 } }], base.metric),
    ).toBeNull();
    expect(
      rollingParamsFromTargets([{ ...base, rolling: { ...TRIPLE_20, window: "6" } }], base.metric),
    ).toBeNull();
  });

  it("duplicate metric keys: first VALID entry wins", () => {
    const broken = { ...goodTarget, rolling: { exercise: "", minSeconds: 20 } };
    const other = { ...goodTarget, rolling: SIMPLE_20S };
    expect(rollingParamsFromTargets([broken, other], goodTarget.metric)).toEqual(SIMPLE_20S);
  });

  it("no matching metric → null", () => {
    expect(rollingParamsFromTargets([goodTarget], "rolling:other_slug")).toBeNull();
  });
});

// ─── canonicalizeRollingTargets — write-path normalization ───────────────────

describe("canonicalizeRollingTargets — write-path exercise canonicalization", () => {
  it("canonicalizes an alias-variant exercise and never mutates the input", () => {
    const input: GoalTarget[] = [
      {
        metric: "rolling:plank_2min_of6",
        label: "2-min plank — last 6",
        units: "of 6",
        direction: "increase",
        target: 4,
        weight: 0.1,
        rolling: { exercise: "Plank Max Hold", minSeconds: 120 },
      },
      {
        metric: "baseline:Pull-Up Max Reps",
        label: "Pull-up max",
        units: "reps",
        direction: "increase",
        target: 25,
        weight: 0.9,
      },
    ];
    const out = canonicalizeRollingTargets(input);

    expect(out[0]!.rolling!.exercise).toBe("Plank");
    // input untouched (fresh objects on the rolling path)
    expect(input[0]!.rolling!.exercise).toBe("Plank Max Hold");
    // non-rolling targets pass through unchanged
    expect(out[1]).toBe(input[1]);
  });
});

// ─── GoalTargetSchema — rolling cross-field refinement ───────────────────────

describe("GoalTargetSchema — rolling refinement (required/forbidden both directions)", () => {
  const rollingTarget = {
    metric: `${ROLLING_METRIC_PREFIX}hs_20s_of6`,
    label: "≥20s hold — sessions hit, last 6",
    units: "of 6",
    direction: "increase" as const,
    target: 4,
    weight: 0.15,
    rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 20 },
  };

  it("rolling:* metric WITH params parses; defaults materialize (hitsPerSession 1, window 6)", () => {
    const parsed = GoalTargetSchema.parse(rollingTarget);
    expect(parsed.rolling).toEqual({
      exercise: "Freestanding Handstand Hold",
      minSeconds: 20,
      hitsPerSession: 1,
      window: 6,
    });
  });

  it("rolling:* metric WITHOUT params is rejected (params carry all semantics)", () => {
    const bare = { ...rollingTarget, rolling: undefined };
    const result = GoalTargetSchema.safeParse(bare);
    expect(result.success).toBe(false);
  });

  it("params on a NON-rolling metric are rejected (would silently do nothing)", () => {
    const result = GoalTargetSchema.safeParse({
      ...rollingTarget,
      metric: "log:hs_sessions_20s_of6",
    });
    expect(result.success).toBe(false);
  });

  it("every existing family still parses without params (byte-identical behavior)", () => {
    const existing = [
      { metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 0.05 },
      { metric: "baseline:Pull-Up Max Reps", label: "Pull-up max", units: "reps", direction: "increase", target: 25, weight: 0.07 },
      { metric: "hike:prep_completion", label: "Prep hikes", units: "hikes", direction: "increase", target: 6, weight: 0.3, gating: true },
      { metric: "log:applications_sent", label: "Apps", units: "apps", direction: "increase", target: 50, weight: 0.3, cumulative: true },
      { metric: "exercise:Bench Press", label: "Bench 1RM", units: "lb", direction: "increase", target: 200, weight: 0.28 },
    ];
    for (const t of existing) {
      const result = GoalTargetSchema.safeParse(t);
      expect(result.success).toBe(true);
      expect(result.success && result.data.rolling).toBeUndefined();
    }
  });

  it("attemptCap < hitsPerSession is rejected; == passes", () => {
    const bad = GoalTargetSchema.safeParse({
      ...rollingTarget,
      rolling: { exercise: "X", minSeconds: 20, hitsPerSession: 3, attemptCap: 2 },
    });
    expect(bad.success).toBe(false);

    const exact = GoalTargetSchema.safeParse({
      ...rollingTarget,
      rolling: { exercise: "X", minSeconds: 20, hitsPerSession: 3, attemptCap: 3 },
    });
    expect(exact.success).toBe(true);
  });

  it("attemptCap ≥ defaulted hitsPerSession=1 is accepted when hitsPerSession is omitted", () => {
    const result = GoalTargetSchema.safeParse({
      ...rollingTarget,
      rolling: { exercise: "X", minSeconds: 20, attemptCap: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("RollingParamsSchema bounds: minSeconds > 0; ints ≥ 1 for hitsPerSession/attemptCap/window", () => {
    expect(RollingParamsSchema.safeParse({ exercise: "X", minSeconds: 0 }).success).toBe(false);
    expect(RollingParamsSchema.safeParse({ exercise: "X", minSeconds: -1 }).success).toBe(false);
    expect(RollingParamsSchema.safeParse({ exercise: "", minSeconds: 20 }).success).toBe(false);
    expect(RollingParamsSchema.safeParse({ exercise: "X", minSeconds: 20, hitsPerSession: 0 }).success).toBe(false);
    expect(RollingParamsSchema.safeParse({ exercise: "X", minSeconds: 20, hitsPerSession: 1.5 }).success).toBe(false);
    expect(RollingParamsSchema.safeParse({ exercise: "X", minSeconds: 20, window: 0 }).success).toBe(false);
    expect(RollingParamsSchema.safeParse({ exercise: "X", minSeconds: 20, attemptCap: 0 }).success).toBe(false);
    // fractional seconds thresholds are allowed (durations are compared as numbers)
    expect(RollingParamsSchema.safeParse({ exercise: "X", minSeconds: 12.5 }).success).toBe(true);
  });
});
