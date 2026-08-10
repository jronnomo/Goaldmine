// src/lib/attribution.test.ts
//
// #307/#308/#309 — the pure auto-link evaluators, exercised with NO DB and no
// mocks (the module imports only exercise-canonical + attribution-rules
// types). Matrix per the issue ACs:
//   evaluateWorkoutLinks    — hint matching (canonical ∩ canonical), Program
//                             attributionRules (title/exercise/source, ANY-
//                             criterion OR), member/status gating, degenerate
//                             rule inputs, hint∪rule union, ordering.
//   evaluateNutritionLinks  — fitness-kind-only, no rules input at all.
//   evaluateMirrorLinkGoalIds — membership + active-status gate for the
//                             Hike/LogEntry goalId mirrors.

import { describe, it, expect } from "vitest";

import {
  evaluateWorkoutLinks,
  evaluateNutritionLinks,
  evaluateMirrorLinkGoalIds,
  type AttributionMemberGoal,
  type WorkoutLinkActivity,
} from "@/lib/attribution";
import type { AttributionRule } from "@/lib/attribution-rules";

// ── Fixtures — the founder Phase-2A shape ────────────────────────────────────

const HANDSTAND: AttributionMemberGoal = { id: "g-handstand", kind: "fitness", status: "active" };
const CUT: AttributionMemberGoal = { id: "g-cut", kind: "fitness", status: "active" };
const AWS: AttributionMemberGoal = { id: "g-aws", kind: "project", status: "active" };
const PAUSED: AttributionMemberGoal = { id: "g-paused", kind: "fitness", status: "paused" };
const ACHIEVED: AttributionMemberGoal = { id: "g-achieved", kind: "fitness", status: "achieved" };

const MEMBERS = [HANDSTAND, CUT, AWS, PAUSED, ACHIEVED];

function hints(entries: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(entries));
}

function workout(partial: Partial<WorkoutLinkActivity>): WorkoutLinkActivity {
  return { exerciseNames: [], workoutTitle: null, source: null, ...partial };
}

const NO_HINTS = new Map<string, string[]>();

// ── evaluateWorkoutLinks — hint matching ─────────────────────────────────────

describe("evaluateWorkoutLinks — hint matching", () => {
  it("exact canonical intersection links the goal", () => {
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["Wall Handstand Hold", "Squat"] }),
      MEMBERS,
      hints({ [HANDSTAND.id]: ["Wall Handstand Hold"] }),
      null,
    );
    expect(out).toEqual([HANDSTAND.id]);
  });

  it("alias variants fold both directions (records.ts canonicalization verbatim)", () => {
    // Logged as the Strong spelling, hinted as the canonical …
    expect(
      evaluateWorkoutLinks(
        workout({ exerciseNames: ["Pull Up"] }),
        MEMBERS,
        hints({ [HANDSTAND.id]: ["Pull-Up"] }),
        null,
      ),
    ).toEqual([HANDSTAND.id]);
    // … and hinted as the baseline testName, logged as the working name.
    expect(
      evaluateWorkoutLinks(
        workout({ exerciseNames: ["Plank"] }),
        MEMBERS,
        hints({ [CUT.id]: ["Plank Max Hold"] }),
        null,
      ),
    ).toEqual([CUT.id]);
  });

  it("comparison is case-insensitive even for unmapped names", () => {
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["kettlebell swing"] }),
      MEMBERS,
      hints({ [CUT.id]: ["Kettlebell Swing"] }),
      null,
    );
    expect(out).toEqual([CUT.id]);
  });

  it("no intersection → no link", () => {
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["Bench Press"] }),
      MEMBERS,
      hints({ [HANDSTAND.id]: ["Wall Handstand Hold"] }),
      null,
    );
    expect(out).toEqual([]);
  });

  it("hints are kind-agnostic: a project-kind member goal can hint-match", () => {
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["Incline Walk"] }),
      MEMBERS,
      hints({ [AWS.id]: ["Incline Walk"] }),
      null,
    );
    expect(out).toEqual([AWS.id]);
  });

  it("non-active member goals never hint-match (paused, achieved)", () => {
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["Squat"] }),
      MEMBERS,
      hints({ [PAUSED.id]: ["Squat"], [ACHIEVED.id]: ["Squat"] }),
      null,
    );
    expect(out).toEqual([]);
  });

  it("zero member goals → [] (fast exit)", () => {
    expect(
      evaluateWorkoutLinks(workout({ exerciseNames: ["Squat"] }), [], NO_HINTS, null),
    ).toEqual([]);
  });
});

