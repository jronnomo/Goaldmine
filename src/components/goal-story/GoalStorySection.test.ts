// src/components/goal-story/GoalStorySection.test.ts
// Fixture-based render proof for GoalStorySection (REQ-006), mirroring the
// established pattern for component JSX (FeasibilityReadout.test.ts,
// completion-card.test.ts): render the full element tree via
// react-dom/server (invokes every nested Story* component's own JSX, unlike
// calling GoalStorySection() directly) and assert on the resulting markup.
// No vi.mock needed — every Story* component under test is pure/props-only
// (no Prisma, no getDb). Vitest only picks up `*.test.ts` (see
// vitest.config.ts), so this file stays JSX-free and builds elements via
// React.createElement.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalStorySection } from "@/components/goal-story/GoalStorySection";
import type { GoalStory } from "@/lib/goal-story-core";

// ── Fixture A: full fitness story — every arc populated, timeline with both
// a phase-matched revision and an unmatched ("Other revisions") one ────────
const FULL_STORY: GoalStory = {
  goal: {
    id: "goal-1",
    objective: "Summit Mt. Elbert",
    kind: "fitness",
    status: "achieved",
    createdAtKey: "2026-04-01",
    completedDateKey: "2026-08-02",
  },
  window: { startKey: "2026-04-01", endKey: "2026-08-02" },
  snapshot: null,
  readinessSeries: [
    { dateKey: "2026-04-06", score: 20 },
    { dateKey: "2026-05-04", score: 55 },
    { dateKey: "2026-08-02", score: 94 },
  ],
  targets: [
    {
      metric: "baseline:pullups",
      label: "Pull-ups",
      units: "reps",
      start: 5,
      final: 15,
      target: 15,
      progress: 1,
      met: true,
    },
    {
      metric: "log:5k-time",
      label: "5k time",
      units: "min",
      start: 32,
      final: 27,
      target: 25,
      progress: 0.75,
      met: false,
    },
  ],
  baselineArcs: [
    {
      testName: "baseline:pullups",
      units: "reps",
      points: [
        { dateKey: "2026-04-01", value: 5 },
        { dateKey: "2026-08-01", value: 15 },
      ],
    },
  ],
  hikeArc: [
    {
      dateKey: "2026-08-02",
      route: "Mt. Elbert — main trail",
      distanceMi: 9.2,
      elevationFt: 4700,
      summitFt: 14440,
      packWeightLb: 18,
      durationMin: 420,
      status: "completed",
    },
    {
      dateKey: "2026-06-15",
      route: "Training hike — Bear Peak",
      distanceMi: 5.1,
      elevationFt: 2100,
      summitFt: null,
      packWeightLb: null,
      durationMin: 180,
      status: "skipped",
    },
  ],
  metricArcs: [],
  timeline: {
    planName: "Elbert 16-week",
    startedOnKey: "2026-04-01",
    weeksTotal: 16,
    phases: [
      { name: "Base", weekStart: 1, weekEnd: 6, startKey: "2026-04-01", endKey: "2026-05-12" },
      { name: "Build", weekStart: 7, weekEnd: 16, startKey: "2026-05-13", endKey: "2026-07-21" },
    ],
    revisions: [
      {
        id: "rev-1",
        createdAtKey: "2026-04-20",
        triggerSource: "claude",
        summary: "Swap Tuesday lower for zone2 after knee tweak",
        reasoning: "Knee felt off during squats — dropped load, added mobility.",
      },
      {
        id: "rev-2",
        // Outside both phase windows (before the plan started) — must land
        // in the trailing "Other revisions" list, not silently drop.
        createdAtKey: "2026-03-15",
        triggerSource: "manual",
        summary: "Pre-plan scaffold adjustment",
        reasoning: null,
      },
    ],
  },
};

// ── Fixture B: empty/legacy story — active project goal, no series/targets/
// arcs/timeline captured yet. Every sub-card except StoryReadinessCard must
// omit itself entirely. ──────────────────────────────────────────────────────
const EMPTY_STORY: GoalStory = {
  goal: {
    id: "goal-2",
    objective: "Ship Chewgether v1",
    kind: "project",
    status: "active",
    createdAtKey: "2026-07-01",
    completedDateKey: null,
  },
  window: { startKey: "2026-07-01", endKey: "2026-08-09" },
  snapshot: null,
  readinessSeries: null,
  targets: [],
  baselineArcs: [],
  hikeArc: [],
  metricArcs: [],
  timeline: null,
};

describe("GoalStorySection", () => {
  it("story === null: renders nothing", () => {
    const html = renderToStaticMarkup(createElement(GoalStorySection, { story: null }));
    expect(html).toBe("");
  });

  it("full story: renders every arc, interleaves revisions, cross-links Other revisions", () => {
    const html = renderToStaticMarkup(createElement(GoalStorySection, { story: FULL_STORY }));

    // Readiness arc card renders the chart, not the hint.
    expect(html).toContain("Readiness arc");
    expect(html).not.toContain("Readiness arc not captured");

    // Targets table.
    expect(html).toContain("Targets: start → final");
    expect(html).toContain("Pull-ups");
    expect(html).toContain("5k time");

    // Baseline arc card, titled by test name.
    expect(html).toContain("baseline:pullups");

    // Hike arc — both hikes, including the non-completed status suffix.
    expect(html).toContain("Hikes");
    expect(html).toContain("Mt. Elbert — main trail");
    expect(html).toContain("summit 14440 ft");
    expect(html).toContain("Training hike — Bear Peak");
    expect(html).toContain("skipped");

    // Timeline — phase bands + the matched revision + the unmatched one under
    // "Other revisions".
    expect(html).toContain("Plan timeline");
    expect(html).toContain("Base");
    expect(html).toContain("Build");
    expect(html).toContain("Swap Tuesday lower for zone2 after knee tweak");
    expect(html).toContain("Other revisions");
    expect(html).toContain("Pre-plan scaffold adjustment");
    expect(html).toContain("Knee felt off during squats");

    // No metric arcs for a fitness goal.
    expect(html).not.toContain("No log");
  });

  it("empty story: only the readiness hint renders, every other card omits itself", () => {
    const html = renderToStaticMarkup(createElement(GoalStorySection, { story: EMPTY_STORY }));

    expect(html).toContain("Readiness arc not captured for this completion");
    expect(html).not.toContain("Targets: start → final");
    expect(html).not.toContain("Plan timeline");
    expect(html).not.toContain("Hikes");
  });
});
