// src/lib/goal-identity.test.ts
//
// #290 — derived identity marks (research §7.8 test 1):
//   - the Phase 2A fixture produces [●/--target, ■/--success, ▲/--accent];
//   - a 4th FITNESS goal pushes the project goal out of slot 2 into overflow
//     (the documented identity-stability hazard, UXR-PV-08);
//   - createdAt ties are broken by id (the total-order requirement);
//   - isMonochromeSafe accepts the geometric triad + hollow forms + ◎ ★ and
//     rejects emoji (COLR glyphs where CSS color is a no-op);
//   - short label comes from the goal-date legend entry, else the truncated
//     objective first-clause fallback.

import { describe, it, expect } from "vitest";
import {
  assignGoalIdentities,
  isMonochromeSafe,
  shortGoalLabel,
  type GoalIdentityMember,
} from "@/lib/goal-identity";

const T0 = new Date("2026-06-01T12:00:00.000Z");
const T1 = new Date("2026-07-01T12:00:00.000Z");
const T2 = new Date("2026-08-01T12:00:00.000Z");

function member(overrides: Partial<GoalIdentityMember> & { id: string }): GoalIdentityMember {
  return {
    objective: `Objective for ${overrides.id}`,
    kind: "fitness",
    isFocus: false,
    createdAt: T1,
    legend: null,
    ...overrides,
  };
}

// The real Phase 2A trio: focus handstand (fitness), body comp (fitness),
// AWS cert (project).
const HANDSTAND = member({
  id: "g-handstand",
  objective: "Hold a freestanding handstand for 30 seconds",
  isFocus: true,
  createdAt: T0,
});
const BODYCOMP = member({
  id: "g-cut",
  objective: "Cut to 15% body fat, holding strength",
  createdAt: T1,
});
const AWS = member({
  id: "g-aws",
  objective: "Pass the AWS Solutions Architect Associate exam",
  kind: "project",
  createdAt: T0, // predates body comp — kind sort must still place it last
});

describe("assignGoalIdentities", () => {
  it("Phase 2A fixture → [●/target, ■/success, ▲/accent] in slot order", () => {
    // Shuffled input — the derived sort owns the order.
    const ids = assignGoalIdentities([AWS, BODYCOMP, HANDSTAND]);

    expect(ids.map((i) => i.goalId)).toEqual(["g-handstand", "g-cut", "g-aws"]);
    expect(ids.map((i) => i.slot)).toEqual([0, 1, 2]);
    expect(ids.map((i) => i.glyphFilled)).toEqual(["●", "■", "▲"]);
    expect(ids.map((i) => i.glyphHollow)).toEqual(["○", "□", "△"]);
    expect(ids.map((i) => i.hue)).toEqual([
      "var(--target)",
      "var(--success)",
      "var(--accent)",
    ]);
    expect(ids.map((i) => i.shape)).toEqual(["circle", "square", "triangle"]);
  });

  it("a 4th FITNESS goal pushes the project goal into the overflow bucket (UXR-PV-08)", () => {
    const newFitness = member({ id: "g-new-fitness", createdAt: T2 });
    const ids = assignGoalIdentities([HANDSTAND, BODYCOMP, AWS, newFitness]);

    expect(ids.map((i) => i.goalId)).toEqual([
      "g-handstand",
      "g-cut",
      "g-new-fitness",
      "g-aws",
    ]);
    const aws = ids.find((i) => i.goalId === "g-aws")!;
    expect(aws.slot).toBe(3);
    expect(aws.shape).toBe("overflow");
    expect(aws.hue).toBe("var(--muted)");
  });

  it("adding a PROJECT goal is safe — it sorts last, existing slots stable", () => {
    const newProject = member({ id: "g-chew", kind: "project", createdAt: T2 });
    const ids = assignGoalIdentities([HANDSTAND, BODYCOMP, AWS, newProject]);
    expect(ids.slice(0, 3).map((i) => i.goalId)).toEqual(["g-handstand", "g-cut", "g-aws"]);
    expect(ids[3]!.goalId).toBe("g-chew");
  });

  it("createdAt ties are broken by id — the total order is deterministic", () => {
    const a = member({ id: "g-aaa", createdAt: T1 });
    const b = member({ id: "g-bbb", createdAt: T1 });
    const forward = assignGoalIdentities([a, b]).map((i) => i.goalId);
    const backward = assignGoalIdentities([b, a]).map((i) => i.goalId);
    expect(forward).toEqual(["g-aaa", "g-bbb"]);
    expect(backward).toEqual(forward);
  });
});

describe("isMonochromeSafe", () => {
  it.each(["●", "■", "▲", "○", "□", "△", "◎", "★"])("accepts %s", (glyph) => {
    expect(isMonochromeSafe(glyph)).toBe(true);
  });

  it.each(["🥾", "⛏️", "🏔️", "🎯"])("rejects emoji %s (COLR — color: is a no-op)", (glyph) => {
    expect(isMonochromeSafe(glyph)).toBe(false);
  });
});

describe("shortGoalLabel", () => {
  it("uses the goal's OWN goal-date legend entry label when present", () => {
    const label = shortGoalLabel({
      objective: "Pass the AWS Solutions Architect Associate exam",
      legend: [{ icon: "▲", label: "AWS", kind: "goal-date" }],
    });
    expect(label).toBe("AWS");
  });

  it("falls back to the objective's first clause, truncated with an ellipsis", () => {
    const label = shortGoalLabel({
      objective: "Pass the AWS Solutions Architect Associate exam",
      legend: null,
    });
    // No separator → first 18 chars + ellipsis.
    expect(label).toBe("Pass the AWS Solut…");
    expect(label.length).toBeLessThanOrEqual(19);
  });

  it("splits on clause separators before truncating", () => {
    const label = shortGoalLabel({
      objective: "Summit Elbert — carry a 30 lb pack",
      legend: null,
    });
    expect(label).toBe("Summit Elbert");
  });

  it("a legendless goal never inherits the default legend's generic 'Goal date' label", () => {
    const label = shortGoalLabel({ objective: "Cut to 15% body fat", legend: null });
    expect(label).not.toBe("Goal date");
    expect(label).toBe("Cut to 15% body fa…");
  });
});
