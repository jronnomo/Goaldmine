// src/components/MealComposer.test.ts
// Render-level proof for the #293 "When" control surfacing and the #294
// `defaultDate` seeding wiring. Mirrors the createElement + renderToStaticMarkup
// pattern established by BetweenGoalsToday.test.ts / GoalStorySection.test.ts
// (this file must stay .test.ts, not .test.tsx: the vitest config only picks up
// *.test.ts, so no JSX — createElement instead). No vi.mock needed: MealComposer
// only imports logNutrition/updateNutrition ("use server" actions) to bind them
// as client-side submit handlers — they're never invoked during a plain render.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MealComposer, type MealDefaults } from "@/components/MealComposer";
import {
  expandSavedMealForComposer,
  savedMealChipMacros,
} from "@/components/useFoodComposer";
import {
  annotateItemsForFactor,
  savedMealScaleFactor,
  scaleSavedMealMacros,
  type SavedMealLite,
} from "@/lib/saved-meal";
import { dateKey } from "@/lib/calendar-core";
import type { ExistingMealStub } from "@/lib/nutrition-merge";

const EDIT_DEFAULTS: MealDefaults = {
  mealType: "lunch",
  items: [],
  notes: "",
  date: "2026-08-05T12:00",
};

describe("MealComposer — When control (#293)", () => {
  it("create mode: the date/time control is visible by default, not behind an 'exact time' disclosure", () => {
    const html = renderToStaticMarkup(createElement(MealComposer, { mode: "create" }));

    expect(html).toContain('data-testid="when-exact-control"');
    expect(html).toContain('aria-label="Meal date and time"');
    // The old, time-only-reading disclosure toggle must be gone in create mode.
    expect(html).not.toContain(">exact time<");
    // Copy makes clear this sets date AND time, not just time-of-day.
    expect(html).toContain("date &amp; time");
  });

  it("create mode: the nudge shortcuts (Yesterday / -2h / Now) remain alongside the control", () => {
    const html = renderToStaticMarkup(createElement(MealComposer, { mode: "create" }));

    expect(html).toContain(">Yesterday<");
    expect(html).toContain("2h");
    expect(html).toContain(">Now<");
  });

  it("edit mode is unchanged: the 'exact time' toggle still gates the control, hidden by default", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, {
        mode: "edit",
        id: "meal-1",
        defaults: EDIT_DEFAULTS,
      }),
    );

    expect(html).toContain(">exact time<");
    expect(html).not.toContain('data-testid="when-exact-control"');
    // Hidden by default: the datetime-local input carries the boolean `hidden` attribute.
    expect(html).toMatch(/type="datetime-local"[^>]*\shidden=""/);
  });
});

describe("MealComposer — defaultDate seeding (#294)", () => {
  it("seeds the rendered control's value to the passed dateKey, not 'now'", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, { mode: "create", defaultDate: "2026-08-05" }),
    );

    // The exact value the `name="date"` field would submit to logNutrition —
    // proves the passed dateKey reaches the real form control (what ends up on
    // the created NutritionLog), not just some internal-only state.
    expect(html).toMatch(/name="date"[^>]*\svalue="2026-08-05T\d{2}:\d{2}"/);
  });

  it("without defaultDate, seeds to today's USER_TZ dateKey (unchanged 'now' behavior for other hosts)", () => {
    const html = renderToStaticMarkup(createElement(MealComposer, { mode: "create" }));
    const today = dateKey(new Date()); // USER_TZ "today", not UTC — matches createModeSeedDate's fallback

    expect(html).toMatch(new RegExp(`name="date"[^>]*\\svalue="${today}T\\d{2}:\\d{2}"`));
  });
});

// ── #295: append-vs-separate choice ─────────────────────────────────────────

// defaultMeal() picks the initial slot from the wall-clock hour (one of these
// four). A stub for each makes the choice render deterministic regardless of
// when the suite runs.
const DEFAULT_MEAL_SLOTS = ["breakfast", "lunch", "snack", "dinner"] as const;

function stubsFor(dk: string, itemCount = 3): ExistingMealStub[] {
  return DEFAULT_MEAL_SLOTS.map((mealType, i) => ({
    id: `row-${mealType}`,
    dateKey: dk,
    mealType,
    itemCount,
    dateISO: `${dk}T1${i}:00:00.000Z`,
  }));
}

