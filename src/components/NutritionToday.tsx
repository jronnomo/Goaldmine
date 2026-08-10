import { LogNutritionForm } from "@/components/LogNutritionForm";
import { MealEditButton } from "@/components/MealEditButton";
import { MEAL_SLOTS, type NutritionPlan, type PlannedMeal } from "@/lib/nutrition-plan";
import {
  sumPlanTargetMacros,
  sumLoggedDayMacrosWithPlanFallback,
  hasAnyMacros,
  formatItemMacroLine,
  MEAL_LABELS,
} from "@/lib/nutrition-macros";
import { parseStoredItems, type NutritionItem } from "@/lib/nutrition-log-ops";
import type { ExistingMealStub } from "@/lib/nutrition-merge";
import { dateKey } from "@/lib/calendar-core";
import type { LibraryFood } from "@/lib/food-types";

export const MEAL_ORDER = MEAL_SLOTS;

type Item = NutritionItem;

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
  if (items.length === 0) return "Custom entry"; // macros-only log
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

/**
 * Per-item breakdown for a logged meal whose items carry itemMacros (food-
 * linked composer adds / SavedMeal bundle expansions): each item on its own
 * line with a compact, muted macro readout — the owner's "individual items
 * logged with each of their macros" view. Meals without any itemMacros render
 * the joined summary exactly as before.
 */
function ItemBreakdown({ items }: { items: Item[] }) {
  return (
    <span
      data-testid="meal-item-breakdown"
      className="inline-flex max-w-full flex-col gap-0.5 align-top"
    >
      {items.map((i, idx) => {
        const line = formatItemMacroLine(i.itemMacros);
        return (
          <span key={idx} className="min-w-0">
            {i.qty ? `${i.name} (${i.qty})` : i.name}
            {line && (
              <span className="ml-1.5 font-mono text-[11px] text-[var(--muted)]">
                {line}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
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
  libraryFoods,
  defaultDate,
}: {
  logs: NutritionTodayLog[];
  plan?: NutritionPlan | null;
  showLogForm?: boolean;
  quickPickFoods?: LibraryFood[];
  /** Pre-loaded library foods for the composer's Browse-library picker
   *  (both the per-meal edit composer and the inline log-form composer
   *  below). Optional — omit and "Browse library" simply doesn't render
   *  (see useFoodComposer's gate); zero behavior change for hosts that
   *  don't wire it. */
  libraryFoods?: LibraryFood[];
  /**
   * Pre-seed the inline log form (when `showLogForm`) to this calendar day
   * (dateKey "YYYY-MM-DD") instead of "now" — passed straight through to
   * MealComposer via LogNutritionForm. Used by the day-detail page (#294) so a
   * meal logged while viewing a past or future day lands on THAT day. Omit for
   * "today"-scoped hosts (unchanged default behavior).
   */
  defaultDate?: string;
}) {
  const byMeal = new Map<string, NutritionTodayLog[]>();
  for (const log of logs) {
    const arr = byMeal.get(log.mealType) ?? [];
    arr.push(log);
    byMeal.set(log.mealType, arr);
  }

  // #295: compact stubs of the already-fetched logs → the composer's
  // append-vs-separate choice. Derived here (server side on RSC hosts) so the
  // composer never needs its own fetch to know a slot already has an entry.
  const existingMeals: ExistingMealStub[] = logs.map((l) => ({
    id: l.id,
    dateKey: dateKey(l.date),
    mealType: l.mealType,
    itemCount: asItems(l.items).length,
    dateISO: l.date.toISOString(),
  }));

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
  // shared helper. "so far" uses the SHARED fallback-aware sum (UXR-TIA-09,
  // BLOCKING): the same helper FuelRail uses, so the Today strip and this
  // detail can never print two contradicting day totals.
  const target = sumPlanTargetMacros(plan);
  const soFar = sumLoggedDayMacrosWithPlanFallback(logs, plan);
  const targetPositive = hasAnyMacros(target);
  const soFarPositive = hasAnyMacros(soFar);
  const showTotal = targetPositive || soFarPositive;

  // Day-strip meter (today-page-ia defect 4 fix): the house h-1.5 track+fill,
  // NOT a Bullseye — Bullseye's ceil(p×4) ring snap at size≥20 rendered any
  // progress above 75% byte-identical to "done" (78% of calories read as
  // complete). Continuous fill width is the honest readout; the shared
  // fallback-aware soFar keeps this strip in lockstep with FuelRail.
  const calFill = targetPositive && target.calories > 0
    ? Math.min(1, soFar.calories / target.calories)
    : 0;
  const calRemaining = targetPositive
    ? Math.max(0, target.calories - soFar.calories)
    : 0;

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        // Date-neutral copy: this component renders for arbitrary days (the
        // day-detail page, #294), not just "today" — "Nothing planned or
        // logged today yet" reads wrong on a backfilled past day.
        <p className="text-sm text-[var(--muted)]">Nothing planned or logged yet.</p>
      ) : (
        <>
          <ul className="space-y-2.5 text-sm">
            {rows.map(({ mt, meals, loggedSummary, planned, actualMacros }) => (
              <li key={mt} className="flex gap-2">
                <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--muted)] pt-0.5">
                  {MEAL_LABELS[mt]}
                </span>
                <div className="flex-1 min-w-0 space-y-1">
                  {loggedSummary ? (
                    // Logged: render each logged meal individually with its summary + Edit button.
                    <>
                      {meals.map((m) => {
                        const mealItems = asItems(m.items);
                        const hasItemMacros = mealItems.some(
                          (i) => formatItemMacroLine(i.itemMacros) != null,
                        );
                        return (
                          <div key={m.id} className="flex items-baseline justify-between gap-2">
                            <span className="flex-1 min-w-0">
                              <span className="text-[var(--success)] mr-1" aria-hidden>
                                ✓
                              </span>
                              {hasItemMacros ? (
                                <ItemBreakdown items={mealItems} />
                              ) : (
                                summarize(mealItems)
                              )}
                            </span>
                            <MealEditButton
                              meal={{
                                id: m.id,
                                mealType: m.mealType,
                                items: mealItems,
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
                              libraryFoods={libraryFoods}
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
              {/* Honest fill meter — replaces the size-20 progress Bullseye
                  (ceil(p×4) showed "done" from 76%). No-target days render no
                  meter at all: an empty track would read as 0% of a target
                  that does not exist; the "No daily target set" note carries
                  that state in words. */}
              {targetPositive && (
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(calFill * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${Math.round(calFill * 100)}% of daily calorie target reached`}
                  data-testid="daytotal-meter"
                  className="w-16 shrink-0 self-center h-1.5 rounded-full bg-[var(--border)]/60 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${Math.round(calFill * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
      {showLogForm && (
        <div className="border-t border-[var(--border)] pt-3">
          <LogNutritionForm
            quickPickFoods={quickPickFoods}
            libraryFoods={libraryFoods}
            defaultDate={defaultDate}
            existingMeals={existingMeals}
          />
        </div>
      )}
    </div>
  );
}
