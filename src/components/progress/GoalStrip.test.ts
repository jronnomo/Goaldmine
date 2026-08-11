// src/components/progress/GoalStrip.test.ts
//
// The one readiness grammar (UXR-PROG-22): four zero-state branches incl.
// the NEW R23 branch (UXR-PROG-24 ★), CeilingRule + gateCopyState inline
// (A3/A27), the UXR-PV-25 measured caption, USER_TZ dates (A8/A9), the
// frozen R9 treatment, and the R11 numeral carve-out.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalStrip, type GoalStripModel } from "@/components/progress/GoalStrip";
import type { ReadinessSnapshot } from "@/lib/readiness";
import type { GoalIdentity } from "@/lib/goal-identity";

const IDENTITY: GoalIdentity = {
  goalId: "g1",
  slot: 0,
  shape: "circle",
  glyphFilled: "●",
  glyphHollow: "○",
  hue: "var(--target)",
  label: "Handstand",
};

function snap(over: Partial<ReadinessSnapshot>): ReadinessSnapshot {
  return {
    score: 22,
    rawScore: 22,
    ceiling: 80,
    coverage: { tested: 5, total: 9 },
    gates: [{ label: "gate", progress: 0, cleared: false }],
    openGateCount: 2,
    breakdown: [],
    missing: [],
    ...over,
  };
}

function model(over: Partial<GoalStripModel>): GoalStripModel {
  return {
    goal: {
      id: "g1",
      objective: "Freestanding Handstand — 20s hold",
      kind: "fitness",
      status: "active",
      targetDate: new Date("2026-12-31T07:00:00Z"),
    },
    mode: "live",
    snapshot: snap({}),
    series: [0, 8, 15, 22],
    frozenScore: null,
    frozenAsOfKey: null,
    measuredScore: null,
    ...over,
  };
}

function render(m: GoalStripModel, identity: GoalIdentity | null = IDENTITY): string {
  return renderToStaticMarkup(createElement(GoalStrip, { identity, model: m }));
}

describe("GoalStrip — live body", () => {
  it("numeral + CeilingRule + gateCopyState + SeamLine trend, in one strip", () => {
    const html = render(model({}));
    expect(html).toContain(">22<"); // R11 tabular numeral
    expect(html).toContain('data-testid="ceiling-rule-g1"');
    expect(html).toContain("ceiling-rule-g1-stile"); // capped teaches while free (A3/A27)
    expect(html).toContain("2 gates to clear before this can pass 80.");
    expect(html).toContain('data-testid="goal-strip-trend-g1"'); // SeamLine, no Recharts
    expect(html).not.toContain("recharts");
    // USER_TZ date, single format (A8/A9):
    expect(html).toContain("by Dec 31");
  });

  it("identity mark renders filled, hue as reinforcement only", () => {
    const html = render(model({}));
    expect(html).toContain("●");
    // The mark is aria-hidden — identity is words on the link, not the glyph.
    expect(html).toMatch(/aria-hidden="true"[^>]*>●</);
  });

  it("UXR-PV-25 measured caption renders only when untested targets drag the score", () => {
    const withCaption = render(model({ measuredScore: 52, snapshot: snap({ rawScore: 28, score: 28 }) }));
    expect(withCaption).toContain("Measured score 52 · 28 counting untested targets as 0.");
    const fullCoverage = render(
      model({ measuredScore: 52, snapshot: snap({ rawScore: 28, coverage: { tested: 9, total: 9 } }) }),
    );
    expect(fullCoverage).not.toContain("Measured score");
  });
});

describe("GoalStrip — the four zero-state branches", () => {
  it("(1) zero targets: no number at all", () => {
    const html = render(model({ snapshot: null, series: null }));
    expect(html).toContain("No measurable targets");
    expect(html).not.toContain("/100");
  });

  it('(2) targets but nothing tested: "Not measured yet", NEVER a 0', () => {
    const html = render(
      model({ snapshot: snap({ score: 0, rawScore: 0, coverage: { tested: 0, total: 3 } }), series: null }),
    );
    expect(html).toContain("Not measured yet");
    expect(html).toContain("0 of 3 targets have a reading");
    expect(html).not.toContain(">0</"); // no headline zero
    expect(html).not.toContain("/100");
  });

  it("★ (3) R23: tested > 0 && rawScore === 0 — the numeral IS real, render it + the two-part line", () => {
    const html = render(
      model({
        snapshot: snap({ score: 0, rawScore: 0, coverage: { tested: 2, total: 9 } }),
        series: [0],
      }),
    );
    expect(html).toContain(">0<"); // the real zero renders
    expect(html).toContain("/100");
    expect(html).toContain('data-testid="zero-tested-g1"');
    expect(html).toContain("2 of 9 targets have a reading; neither has moved off its start yet.");
  });

  it("(4) normal: numeral + rule + copy (covered above)", () => {
    expect(render(model({}))).toContain('aria-valuenow="22"');
  });
});

describe("GoalStrip — frozen (R9)", () => {
  it("muted numeral + FROZEN eyebrow + never-recomputed line; stroke-only trend", () => {
    const html = render(
      model({
        mode: "frozen",
        snapshot: null,
        series: [70, 89],
        frozenScore: 89,
        frozenAsOfKey: "2026-08-08",
      }),
    );
    expect(html).toContain(">89<");
    expect(html).toContain("Frozen · Aug 8"); // ONE date format (A8 fixed)
    expect(html).toContain("frozen at completion, never recomputed");
    expect(html).toContain('data-testid="goal-strip-frozen-trend-g1"');
    // SeamLine defaults to the muted stroke — never dashed:
    expect(html).not.toContain("stroke-dasharray");
  });
});

describe("GoalStrip — gate copy states", () => {
  it("clear state reads All gates cleared in --success", () => {
    const html = render(
      model({ snapshot: snap({ openGateCount: 0, ceiling: 100, gates: [{ label: "g", progress: 1, cleared: true }] }) }),
    );
    expect(html).toContain("All gates cleared.");
    expect(html).not.toContain("-stile"); // ceiling 100 → no stile
  });

  it("HELD eyebrow renders at ≥12px (UXR-PROG-106's floor), never text-[10px]", () => {
    const html = render(model({ snapshot: snap({ rawScore: 91, score: 80, ceiling: 80 }) }));
    expect(html).toContain("HELD AT 80");
    expect(html).not.toContain("text-[10px]");
  });
});
