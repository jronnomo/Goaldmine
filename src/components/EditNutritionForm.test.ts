// src/components/EditNutritionForm.test.ts
// Render-level proof for the "Browse library never renders when editing an
// existing meal" fix. EditNutritionForm is the full-page /nutrition/[id]/edit
// fallback (Direction C) — unlike MealEditButton/NutritionList, its
// MealComposer is rendered unconditionally (no closed-by-default BottomSheet
// gate), so a threaded `libraryFoods` prop is directly observable via
// renderToStaticMarkup. Mirrors the createElement + renderToStaticMarkup
// pattern established by MealComposer.test.ts / BetweenGoalsToday.test.ts
// (.test.ts, not .test.tsx — no JSX).
//
// EditNutritionForm calls useRouter() (next/navigation) to route back to
// /nutrition after save/delete. Outside a mounted AppRouterContext this
// throws ("invariant expected app router to be mounted") — mocked here
// per the house convention (see day-actions.test.ts's
// vi.mock("next/navigation", () => ({ redirect: vi.fn() }))).

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { EditNutritionForm } from "@/components/EditNutritionForm";
import type { MealDefaults } from "@/components/MealComposer";
import type { LibraryFood } from "@/lib/food-types";

const DEFAULTS: MealDefaults = {
  mealType: "lunch",
  items: [],
  notes: "",
  date: "2026-08-05T12:00",
};

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

describe("EditNutritionForm — libraryFoods passthrough (Browse library fix)", () => {
  it("libraryFoods supplied: renders the Browse library button", () => {
    const html = renderToStaticMarkup(
      createElement(EditNutritionForm, {
        id: "meal-1",
        defaults: DEFAULTS,
        libraryFoods: LIB_FOOD,
      }),
    );
    expect(html).toContain('data-testid="composer-browse-library"');
    expect(html).toContain("Browse library");
  });

  it("libraryFoods omitted: does NOT render Browse library (regression guard — pre-fix behavior, and any future untouched caller)", () => {
    const html = renderToStaticMarkup(
      createElement(EditNutritionForm, {
        id: "meal-1",
        defaults: DEFAULTS,
      }),
    );
    expect(html).not.toContain("composer-browse-library");
    expect(html).not.toContain("Browse library");
  });

  it("quickPickFoods passthrough is unaffected by this fix (pre-existing prop, still forwarded)", () => {
    const html = renderToStaticMarkup(
      createElement(EditNutritionForm, {
        id: "meal-1",
        defaults: DEFAULTS,
        quickPickFoods: LIB_FOOD,
      }),
    );
    expect(html).toContain('data-testid="quickpick-row"');
  });
});
