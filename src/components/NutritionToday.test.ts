// src/components/NutritionToday.test.ts
// Render-level proof that NutritionToday forwards `defaultDate` through
// LogNutritionForm into MealComposer's date/time control (#294) — the
// day-detail page's log entry point depends on this chain to land a
// backfilled/pre-planned meal on the viewed day, not "today". Mirrors the
// createElement + renderToStaticMarkup pattern established by
// BetweenGoalsToday.test.ts (.test.ts, not .test.tsx — no JSX).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NutritionToday } from "@/components/NutritionToday";

describe("NutritionToday — defaultDate passthrough (#294)", () => {
  it("showLogForm + defaultDate renders a composer seeded to that day, not today", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, {
        logs: [],
        plan: null,
        showLogForm: true,
        defaultDate: "2026-08-05",
      }),
    );

    expect(html).toContain('data-testid="meal-composer"');
    // The exact value the day-detail page's log entry point would submit —
    // proves defaultDate survives NutritionToday → LogNutritionForm → MealComposer.
    expect(html).toMatch(/name="date"[^>]*\svalue="2026-08-05T\d{2}:\d{2}"/);
  });

  it("showLogForm=false renders no composer (e.g. Today page, which owns logging via the global Log sheet instead)", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, { logs: [], plan: null, showLogForm: false }),
    );

    expect(html).not.toContain('data-testid="meal-composer"');
  });

  it("empty-state copy is date-neutral — this component renders for arbitrary days, not just today", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, { logs: [], plan: null, showLogForm: false }),
    );

    expect(html).toContain("Nothing planned or logged yet.");
    expect(html).not.toContain("Nothing planned or logged today yet.");
  });
});
