"use client";

/**
 * ScanFoodSheet-stub.tsx — Minimal stub for Stream C form development.
 * Immediately offers a canned food (or initialFood if provided) with a servings
 * stepper and an Add button. No camera, no barcode logic.
 *
 * INTEGRATION: swap import to @/components/ScanFoodSheet (real implementation from Stream B)
 */

import { useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import type { AddFoodPayload, LibraryFood } from "@/lib/food-types";

const STUB_FOOD: LibraryFood = {
  id: "stub-oikos",
  barcode: null,
  name: "Oikos Triple Zero Greek Yogurt",
  brand: "Danone",
  servingSize: "150 g",
  basis: "serving",
  perServing: {
    calories: 120,
    proteinG: 17,
    carbsG: 9,
    fatG: 0,
    fiberG: 0,
    sodiumMg: 65,
  },
};

export type ScanFoodSheetProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (payload: AddFoodPayload) => void;
  /** When provided (chip tap), skip scan phase and open directly at confirm. */
  initialFood?: LibraryFood;
};

export function ScanFoodSheet({
  open,
  onClose,
  onAdd,
  initialFood,
}: ScanFoodSheetProps) {
  const [servings, setServings] = useState(1);

  const food = initialFood ?? STUB_FOOD;
  // chipSource mirrors real ScanFoodSheet: initialFood !== undefined → chip tap path
  const chipSource = initialFood !== undefined;

  const decrement = () =>
    setServings((s) => Math.max(0.5, Math.round((s - 0.5) * 10) / 10));
  const increment = () =>
    setServings((s) => Math.min(20, Math.round((s + 0.5) * 10) / 10));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Add food"
      data-testid="scanfood-sheet"
    >
      <div className="p-4 flex flex-col gap-4">
        {/* Food card */}
        <div
          data-testid="confirm-food-card"
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
        >
          <p className="text-base font-semibold">{food.name}</p>
          {(food.brand || food.servingSize) && (
            <p className="text-xs text-[var(--muted)]">
              {[food.brand, food.servingSize].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {/* Servings stepper */}
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            data-testid="servings-stepper-dec"
            onClick={decrement}
            disabled={servings <= 0.5}
            className="w-11 h-11 rounded-full border border-[var(--border)] text-xl
                       flex items-center justify-center disabled:opacity-40"
          >
            −
          </button>
          <span
            data-testid="servings-stepper-value"
            className="text-lg font-medium w-10 text-center"
          >
            {servings}
          </span>
          <button
            type="button"
            data-testid="servings-stepper-inc"
            onClick={increment}
            disabled={servings >= 20}
            className="w-11 h-11 rounded-full border border-[var(--border)] text-xl
                       flex items-center justify-center disabled:opacity-40"
          >
            +
          </button>
        </div>
        <p className="text-xs text-center text-[var(--muted)]">
          {food.basis === "100g" ? "× 100 g" : "servings"}
        </p>

        {/* Add button */}
        <button
          type="button"
          data-testid="add-to-meal-btn"
          onClick={() => {
            onAdd({ food, servings, chipSource });
            onClose();
          }}
          className="w-full rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] py-3 font-medium"
        >
          Add to meal
        </button>

        <p className="text-xs text-center text-[var(--warning)]">
          Stub · real scanner integrates from Stream B
        </p>
      </div>
    </BottomSheet>
  );
}
