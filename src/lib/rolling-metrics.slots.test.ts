// src/lib/rolling-metrics.slots.test.ts
//
// The Seam Strip assembler exports (UXR-PROG-14): rollingWindowSlots must be
// value-equivalent to computeRollingValueFromWorkouts — that equivalence is
// the whole safety argument for reading the strip and the readiness number
// off the same scan. Plus rollingMatrix's shared-universe/nesting doctrine
// and the untimed-session range (UXR-PROG-11, ⚑ resolved assembler-specced).
//
// Pure — no DB, no mocks (rolling-metrics.test.ts conventions).

import { describe, it, expect } from "vitest";
import {
  computeRollingValueFromWorkouts,
  isRollingHitSession,
  rollingMatrix,
  rollingSessionMatch,
  rollingWindowSlots,
  type RollingWorkoutSlotSource,
} from "@/lib/rolling-metrics";
import type { RollingParams } from "@/lib/metrics-registry";

const P10: RollingParams = { exercise: "Freestanding Handstand Hold", minSeconds: 10, hitsPerSession: 1, window: 6 };
const P20: RollingParams = { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 1, window: 6 };
const TRIPLE: RollingParams = { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 3, attemptCap: 5, window: 6 };

let seq = 0;
function w(dateIso: string, durations: (number | null)[], name = "Freestanding Handstand Hold"): RollingWorkoutSlotSource {
  return {
    id: `w-${String(++seq).padStart(3, "0")}`,
    startedAt: new Date(dateIso),
    exercises: [{ name, sets: durations.map((d) => ({ durationSec: d })) }],
  };
}

