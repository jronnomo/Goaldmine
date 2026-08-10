// src/app/program/page.test.ts
//
// #290 — render proof for the /program dashboard (research §7.8; house
// idiom: node env, no jsdom — the async RSC is awaited, then
// renderToStaticMarkup'd, assertions on the HTML string).
//
// Covers, per the story's acceptance criteria:
//   - three-goal fixture: the gated goal reads as CAPPED (HELD AT 80 +
//     rawScore in copy + stile/hatch), never a mysterious plateau;
//   - sparklines present (UXR-PV-90 rejected — they ship, as plain awaited
//     server SVG) with the series domain clamped to the Program window
//     (UXR-PV-51) and bounded query knobs (maxPoints 26 / batchSize 3);
//   - identity marks ● ■ ▲ in derived slot order;
//   - no-Program tenants get the quiet explainer (HTTP 200, never an error);
//   - zero-member Program → honest empty row; zero-target member → NO number;
//   - nothing-measured member → "Not measured yet", numeral suppressed, and
//     the series is never computed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockGetDb, mockMembership, mockPlan, mockReadiness, mockSeries } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockMembership: vi.fn(),
  mockPlan: vi.fn(),
  mockReadiness: vi.fn(),
  mockSeries: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mockGetDb, prisma: {} }));
vi.mock("@/lib/program", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/program")>();
  return {
    ...actual,
    getActiveProgramMembership: mockMembership,
    getActiveProgram: mockPlan,
  };
});
vi.mock("@/lib/readiness", () => ({
  computeReadiness: mockReadiness,
  computeReadinessSeriesSampled: mockSeries,
  GATE_CEILING: 80,
}));

import ProgramPage from "@/app/program/page";
import { parseDateKey } from "@/lib/calendar-core";
import type { ReadinessSnapshot } from "@/lib/readiness";

// ── Fixture: the Phase 2A program, Mon Aug 24 (day 15 of 144) ───────────────

// 12:00 in America/Denver on 2026-08-24.
const NOW = new Date("2026-08-24T18:00:00.000Z");

const PROGRAM = {
  id: "prog-1",
  name: "Lighter and Upside Down",
  status: "active",
  startedOn: parseDateKey("2026-08-10"),
  endsOn: parseDateKey("2026-12-31"),
  notes: null,
  attributionRules: null,
  memberGoals: [],
};

