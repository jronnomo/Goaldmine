// FuelRail — Tier-2 strip render proofs (today-page-ia §2.4).
// The two load-bearing claims: (1) remaining-led calories with the HONEST
// h-1.5 fill meter — never a Bullseye, whose ceil(p×4) rendered 78% as done
// (UXR-TIA-08); (2) totals come from the SHARED fallback-aware sum, byte-
// consistent with NutritionToday's day total (UXR-TIA-09, BLOCKING).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FuelRail } from "@/components/today/FuelRail";
import { NutritionToday } from "@/components/NutritionToday";
import type { NutritionPlan } from "@/lib/nutrition-plan";

const plan: NutritionPlan = {
  breakfast: { items: [{ name: "eggs" }], macros: { calories: 600, proteinG: 45, carbsG: 40, fatG: 25 } },
  lunch: { items: [{ name: "bowl" }], macros: { calories: 1000, proteinG: 70, carbsG: 90, fatG: 35 } },
  dinner: { items: [{ name: "steak" }], macros: { calories: 1000, proteinG: 75, carbsG: 70, fatG: 40 } },
}; // target: 2,600 cal · 190p

const log = (
  mealType: string,
  macros: { calories?: number | null; proteinG?: number | null; carbsG?: number | null; fatG?: number | null } = {},
) => ({
  mealType,
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  ...macros,
});

describe("FuelRail — remaining-led headline + honest meter", () => {
  it("leads with REMAINING calories against the day's target; protein line second", () => {
    const html = renderToStaticMarkup(
      createElement(FuelRail, {
        logs: [log("breakfast", { calories: 580, proteinG: 44, carbsG: 38, fatG: 24 }), log("lunch", { calories: 1260, proteinG: 80, carbsG: 100, fatG: 40 })],
        plan,
      }),
    );
    // 2,600 − 1,840 = 760 left.
    expect(html).toContain("760 left of 2,600 cal");
    expect(html).toContain("Protein 124 / 190g");
    expect(html).toContain("2 meals");
    expect(html).toContain('data-testid="today-fuel-rail"');
  });

  it("the 78%-not-done case: fill width 78%, aria 78 — and NO Bullseye svg anywhere in the strip", () => {
    // 2,028 / 2,600 = 78% — the exact band the shipped Bullseye rendered as done.
    const html = renderToStaticMarkup(
      createElement(FuelRail, { logs: [log("lunch", { calories: 2028 })], plan }),
    );
    expect(html).toContain('data-testid="today-fuel-meter"');
    expect(html).toContain("width:78%");
    expect(html).toMatch(/aria-valuenow="78"/);
    expect(html).toContain("572 left of 2,600 cal");
    expect(html).not.toContain("<svg"); // Bullseye is an svg glyph — banned here
  });

  it("over-target is signalled by the WORD, meter capped at 100% (never --danger alone)", () => {
    const html = renderToStaticMarkup(
      createElement(FuelRail, { logs: [log("lunch", { calories: 2840 })], plan }),
    );
    expect(html).toContain("240 cal over");
    expect(html).toContain("width:100%");
  });

  it("Tier-2 grammar: no h2 in the strip (eyebrow, not a heading)", () => {
    const html = renderToStaticMarkup(
      createElement(FuelRail, { logs: [log("lunch", { calories: 500 })], plan }),
    );
    expect(html).not.toContain("<h2");
    expect(html).toContain("Fuel");
  });

  it("is a wayfinding Link to /nutrition plus the one-tap Log affordance (never a composer)", () => {
    const html = renderToStaticMarkup(
      createElement(FuelRail, { logs: [log("lunch", { calories: 500 })], plan }),
    );
    expect(html).toContain('href="/nutrition"');
    expect(html).toContain('data-testid="today-fuel-log"');
    expect(html).toContain("Log meal");
    expect(html).not.toContain("meal-composer");
  });
});

describe("FuelRail — shared fallback-aware sum (UXR-TIA-09: can never contradict NutritionToday)", () => {
  // A macros-null logged breakfast in a planned slot: the PLAIN sum would say
  // 0 consumed / 2,600 left; the fallback-aware sum inherits breakfast's
  // planned 600. Both surfaces must print the fallback-aware figure.
  const fallbackLogs = [log("breakfast")];

  it("a macros-null row falls back to the slot's plan estimate — exactly as NutritionToday does", () => {
    const railHtml = renderToStaticMarkup(createElement(FuelRail, { logs: fallbackLogs, plan }));
    expect(railHtml).toContain("2,000 left of 2,600 cal"); // 2600 − 600 planned
    expect(railHtml).toContain("Protein 45 / 190g");

    const detailHtml = renderToStaticMarkup(
      createElement(NutritionToday, { logs: fallbackLogs.map((l, i) => ({
        id: `l${i}`,
        date: new Date("2026-08-10T12:00:00.000Z"),
        items: [{ name: "eggs" }],
        notes: null,
        ...l,
      })), plan, showLogForm: false }),
    );
    // Same 600-so-far / 2,000-remaining day the rail shows.
    expect(detailHtml).toContain("600 cal");
    expect(detailHtml).toContain("2000 cal remaining");
  });
});

describe("FuelRail — zero states (UXR-TIA-11: degrade, never return null)", () => {
  it("brand-new user (no logs, no plan): eyebrow + 'Nothing logged yet' + the Log affordance, no meter", () => {
    const html = renderToStaticMarkup(createElement(FuelRail, { logs: [], plan: null }));
    expect(html).toContain('data-testid="today-fuel-rail"');
    expect(html).toContain("Nothing logged yet");
    expect(html).toContain('data-testid="today-fuel-log"');
    expect(html).not.toContain("progressbar");
  });

  it("logs but no plan target: so-far headline + verbatim 'No daily target set', no meter", () => {
    const html = renderToStaticMarkup(
      createElement(FuelRail, { logs: [log("lunch", { calories: 1840, proteinG: 120 })], plan: null }),
    );
    expect(html).toContain("1,840 cal");
    expect(html).toContain("No daily target set");
    expect(html).not.toContain("progressbar");
  });

  it("target set but nothing logged yet (every morning): full budget + 0% meter, not the zero-row state", () => {
    const html = renderToStaticMarkup(createElement(FuelRail, { logs: [], plan }));
    expect(html).toContain("2,600 left of 2,600 cal");
    expect(html).toContain("width:0%");
    expect(html).not.toContain("Nothing logged yet");
  });
});
