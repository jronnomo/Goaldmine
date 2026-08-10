// TODAY_SECTION_ORDER — the page's vertical-order contract (today-page-ia
// §2.2, with the FuelRail at the owner-directed post-timeline slot). These
// assertions ARE the "Fuel Rail + Weight Ladder" order: the page renders by
// mapping this exact array, so an order regression fails here before it
// ships.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TODAY_SECTION_ORDER,
  orderedTodaySections,
  type TodaySectionKey,
} from "@/components/today/today-manifest";

const idx = (key: TodaySectionKey) => TODAY_SECTION_ORDER.indexOf(key);

describe("TODAY_SECTION_ORDER — the move list's binding order", () => {
  it("timeline before fuel-rail before session (owner-directed: rail rides right after the timeline)", () => {
    expect(idx("timeline")).toBeGreaterThan(idx("hero"));
    expect(idx("fuel-rail")).toBeGreaterThan(idx("timeline"));
    expect(idx("session")).toBeGreaterThan(idx("fuel-rail"));
  });

  it("TRACK zone is last: divider, then the two lids — nothing after them", () => {
    expect(idx("zone-divider")).toBeGreaterThan(idx("session"));
    expect(idx("deferred-lid")).toBe(idx("zone-divider") + 1);
    expect(idx("baselines-completed-lid")).toBe(idx("deferred-lid") + 1);
    expect(TODAY_SECTION_ORDER.at(-1)).toBe("baselines-completed-lid");
  });

  it("the cut surfaces have NO key at all: feasibility card, nutrition card, recent workouts", () => {
    const keys = TODAY_SECTION_ORDER as readonly string[];
    expect(keys).not.toContain("feasibility");
    expect(keys).not.toContain("nutrition-card");
    expect(keys).not.toContain("recent-workouts");
    expect(keys).not.toContain("day-task"); // absorbed into session/deferred-lid
  });

  it("hero keeps the top block: character, other-goals, hero lead the manifest", () => {
    expect([...TODAY_SECTION_ORDER.slice(0, 3)]).toEqual(["character", "other-goals", "hero"]);
  });
});

describe("orderedTodaySections — the machinery the page renders with", () => {
  it("emits DOM in manifest order regardless of insertion order, dropping absent sections", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        orderedTodaySections({
          session: createElement("div", { "data-testid": "stub-session" }),
          "fuel-rail": createElement("div", { "data-testid": "stub-fuel" }),
          timeline: createElement("div", { "data-testid": "stub-timeline" }),
          "zone-divider": null, // TRACK zone empty → gated off
          hero: createElement("div", { "data-testid": "stub-hero" }),
        }).map(({ key, node }) => createElement("section", { key }, node)),
      ),
    );
    const order = ["stub-hero", "stub-timeline", "stub-fuel", "stub-session"].map((t) =>
      html.indexOf(t),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("zone-divider");
  });

  it("false/null/undefined sections are dropped (a `cond && <X/>` node can never render a stray 'false')", () => {
    const out = orderedTodaySections({
      hero: false,
      timeline: undefined,
      session: null,
      "fuel-rail": createElement("span"),
    });
    expect(out.map((s) => s.key)).toEqual(["fuel-rail"]);
  });

  it("keys are the stable literals themselves — never array indexes (UXR-TIA-06)", () => {
    const out = orderedTodaySections({
      "fuel-rail": createElement("span"),
      session: createElement("span"),
    });
    expect(out.map((s) => s.key)).toEqual(["fuel-rail", "session"]);
  });
});
