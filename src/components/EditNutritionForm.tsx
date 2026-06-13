"use client";

import { useRouter } from "next/navigation";
import { MealComposer, type MealDefaults } from "@/components/MealComposer";
import type { LibraryFood } from "@/lib/food-types";

/**
 * Thin wrapper for the full-page /nutrition/[id]/edit route — the documented
 * Direction C deep-link/fallback (UXR-meal-edit-29). The shared MealComposer is
 * the real component (UXR-meal-edit-02).
 *
 * De-redirect note (UXR-meal-edit-12): updateNutrition/deleteNutrition no longer
 * redirect — that footgun was removed so the BottomSheet host can close in
 * place. The full-page fallback therefore navigates back to /nutrition HERE,
 * at the client level, rather than via a redirect baked into the shared action.
 * The action already revalidated /nutrition, so the list is fresh on arrival.
 */
export function EditNutritionForm({
  id,
  defaults,
  quickPickFoods,
}: {
  id: string;
  defaults: MealDefaults;
  quickPickFoods?: LibraryFood[];
}) {
  const router = useRouter();
  return (
    <MealComposer
      mode="edit"
      id={id}
      defaults={defaults}
      quickPickFoods={quickPickFoods}
      onSaved={() => router.push("/nutrition")}
      onDeleted={() => router.push("/nutrition")}
    />
  );
}
