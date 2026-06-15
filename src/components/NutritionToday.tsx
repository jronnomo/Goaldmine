import { LogNutritionForm } from "@/components/LogNutritionForm";
import { MealEditButton } from "@/components/MealEditButton";
import { Bullseye } from "@/components/Bullseye";
import { MEAL_SLOTS, type MealSlot, type NutritionPlan, type PlannedMeal } from "@/lib/nutrition-plan";
import { sumPlanTargetMacros, hasAnyMacros } from "@/lib/nutrition-macros";
import { parseStoredItems } from "@/lib/nutrition-log-ops";
import type { LibraryFood } from "@/lib/food-types";

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
  // Optional structured macros (null on older / quick logs).
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
  sodiumMg?: number | null;
};


// The macros we total + display on Today (calories + the big three).
type Macros = { calories?: number; proteinG?: number; carbsG?: number; fatG?: number };
const MACRO4 = ["calories", "proteinG", "carbsG", "fatG"] as const;

// Use the shared parser so structured fields (amount/unit/source) survive into
// the edit composer — a stripping map here turned structured items back into
// freehand steppers in edit mode, so changing the size wouldn't recompute and
// the macros sat stale at the original portion (read as a "double count").
function asItems(raw: unknown): Item[] {
  return parseStoredItems(raw);
}

function summarize(items: Item[]): string {
  return items
    .map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name))
    .join(", ");
}

// Sum the actual logged macros across a slot's meals, keeping only fields that
// were actually recorded. Returns null when none of the meals carry macros.
function loggedMacros(meals: NutritionTodayLog[]): Macros | null {
  const out: Macros = {};
  let any = false;
  for (const k of MACRO4) {
    let fieldLogged = false;
    let total = 0;
    for (const m of meals) {
      const v = m[k];
      if (v != null) {
        fieldLogged = true;
        total += v;
      }
    }
    if (fieldLogged) {
      out[k] = total;
      any = true;
    }
  }
  return any ? out : null;
}

