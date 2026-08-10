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
import type { LibraryFood } from "@/lib/food-types";

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

describe("NutritionToday — day-total meter honesty (today-page-ia defect 4)", () => {
  const plan = {
    dinner: { items: [{ name: "steak" }], macros: { calories: 600, proteinG: 45 } },
  };
  const logAt = (calories: number): NutritionTodayLog[] => [
    {
      id: "log-1",
      date: parseDatetimeLocalValue("2026-08-05T12:00"),
      mealType: "lunch",
      items: [{ name: "bowl" }],
      notes: null,
      calories,
      proteinG: 30,
      carbsG: 40,
      fatG: 15,
    },
  ];

  it("78% of target renders a 78%-wide fill meter — never a Bullseye (ceil(p×4) read as done from 76%)", () => {
    // target 600 (dinner planned) · logged 468 = 78%
    const html = renderToStaticMarkup(
      createElement(NutritionToday, { logs: logAt(468), plan, showLogForm: false }),
    );
    expect(html).toContain('data-testid="daytotal-meter"');
    expect(html).toContain("width:78%");
    expect(html).toMatch(/aria-valuenow="78"/);
    expect(html).not.toContain("daytotal-bullseye");
    // No svg ring glyph in the day-total strip's meter role.
    expect(html).not.toMatch(/role="progressbar"[^>]*>\s*<svg/);
  });

  it("no daily target → no meter at all (an empty track would fake a 0% reading); the note carries the state", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, { logs: logAt(468), plan: null, showLogForm: false }),
    );
    expect(html).not.toContain('data-testid="daytotal-meter"');
    expect(html).toContain("No daily target set");
  });
});

describe("NutritionToday — per-item macro display (food-linked bundles)", () => {
  const logWithItemMacros: NutritionTodayLog[] = [
    {
      id: "log-im",
      date: parseDatetimeLocalValue("2026-08-05T12:00"),
      mealType: "lunch",
      items: [
        {
          name: "97% Lean Beef",
          qty: "200 g",
          amount: 200,
          unit: "g",
          itemMacros: { calories: 260, proteinG: 42, carbsG: 0, fatG: 9 },
        },
        { name: "Kroger Hamburger Buns", qty: "1 serving", itemMacros: { calories: 140, proteinG: 5, carbsG: 26, fatG: 2 } },
      ],
      notes: null,
      calories: 400,
      proteinG: 47,
    },
  ];

  it("items carrying itemMacros render the per-item breakdown — each item with its own compact macro line", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, { logs: logWithItemMacros, plan: null, showLogForm: false }),
    );
    expect(html).toContain('data-testid="meal-item-breakdown"');
    // Individual items still visible with their qty…
    expect(html).toContain("97% Lean Beef (200 g)");
    expect(html).toContain("Kroger Hamburger Buns (1 serving)");
    // …each with its own muted macro readout.
    expect(html).toContain("260 cal · 42P · 0C · 9F");
    expect(html).toContain("140 cal · 5P · 26C · 2F");
  });

  it("meals without itemMacros keep the joined summary — zero regression for legacy logs", () => {
    const legacy: NutritionTodayLog[] = [
      {
        id: "log-legacy",
        date: parseDatetimeLocalValue("2026-08-05T12:00"),
        mealType: "lunch",
        items: [{ name: "eggs", qty: "3" }, { name: "toast" }],
        notes: null,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(NutritionToday, { logs: legacy, plan: null, showLogForm: false }),
    );
    expect(html).not.toContain("meal-item-breakdown");
    expect(html).toContain("eggs (3), toast");
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

// ── "Browse library" — libraryFoods threading fix ────────────────────────────
// Root cause: NutritionToday had no `libraryFoods` prop at all, so neither its
// inline log composer (LogNutritionForm, below) nor its per-meal edit composer
// (MealEditButton, gated behind a closed-by-default BottomSheet — not
// SSR-observable) could ever show "Browse library". This suite proves the fix
// via the inline composer, which — unlike the per-meal edit sheet — renders
// unconditionally whenever `showLogForm` is true, so the threaded prop is
// directly visible in a static render.
describe("NutritionToday — libraryFoods passthrough to the inline composer (Browse library fix)", () => {
  const LIB_FOOD: LibraryFood[] = [
    {
      id: "food-1",
      barcode: null,
      name: "Chicken breast",
      brand: null,
      servingSize: "100 g",
      basis: "100g",
      perServing: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fiberG: 0, sodiumMg: 74 },
    },
  ];

  it("libraryFoods supplied: the inline log composer renders Browse library", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, {
        logs: [],
        plan: null,
        showLogForm: true,
        libraryFoods: LIB_FOOD,
      }),
    );
    expect(html).toContain('data-testid="composer-browse-library"');
    expect(html).toContain("Browse library");
  });

  it("libraryFoods omitted: no Browse library (regression guard — matches pre-fix behavior for any host that doesn't wire it)", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionToday, {
        logs: [],
        plan: null,
        showLogForm: true,
      }),
    );
    expect(html).not.toContain("composer-browse-library");
    expect(html).not.toContain("Browse library");
  });
});
