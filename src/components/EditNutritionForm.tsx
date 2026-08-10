"use client";

import { useRouter } from "next/navigation";
import { MealComposer, type MealDefaults } from "@/components/MealComposer";
import { deleteNutrition } from "@/lib/workout-actions";
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
 *
 * Delete (UXR-meal-edit-13): MealComposer's Delete is non-destructive — it hands
 * us a snapshot but does NOT mutate the server. There's no Undo bar on the full
 * page, so here we commit deleteNutrition immediately, then navigate back.
 */
export function EditNutritionForm({
  id,
  defaults,
  quickPickFoods,
  libraryFoods,
}: {
  id: string;
  defaults: MealDefaults;
  quickPickFoods?: LibraryFood[];
  /** Pre-loaded library foods for the composer's Browse-library picker.
   *  Optional — omit and "Browse library" simply doesn't render (see
   *  useFoodComposer's gate); zero behavior change for hosts that don't wire it. */
  libraryFoods?: LibraryFood[];
}) {
  const router = useRouter();
  return (
    <MealComposer
      mode="edit"
      id={id}
      defaults={defaults}
      quickPickFoods={quickPickFoods}
      libraryFoods={libraryFoods}
      onSaved={() => router.push("/nutrition")}
      onDeleted={async () => {
        await deleteNutrition(id);
        router.push("/nutrition");
      }}
    />
  );
}
