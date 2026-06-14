"use client";

import { startTransition, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteLibraryFood, updateLibraryFood } from "@/lib/food-actions";
import type { LibraryFoodRow, UpdateLibraryFoodPatch } from "@/lib/food-actions";
import { classifyFood, type MacroGroup } from "@/lib/food-resolve-local";

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

// ── Badge + Tab config ────────────────────────────────────────────────────────

const BADGE: Record<MacroGroup, { letter: string; bg: string; fg: string }> = {
  protein: { letter: "P", bg: "color-mix(in srgb, var(--target) 15%, var(--card))",  fg: "var(--target)"  },
  carbs:   { letter: "C", bg: "color-mix(in srgb, var(--success) 15%, var(--card))", fg: "var(--success)" },
  fat:     { letter: "F", bg: "color-mix(in srgb, var(--accent) 15%, var(--card))",  fg: "var(--accent)"  },
  misc:    { letter: "M", bg: "color-mix(in srgb, var(--muted) 15%, var(--card))",   fg: "var(--muted)"   },
};

const TABS: { key: MacroGroup | "all"; label: string }[] = [
  { key: "all",     label: "All"     },
  { key: "protein", label: "Protein" },
  { key: "carbs",   label: "Carbs"   },
  { key: "fat",     label: "Fat"     },
  { key: "misc",    label: "Misc"    },
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
  const [activeTab, setActiveTab] = useState<MacroGroup | "all">("all");

  const visible = foods.filter((f) => {
    if (hidden.has(f.id)) return false;
    if (activeTab !== "all" && classifyFood(f) !== activeTab) return false;
    return true;
  });

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

  // CRITICAL-2: Gate "empty library" on the un-tab-filtered set.
  // This fires only when the library itself is empty (no foods at all).
  // The per-tab "No foods in this group" is handled BELOW the tab bar.
  if (foods.filter((f) => !hidden.has(f.id)).length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Scanned and estimated foods will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Macro-group segmented tabs (role=radiogroup, UXR-lib-06) */}
      <div
        role="radiogroup"
        aria-label="Filter food library by macro type"
        className="flex gap-1 overflow-x-auto [-webkit-overflow-scrolling:touch]"
      >
        {TABS.map(({ key, label }) => {
          const sel = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={sel}
              data-testid={`macro-tab-${key}`}
              onClick={() => setActiveTab(key)}
              className={`inline-flex shrink-0 items-center justify-center min-h-[44px] px-4 rounded-full text-xs font-semibold ${
                sel
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "border border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Per-tab empty state (CRITICAL-2: distinct copy from library-empty copy above) */}
      {visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)] italic">No foods in this group.</p>
      ) : (
        /* tab-content-fade key wiring: re-fire fade on tab change (addendum) */
        <div className="tab-content-fade" key={activeTab}>
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

              // ── Collapsed row — macro line + letter badge (REQ-005) ──────────
              const meta = [food.brand, food.servingSize].filter(Boolean).join(" · ");
              const group = classifyFood(food);
              const badge = BADGE[group];
              const p = food.perServing;
              const hasAnyMacro =
                p.calories != null || p.proteinG != null || p.carbsG != null || p.fatG != null;
              const macroLineStr = hasAnyMacro
                ? [
                    p.calories != null ? `${p.calories} cal` : null,
                    p.proteinG != null ? `${p.proteinG}p`    : null,
                    p.carbsG   != null ? `${p.carbsG}c`      : null,
                    p.fatG     != null ? `${p.fatG}f`         : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "— · mixed / data incomplete";

              return (
                <li
                  key={food.id}
                  className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    {/* Name + letter badge — badge bg via color-mix, no literals (UXR-lib-13) */}
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{food.name}</p>
                      <span
                        className="shrink-0 text-[10px] font-bold uppercase rounded px-1 py-0.5 leading-none"
                        style={{ background: badge.bg, color: badge.fg }}
                        aria-hidden
                      >
                        {badge.letter}
                      </span>
                    </div>
                    {/* Brand · serving size */}
                    {meta ? (
                      <p className="text-xs text-[var(--muted)] truncate">{meta}</p>
                    ) : null}
                    {/* Macro line — typed numerals, text-xs (12px) AA (UXR-lib-24, UXR-lib-11) */}
                    <p className={`text-xs ${hasAnyMacro ? "" : "italic"} text-[var(--muted)]`}>
                      {macroLineStr}
                    </p>
                    {/* Usage line */}
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
        </div>
      )}
    </div>
  );
}