const PLAN = {
  id: "plan-1",
  name: "Phase 2A rotation",
  startedOn: parseDateKey("2026-08-10"),
  confirmedThroughDate: null,
  template: {
    name: "Phase 2A",
    totalWeeks: 20,
    phases: [
      { index: 1, name: "Block 0", weeks: [1, 2] },
      { index: 2, name: "Block 1", weeks: [3, 4, 5, 6, 7, 8, 9, 10] },
      { index: 3, name: "Block 2", weeks: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
    ],
    weeklySplit: [],
    baselineWeek: [],
  },
} as unknown as Awaited<ReturnType<typeof import("@/lib/program").getActiveProgram>>;

function goalRow(overrides: Record<string, unknown>) {
  return {
    id: "g-x",
    objective: "Objective",
    kind: "fitness",
    status: "active",
    isFocus: false,
    createdAt: new Date("2026-06-01T12:00:00.000Z"), // predates the Program
    targetDate: null,
    targets: [{ metric: "m", label: "T", units: "u", direction: "increase", target: 1, weight: 1 }],
    legend: null,
    ...overrides,
  };
}

const GOALS = [
  goalRow({
    id: "g-handstand",
    objective: "Hold a freestanding handstand for 30 seconds",
    isFocus: true,
  }),
  goalRow({
    id: "g-cut",
    objective: "Cut to 15% body fat, holding strength",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
  }),
  goalRow({
    id: "g-aws",
    objective: "Pass the AWS Solutions Architect Associate exam",
    kind: "project",
    targetDate: parseDateKey("2026-11-15"),
  }),
];

function snap(partial: Partial<ReadinessSnapshot>): ReadinessSnapshot {
  return {
    score: 50,
    rawScore: 50,
    ceiling: 100,
    coverage: { tested: 1, total: 1 },
    gates: [],
    openGateCount: 0,
    breakdown: [
      {
        target: { metric: "m", label: "T", units: "u", direction: "increase", target: 1, weight: 1 },
        current: 0.5,
        start: 0,
        progress: 0.5,
      },
    ],
    missing: [],
    ...partial,
  } as ReadinessSnapshot;
}

const SNAPSHOTS: Record<string, ReadinessSnapshot> = {
  // HELD: raw 91 capped at 80 by one open gate.
  "g-handstand": snap({
    score: 80,
    rawScore: 91,
    ceiling: 80,
    coverage: { tested: 5, total: 6 },
    openGateCount: 1,
    gates: [
      { label: "Freestanding hold 30s", progress: 0.6, cleared: false },
      { label: "Wall hold 60s", progress: 1, cleared: true },
    ],
    breakdown: [
      {
        target: {
          metric: "baseline:Wall Handstand Hold",
          label: "Freestanding hold 30s",
          units: "s",
          direction: "increase",
          target: 30,
          weight: 0.5,
          gating: true,
        },
        current: 18,
        start: 0,
        progress: 0.6,
      },
      {
        target: {
          metric: "baseline:Pike Push-ups",
          label: "Pike push-ups",
          units: "reps",
          direction: "increase",
          target: 20,
          weight: 0.5,
        },
        current: 22,
        start: 8,
        progress: 1,
      },
    ],
  }),
  // No gates at all: no gate copy block.
  "g-cut": snap({ score: 45, rawScore: 45, ceiling: 100, coverage: { tested: 3, total: 4 } }),
  // OPEN-NOT-BINDING: two gates, raw score far below the ceiling.
  "g-aws": snap({
    score: 12,
    rawScore: 12,
    ceiling: 80,
    coverage: { tested: 1, total: 3 },
    openGateCount: 2,
    gates: [
      { label: "Practice exam ≥ 80%", progress: 0.2, cleared: false },
      { label: "All labs complete", progress: 0.4, cleared: false },
    ],
  }),
};

const SERIES: Record<string, { weekEnd: Date; score: number }[]> = {
  "g-handstand": [70, 74, 80].map((score, i) => ({ weekEnd: new Date(NOW.getTime() - i), score })),
  "g-cut": [30, 38, 45].map((score, i) => ({ weekEnd: new Date(NOW.getTime() - i), score })),
  "g-aws": [2, 5, 8, 12].map((score, i) => ({ weekEnd: new Date(NOW.getTime() - i), score })),
};

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ProgramPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mockMembership.mockResolvedValue(PROGRAM);
  mockPlan.mockResolvedValue(PLAN);
  mockGetDb.mockResolvedValue({ goal: { findMany: vi.fn(async () => GOALS) } });
  mockReadiness.mockImplementation(async (_targets, _asOf, goalId: string) => SNAPSHOTS[goalId]);
  mockSeries.mockImplementation(async (_created, _targets, _until, goalId: string) => SERIES[goalId] ?? []);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/program — three-goal fixture", () => {
  it("renders the header window math and the block band caption", async () => {
    const html = await renderPage();
    expect(html).toContain("Lighter and Upside Down");
    expect(html).toContain("day 15 of 144");
    expect(html).toContain("129 remaining");
    expect(html).toContain('data-testid="program-to-calendar"');
    expect(html).toContain('data-testid="program-window-card"');
    expect(html).toContain('data-testid="program-block-band"');
    // Aug 24 is week 3 → Block 1 (weeks 3–10).
    expect(html).toContain("Block 1 · Week 3 of 20");
  });

  it("renders one card per member goal, in derived slot order with ● ■ ▲ marks", async () => {
    const html = await renderPage();
    const iHand = html.indexOf('data-testid="member-goal-card-g-handstand"');
    const iCut = html.indexOf('data-testid="member-goal-card-g-cut"');
    const iAws = html.indexOf('data-testid="member-goal-card-g-aws"');
    expect(iHand).toBeGreaterThan(-1);
    expect(iCut).toBeGreaterThan(iHand);
    expect(iAws).toBeGreaterThan(iCut);
    expect(html).toContain("●");
    expect(html).toContain("■");
    expect(html).toContain("▲");
    expect(html).toContain("color:var(--target)");
    expect(html).toContain("color:var(--success)");
    expect(html).toContain("color:var(--accent)");
  });

  it("the gated goal reads as CAPPED — HELD eyebrow, rawScore in copy, stile + hatch on the bar", async () => {
    const html = await renderPage();
    expect(html).toContain("HELD AT 80");
    expect(html).toContain(
      "Your work adds up to 91 — the ceiling holds it at 80 until the gate clears.",
    );
    expect(html).toContain('data-testid="ceiling-rule-g-handstand-stile"');
    expect(html).toContain('data-testid="ceiling-rule-g-handstand-hatch"');
    // aria reads the capped value, never the raw one.
    expect(html).toContain('aria-valuenow="80"');
    // Per-gate rows carry labels and cleared/open status words.
    expect(html).toContain("Freestanding hold 30s");
    expect(html).toContain("Wall hold 60s");
    expect(html).toContain(">open<");
    expect(html).toContain(">cleared<");
  });

  it("open-not-binding copy on the project goal; the gateless goal gets no stile and no gate copy", async () => {
    const html = await renderPage();
    expect(html).toContain("2 gates to clear before this can pass 80.");
    // g-cut: ceiling 100 → plain bar, no gate block.
    expect(html).not.toContain('data-testid="ceiling-rule-g-cut-stile"');
    expect(html).not.toContain('data-testid="gate-copy-g-cut"');
  });

  it("sparklines ship (UXR-PV-90 rejected): a seam-line per measured goal, no <circle> inside them", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="seam-line-g-handstand"');
    expect(html).toContain('data-testid="seam-line-g-cut"');
    expect(html).toContain('data-testid="seam-line-g-aws"');
    expect(html).toContain("<polyline");
    // The no-<circle> rule is about the NON-UNIFORMLY SCALED seam-line svg
    // (a circle would render as an ellipse) — the Bullseye per-gate rows are
    // uniform-scale and legitimately made of circles. Scope the assertion.
    const seamSvgs = html.match(/data-testid="seam-line-[^"]+"[^>]*>.*?<\/span>/g) ?? [];
    expect(seamSvgs).toHaveLength(3);
    for (const svg of seamSvgs) expect(svg).not.toContain("<circle");
  });

  it("clamps the series domain to the Program window and passes the bounded knobs (UXR-PV-51/52)", async () => {
    await renderPage();
    expect(mockSeries).toHaveBeenCalledTimes(3);
    for (const call of mockSeries.mock.calls) {
      // Every fixture goal predates the Program → domain start is startedOn.
      expect((call[0] as Date).getTime()).toBe(PROGRAM.startedOn.getTime());
      expect(call[4]).toEqual({ maxPoints: 26, batchSize: 3 });
    }
  });

  it("expandable target breakdown: details/summary with per-target gate flag", async () => {
    const html = await renderPage();
    expect(html).toContain("<details");
    expect(html).toContain('data-testid="member-goal-targets-g-handstand"');
    expect(html).toContain("Targets (6)");
    expect(html).toContain(">gate<");
  });
});

