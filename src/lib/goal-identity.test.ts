// src/lib/goal-identity.test.ts
// Identity derivation for the Program mark system (program-views research
// §7.8 test 1): the Phase 2A fixture produces [●/target, ■/success, ▲/accent];
// a 4th fitness goal pushes the project goal into the +N bucket; createdAt
// ties are broken by id; isMonochromeSafe accepts the geometric triad and
// rejects emoji.

import { describe, it, expect } from "vitest";
import {
  assignGoalIdentities,
  isMonochromeSafe,
  GOAL_MARK_SLOT_CAP,
  type GoalIdentityMember,
} from "@/lib/goal-identity";

const HANDSTAND: GoalIdentityMember = {
  id: "g-handstand",
  objective: "Freestanding Handstand — 20s hold, then 5 wall HSPU",
  kind: "fitness",
  status: "active",
  isFocus: true,
  createdAt: new Date("2026-07-01T00:00:00Z"),
};
const BODYCOMP: GoalIdentityMember = {
  id: "g-bodycomp",
  objective: "Reach 10% body fat",
  kind: "fitness",
  status: "active",
  isFocus: false,
  createdAt: new Date("2026-08-01T00:00:00Z"),
};
const AWS: GoalIdentityMember = {
  id: "g-aws",
  objective: "Pass the AWS Solutions Architect Associate exam",
  kind: "project",
  status: "active",
  isFocus: false,
  createdAt: new Date("2026-08-02T00:00:00Z"),
};

describe("assignGoalIdentities", () => {
  it("Phase 2A fixture → ●/--target, ■/--success, ▲/--accent in slot order", () => {
    const ids = assignGoalIdentities([HANDSTAND, BODYCOMP, AWS]);
    expect(ids.map((i) => i.goalId)).toEqual(["g-handstand", "g-bodycomp", "g-aws"]);
    expect(ids.map((i) => i.glyphFilled)).toEqual(["●", "■", "▲"]);
    expect(ids.map((i) => i.glyphHollow)).toEqual(["○", "□", "△"]);
    expect(ids.map((i) => i.hue)).toEqual([
      "var(--target)",
      "var(--success)",
      "var(--accent)",
    ]);
    expect(ids.map((i) => i.shape)).toEqual(["circle", "square", "triangle"]);
  });

  it("input order does not matter — the sort is a total order", () => {
    const shuffled = assignGoalIdentities([AWS, BODYCOMP, HANDSTAND]);
    expect(shuffled.map((i) => i.goalId)).toEqual([
      "g-handstand",
      "g-bodycomp",
      "g-aws",
    ]);
  });

  it("a 4th fitness goal pushes the project goal out of slot 2 into the +N bucket", () => {
    const fourth: GoalIdentityMember = {
      id: "g-mobility",
      objective: "Full pancake",
      kind: "fitness",
      status: "active",
      createdAt: new Date("2026-08-03T00:00:00Z"),
    };
    const ids = assignGoalIdentities([HANDSTAND, BODYCOMP, AWS, fourth]);
    const aws = ids.find((i) => i.goalId === "g-aws")!;
    expect(aws.slot).toBe(GOAL_MARK_SLOT_CAP); // 3 → overflow
    expect(aws.shape).toBeNull();
    expect(aws.hue).toBe("var(--muted)");
    // The new fitness goal took ▲'s slot.
    expect(ids.find((i) => i.goalId === "g-mobility")!.glyphFilled).toBe("▲");
  });

  it("createdAt ties are broken by id ascending", () => {
    const t = new Date("2026-08-01T00:00:00Z");
    const a: GoalIdentityMember = { id: "b-goal", objective: "B", kind: "fitness", status: "active", createdAt: t };
    const b: GoalIdentityMember = { id: "a-goal", objective: "A", kind: "fitness", status: "active", createdAt: t };
    expect(assignGoalIdentities([a, b]).map((i) => i.goalId)).toEqual([
      "a-goal",
      "b-goal",
    ]);
  });

  it("non-active members receive no identity", () => {
    const achieved: GoalIdentityMember = {
      ...HANDSTAND,
      id: "g-elbert",
      status: "achieved",
    };
    const ids = assignGoalIdentities([achieved, BODYCOMP, AWS]);
    expect(ids.map((i) => i.goalId)).toEqual(["g-bodycomp", "g-aws"]);
    expect(ids[0].glyphFilled).toBe("●"); // slots compact — no gap for the achieved goal
  });

  it("labels: monochrome-safe goal-date legend wins; emoji legends degrade to the objective clause", () => {
    const migrated = assignGoalIdentities([
      {
        ...HANDSTAND,
        legend: [{ icon: "●", label: "Handstand", kind: "goal-date" }],
      },
      {
        ...BODYCOMP,
        // Pre-E6 stock legend: emoji icon + generic label — must NOT be used.
        legend: [{ icon: "🎯", label: "Goal date", kind: "goal-date" }],
      },
      AWS,
    ]);
    expect(migrated[0].label).toBe("Handstand");
    // Objective fallback: first clause before a separator ("Reach 10% body fat" — no separator, short).
    expect(migrated[1].label).toBe("Reach 10% body fat");
    // No separator + long → truncated at 18 chars with an ellipsis.
    expect(migrated[2].label).toBe("Pass the AWS Solut…");
  });

  it("objective fallback splits on the first em-dash clause", () => {
    const [id] = assignGoalIdentities([HANDSTAND]);
    expect(id.label).toBe("Freestanding Hands…"); // "Freestanding Handstand" > 18 chars
  });
});

describe("isMonochromeSafe", () => {
  it("accepts the geometric mark set", () => {
    for (const g of ["●", "■", "▲", "○", "□", "△", "◎", "★"]) {
      expect(isMonochromeSafe(g)).toBe(true);
    }
  });
  it("rejects emoji and multi-char strings", () => {
    for (const g of ["🥾", "⛏️", "🏔️", "🎯", "📏", "●●", ""]) {
      expect(isMonochromeSafe(g)).toBe(false);
    }
  });
});
