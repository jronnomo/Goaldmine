// src/lib/attribution-rules.test.ts
//
// parseAttributionRules is the single trust boundary for the coach-authored
// Program.attributionRules Json column (design amendment 1). Contract under
// test: valid shapes round-trip, null/unset → null, ANY malformation → null
// without throwing (a bad Json blob must never take down membership or the
// auto-link engine), and unknown keys are stripped rather than invalidating
// the whole ruleset.

import { describe, it, expect } from "vitest";

import { parseAttributionRules, type AttributionRule } from "@/lib/attribution-rules";

const VALID_RULES: AttributionRule[] = [
  {
    match: { titleContains: ["incline walk", "walk"], source: "strong" },
    goalIds: ["goal-cut", "goal-aws"],
    note: "Z2 walks advance the cut and double as AWS audio time",
  },
  {
    match: { exerciseContains: ["Handstand"] },
    goalIds: ["goal-handstand"],
  },
];

describe("parseAttributionRules", () => {
  it("valid ruleset round-trips (all matcher kinds + optional note)", () => {
    expect(parseAttributionRules(VALID_RULES)).toEqual(VALID_RULES);
  });

  it("null and undefined (column never set) → null", () => {
    expect(parseAttributionRules(null)).toBeNull();
    expect(parseAttributionRules(undefined)).toBeNull();
  });

  it("empty array is a VALID, intentionally-empty ruleset → [] (distinct from null)", () => {
    expect(parseAttributionRules([])).toEqual([]);
  });

  it("empty match {} is a valid rule (all matchers optional per the documented shape)", () => {
    const rules = [{ match: {}, goalIds: ["goal-x"] }];
    expect(parseAttributionRules(rules)).toEqual(rules);
  });

  it("empty goalIds is shape-valid (a no-op rule) — rejecting it would nullify the whole ruleset", () => {
    const rules = [{ match: { titleContains: ["run"] }, goalIds: [] }];
    expect(parseAttributionRules(rules)).toEqual(rules);
  });

  it("malformed: not an array → null, no throw", () => {
    expect(parseAttributionRules({ match: {}, goalIds: [] })).toBeNull();
    expect(parseAttributionRules("[]")).toBeNull();
    expect(parseAttributionRules(42)).toBeNull();
  });

  it("malformed: rule missing goalIds → null", () => {
    expect(parseAttributionRules([{ match: { titleContains: ["walk"] } }])).toBeNull();
  });

  it("malformed: rule missing match → null", () => {
    expect(parseAttributionRules([{ goalIds: ["goal-x"] }])).toBeNull();
  });

  it("malformed: wrong element types (goalIds as string, titleContains as string) → null", () => {
    expect(parseAttributionRules([{ match: {}, goalIds: "goal-x" }])).toBeNull();
    expect(
      parseAttributionRules([{ match: { titleContains: "walk" }, goalIds: ["goal-x"] }]),
    ).toBeNull();
    expect(parseAttributionRules([{ match: {}, goalIds: [1, 2] }])).toBeNull();
  });

  it("one malformed rule among valid ones nullifies the ruleset (all-or-nothing — partial rules could silently mis-attribute)", () => {
    const mixed = [VALID_RULES[0], { goalIds: ["goal-x"] }];
    expect(parseAttributionRules(mixed)).toBeNull();
  });

  it("unknown extra keys are stripped, not fatal (forward-compatible writers)", () => {
    const withExtras = [
      {
        match: { titleContains: ["walk"], futureMatcher: "ignored" },
        goalIds: ["goal-x"],
        priority: 5,
      },
    ];
    expect(parseAttributionRules(withExtras)).toEqual([
      { match: { titleContains: ["walk"] }, goalIds: ["goal-x"] },
    ]);
  });
});