function addMacros(acc: { calories: number; proteinG: number; carbsG: number; fatG: number }, m: Macros) {
  acc.calories += m.calories ?? 0;
  acc.proteinG += m.proteinG ?? 0;
  acc.carbsG += m.carbsG ?? 0;
  acc.fatG += m.fatG ?? 0;
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
  quickPickFoods,
}: {
  logs: NutritionTodayLog[];
  plan?: NutritionPlan | null;
  showLogForm?: boolean;
  quickPickFoods?: LibraryFood[];
}) {
  const byMeal = new Map<string, NutritionTodayLog[]>();
  for (const log of logs) {
    const arr = byMeal.get(log.mealType) ?? [];
    arr.push(log);
    byMeal.set(log.mealType, arr);
  }

  // Build one row per slot, then drop slots that are neither planned nor
  // logged (no more bare "—" rows for unused meal times).
  const rows = MEAL_ORDER.map((mt) => {
    const meals = byMeal.get(mt) ?? [];
    const loggedSummary = meals
      .map((m) => summarize(asItems(m.items)))
      .filter(Boolean)
      .join(" · ");
    return { mt, meals, loggedSummary, planned: plan?.[mt], actualMacros: loggedMacros(meals) };
  }).filter((r) => r.loggedSummary || r.planned);

  // Cumulative day totals. "target" sums every planned slot's macros via the
  // shared helper. "so far" uses the actual macros you logged per slot, falling
  // back to that slot's planned macros when a logged meal didn't record any
  // (fallback logic is unique to this component — not in sumLoggedDayMacros).
  const target = sumPlanTargetMacros(plan);
  const soFar = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const r of rows) {
    if (r.loggedSummary) {
      const src = r.actualMacros ?? r.planned?.macros;
      if (src) addMacros(soFar, src);
    }
  }
  const targetPositive = hasAnyMacros(target);
  const soFarPositive = hasAnyMacros(soFar);
  const showTotal = targetPositive || soFarPositive;

  // Day-strip Bullseye (REQ-004, UXR-lib-05)
  // Uses this component's own soFar (which includes planned-fallback) not the page's.
  const calFill = targetPositive && target.calories > 0
    ? Math.min(1, soFar.calories / target.calories)
    : 0;
  const calRemaining = targetPositive
    ? Math.max(0, target.calories - soFar.calories)
    : 0;

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing planned or logged today yet.</p>
      ) : (
        <>
          <ul className="space-y-2.5 text-sm">
            {rows.map(({ mt, meals, loggedSummary, planned, actualMacros }) => (
              <li key={mt} className="flex gap-2">
                <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--muted)] pt-0.5">
                  {MEAL_LABEL[mt]}
                </span>
                <div className="flex-1 min-w-0 space-y-1">
                  {loggedSummary ? (
                    // Logged: render each logged meal individually with its summary + Edit button.
                    <>
                      {meals.map((m) => {
                        const mealSummary = summarize(asItems(m.items));
                        return (
                          <div key={m.id} className="flex items-baseline justify-between gap-2">
                            <span className="flex-1 min-w-0">
                              <span className="text-[var(--success)] mr-1" aria-hidden>
                                ✓
                              </span>
                              {mealSummary}
                            </span>
                            <MealEditButton
                              meal={{
                                id: m.id,
                                mealType: m.mealType,
                                items: asItems(m.items),
                                notes: m.notes,
                                dateISO: m.date.toISOString(),
                                macros: {
                                  calories: m.calories ?? null,
                                  proteinG: m.proteinG ?? null,
                                  carbsG: m.carbsG ?? null,
                                  fatG: m.fatG ?? null,
                                  fiberG: m.fiberG ?? null,
                                  sodiumMg: m.sodiumMg ?? null,
                                },
                                plannedTarget: planned?.macros?.calories != null
                                  ? Math.round(planned.macros.calories)
                                  : undefined,
                              }}
                              quickPickFoods={quickPickFoods}
                            />
                          </div>
                        );
                      })}
                      {actualMacros ? (
                        <span className="block text-xs text-[var(--muted)]">
                          {formatMacros(actualMacros)}
                        </span>
                      ) : planned?.macros ? (
                        <span className="block text-xs text-[var(--muted)]">
                          target {formatMacros(planned.macros)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    // Not logged yet: show the full planned prompt.
                    <PlannedRow meal={planned!} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {showTotal && (
            <div className="flex items-center gap-2 border-t border-[var(--border)] pt-2.5 text-sm">
              <span className="w-24 shrink-0 text-xs uppercase tracking-wide font-medium pt-0.5">
                Day total
              </span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <span className="block">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] mr-1 align-middle">
                    so far
                  </span>
                  <span className="tabular-nums font-medium">{formatMacros(soFar)}</span>
                </span>
                {targetPositive && (
                  <span className="block text-[var(--muted)]">
                    <span className="text-[10px] uppercase tracking-wide mr-1 align-middle">
                      target
                    </span>
                    <span className="tabular-nums">{formatMacros(target)}</span>
                  </span>
                )}
                {/* REQ-004: remaining line */}
                {targetPositive && calRemaining > 0 && (
                  <span
                    data-testid="daytotal-remaining"
                    className="block text-xs text-[var(--muted)]"
                  >
                    {Math.round(calRemaining)} cal remaining
                  </span>
                )}
                {/* No-target note */}
                {!targetPositive && soFarPositive && (
                  <span
                    data-testid="daytotal-no-target-note"
                    className="block text-xs italic text-[var(--muted)]"
                  >
                    No daily target set
                  </span>
                )}
              </div>
              {/* Size-20 Bullseye — appended to the right of the strip (UXR-lib-05) */}
              {targetPositive ? (
                <Bullseye
                  size={20}
                  progress={calFill}
                  aria-label={`${Math.round(calFill * 100)}% of daily calorie target reached`}
                  data-testid="daytotal-bullseye"
                />
              ) : (
                <Bullseye
                  size={20}
                  aria-label="No daily calorie target set"
                  data-testid="daytotal-bullseye"
                />
              )}
            </div>
          )}
        </>
      )}
      {showLogForm && (
        <div className="border-t border-[var(--border)] pt-3">
          <LogNutritionForm />
        </div>
      )}
    </div>
  );
}
