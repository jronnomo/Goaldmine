"use client";

import { startTransition, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteLibraryFood } from "@/lib/food-actions";
import type { LibraryFoodRow } from "@/lib/food-actions";

export function FoodLibraryManager({ foods: initial }: { foods: LibraryFoodRow[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visible = initial.filter((f) => !hidden.has(f.id));

  function handleDelete(id: string) {
    // Optimistically hide the row immediately; server revalidation re-renders
    // the page if the user navigates away and back.
    setHidden((prev) => new Set([...prev, id]));
    startTransition(async () => {
      await deleteLibraryFood(id);
    });
  }

  if (visible.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Scanned and estimated foods will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border)]">
      {visible.map((food) => {
        const meta = [food.brand, food.servingSize].filter(Boolean).join(" · ");
        return (
          <li
            key={food.id}
            className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{food.name}</p>
              {meta ? (
                <p className="text-xs text-[var(--muted)] truncate">{meta}</p>
              ) : null}
              <p className="text-xs text-[var(--muted)]">
                {`used ${food.usageCount}×`}
                {food.lastUsedAt ? ` · ${food.lastUsedAt}` : ""}
              </p>
            </div>
            <ConfirmButton
              label="X"
              confirmLabel="Remove · confirm"
              onConfirm={() => handleDelete(food.id)}
              variant="danger"
              aria-label={`Remove ${food.name} from food library`}
              className="shrink-0 text-xs text-[var(--muted)] border border-[var(--border)] rounded-lg px-3"
            />
          </li>
        );
      })}
    </ul>
  );
}