describe("MealComposer — append-vs-separate choice (#295)", () => {
  it("create mode with an existing same-day/slot row: renders the choice, defaulting to 'separate'", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, {
        mode: "create",
        defaultDate: "2026-08-05",
        existingMeals: stubsFor("2026-08-05"),
      }),
    );

    expect(html).toContain('data-testid="append-choice"');
    expect(html).toContain("already has an entry for this day");
    expect(html).toContain("Add to existing");
    expect(html).toContain("(3 items)");
    expect(html).toContain("Log as separate entry");
    // Default selection is SEPARATE (non-destructive): the separate option is
    // pressed, append is not, and the submit button keeps the create label.
    expect(html).toMatch(/data-testid="append-choice-separate"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-testid="append-choice-append"[^>]*aria-pressed="false"/);
    expect(html).toContain(">Log meal<");
  });

  it("no rows for the composed day: no choice UI and no reserved space (jank-free common path)", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, {
        mode: "create",
        defaultDate: "2026-08-09", // stubs are for the 5th — different day, no match
        existingMeals: stubsFor("2026-08-05"),
      }),
    );

    expect(html).not.toContain("append-choice");
  });

  it("absent existingMeals prop: create renders exactly as before — no choice UI", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, { mode: "create", defaultDate: "2026-08-05" }),
    );

    expect(html).not.toContain("append-choice");
  });

  it("singular / macros-only count labels: '(1 item)' and '(custom entry)'", () => {
    const oneItem = renderToStaticMarkup(
      createElement(MealComposer, {
        mode: "create",
        defaultDate: "2026-08-05",
        existingMeals: stubsFor("2026-08-05", 1),
      }),
    );
    expect(oneItem).toContain("(1 item)");
    expect(oneItem).not.toContain("(1 items)");

    const macrosOnly = renderToStaticMarkup(
      createElement(MealComposer, {
        mode: "create",
        defaultDate: "2026-08-05",
        existingMeals: stubsFor("2026-08-05", 0),
      }),
    );
    expect(macrosOnly).toContain("(custom entry)");
  });
});

// ── #296: SavedMeal composer quick-pick ──────────────────────────────────────

const BROOKIE: SavedMealLite = {
  id: "sm-brookie",
  name: "Protein Brookie",
  items: [{ name: "Protein brookie", qty: "1 brookie" }],
  macros: { calories: 310, proteinG: 31, carbsG: 28, fatG: 9 },
  defaultServings: 1,
};

const BOWL: SavedMealLite = {
  id: "sm-bowl",
  name: "Chipotle Protein Bowl",
  items: [
    { name: "Chipotle bowl", qty: "1 bowl" },
    { name: "Guac", notes: "side" },
  ],
  macros: { calories: 670, proteinG: 71, carbsG: 52, fatG: 22 },
  defaultServings: 1,
};

describe("MealComposer — SavedMeal quick-pick row (#296)", () => {
  it("renders chips from the server-fetched list — name plus the mono cal·protein line", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, { mode: "create", savedMeals: [BROOKIE, BOWL] }),
    );

    expect(html).toContain('data-testid="saved-meal-row"');
    expect(html).toContain('data-testid="saved-meal-chip-sm-brookie"');
    expect(html).toContain('data-testid="saved-meal-chip-sm-bowl"');
    expect(html).toContain("Protein Brookie");
    // UXR-PV-60: the two numbers that decide the tap, mono at 11px.
    expect(html).toContain("310 · 31P");
    expect(html).toContain("670 · 71P");
    expect(html).toContain('aria-label="Saved meals"');
  });

  it("is the FIRST block inside the composer controls — above the food quick-pick / scan affordance", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, { mode: "create", savedMeals: [BROOKIE] }),
    );
    const savedIdx = html.indexOf('data-testid="saved-meal-row"');
    const scanIdx = html.indexOf('data-testid="scan-affordance"');
    const estimateIdx = html.indexOf('data-testid="estimate-input"');
    expect(savedIdx).toBeGreaterThan(-1);
    expect(savedIdx).toBeLessThan(scanIdx);
    expect(savedIdx).toBeLessThan(estimateIdx);
  });

  it("empty list renders the coach note (creation is MCP-only), cleanly, no chips", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, { mode: "create", savedMeals: [] }),
    );
    expect(html).toContain('data-testid="saved-meal-empty"');
    expect(html).toContain("saved meals are created by your coach");
    expect(html).not.toContain("saved-meal-chip-");
  });

  it("no savedMeals prop (lazy path, pre-fetch) renders NOTHING — no skeleton, no flash", () => {
    const html = renderToStaticMarkup(createElement(MealComposer, { mode: "create" }));
    expect(html).not.toContain("saved-meal-row");
    expect(html).not.toContain("saved-meal-empty");
  });

  it("chips are buttons that open a sheet — never a direct one-tap log (no submit-type chip)", () => {
    const html = renderToStaticMarkup(
      createElement(MealComposer, { mode: "create", savedMeals: [BOWL] }),
    );
    // The chip is an explicit type="button" (cannot submit the host form).
    expect(html).toMatch(
      /<button type="button"[^>]*data-testid="saved-meal-chip-sm-bowl"/,
    );
  });
});

