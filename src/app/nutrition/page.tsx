import { Card } from "@/components/Card";
import { FoodLibraryManager } from "@/components/FoodLibraryManager";
import { LogNutritionForm } from "@/components/LogNutritionForm";
import {
  NutritionList,
  type NutritionDayGroup,
  type NutritionRowData,
} from "@/components/NutritionList";
import { TodayMacroSummary } from "@/components/TodayMacroSummary";
import {
  addDays,
  dateKey,
  resolveDay,
  startOfDay,
  toDatetimeLocalValue,
} from "@/lib/calendar";
import { getDb } from "@/lib/db";
import { getQuickPickFoods, listLibraryFoods } from "@/lib/food-actions";
import { sumLoggedDayMacros, sumPlanTargetMacros, hasAnyMacros } from "@/lib/nutrition-macros";
import type { DayMacros } from "@/lib/nutrition-macros";
import { type NutritionItem, parseStoredItems } from "@/lib/nutrition-log-ops";
import type { MealSlot } from "@/lib/nutrition-plan";

export const dynamic = "force-dynamic";

const MEAL_LABEL: Record<string, string> = {
  preworkout: "Preworkout",
  postworkout: "Postworkout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

// Shared parser preserves structured fields (amount/unit/source) so the list's
// edit path keeps live recalc — a stripping map dropped them, reverting items to
// freehand steppers whose macros went stale on size changes.
function asItems(raw: unknown): NutritionItem[] {
  return parseStoredItems(raw);
}

function summarize(items: NutritionItem[]): string {
  return items.map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name)).join(", ");
}

// Time-of-day label from the USER_TZ wall-clock value (fixes the prior
// server-local toLocaleTimeString — all date/time routes through @/lib/calendar).
function timeLabelFromLocal(datetimeLocal: string): string {
  const time = datetimeLocal.split("T")[1] ?? "00:00";
  const [hhStr, mm] = time.split(":");
  const hh = Number(hhStr);
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm} ${ampm}`;
}

export default async function NutritionPage() {
  const since = startOfDay(addDays(new Date(), -30));

  const db = await getDb();
  const [logs, quickPickFoods, libraryFoods, today] = await Promise.all([
    db.nutritionLog.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    getQuickPickFoods(),
    listLibraryFoods(),
    // Today's resolved day — only source of a planned per-slot calorie target
    // (it lives in a per-day nutrition-plan override). Lights the Bullseye meter
    // for today's meals (UXR-meal-edit-26); other days have no target → hollow.
    resolveDay(new Date()),
  ]);

  const todayKey = dateKey(new Date());
  const todayPlan = today.nutritionPlan;

  // Group logs by USER_TZ day, building serialized rows for the client island.
  const groupMap = new Map<string, NutritionRowData[]>();
  const order: string[] = [];
  for (const log of logs) {
    const k = dateKey(log.date);
    if (!groupMap.has(k)) {
      groupMap.set(k, []);
      order.push(k);
    }
    const items = asItems(log.items);
    const datetimeLocal = toDatetimeLocalValue(new Date(log.date));
    // Planned calorie target — today only, when a plan slot carries calories.
    const slot = todayPlan ? todayPlan[log.mealType as MealSlot] : null;
    const plannedTarget = k === todayKey ? slot?.macros?.calories ?? undefined : undefined;
    groupMap.get(k)!.push({
      id: log.id,
      mealType: log.mealType,
      label: MEAL_LABEL[log.mealType] ?? log.mealType,
      items,
      summary: summarize(items),
      notes: log.notes,
      timeLabel: timeLabelFromLocal(datetimeLocal),
      datetimeLocal,
      dateISO: new Date(log.date).toISOString(),
      macros: {
        calories: log.calories,
        proteinG: log.proteinG,
        carbsG: log.carbsG,
        fatG: log.fatG,
        fiberG: log.fiberG,
        sodiumMg: log.sodiumMg,
      },
      plannedTarget,
    });
  }

  const groups: NutritionDayGroup[] = order.map((day) => ({
    day,
    dayLabel: formatDay(day),
    rows: groupMap.get(day)!,
  }));

  // Today's macro totals for the summary banner.
  const todayRows = groupMap.get(todayKey) ?? [];
  const soFar = sumLoggedDayMacros(todayRows.map((r) => r.macros));
  const target = sumPlanTargetMacros(todayPlan);

  // dayTargetMacros: null means "no plan" (honest no-target path in the composer).
  // all-zeros from sumPlanTargetMacros also means no plan.
  const dayTargetMacros: DayMacros | null = hasAnyMacros(target) ? target : null;
  // Alias soFar as trackedTodayMacros for clarity at the call-site.
  const trackedTodayMacros: DayMacros = soFar;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Nutrition</h1>
        <p className="text-sm text-[var(--muted)]">
          Food groups by meal. Claude reads these and proposes adjustments.
        </p>
      </header>

      <TodayMacroSummary soFar={soFar} target={target} />

      {groups.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">No meals logged in the last 30 days.</p>
        </Card>
      ) : (
        <NutritionList groups={groups} quickPickFoods={quickPickFoods} />
      )}

      <Card title="Log a meal">
        <LogNutritionForm
          quickPickFoods={quickPickFoods}
          libraryFoods={libraryFoods}
          trackedSoFar={trackedTodayMacros}
          dayTarget={dayTargetMacros}
        />
      </Card>

      <Card title="Food library">
        <FoodLibraryManager foods={libraryFoods} />
      </Card>
    </div>
  );
}

function formatDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}