/** Newest-first, like the resolver's scan order. */
function newestFirst(...ws: RollingWorkoutSlotSource[]): RollingWorkoutSlotSource[] {
  return [...ws].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

describe("rollingWindowSlots ≡ computeRollingValueFromWorkouts (the safety argument)", () => {
  const universes: RollingWorkoutSlotSource[][] = [
    [], // never attempted
    newestFirst(w("2026-08-26T17:00Z", [8, 12])), // one session
    newestFirst(
      w("2026-08-26T17:00Z", [8, 12]),
      w("2026-09-01T17:00Z", [4, 6]),
      w("2026-09-05T17:00Z", [14]),
    ), // partial window
    newestFirst(
      w("2026-08-26T17:00Z", [8, 12]),
      w("2026-09-01T17:00Z", [4, 6]),
      w("2026-09-05T17:00Z", [14]),
      w("2026-09-09T17:00Z", [21, 12]),
      w("2026-09-14T17:00Z", [22, 8, 20]),
      w("2026-09-18T17:00Z", [25, 21, 6]),
    ), // full window
    newestFirst(
      w("2026-08-20T17:00Z", [30, 25, 22]), // triple20 in ≤5 attempts — rolls OUT below
      w("2026-08-26T17:00Z", [8, 12]),
      w("2026-09-01T17:00Z", [4, 6]),
      w("2026-09-05T17:00Z", [14]),
      w("2026-09-09T17:00Z", [21, 12]),
      w("2026-09-14T17:00Z", [22, 8, 20]),
      w("2026-09-18T17:00Z", [25, 21, 6]),
    ), // 7 sessions — oldest (the only triple20) left the window
    newestFirst(
      w("2026-09-01T17:00Z", [null, null], "Freestanding Handstand Hold"), // untimed — not a session
      w("2026-09-05T17:00Z", [14]),
      w("2026-09-09T17:00Z", [21]),
    ),
  ];

  for (const params of [P10, P20, TRIPLE]) {
    it(`value equals the resolver's for every fixture universe (min ${params.minSeconds}s, hits ${params.hitsPerSession ?? 1})`, () => {
      for (const u of universes) {
        const { slots, value, window } = rollingWindowSlots(u, params);
        expect(value).toBe(computeRollingValueFromWorkouts(u, params));
        expect(window).toBe(6);
        expect(slots.length).toBeLessThanOrEqual(6);
        // slots are newest-first
        for (let i = 1; i < slots.length; i++) {
          expect(slots[i - 1]!.startedAt.getTime()).toBeGreaterThanOrEqual(slots[i]!.startedAt.getTime());
        }
        // hit flags agree with the pure hit test
        for (const s of slots) {
          expect(s.hit).toBe(isRollingHitSession(s.attempts, params));
        }
      }
    });
  }

  it("zero sessions → value null, slots [] (— of 6, never 0 of 6)", () => {
    const { slots, value } = rollingWindowSlots([], P10);
    expect(value).toBeNull();
    expect(slots).toEqual([]);
  });
});

describe("rollingMatrix — one universe, three depths (report F-B)", () => {
  const FULL = newestFirst(
    w("2026-08-26T17:00Z", [8, 12]), // ≥10 hit (rung 1)
    w("2026-09-01T17:00Z", [4, 6]), // stub
    w("2026-09-05T17:00Z", [14]), // ≥10
    w("2026-09-09T17:00Z", [21, 12]), // ≥20
    w("2026-09-14T17:00Z", [22, 8, 20]), // ≥20
    w("2026-09-18T17:00Z", [25, 21, 24]), // triple20
  );

  it("session membership is threshold-independent and rows nest", () => {
    const m = rollingMatrix(FULL, "Freestanding Handstand Hold", 6, [P10, P20, TRIPLE]);
    expect(m.sessions).toHaveLength(6);
    const hits = Object.fromEntries(m.rows.map((r) => [r.params.minSeconds + ":" + (r.params.hitsPerSession ?? 1), r.hits]));
    expect(hits["10:1"]).toBe(5); // all but the stub
    expect(hits["20:1"]).toBe(3);
    expect(hits["20:3"]).toBe(1);
    // Nesting: each deeper tier's hits ≤ the shallower tier's.
    expect(hits["20:3"]!).toBeLessThanOrEqual(hits["20:1"]!);
    expect(hits["20:1"]!).toBeLessThanOrEqual(hits["10:1"]!);
  });

  it("every row equals its own computeRollingValueFromWorkouts (equivalence per track)", () => {
    const m = rollingMatrix(FULL, "Freestanding Handstand Hold", 6, [P10, P20, TRIPLE]);
    for (const row of m.rows) {
      expect(row.hits).toBe(computeRollingValueFromWorkouts(FULL, row.params));
    }
  });

  it("regression roll-out: a 7th session pushes the triple20 out and the gate row goes dark (F5)", () => {
    // Six sessions, the OLDEST being the only triple20 → GATE lit (1 of 6).
    const sixWithOldTriple = newestFirst(
      w("2026-08-20T17:00Z", [30, 25, 22]), // the only triple20 — oldest slot
      w("2026-08-26T17:00Z", [8, 12]),
      w("2026-09-01T17:00Z", [4, 6]),
      w("2026-09-05T17:00Z", [14]),
      w("2026-09-09T17:00Z", [21, 12]),
      w("2026-09-14T17:00Z", [22, 8, 20]), // two ≥20s — NOT a triple
    );
    const before = rollingMatrix(sixWithOldTriple, "Freestanding Handstand Hold", 6, [TRIPLE]);
    expect(before.rows[0]!.hits).toBe(1); // GATE CLEAR

    // A 7th qualifying session (not a triple) lands → Aug 20 rolls out.
    const seven = newestFirst(...sixWithOldTriple, w("2026-09-18T17:00Z", [25, 12, 6]));
    const after = rollingMatrix(seven, "Freestanding Handstand Hold", 6, [TRIPLE]);
    expect(after.rows[0]!.hits).toBe(0); // GATE DARK — best-ever consistency, gate off anyway
    expect(after.sessions.some((s) => s.startedAt.toISOString().startsWith("2026-08-20"))).toBe(false);
    // Equivalence holds through the regression:
    expect(after.rows[0]!.hits).toBe(computeRollingValueFromWorkouts(seven, TRIPLE));
  });

  it("untimed sessions count ONLY from the oldest slot's startedAt onward (UXR-PROG-11)", () => {
    const withUntimed = newestFirst(
      ...FULL,
      // Untimed handstand day INSIDE the window span:
      w("2026-09-16T17:00Z", [null]),
      // Untimed handstand day BEFORE the oldest slot — outside the range:
      w("2026-08-01T17:00Z", [null, null]),
    );
    const m = rollingMatrix(withUntimed, "Freestanding Handstand Hold", 6, [P10, P20, TRIPLE]);
    expect(m.sessions).toHaveLength(6);
    expect(m.untimedSessionCount).toBe(1); // Sep 16 in-range; Aug 1 excluded
  });

  it("zero slots: every matched-but-untimed workout counts (day-one hole stays closed)", () => {
    const onlyUntimed = newestFirst(w("2026-09-16T17:00Z", [null]), w("2026-09-12T17:00Z", [null]));
    const m = rollingMatrix(onlyUntimed, "Freestanding Handstand Hold", 6, [P10]);
    expect(m.sessions).toHaveLength(0);
    expect(m.rows[0]!.hits).toBeNull();
    expect(m.untimedSessionCount).toBe(2);
  });

  it("unmatched workouts are invisible — no slot, no footnote increment", () => {
    const m = rollingMatrix(
      newestFirst(w("2026-09-16T17:00Z", [30, 30, 30], "Plank")),
      "Freestanding Handstand Hold",
      6,
      [P10],
    );
    expect(m.sessions).toHaveLength(0);
    expect(m.untimedSessionCount).toBe(0);
  });

  it("tracks with a different exercise or window are NOT merged (guard)", () => {
    const other: RollingParams = { exercise: "Plank", minSeconds: 60, window: 6 };
    const wrongWindow: RollingParams = { ...P10, window: 4 };
    const m = rollingMatrix(FULL, "Freestanding Handstand Hold", 6, [P10, other, wrongWindow]);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]!.params).toEqual(P10);
  });
});

describe("rollingSessionMatch — the untimed/unmatched split", () => {
  it("distinguishes matched-untimed from unmatched", () => {
    expect(rollingSessionMatch([{ name: "Plank", sets: [{ durationSec: 30 }] }], "Freestanding Handstand Hold"))
      .toEqual({ matched: false, attempts: null });
    expect(
      rollingSessionMatch(
        [{ name: "Freestanding Handstand Hold", sets: [{ durationSec: null }] }],
        "Freestanding Handstand Hold",
      ),
    ).toEqual({ matched: true, attempts: null });
    expect(
      rollingSessionMatch(
        [{ name: "Freestanding Handstand Hold", sets: [{ durationSec: 12 }] }],
        "Freestanding Handstand Hold",
      ),
    ).toEqual({ matched: true, attempts: [12] });
  });
});