describe("SavedMeal expansion — scaling via the pure src/lib/saved-meal.ts helpers (#296)", () => {
  it("half a Chipotle bowl: factor 0.5, macros halved, qty annotated ×0.5 (the fractions pattern)", () => {
    const { items, macros } = expandSavedMealForComposer(BOWL, 0.5);

    // Factor math IS the imported helper's math.
    expect(savedMealScaleFactor(0.5, BOWL.defaultServings)).toBe(0.5);
    expect(macros).toEqual(scaleSavedMealMacros(BOWL.macros, 0.5));
    expect(macros).toEqual({ calories: 335, proteinG: 35.5, carbsG: 26, fatG: 11 });

    // Item annotation mirrors annotateItemsForFactor exactly (the same
    // NutritionLog text the coach's log_nutrition(savedMealId) path writes).
    expect(items).toEqual(annotateItemsForFactor(BOWL.items, 0.5));
    expect(items[0].qty).toBe("1 bowl ×0.5");
    expect(items[1].qty).toBe("×0.5 of saved qty");
  });

  it("2 servings of the brookie: macros doubled, qty '1 brookie ×2'", () => {
    const { items, macros } = expandSavedMealForComposer(BROOKIE, 2);
    expect(macros).toEqual({ calories: 620, proteinG: 62, carbsG: 56, fatG: 18 });
    expect(items[0].qty).toBe("1 brookie ×2");
  });

  it("defaultServings servings: factor 1 — items untouched, macros verbatim", () => {
    const { items, macros } = expandSavedMealForComposer(BROOKIE, BROOKIE.defaultServings);
    expect(items).toEqual(BROOKIE.items);
    expect(macros).toEqual(BROOKIE.macros);
  });

  it("defaultServings > 1 divides: 1 serving of a 2-serving batch is factor 0.5", () => {
    const batch: SavedMealLite = { ...BROOKIE, defaultServings: 2 };
    const { macros } = expandSavedMealForComposer(batch, 1);
    expect(savedMealScaleFactor(1, 2)).toBe(0.5);
    expect(macros).toEqual({ calories: 155, proteinG: 15.5, carbsG: 14, fatG: 4.5 });
  });

  it("macro-less saved meal expands items only (no macros key)", () => {
    const bare: SavedMealLite = { ...BROOKIE, macros: undefined };
    const { items, macros } = expandSavedMealForComposer(bare, 2);
    expect(macros).toBeUndefined();
    expect(items[0].qty).toBe("1 brookie ×2");
  });
});

describe("savedMealChipMacros — the chip's second line", () => {
  it("formats '670 · 71P', rounding for the 11px chip", () => {
    expect(savedMealChipMacros({ calories: 670.4, proteinG: 70.6 })).toBe("670 · 71P");
  });
  it("degrades to whichever number exists, or null for none", () => {
    expect(savedMealChipMacros({ calories: 310 })).toBe("310");
    expect(savedMealChipMacros({ proteinG: 31 })).toBe("31P");
    expect(savedMealChipMacros(undefined)).toBeNull();
    expect(savedMealChipMacros({})).toBeNull();
  });
});
