// src/lib/metrics-registry.test.ts
//
// Unit tests for the career goal template pack + resolveTemplateTargets.
// Pure functions: no DB, no mocking required.
// Conventions mirror rarity-core.test.ts / food-units.test.ts / legend.test.ts.

import { describe, it, expect } from "vitest";
import {
  CAREER_DEFAULT_TARGETS,
  GOAL_TEMPLATES,
  targetsForTemplate,
  resolveTemplateTargets,
} from "@/lib/metrics-registry";
import type { GoalTarget } from "@/lib/metrics-registry";

// ─── CAREER_DEFAULT_TARGETS shape ───────────────────────────────────────────

describe("CAREER_DEFAULT_TARGETS", () => {
  it("has exactly 5 targets", () => {
    expect(CAREER_DEFAULT_TARGETS).toHaveLength(5);
  });

  it("weights sum to 1.00 within epsilon", () => {
    const sum = CAREER_DEFAULT_TARGETS.reduce((acc, t) => acc + t.weight, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it("four targets are cumulative:true; log:connections omits cumulative entirely", () => {
    const cumulativeCount = CAREER_DEFAULT_TARGETS.filter((t) => t.cumulative === true).length;
    expect(cumulativeCount).toBe(4);
    const connections = CAREER_DEFAULT_TARGETS.find((t) => t.metric === "log:connections")!;
    expect(connections.cumulative).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(connections, "cumulative")).toBe(false);
  });

  it("every metric is log:-prefixed", () => {
    expect(CAREER_DEFAULT_TARGETS.every((t) => t.metric.startsWith("log:"))).toBe(true);
  });

  it("every target has a rationale stating the number is a starting default the coach adapts at intake", () => {
    for (const t of CAREER_DEFAULT_TARGETS) {
      expect(t.rationale).toBeTruthy();
      expect(t.rationale!.toLowerCase()).toMatch(/starting default/);
      expect(t.rationale!.toLowerCase()).toMatch(/intake|adapt/);
    }
  });
});

// ─── targetsForTemplate — deep-copy mutation safety ─────────────────────────

describe("targetsForTemplate", () => {
  it("returns a fresh array copy — mutating the result never mutates the constant", () => {
    const copy = targetsForTemplate("career");
    expect(copy).not.toBe(CAREER_DEFAULT_TARGETS);
    copy.push({
      metric: "log:fake",
      label: "x",
      units: "x",
      direction: "increase",
      target: 1,
      weight: 0,
    });
    expect(CAREER_DEFAULT_TARGETS).toHaveLength(5);
  });

  it("returns fresh per-object copies — mutating a field never mutates the constant's object", () => {
    const copy = targetsForTemplate("career");
    copy[0].target = 999999;
    expect(CAREER_DEFAULT_TARGETS[0].target).not.toBe(999999);
    expect(CAREER_DEFAULT_TARGETS[0].target).toBe(50);
  });

  it("GOAL_TEMPLATES.career is the same underlying pack (targetsForTemplate copies, GOAL_TEMPLATES itself does not)", () => {
    expect(GOAL_TEMPLATES.career).toBe(CAREER_DEFAULT_TARGETS);
  });
});

// ─── resolveTemplateTargets — full matrix ───────────────────────────────────

describe("resolveTemplateTargets", () => {
  const explicitTargets: GoalTarget[] = [
    { metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 150, weight: 1 },
  ];

  it("explicit targets win even when template is also set", () => {
    const result = resolveTemplateTargets({ template: "career", targets: explicitTargets, kind: "project" });
    expect(result).toBe(explicitTargets);
  });

  it("template + kind='project', no targets → seeds the career pack (fresh copy, not the shared constant)", () => {
    const result = resolveTemplateTargets({ template: "career", kind: "project" });
    expect(result).toHaveLength(5);
    expect(result).not.toBe(CAREER_DEFAULT_TARGETS);
  });

  it("template + kind='fitness' → throws mentioning kind='project'", () => {
    expect(() => resolveTemplateTargets({ template: "career", kind: "fitness" })).toThrow(/kind='project'/);
  });

  it("neither template nor targets → undefined", () => {
    expect(resolveTemplateTargets({ kind: "project" })).toBeUndefined();
  });

  // R2 (architecture blueprint v2): template + copyFromGoalId conflict.
  it("template + copyFromGoalId + no explicit targets → throws mentioning copyFromGoalId", () => {
    expect(() =>
      resolveTemplateTargets({ template: "career", kind: "project", copyFromGoalId: "goal_123" }),
    ).toThrow(/copyFromGoalId/);
  });

  it("template + copyFromGoalId + explicit targets → explicit targets win, no throw", () => {
    const result = resolveTemplateTargets({
      template: "career",
      targets: explicitTargets,
      kind: "project",
      copyFromGoalId: "goal_123",
    });
    expect(result).toBe(explicitTargets);
  });
});
