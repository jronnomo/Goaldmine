// ReachChip — byte-consistency with the /goals surfaces' meter (today-page-ia
// UXR-TIA-13): the chip must contain the EXACT static markup ReachMeter emits
// for the same tier, because /goals/[id] renders that same component — one
// glyph grammar, two hosts, zero drift.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReachChip } from "@/components/today/ReachChip";
import { ReachMeter } from "@/components/ReachMeter";

describe("ReachChip — Tier-4 chip in the hero eyeline", () => {
  it("contains ReachMeter's markup byte-for-byte (label variant, size sm)", () => {
    const meterHtml = renderToStaticMarkup(
      createElement(ReachMeter, { tier: "rare", label: true, size: "sm" }),
    );
    const chipHtml = renderToStaticMarkup(
      createElement(ReachChip, { tier: "rare", weeksRemaining: 11.6, goalId: "g1" }),
    );
    expect(chipHtml).toContain(meterHtml);
  });

  it("wayfinds into the goal page (the old Reach Card linked nowhere) with a 44px target", () => {
    const chipHtml = renderToStaticMarkup(
      createElement(ReachChip, { tier: "epic", weeksRemaining: 4.2, goalId: "goal-abc" }),
    );
    expect(chipHtml).toContain('href="/goals/goal-abc"');
    expect(chipHtml).toContain("min-h-[44px]");
    expect(chipHtml).toContain('data-testid="today-reach-chip"');
  });

  it("rounds the weeks label; omits it when weeksRemaining is null (coach-tiered someday goal)", () => {
    const withWeeks = renderToStaticMarkup(
      createElement(ReachChip, { tier: "rare", weeksRemaining: 11.6, goalId: "g1" }),
    );
    expect(withWeeks).toContain("12 wk");
    const noWeeks = renderToStaticMarkup(
      createElement(ReachChip, { tier: "rare", weeksRemaining: null, goalId: "g1" }),
    );
    expect(noWeeks).not.toContain("wk");
  });

  it("never animated (UXR-63-21): no transition/animation classes anywhere in the chip", () => {
    const chipHtml = renderToStaticMarkup(
      createElement(ReachChip, { tier: "legendary", weeksRemaining: 2, goalId: "g1" }),
    );
    expect(chipHtml).not.toContain("transition");
    expect(chipHtml).not.toContain("animate");
  });
});
