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
