// src/components/progress/ProgramReadinessSection.test.ts
// Render-level proof for the #292 /progress Program extension. House idiom:
// vitest node env, no jsdom, no JSX — createElement + renderToStaticMarkup,
// assert on the HTML string (MealComposer.test.ts / GoalStorySection.test.ts
// precedent). Types are imported `type`-only so no DB module loads.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramReadinessSection } from "@/components/progress/ProgramReadinessSection";
import { ReadinessChart } from "@/components/ReadinessChart";
import type {
  MemberGoalArc,
  MetricClaim,
  ProgramMetricRow,
  ProgressProgramData,
} from "@/lib/progress-program";

// ── Fixtures — the research's real shared-metric case ───────────────────────

function liveArc(overrides: Partial<MemberGoalArc> = {}): MemberGoalArc {
  return {
    goal: {
      id: "g-hand",
      objective: "Handstand",
      kind: "fitness",
      status: "active",
      targetDate: null,
    },
    mode: "live",
    score: 62,
    coverage: { tested: 4, total: 6 },
    openGateCount: 1,
    series: [
      { date: "2026-07-05T00:00:00.000Z", score: 40 },
      { date: "2026-08-09T00:00:00.000Z", score: 62 },
    ],
    frozenAsOf: null,
    breakdown: [],
    missingCount: 2,
    targetsTotal: 6,
    ...overrides,
  };
}

function frozenArc(overrides: Partial<MemberGoalArc> = {}): MemberGoalArc {
  return {
    goal: {
      id: "g-elbert",
      objective: "Summit Mt. Elbert",
      kind: "fitness",
      status: "achieved",
      targetDate: null,
    },
    mode: "frozen",
    score: 89,
    coverage: null,
    openGateCount: null,
    series: [
      { date: "2026-05-03", score: 55 },
      { date: "2026-08-08", score: 89 },
    ],
    frozenAsOf: "2026-08-08",
    breakdown: [],
    missingCount: 0,
    targetsTotal: 6,
    ...overrides,
  };
}

function claim(overrides: Partial<MetricClaim> = {}): MetricClaim {
  return {
    goalId: "g-hand",
    objective: "Handstand",
    target: 25,
    start: 25,
    current: 25,
    progress: 1,
    weight: 0.1,
    direction: "increase",
    gating: false,
    maintenance: true,
    ...overrides,
  };
}

const SHARED_PULLUP_ROW: ProgramMetricRow = {
  metricKey: "baseline:Pull-Up Max Reps",
  label: "Pull-Up Max Reps",
  units: "reps",
  points: [
    { date: "2026-08-11T00:00:00.000Z", value: 25 },
    { date: "2026-08-25T00:00:00.000Z", value: 25 },
  ],
  claims: [
    claim(),
    claim({ goalId: "g-cut", objective: "Body comp", weight: 0.15 }),
  ],
  targetLines: [
    { value: 25, label: "Handstand" },
    { value: 25, label: "Body comp" },
  ],
};

function data(overrides: Partial<ProgressProgramData> = {}): ProgressProgramData {
  return {
    program: {
      name: "Lighter and Upside Down",
      startedOnKey: "2026-08-10",
      endsOnKey: "2027-01-04",
      windowEndKey: "2026-08-10",
    },
    memberGoalIds: ["g-hand", "g-cut"],
    arcs: [liveArc()],
    metrics: [SHARED_PULLUP_ROW],
    ...overrides,
  };
}

function render(d: ProgressProgramData): string {
  return renderToStaticMarkup(createElement(ProgramReadinessSection, { data: d }));
}

// ── Shared-metric grammar (UXR-PV-44 + #292 brief) ──────────────────────────

