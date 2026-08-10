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
import { NutritionToday, type NutritionTodayLog } from "@/components/NutritionToday";
import { parseDatetimeLocalValue } from "@/lib/calendar-core";

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

describe("NutritionToday — append-choice stub threading (#295)", () => {
  // defaultMeal() picks the composer's initial slot from the wall-clock hour;
  // logging one row per candidate slot makes the choice render deterministic.
  const DAY = "2026-08-05";
  const logsForAllSlots: NutritionTodayLog[] = (
    ["breakfast", "lunch", "snack", "dinner"] as const
  ).map((mealType, i) => ({
    id: `log-${mealType}`,
    // USER_TZ noon-ish instants — dateKey(date) resolves to DAY on any machine TZ.
    date: parseDatetimeLocalValue(`${DAY}T1${i}:00`),
    mealType,
    items: [{ name: "eggs" }, { name: "toast" }],
    notes: null,
  }));

  it("threads the day's logs into the composer as append-choice stubs", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, {
        logs: logsForAllSlots,
        plan: null,
        showLogForm: true,
        defaultDate: DAY, // day-detail entry point (#294) — composer pinned to DAY
      }),
    );

    // The chain NutritionToday → LogNutritionForm → MealComposer surfaces the
    // choice because the composed (day, slot) matches a threaded log.
    expect(html).toContain('data-testid="append-choice"');
    expect(html).toContain("Add to existing");
    expect(html).toContain("(2 items)");
    // Non-destructive default: separate entry selected.
    expect(html).toMatch(/data-testid="append-choice-separate"[^>]*aria-pressed="true"/);
  });

  it("a day with no logs renders the composer without the choice (unchanged create flow)", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, {
        logs: [],
        plan: null,
        showLogForm: true,
        defaultDate: DAY,
      }),
    );

    expect(html).toContain('data-testid="meal-composer"');
    expect(html).not.toContain("append-choice");
  });
});
