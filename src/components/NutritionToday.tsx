import { LogNutritionForm } from "@/components/LogNutritionForm";

export const MEAL_ORDER = [
  "preworkout",
  "breakfast",
  "lunch",
  "snack",
  "postworkout",
  "dinner",
] as const;

const MEAL_LABEL: Record<(typeof MEAL_ORDER)[number], string> = {
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

export function NutritionToday({ logs }: { logs: NutritionTodayLog[] }) {
  const byMeal = new Map<string, NutritionTodayLog[]>();
  for (const log of logs) {
    const arr = byMeal.get(log.mealType) ?? [];
    arr.push(log);
    byMeal.set(log.mealType, arr);
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5 text-sm">
        {MEAL_ORDER.map((mt) => {
          const meals = byMeal.get(mt) ?? [];
          const summary = meals
            .map((m) => summarize(asItems(m.items)))
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={mt} className="flex gap-2">
              <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--muted)] pt-0.5">
                {MEAL_LABEL[mt]}
              </span>
              <span className={summary ? "" : "text-[var(--muted)]"}>
                {summary || "—"}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-[var(--border)] pt-3">
        <LogNutritionForm />
      </div>
    </div>
  );
}
