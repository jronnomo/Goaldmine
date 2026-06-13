"use client";

import { useState } from "react";
import Link from "next/link";
import { LogMeasurementForm } from "@/components/LogMeasurementForm";
import { LogNutritionForm } from "@/components/LogNutritionForm";
import { LogNoteForm } from "@/components/LogNoteForm";
import { MealEditButton } from "@/components/MealEditButton";
import type { TodayMealLite } from "@/app/layout";
import type { LibraryFood } from "@/lib/food-types";
import { sumLoggedDayMacros, formatDayMacros, hasAnyMacros } from "@/lib/nutrition-macros";

const MEAL_LABELS: Record<string, string> = {
  preworkout: "Preworkout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  postworkout: "Postworkout",
  dinner: "Dinner",
};

function mealSummary(items: TodayMealLite["items"]): string {
  return items
    .map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name))
    .join(", ");
}

export type LogLauncherProps = {
  /** Latest recorded weight in lb, or null. Passed to LogMeasurementForm as defaultValue.
   *  Defaults to null (weight input starts empty — by design; BottomNav cannot query Prisma). */
  latestWeight?: number | null;
  onClose: () => void;
  todaysMeals?: TodayMealLite[];
  quickPickFoods?: LibraryFood[];
};

type ExpandedRow = "weight" | "meal" | "note" | null;

type RowConfig = {
  key: ExpandedRow & string;
  label: string;
  sub: string;
  icon: React.ReactNode;
};

const ChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const rows: RowConfig[] = [
  {
    key: "weight",
    label: "Weight",
    sub: "Log today's weigh-in",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 17a5 5 0 0 1 10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "meal",
    label: "Meal",
    sub: "Log what you ate",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 3v6a4 4 0 0 0 8 0V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10 13v4M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "note",
    label: "Note",
    sub: "Journal, audible, or feedback",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

const ImportIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M3 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 3v10M7 10l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function LogLauncher({
  latestWeight = null,
  onClose,
  todaysMeals,
  quickPickFoods,
}: LogLauncherProps) {
  const [expanded, setExpanded] = useState<ExpandedRow>(null);

  const toggle = (key: ExpandedRow & string) => {
    setExpanded((prev) => (prev === key ? null : key));
  };

  // Compact "today so far" total shown above the meal log list when food has
  // been logged. Computed from todaysMeals (already in scope via layout query).
  const mealSoFar = todaysMeals
    ? sumLoggedDayMacros(todaysMeals.map((m) => m.macros))
    : null;
  const showMealSoFar = mealSoFar !== null && hasAnyMacros(mealSoFar);

  return (
    <div className="py-2">
      {rows.map(({ key, label, sub, icon }) => {
        const isOpen = expanded === key;
        return (
          <div key={key}>
            {/* Row button — ≥48px tap target */}
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] text-left hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
            >
              <span className="text-[var(--accent)] shrink-0">{icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
                <span className="block text-xs text-[var(--muted)]">{sub}</span>
              </span>
              <span className="text-[var(--muted)] shrink-0">
                {isOpen ? <ChevronUp /> : <ChevronDown />}
              </span>
            </button>

            {/* Inline expanded form */}
            {isOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[var(--border)]">
                {key === "weight" && <LogMeasurementForm latestWeight={latestWeight} />}
                {key === "meal" && (
                  <>
                    {showMealSoFar && mealSoFar && (
                      <p className="text-xs text-[var(--muted)] mb-3 tabular-nums">
                        Today so far · <span className="font-mono">{formatDayMacros(mealSoFar)}</span>
                      </p>
                    )}
                    {todaysMeals && todaysMeals.length > 0 && (
                      <div className="mb-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-2">
                          Logged today
                        </p>
                        <ul className="space-y-2">
                          {todaysMeals.map((meal) => {
                            const label = MEAL_LABELS[meal.mealType] ?? meal.mealType;
                            const summary = mealSummary(meal.items);
                            return (
                              <li key={meal.id} className="flex items-baseline justify-between gap-2 border-l-2 border-[var(--border)] pl-3">
                                <span className="flex-1 min-w-0 text-sm">
                                  <span className="text-xs uppercase tracking-wide text-[var(--muted)] mr-1">
                                    {label}
                                  </span>
                                  {summary && (
                                    <span className="text-[var(--foreground)]">· {summary}</span>
                                  )}
                                </span>
                                <MealEditButton
                                  meal={meal}
                                  quickPickFoods={quickPickFoods}
                                />
                              </li>
                            );
                          })}
                        </ul>
                        <div className="border-t border-[var(--border)] mt-4 pt-4" />
                      </div>
                    )}
                    <LogNutritionForm />
                  </>
                )}
                {key === "note" && <LogNoteForm />}
              </div>
            )}
          </div>
        );
      })}

      {/* Import row — Link, not a button */}
      <Link
        href="/import"
        onClick={onClose}
        className="flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
      >
        <span className="text-[var(--accent)] shrink-0">
          <ImportIcon />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--foreground)]">Import</span>
          <span className="block text-xs text-[var(--muted)]">Paste a Strong-app export</span>
        </span>
      </Link>
    </div>
  );
}