describe("ProgramReadinessSection — shared metric", () => {
  it("renders ONE series (one chart) with both goals' target lines and the SHARED BY 2 GOALS eyebrow", () => {
    const html = render(data());

    // Eyebrow (uppercase via CSS; content is the words).
    expect(html).toContain("Shared by 2 goals");
    expect(html).toContain(
      'data-testid="metric-shared-eyebrow-baseline:Pull-Up Max Reps"',
    );

    // Exactly ONE chart for the shared metric — one artifact, many claims.
    const chartMatches = html.match(/data-testid="metric-chart-/g) ?? [];
    expect(chartMatches).toHaveLength(1);

    // Both goals' target lines are declared on the chart's accessible name.
    expect(html).toContain("target lines at 25 (Handstand), 25 (Body comp)");

    // Two goal-chipped meaning rows below, same grammar as a Today row.
    expect(html).toContain(
      'data-testid="metric-row-g-hand-baseline:Pull-Up Max Reps"',
    );
    expect(html).toContain(
      'data-testid="metric-row-g-cut-baseline:Pull-Up Max Reps"',
    );
  });

  it("cliff/maintenance claims get a status readout (HOLDING), never a progress bar", () => {
    const html = render(data());
    expect(html).toContain("Pass/fail by design.");
    expect(html).toContain("HOLDING 25");
    expect(html).toContain("Worth 10 of 100");
    expect(html).toContain("Worth 15 of 100");
  });

  it("a below-floor maintenance claim reads BELOW FLOOR with the current value", () => {
    const row: ProgramMetricRow = {
      ...SHARED_PULLUP_ROW,
      claims: [claim({ current: 23 })],
      targetLines: [{ value: 25, label: "Handstand" }],
    };
    const html = render(data({ metrics: [row] }));
    expect(html).toContain("BELOW FLOOR · 23");
    expect(html).not.toContain("HOLDING");
  });

  it("single-claim metrics render no shared eyebrow", () => {
    const row: ProgramMetricRow = {
      ...SHARED_PULLUP_ROW,
      claims: [claim()],
      targetLines: [{ value: 25, label: "Handstand" }],
    };
    const html = render(data({ metrics: [row] }));
    expect(html).not.toContain("Shared by");
  });
});

// ── Series edge branches (§8.5 zero-row rules) ───────────────────────────────

describe("ProgramReadinessSection — metric series edges", () => {
  it("one point → 'A trend needs two.', never a one-point line", () => {
    const row: ProgramMetricRow = {
      ...SHARED_PULLUP_ROW,
      points: [{ date: "2026-08-11T00:00:00.000Z", value: 25 }],
    };
    const html = render(data({ metrics: [row] }));
    expect(html).toContain("One reading so far. A trend needs two.");
    expect(html).not.toContain('data-testid="metric-chart-');
  });

  it("zero points in the window → honest empty line, no chart frame", () => {
    const row: ProgramMetricRow = { ...SHARED_PULLUP_ROW, points: [] };
    const html = render(data({ metrics: [row] }));
    expect(html).toContain("No readings in this program window yet.");
    expect(html).not.toContain('data-testid="metric-chart-');
  });

  it("helper-less metrics (points === null) render headline rows only", () => {
    const row: ProgramMetricRow = {
      metricKey: "hike:total_elevation_ft",
      label: "Total elevation",
      units: "ft",
      points: null,
      claims: [
        claim({
          maintenance: false,
          start: 0,
          current: 14200,
          target: 30000,
          weight: 0.2,
        }),
      ],
      targetLines: [{ value: 30000, label: "Handstand" }],
    };
    const html = render(data({ metrics: [row] }));
    expect(html).toContain("No history chart for this metric yet");
    expect(html).toContain("0 → 14200 / 30000 ft");
  });

  it("window caption carries the 'not scored' disclaimer (window value never touches the score)", () => {
    const html = render(data());
    expect(html).toContain("not scored");
    expect(html).toContain("Program window ·");
  });
});

// ── Frozen (R9) arcs — UXR-PV-47 ─────────────────────────────────────────────

describe("ProgramReadinessSection — frozen member arcs", () => {
  it("achieved member renders the FROZEN eyebrow, filled Bullseye, and completion score — no live coverage line", () => {
    const html = render(data({ arcs: [frozenArc()], metrics: [] }));

    expect(html).toContain('data-testid="member-goal-progress-g-elbert"');
    expect(html).toContain("Frozen · 2026-08-08");
    expect(html).toContain('aria-label="Completed goal"');
    expect(html).toContain("89");
    expect(html).toContain("at completion");
    expect(html).toContain("frozen at completion, never recomputed");
    // No live-card artifacts on the frozen card.
    expect(html).not.toContain("verified");
    expect(html).not.toContain("best-effort estimate");
  });

  it("frozen chart wrapper is stamped data-arc-variant=frozen (muted stroke-only variant)", () => {
    const html = render(data({ arcs: [frozenArc()], metrics: [] }));
    expect(html).toContain('data-arc-variant="frozen"');
  });

  it("frozen arc with no captured series degrades to the canonical hint — never an empty chart frame", () => {
    const html = render(
      data({ arcs: [frozenArc({ series: [], score: null })], metrics: [] }),
    );
    expect(html).not.toContain('data-arc-variant="frozen"');
    // readinessSeriesHint(6) — the targets-existed branch.
    expect(html).toContain("reopen");
  });
});

// ── ReadinessChart frozen variant is additive-only ───────────────────────────

describe("ReadinessChart — frozen prop", () => {
  const points = [
    { date: "2026-05-03", score: 55 },
    { date: "2026-08-08", score: 89 },
  ];

  it("default (live) markup carries NO data-arc-variant attribute — existing consumers byte-identical", () => {
    const html = renderToStaticMarkup(
      createElement(ReadinessChart, { data: points }),
    );
    expect(html).not.toContain("data-arc-variant");
  });

  it("frozen render stamps the variant on the accessible wrapper", () => {
    const html = renderToStaticMarkup(
      createElement(ReadinessChart, { data: points, frozen: true }),
    );
    expect(html).toContain('data-arc-variant="frozen"');
  });
});

// ── Live member cards ────────────────────────────────────────────────────────

describe("ProgramReadinessSection — live member arcs", () => {
  it("live card keeps the shipped readiness-card grammar: score/100, coverage, gates left", () => {
    const html = render(data({ metrics: [] }));
    expect(html).toContain('data-testid="member-goal-progress-g-hand"');
    expect(html).toContain("Readiness: Handstand");
    expect(html).toContain("62");
    expect(html).toContain("/100");
    expect(html).toContain("4/6 verified");
    expect(html).toContain("1 gate left");
    expect(html).not.toContain("data-arc-variant"); // live arc, live styling
  });

  it("section eyebrow names the Program and its window", () => {
    const html = render(data({ metrics: [] }));
    expect(html).toContain('data-testid="program-readiness-section"');
    expect(html).toContain("Lighter and Upside Down");
  });
});
