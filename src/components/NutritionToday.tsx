import { LogNutritionForm } from "@/components/LogNutritionForm";
import { MEAL_SLOTS, type MealSlot, type NutritionPlan, type PlannedMeal } from "@/lib/nutrition-plan";

export const MEAL_ORDER = MEAL_SLOTS;

const MEAL_LABEL: Record<MealSlot, string> = {
  preworkout: "Preworkout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  postworkout: "Postworkout",
  dinner: "Dinner",
};

type Item = { name: string; qty?: string; notes?: string };

export type NutritionTodayLog = {
  id: string;
  date: Date;
  mealType: string;
  items: unknown;
  notes: string | null;
};

function asItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      name: typeof x.name === "string" ? x.name : "",
      qty: typeof x.qty === "string" ? x.qty : undefined,
      notes: typeof x.notes === "string" ? x.notes : undefined,
    }))
    .filter((i) => i.name);
}

function summarize(items: Item[]): string {
  return items
    .map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name))
    .join(", ");
}

function formatMacros(macros: NonNullable<PlannedMeal["macros"]>): string {
  const parts: string[] = [];
  if (macros.calories != null) parts.push(`${Math.round(macros.calories)} cal`);
  if (macros.proteinG != null) parts.push(`${Math.round(macros.proteinG)}p`);
  if (macros.carbsG != null) parts.push(`${Math.round(macros.carbsG)}c`);
  if (macros.fatG != null) parts.push(`${Math.round(macros.fatG)}f`);
  if (macros.fiberG != null) parts.push(`${Math.round(macros.fiberG)}g fiber`);
  if (macros.sodiumMg != null) parts.push(`${Math.round(macros.sodiumMg)}mg Na`);
  return parts.join(" · ");
}

function PlannedRow({ meal }: { meal: PlannedMeal }) {
  const summary = summarize(meal.items);
  const macros = meal.macros ? formatMacros(meal.macros) : null;
  return (
    <div className="text-[var(--muted)] italic">
      <span className="text-[10px] uppercase not-italic tracking-wide mr-1 px-1 py-px rounded border border-[var(--border)] align-middle">
        planned
      </span>
      <span>{summary}</span>
      {macros && (
        <span className="block text-xs not-italic mt-0.5">{macros}</span>
      )}
      {meal.notes && (
        <span className="block text-xs mt-0.5">{meal.notes}</span>
      )}
    </div>
  );
}

export function NutritionToday({
  logs,
  plan,
  showLogForm = true,
}: {
  logs: NutritionTodayLog[];
  plan?: NutritionPlan | null;
  showLogForm?: boolean;
}) {
  const byMeal = new Map<string, NutritionTodayLog[]>();
  for (const log of logs) {
    const arr = byMeal.get(log.mealType) ?? [];
    arr.push(log);
    byMeal.set(log.mealType, arr);
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {MEAL_ORDER.map((mt) => {
          const meals = byMeal.get(mt) ?? [];
          const loggedSummary = meals
            .map((m) => summarize(asItems(m.items)))
            .filter(Boolean)
            .join(" · ");
          const planned = plan?.[mt];
          const isEmpty = !loggedSummary && !planned;
          return (
            <li key={mt} className="flex gap-2">
              <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--muted)] pt-0.5">
                {MEAL_LABEL[mt]}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                {planned && <PlannedRow meal={planned} />}
                {loggedSummary && <span className="block">{loggedSummary}</span>}
                {isEmpty && <span className="text-[var(--muted)]">—</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {showLogForm && (
        <div className="border-t border-[var(--border)] pt-3">
          <LogNutritionForm />
        </div>
      )}
    </div>
  );
}
