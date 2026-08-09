// src/components/goal-assay/AssayMonument.test.ts
// Render-smoke coverage (REQ-003), mirroring the established pattern for
// component JSX (GoalStorySection.test.ts, completion-card.test.ts): render
// the full element tree via react-dom/server (invokes GoalAssayHero's and
// AssayTargetRows' own nested JSX too, unlike calling AssayMonument()
// directly) and assert on the resulting markup. No vi.mock needed — every
// component under test is pure/props-only. Vitest only picks up
// `*.test.ts` (see vitest.config.ts), so this file stays JSX-free and
// builds elements via React.createElement.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssayMonument } from "@/components/goal-assay/AssayMonument";
import { playFlourish } from "@/components/goal-assay/AssayFlourish";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

// ── Fixture A: Summit — the founder's own Mt. Elbert reference case
// (report's own header: 98 days, readiness 8 → 89, 7/9 met, +700 XP,
// 2 badges, legendary Reach). Exercises the full stack incl. ceremony. ────
const SUMMIT_SNAPSHOT: GoalCompletionSnapshot = {
  version: 1,
  completedDateKey: "2026-08-02",
  capturedAt: "2026-08-02T18:00:00.000Z",
  backdated: false,
  objective: "Summit Mt. Elbert",
  kind: "fitness",
  daysElapsed: 98,
  readiness: {
    score: 89,
    rawScore: 89,
    ceiling: 100,
    coverage: { tested: 9, total: 9 },
    openGateCount: 0,
  },
  readinessSeries: [
    { dateKey: "2026-04-27", score: 8 },
    { dateKey: "2026-06-15", score: 55 },
    { dateKey: "2026-08-02", score: 89 },
  ],
  ceremony: {
    badgesUnlocked: [
      { id: "goal-first", name: "First Summit" },
      { id: "goal-fit-finisher", name: "Fit Finisher" },
    ],
    levelBefore: 3,
    levelAfter: 4,
  },
  targets: [
    ...Array.from({ length: 7 }, (_, i) => ({
      metric: `met-${i}`,
      label: `Met target ${i}`,
      units: "reps",
      start: 5,
      final: 15,
      target: 15,
      progress: 1,
      met: true,
    })),
    {
      metric: "missed-a",
      label: "5k time",
      units: "min",
      start: 32,
      final: 27,
      target: 25,
      progress: 0.75,
      met: false,
    },
    {
      metric: "missed-b",
      label: "Pack weight",
      units: "lb",
      start: 40,
      final: 30,
      target: 25,
      progress: 0.6,
      met: false,
    },
  ],
  targetsMet: 7,
  targetsTotal: 9,
  feasibilityTierAtCompletion: "legendary",
  coachFeasibilityTier: "legendary",
  plan: { planId: "plan-1", weeksTotal: 16, weeksElapsed: 14 },
  xpBasis: { weeks: 14, targetsMet: 7 },
  xpAwardedAtCompletion: 700,
};

// ── Fixture B: Marker floor — the zero-target case (report §1.6/§2.2):
// readiness null, no series, no targets, no Reach rating, no ceremony
// (never captured for this legacy-ish row). Exercises the honest sentence +
// omitted blocks. ───────────────────────────────────────────────────────────
const MARKER_SNAPSHOT: GoalCompletionSnapshot = {
  version: 1,
  completedDateKey: "2026-07-20",
  capturedAt: "2026-07-20T12:00:00.000Z",
  backdated: false,
  objective: "Read one book a week for a month",
  kind: "project",
  daysElapsed: 14,
  readiness: null,
  targets: [],
  targetsMet: 0,
  targetsTotal: 0,
  feasibilityTierAtCompletion: null,
  coachFeasibilityTier: null,
  plan: { planId: null, weeksTotal: null, weeksElapsed: null },
  xpBasis: { weeks: 2, targetsMet: 0 },
  xpAwardedAtCompletion: 150,
};