describe("/program — empty states", () => {
  it("no active Program → quiet explainer at HTTP 200, pointing at the coach, with a Month-view escape hatch", async () => {
    mockMembership.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).toContain('data-testid="program-empty"');
    expect(html).toContain("No program yet");
    expect(html).toContain("Your coach builds programs in Claude");
    expect(html).toContain("Month view →");
    // Never rendered the member machinery.
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockReadiness).not.toHaveBeenCalled();
  });

  it("active Program with zero member goals → window card + honest empty row", async () => {
    mockGetDb.mockResolvedValue({ goal: { findMany: vi.fn(async () => []) } });
    const html = await renderPage();
    expect(html).toContain('data-testid="program-window-card"');
    expect(html).toContain('data-testid="program-no-members"');
    expect(html).toContain("No goals in this program yet");
  });

  it("a member with zero targets → honest empty row, NO number at all (never a 0)", async () => {
    mockGetDb.mockResolvedValue({
      goal: {
        findMany: vi.fn(async () => [
          goalRow({ id: "g-bare", objective: "Someday goal", targets: null }),
        ]),
      },
    });
    const html = await renderPage();
    expect(html).toContain('data-testid="member-goal-empty-g-bare"');
    expect(html).toContain("No measurable targets");
    expect(html).not.toContain("/100");
    expect(mockReadiness).not.toHaveBeenCalled();
    expect(mockSeries).not.toHaveBeenCalled();
  });

  it("targets but nothing measured → 'Not measured yet', numeral suppressed, series never computed", async () => {
    mockGetDb.mockResolvedValue({
      goal: { findMany: vi.fn(async () => [goalRow({ id: "g-fresh" })]) },
    });
    mockReadiness.mockResolvedValue(
      snap({
        score: 0,
        rawScore: 0,
        ceiling: 80,
        coverage: { tested: 0, total: 4 },
        openGateCount: 1,
        gates: [{ label: "Gate", progress: null, cleared: false }],
      }),
    );
    const html = await renderPage();
    expect(html).toContain("Not measured yet");
    expect(html).toContain("0 of 4 targets have a reading");
    expect(html).not.toContain("/100");
    expect(html).not.toContain('data-testid="seam-line-g-fresh"');
    expect(mockSeries).not.toHaveBeenCalled();
  });

  it("Program with no rotation plan attached → window card explains instead of erroring", async () => {
    mockPlan.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).toContain("No training rotation attached");
    expect(html).toContain('data-testid="member-goal-card-g-handstand"');
  });
});
