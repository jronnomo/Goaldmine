"use client";

import { startTransition, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteLibraryFood, updateLibraryFood } from "@/lib/food-actions";
import type { LibraryFoodRow, UpdateLibraryFoodPatch } from "@/lib/food-actions";

// ── Macro field descriptors ───────────────────────────────────────────────────

type MacroDraftKey =
  | "calories"
  | "proteinG"
  | "carbsG"
  | "fatG"
  | "fiberG"
  | "sodiumMg";

const MACRO_FIELDS: Array<{
  key: MacroDraftKey;
  label: string;
  placeholder: string;
}> = [
  { key: "calories", label: "Cal", placeholder: "cal" },
  { key: "proteinG", label: "Protein", placeholder: "g" },
  { key: "carbsG", label: "Carbs", placeholder: "g" },
  { key: "fatG", label: "Fat", placeholder: "g" },
  { key: "fiberG", label: "Fiber", placeholder: "g" },
  { key: "sodiumMg", label: "Sodium", placeholder: "mg" },
];

// ── Draft shape (all strings — number inputs work best as strings in React) ───

type EditDraft = {
  name: string;
  brand: string;
  servingSize: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fiberG: string;
  sodiumMg: string;
};

function toDraft(food: LibraryFoodRow): EditDraft {
  const m = food.perServing;
  return {
    name: food.name,
    brand: food.brand ?? "",
    servingSize: food.servingSize ?? "",
    calories: m.calories != null ? String(m.calories) : "",
    proteinG: m.proteinG != null ? String(m.proteinG) : "",
    carbsG: m.carbsG != null ? String(m.carbsG) : "",
    fatG: m.fatG != null ? String(m.fatG) : "",
    fiberG: m.fiberG != null ? String(m.fiberG) : "",
    sodiumMg: m.sodiumMg != null ? String(m.sodiumMg) : "",
  };
}

/** Convert an input string to a macro number or null (empty / NaN / negative → null). */
function parseMacro(val: string): number | null {
  const s = val.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Derive an optimistic LibraryFoodRow from the current draft. */
function draftToOptimisticFood(
  food: LibraryFoodRow,
  d: EditDraft,
): LibraryFoodRow {
  return {
    ...food,
    name: d.name.trim() || food.name,
    brand: d.brand.trim() || null,
    servingSize: d.servingSize.trim() || null,
    perServing: {
      calories: parseMacro(d.calories),
      proteinG: parseMacro(d.proteinG),
      carbsG: parseMacro(d.carbsG),
      fatG: parseMacro(d.fatG),
      fiberG: parseMacro(d.fiberG),
      sodiumMg: parseMacro(d.sodiumMg),
    },
  };
}

/** Build the patch object sent to the server action. */
function draftToPatch(d: EditDraft): UpdateLibraryFoodPatch {
  return {
    name: d.name,
    brand: d.brand.trim() !== "" ? d.brand.trim() : null,
    servingSize: d.servingSize.trim() !== "" ? d.servingSize.trim() : null,
    calories: parseMacro(d.calories),
    proteinG: parseMacro(d.proteinG),
    carbsG: parseMacro(d.carbsG),
    fatG: parseMacro(d.fatG),
    fiberG: parseMacro(d.fiberG),
    sodiumMg: parseMacro(d.sodiumMg),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FoodLibraryManager({ foods: initial }: { foods: LibraryFoodRow[] }) {
  const [foods, setFoods] = useState<LibraryFoodRow[]>(initial);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);

  const visible = foods.filter((f) => !hidden.has(f.id));

  function handleDelete(id: string) {
    setHidden((prev) => new Set([...prev, id]));
    if (editingId === id) {
      setEditingId(null);
      setDraft(null);
    }
    startTransition(async () => {
      await deleteLibraryFood(id);
    });
  }

  function handleEditOpen(food: LibraryFoodRow) {
    setEditingId(food.id);
    setDraft(toDraft(food));
  }

  function handleEditCancel() {
    setEditingId(null);
    setDraft(null);
  }

  function handleDraftChange(key: keyof EditDraft, value: string) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : null));
  }

  function handleSave(food: LibraryFoodRow) {
    if (!draft) return;

    const optimistic = draftToOptimisticFood(food, draft);
    const patch = draftToPatch(draft);

    // Optimistically apply the edit and close the editor immediately
    setFoods((prev) => prev.map((f) => (f.id === food.id ? optimistic : f)));
    setEditingId(null);
    setDraft(null);

    startTransition(async () => {
      const result = await updateLibraryFood(food.id, patch);
      if (result.ok) {
        // Reconcile with server-canonical data; keep display-only stats from local state
        setFoods((prev) =>
          prev.map((f) => {
            if (f.id !== food.id) return f;
            return {
              ...f,
              ...result.food,
              usageCount: f.usageCount,
              lastUsedAt: f.lastUsedAt,
            };
          }),
        );
      } else {
        // Revert to pre-edit food on failure
        setFoods((prev) => prev.map((f) => (f.id === food.id ? food : f)));
      }
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
        const isEditing = editingId === food.id;

        if (isEditing && draft) {
          return (
            <li
              key={food.id}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
            >
              {/* Name */}
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  Name
                </span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => handleDraftChange("name", e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
                />
              </label>
              {/* Brand */}
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  Brand
                </span>
                <input
                  type="text"
                  value={draft.brand}
                  onChange={(e) => handleDraftChange("brand", e.target.value)}
                  placeholder="—"
                  className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
                />
              </label>
              {/* Serving size */}
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  Serving size
                </span>
                <input
                  type="text"
                  value={draft.servingSize}
                  onChange={(e) => handleDraftChange("servingSize", e.target.value)}
                  placeholder="—"
                  className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
                />
              </label>
              {/* Macros */}
              <div className="grid grid-cols-3 gap-2">
                {MACRO_FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      {f.label}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={draft[f.key]}
                      onChange={(e) => handleDraftChange(f.key, e.target.value)}
                      placeholder="—"
                      className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
                    />
                  </label>
                ))}
              </div>
              {/* Save / Cancel */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleSave(food)}
                  className="min-h-[44px] flex-1 rounded-lg border border-[var(--accent)] text-[var(--accent)] text-sm font-medium px-3"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="min-h-[44px] rounded-lg border border-[var(--border)] text-[var(--muted)] text-sm px-3"
                >
                  Cancel
                </button>
              </div>
            </li>
          );
        }

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
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleEditOpen(food)}
                aria-label={`Edit ${food.name}`}
                className="min-h-[44px] text-xs text-[var(--muted)] border border-[var(--border)] rounded-lg px-3"
              >
                Edit
              </button>
              <ConfirmButton
                label="X"
                confirmLabel="Remove · confirm"
                onConfirm={() => handleDelete(food.id)}
                variant="danger"
                aria-label={`Remove ${food.name} from food library`}
                className="shrink-0 text-xs text-[var(--muted)] border border-[var(--border)] rounded-lg px-3"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
