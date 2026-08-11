// src/components/progress/BaselinesCard.test.ts
//
// G2's open Pillar-1 card: weight-desc ordering with the BELOW-FLOOR pin
// (UXR-PROG-26), the canary status readout that is NEVER a bar (UXR-PV-27/45),
// the reading-not-verdict negative retest (UXR-PROG-27), notes only on
// negative deltas (UXR-PROG-28), and the capped channels (UXR-PROG-30:
// ▲cap text + the SeamLine cap rule).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BaselinesCard,
  orderBaselineRows,
  type BaselineCardRow,
} from "@/components/progress/BaselinesCard";

function row(over: Partial<BaselineCardRow>): BaselineCardRow {
  return {
    testName: "Test",
    units: "sec",
    latest: { value: 20, date: new Date("2026-09-14T17:00Z"), capped: false },
    earliest: { value: 10, date: new Date("2026-08-10T17:00Z") },
    count: 2,
    history: [10, 20],
    capValue: null,
    weight: 0.1,
    maintenance: null,
    notes: null,
    sharedByGoals: 1,
    ...over,
  };
}

const render = (rows: BaselineCardRow[], totalScheduled: number | null = 9) =>
  renderToStaticMarkup(createElement(BaselinesCard, { rows, totalScheduled }));

describe("ordering (UXR-PROG-26)", () => {
  it("weight-desc, with a below-floor canary PINNED to position 1", () => {
    const rows = [
      row({ testName: "Heavy", weight: 0.2 }),
      row({ testName: "Light", weight: 0.05 }),
      row({
        testName: "Pull-Up Max Reps",
        units: "reps",
        weight: 0.07,
        latest: { value: 23, date: new Date("2026-09-14T17:00Z"), capped: false },
        maintenance: { floor: 25, holding: false },
      }),
    ];
    expect(orderBaselineRows(rows).map((r) => r.testName)).toEqual([
      "Pull-Up Max Reps", // pinned — the canary's job is to alarm
      "Heavy",
      "Light",
    ]);
  });

  it("a HOLDING canary is not pinned — weight order applies", () => {
    const rows = [
      row({ testName: "Heavy", weight: 0.2 }),
      row({ testName: "Pull-Up Max Reps", weight: 0.07, maintenance: { floor: 25, holding: true } }),
    ];
    expect(orderBaselineRows(rows).map((r) => r.testName)).toEqual(["Heavy", "Pull-Up Max Reps"]);
  });
});

describe("the canary treatment — a cliff, never a bar", () => {
  it("HOLDING renders the --success eyebrow; BELOW FLOOR the --warning one; neither gets a bar", () => {
    const holding = render([
      row({ testName: "Pull-Up Max Reps", units: "reps", latest: { value: 25, date: new Date(), capped: false }, maintenance: { floor: 25, holding: true } }),
    ]);
    expect(holding).toContain("Holding 25");
    expect(holding).toContain("text-[var(--success)]");
    const below = render([
      row({ testName: "Pull-Up Max Reps", units: "reps", latest: { value: 23, date: new Date(), capped: false }, maintenance: { floor: 25, holding: false } }),
    ]);
    expect(below).toContain("Below floor · 23");
    expect(below).toContain("text-[var(--warning)]");
    expect(below).toContain("25 reps is the floor");
    // NEVER a progress bar, never danger, never an arrow:
    for (const html of [holding, below]) {
      expect(html).not.toContain('role="progressbar"');
      expect(html).not.toContain("--danger");
      expect(html).not.toContain("↓");
    }
  });
});

describe("negative retests read as readings (UXR-PROG-27/28)", () => {
  const negative = row({
    testName: "Freestanding Handstand Hold",
    latest: { value: 18, date: new Date("2026-10-14T17:00Z"), capped: false },
    earliest: { value: 20, date: new Date("2026-08-10T17:00Z") },
    history: [20, 18],
    notes: "tested at the end of a deficit week, 3rd in the order",
  });

  it("the dated prior is the message — no arrow, no red; notes render on the negative delta", () => {
    const html = render([negative]);
    expect(html).toContain("18 sec");
    expect(html).toContain("20 sec on Aug 10");
    expect(html).not.toContain("↓");
    expect(html).not.toContain("--danger");
    expect(html).toContain("baseline-notes-Freestanding Handstand Hold");
    expect(html).toContain("deficit week");
    // The framing line teaches the doctrine:
    expect(html).toContain("Retests are readings, not verdicts.");
  });

  it("notes do NOT render on a positive delta", () => {
    const positive = row({ notes: "felt great" });
    const html = render([positive]);
    expect(html).not.toContain("baseline-notes");
  });
});

describe("capped channels (UXR-PROG-30)", () => {
  it("▲cap text + the SeamLine cap rule + the pinned-not-stalled line", () => {
    const html = render([
      row({
        testName: "Goblet Squat 5RM",
        units: "lb",
        latest: { value: 65, date: new Date("2026-07-28T17:00Z"), capped: true },
        earliest: { value: 50, date: new Date("2026-06-01T17:00Z") },
        history: [50, 60, 65, 65, 65],
        capValue: 65,
      }),
    ]);
    expect(html).toContain("▲cap");
    expect(html).toContain("data-seam-rule"); // channel 2: the drawn ceiling
    expect(html).toContain("Flat on a drawn ceiling reads pinned, not stalled.");
  });
});

describe("overflow + subtitle honesty", () => {
  it("headline 4 with an in-place details overflow; the measured count subtitle", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ testName: `T${i}`, weight: 0.1 - i * 0.01 }));
    const html = render(rows, 9);
    expect(html).toContain("Show all 6 tests");
    expect(html).toContain("6 of 9 tested");
    expect(html).toContain("<details");
  });

  it("self-nulls on zero rows", () => {
    expect(render([], 9)).toBe("");
  });
});