// ── evaluateWorkoutLinks — Program attributionRules ──────────────────────────

describe("evaluateWorkoutLinks — attributionRules", () => {
  it("titleContains: case-insensitive substring against the title", () => {
    const rules: AttributionRule[] = [
      { match: { titleContains: ["incline walk"] }, goalIds: [CUT.id, AWS.id] },
    ];
    const out = evaluateWorkoutLinks(
      workout({ workoutTitle: "Monday Incline Walk + audio" }),
      MEMBERS,
      NO_HINTS,
      rules,
    );
    expect(out).toEqual([CUT.id, AWS.id]);
  });

  it("titleContains never matches a null title", () => {
    const rules: AttributionRule[] = [{ match: { titleContains: ["walk"] }, goalIds: [CUT.id] }];
    expect(
      evaluateWorkoutLinks(workout({ workoutTitle: null }), MEMBERS, NO_HINTS, rules),
    ).toEqual([]);
  });

  it("exerciseContains: substring with BOTH sides canonicalized (rule 'pull up' hits logged 'Pull-Up Max Reps')", () => {
    const rules: AttributionRule[] = [
      { match: { exerciseContains: ["pull up"] }, goalIds: [HANDSTAND.id] },
    ];
    // "Pull-Up Max Reps" canonicalizes to "Pull-Up"; the rule entry "pull up"
    // canonicalizes to "Pull-Up" too — substring hit.
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["Pull-Up Max Reps"] }),
      MEMBERS,
      NO_HINTS,
      rules,
    );
    expect(out).toEqual([HANDSTAND.id]);
  });

  it("exerciseContains: an UNMAPPED rule entry still substring-matches within a canonical name", () => {
    const rules: AttributionRule[] = [
      { match: { exerciseContains: ["handstand"] }, goalIds: [HANDSTAND.id] },
    ];
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["Wall Handstand Hold"] }),
      MEMBERS,
      NO_HINTS,
      rules,
    );
    expect(out).toEqual([HANDSTAND.id]);
  });

  it("source: EXACT match only — no substring, no case folding", () => {
    const rules: AttributionRule[] = [{ match: { source: "strong" }, goalIds: [CUT.id] }];
    expect(
      evaluateWorkoutLinks(workout({ source: "strong" }), MEMBERS, NO_HINTS, rules),
    ).toEqual([CUT.id]);
    expect(
      evaluateWorkoutLinks(workout({ source: "Strong" }), MEMBERS, NO_HINTS, rules),
    ).toEqual([]);
    expect(
      evaluateWorkoutLinks(workout({ source: "strong-export" }), MEMBERS, NO_HINTS, rules),
    ).toEqual([]);
    expect(evaluateWorkoutLinks(workout({ source: null }), MEMBERS, NO_HINTS, rules)).toEqual([]);
  });

  it("ANY criterion hits ⇒ the rule matches (OR within a rule)", () => {
    const rules: AttributionRule[] = [
      {
        match: { titleContains: ["no-such-title"], exerciseContains: ["no-such-exercise"], source: "manual" },
        goalIds: [CUT.id],
      },
    ];
    const out = evaluateWorkoutLinks(
      workout({ workoutTitle: "Leg day", exerciseNames: ["Squat"], source: "manual" }),
      MEMBERS,
      NO_HINTS,
      rules,
    );
    expect(out).toEqual([CUT.id]);
  });

  it("a matching rule links ONLY goalIds that are current ACTIVE members — non-members and paused/achieved members are dropped", () => {
    const rules: AttributionRule[] = [
      {
        match: { titleContains: ["walk"] },
        goalIds: ["g-not-a-member", PAUSED.id, ACHIEVED.id, CUT.id],
      },
    ];
    const out = evaluateWorkoutLinks(
      workout({ workoutTitle: "Incline Walk" }),
      MEMBERS,
      NO_HINTS,
      rules,
    );
    expect(out).toEqual([CUT.id]);
  });

  it("degenerate rules are inert: empty match {}, empty goalIds, empty/whitespace criterion strings", () => {
    const rules: AttributionRule[] = [
      { match: {}, goalIds: [CUT.id] }, // no criteria → matches nothing
      { match: { titleContains: ["walk"] }, goalIds: [] }, // matches, links nothing
      { match: { titleContains: ["", "   "] }, goalIds: [CUT.id] }, // "" would substring-match EVERYTHING — must not
      { match: { exerciseContains: [""] }, goalIds: [CUT.id] },
      { match: { source: "  " }, goalIds: [CUT.id] },
    ];
    const out = evaluateWorkoutLinks(
      workout({ workoutTitle: "Incline Walk", exerciseNames: ["Squat"], source: "manual" }),
      MEMBERS,
      NO_HINTS,
      rules,
    );
    expect(out).toEqual([]);
  });

  it("rules null and rules [] both contribute nothing", () => {
    const activity = workout({ workoutTitle: "Incline Walk" });
    expect(evaluateWorkoutLinks(activity, MEMBERS, NO_HINTS, null)).toEqual([]);
    expect(evaluateWorkoutLinks(activity, MEMBERS, NO_HINTS, [])).toEqual([]);
  });
});

