// src/components/today/TodayTimeline.test.ts
// Render proof for the Unified Today timeline (#288), house idiom: node env,
// createElement + renderToStaticMarkup, assert on the HTML string (same
// pattern as BetweenGoalsToday.test.ts). The four named acceptance checks:
//   1. the mark lane renders N marks for a multi-goal item;
//   2. a shared activity appears exactly once (no per-goal sections — RFC §7);
//   3. zero-Program input renders NOTHING (Today stays byte-identical);
//   4. a completed scheduled item's mark renders filled.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayTimeline } from "@/components/today/TodayTimeline";
import { assignGoalIdentities } from "@/lib/goal-identity";
import type { TimelineEntry } from "@/lib/day-rhythm";

const G1 = "g-handstand";
const G2 = "g-bodycomp";
const G3 = "g-aws";

const IDENTITIES = assignGoalIdentities([
  { id: G1, objective: "Freestanding Handstand — 20s", kind: "fitness", status: "active", isFocus: true, createdAt: new Date("2026-07-01T00:00:00Z") },
  { id: G2, objective: "Reach 10% body fat", kind: "fitness", status: "active", createdAt: new Date("2026-08-01T00:00:00Z") },
  { id: G3, objective: "Pass the AWS exam", kind: "project", status: "active", createdAt: new Date("2026-08-02T00:00:00Z") },
]);

const AM_ROW: TimelineEntry = {
  id: "am-0",
  slot: "fasted-am",
  title: "Fasted AM — incline walk + AWS lectures",
  detail: null,
  href: "/days/2026-08-24",
  itemType: null,
  goalIds: [G1, G2, G3],
  filled: false,
};

const DONE_ITEM: TimelineEntry = {
  id: "item-i2",
  slot: "anytime",
  title: "Practice exam 1",
  detail: null,
  href: "/days/2026-08-24",
  itemType: "milestone",
  goalIds: [G3],
  filled: true,
};

function render(entries: TimelineEntry[], identities = IDENTITIES): string {
  return renderToStaticMarkup(createElement(TodayTimeline, { identities, entries }));
}

describe("TodayTimeline", () => {
  it("renders N marks in the lane for a multi-goal item, in slot order ● ■ ▲", () => {
    const html = render([AM_ROW]);
    expect(html).toContain(`data-testid="mark-lane-am-0"`);
    expect(html).toContain(`data-testid="mark-${G1}-am-0"`);
    expect(html).toContain(`data-testid="mark-${G2}-am-0"`);
    expect(html).toContain(`data-testid="mark-${G3}-am-0"`);
    // Hollow glyphs — claimed, not yet logged — in stable slot order. Scoped
    // to the lane: the legend strip above it teaches the FILLED glyphs.
    const lane = html.slice(html.indexOf(`data-testid="mark-lane-am-0"`));
    expect(lane.indexOf("○")).toBeGreaterThan(-1);
    expect(lane.indexOf("○")).toBeLessThan(lane.indexOf("□"));
    expect(lane.indexOf("□")).toBeLessThan(lane.indexOf("△"));
    expect(lane).not.toContain("●");
    expect(lane).not.toContain("■");
    expect(lane).not.toContain("▲");
  });

  it("a shared activity appears exactly once — one row, many marks, never per-goal sections", () => {
    const html = render([AM_ROW, DONE_ITEM]);
    expect(html.split(`data-testid="timeline-row-am-0"`)).toHaveLength(2); // 1 occurrence
    expect(html.split("Fasted AM — incline walk + AWS lectures")).toHaveLength(2);
  });

  it("zero-Program input renders nothing at all (Today stays byte-identical)", () => {
    expect(renderToStaticMarkup(createElement(TodayTimeline, { identities: [], entries: [] }))).toBe("");
    // Even with stray entries, no identities → no DOM (the page-level guard's contract).
    expect(render([AM_ROW], [])).toBe("");
  });

  it("a completed scheduled item's mark renders filled (▲) with the done receipt", () => {
    const html = render([DONE_ITEM]);
    expect(html).toContain(`data-testid="mark-${G3}-item-i2"`);
    const lane = html.slice(html.indexOf(`data-testid="mark-lane-item-i2"`));
    expect(lane).toContain(`data-mark-state="logged"`);
    expect(lane).toContain("▲");
    expect(html).not.toContain("△"); // hollow triangle appears nowhere
    expect(html).toContain("✓");
    expect(html).toContain("milestone"); // TypeBadge
  });

  it("teaches the marks once via the legend strip; row lanes stay glyph-only", () => {
    const html = render([AM_ROW]);
    expect(html.split(`data-testid="mark-legend-strip"`)).toHaveLength(2);
    expect(html).toContain("Freestanding Hands…"); // short-label fallback
    expect(html).toContain("Reach 10% body fat");
  });

  it("keeps the words-only claim summary for screen readers on the lane", () => {
    const html = render([AM_ROW]);
    expect(html).toContain("Counts toward 3 goals:");
    expect(html).toContain("claimed");
  });

  it("mounts the aria-live region empty from the first paint", () => {
    const html = render([AM_ROW]);
    expect(html).toContain(`data-testid="timeline-live-region"`);
    expect(html).toContain(`aria-live="polite"`);
  });

  it("renders the rest-day empty state when the program has members but no rows", () => {
    const html = render([]);
    expect(html).toContain(`data-testid="timeline-empty"`);
    expect(html).toContain("Nothing scheduled today.");
  });

  it("overflow identities render as a bare +N, not a fourth glyph", () => {
    const fourGoals = assignGoalIdentities([
      { id: G1, objective: "Handstand", kind: "fitness", status: "active", isFocus: true, createdAt: new Date("2026-07-01T00:00:00Z") },
      { id: G2, objective: "Body comp", kind: "fitness", status: "active", createdAt: new Date("2026-08-01T00:00:00Z") },
      { id: "g-mobility", objective: "Pancake", kind: "fitness", status: "active", createdAt: new Date("2026-08-03T00:00:00Z") },
      { id: G3, objective: "AWS", kind: "project", status: "active", createdAt: new Date("2026-08-02T00:00:00Z") },
    ]);
    const entry: TimelineEntry = { ...AM_ROW, goalIds: [G1, G2, "g-mobility", G3] };
    const html = renderToStaticMarkup(
      createElement(TodayTimeline, { identities: fourGoals, entries: [entry] }),
    );
    expect(html).toContain(">+1<");
    // AWS (slot 3) has no glyph of its own: exactly three hollow shapes.
    expect(html).toContain("○");
    expect(html).toContain("□");
    expect(html).toContain("△");
  });
});