describe("AssayMonument — Summit fixture (full stack incl. ceremony)", () => {
  const html = renderToStaticMarkup(
    createElement(AssayMonument, { snapshot: SUMMIT_SNAPSHOT, goalId: "goal-elbert", evidenceDensity: 20 }),
  );

  it("renders the hero + annulus (from GoalAssayHero)", () => {
    expect(html).toContain('data-testid="goal-assay-hero"');
    expect(html).toContain('data-testid="goal-assay-annulus"');
    expect(html).toContain("GOAL COMPLETE");
  });

  it("renders the objective, backdated-free subline, and mono fact line", () => {
    expect(html).toContain('data-testid="goal-assay-objective"');
    expect(html).toContain("Summit Mt. Elbert");
    expect(html).toContain("Completed Aug 2, 2026");
    expect(html).not.toContain("backdated");
    expect(html).toContain('data-testid="goal-assay-fact-line"');
    expect(html).toContain("98 DAYS");
    expect(html).toContain("7/9 TARGETS");
    expect(html).toContain("+700 XP");
  });

  it("renders WHAT MOVED with the reserve-slot-for-first-miss rule already applied (ported from goal-assay-core)", () => {
    expect(html).toContain('data-testid="goal-assay-what-moved"');
    // 6-row cap, met-first, but the 6th slot is the FIRST miss per Rule B.
    expect(html).toContain('data-testid="goal-assay-row-5"');
    expect(html).not.toContain('data-testid="goal-assay-row-6"');
    expect(html).toContain("5k time");
    expect(html).toContain("+3 more");
  });

  it("caps the ANIMATED rows at 4 independently of the 6-row display cap (QA M3 / UXR-GCU-27 fold rule)", () => {
    // Rows 0-3 (the first 4) are armed for playFlourish via the data-assay
    // marker; rows 4-5 still DISPLAY (testid present) but render settled
    // from the start (no marker) — never a delayed/invisible row past the
    // fold.
    for (const i of [0, 1, 2, 3]) {
      expect(html).toContain(`data-assay="row-${i}"`);
    }
    for (const i of [4, 5]) {
      expect(html).toContain(`data-testid="goal-assay-row-${i}"`);
      expect(html).not.toContain(`data-assay="row-${i}"`);
    }
  });

  it("renders the readiness traversal with the honest framing caption", () => {
    expect(html).toContain("8 →");
    expect(html).toContain("89");
    expect(html).toContain("weighted progress across your targets");
  });

  it("renders the static Reach meter for a rated tier", () => {
    expect(html).toContain('data-testid="goal-assay-reach"');
    expect(html).toContain("Legendary");
  });

  it("renders badge medals and the level-crossing line from snapshot.ceremony", () => {
    expect(html).toContain('data-testid="goal-assay-badges"');
    expect(html).toContain("First Summit");
    expect(html).toContain("Fit Finisher");
    expect(html).toContain("Level 3 → 4");
  });

  it("renders the permanence line and both CTAs at their 44px min-height", () => {
    expect(html).toContain('data-testid="goal-assay-permanence"');
    expect(html).toContain("Frozen at completion. This never recomputes.");
    expect(html).toContain('data-testid="goal-assay-share"');
    expect(html).toContain("goalId=goal-elbert");
    expect(html).toContain("Make a share card");
    expect(html).toContain("Back to goals");
    expect(html).toContain("min-h-[44px]");
  });
});

describe("AssayMonument — Marker zero-target fixture (honest sentence, no reach/badges)", () => {
  const html = renderToStaticMarkup(
    createElement(AssayMonument, { snapshot: MARKER_SNAPSHOT, goalId: "goal-book", evidenceDensity: 0 }),
  );

  it("collapses WHAT MOVED to the one honest sentence, not an empty list", () => {
    expect(html).toContain('data-testid="goal-assay-what-moved"');
    expect(html).toContain("This goal had no numeric targets");
    expect(html).not.toContain('data-testid="goal-assay-row-0"');
  });

  it("omits the readiness row entirely (readiness null, zero targets)", () => {
    expect(html).not.toContain("weighted progress across your targets");
  });

  it("omits the Reach row (unrated) and the badges block (no ceremony captured)", () => {
    expect(html).not.toContain('data-testid="goal-assay-reach"');
    expect(html).not.toContain('data-testid="goal-assay-badges"');
  });

  it("still renders the hero, fact line (0/0 targets is a true fact, not a fabricated zero), and permanence line", () => {
    expect(html).toContain('data-testid="goal-assay-hero"');
    expect(html).toContain("0/0 TARGETS");
    expect(html).toContain('data-testid="goal-assay-permanence"');
  });
});

describe("AssayMonument — reduced-motion equivalence proxy (Rule A)", () => {
  it("the settled server-rendered DOM never contains a beat/flourish CSS class — server HTML is already final", () => {
    const html = renderToStaticMarkup(
      createElement(AssayMonument, { snapshot: SUMMIT_SNAPSHOT, goalId: "goal-elbert", evidenceDensity: 20 }),
    );
    // The choreographed "beat" primitives (report §5.4's reduced-motion
    // block) must be absent from SSR output entirely — see
    // AssayFlourish.tsx's header comment for why. `.assay-annulus` is
    // deliberately EXEMPT: it is the PERMANENT ring (not a beat), and its
    // resting CSS already equals its own keyframe's 100% state (Rule A),
    // so its presence from the first paint is correct, not a beat replay.
    for (const beatClass of ["assay-fade", "assay-rise", "assay-disc-rim", "assay-disc-inner", "assay-ring"]) {
      expect(html).not.toContain(beatClass);
    }
  });

  it("Marker fixture is equally beat-class-free", () => {
    const html = renderToStaticMarkup(
      createElement(AssayMonument, { snapshot: MARKER_SNAPSHOT, goalId: "goal-book", evidenceDensity: 0 }),
    );
    for (const beatClass of ["assay-fade", "assay-rise", "assay-disc-rim", "assay-disc-inner", "assay-ring"]) {
      expect(html).not.toContain(beatClass);
    }
  });
});

describe("AssayFlourish's playFlourish export", () => {
  it("is exported as a callable function (DOM behavior itself needs jsdom — out of this node-environment suite's reach)", () => {
    expect(typeof playFlourish).toBe("function");
  });
});