// ── evaluateWorkoutLinks — union + ordering ──────────────────────────────────

describe("evaluateWorkoutLinks — hint ∪ rule union", () => {
  it("G4 gate-check shape: ONE incline-walk log links cut + AWS (rule) and handstand (Z2 hint) together", () => {
    const rules: AttributionRule[] = [
      {
        match: { titleContains: ["incline walk"] },
        goalIds: [CUT.id, AWS.id],
        note: "Z2 walks advance the cut and double as AWS audio time",
      },
    ];
    const out = evaluateWorkoutLinks(
      workout({ workoutTitle: "Incline Walk (Z2)", exerciseNames: ["Incline Walk"] }),
      MEMBERS,
      hints({ [HANDSTAND.id]: ["Incline Walk"] }),
      rules,
    );
    expect(out).toEqual([HANDSTAND.id, CUT.id, AWS.id]);
  });

  it("a goal selected by BOTH inputs appears once (dedupe), output in member-goal order", () => {
    const rules: AttributionRule[] = [
      { match: { exerciseContains: ["squat"] }, goalIds: [CUT.id, HANDSTAND.id] },
    ];
    const out = evaluateWorkoutLinks(
      workout({ exerciseNames: ["Squat"] }),
      MEMBERS,
      hints({ [CUT.id]: ["Squat"] }),
      rules,
    );
    // HANDSTAND precedes CUT in MEMBERS — member order wins, CUT not duplicated.
    expect(out).toEqual([HANDSTAND.id, CUT.id]);
  });
});

// ── evaluateNutritionLinks ───────────────────────────────────────────────────

describe("evaluateNutritionLinks", () => {
  it("links every ACTIVE fitness-kind member goal", () => {
    expect(evaluateNutritionLinks(MEMBERS)).toEqual([HANDSTAND.id, CUT.id]);
  });

  it("never links project-kind member goals (append-only: meals must not permanently attach to projects)", () => {
    expect(evaluateNutritionLinks([AWS])).toEqual([]);
  });

  it("never links paused/achieved fitness member goals", () => {
    expect(evaluateNutritionLinks([PAUSED, ACHIEVED])).toEqual([]);
  });

  it("zero members → []", () => {
    expect(evaluateNutritionLinks([])).toEqual([]);
  });
});

// ── evaluateMirrorLinkGoalIds ────────────────────────────────────────────────

describe("evaluateMirrorLinkGoalIds", () => {
  it("an active member goalId mirrors to [goalId]", () => {
    expect(evaluateMirrorLinkGoalIds(HANDSTAND.id, MEMBERS)).toEqual([HANDSTAND.id]);
  });

  it("null goalId → [] (caller resolves the focus fallback before calling)", () => {
    expect(evaluateMirrorLinkGoalIds(null, MEMBERS)).toEqual([]);
  });

  it("a non-member goalId → [] (goalId column stays authoritative; only members mirror)", () => {
    expect(evaluateMirrorLinkGoalIds("g-not-a-member", MEMBERS)).toEqual([]);
  });

  it("a paused/achieved member goalId → []", () => {
    expect(evaluateMirrorLinkGoalIds(PAUSED.id, MEMBERS)).toEqual([]);
    expect(evaluateMirrorLinkGoalIds(ACHIEVED.id, MEMBERS)).toEqual([]);
  });
});
