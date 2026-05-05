import Link from "next/link";
import { Card } from "@/components/Card";
import { LogNutritionForm } from "@/components/LogNutritionForm";
import { addDays, dateKey, startOfDay } from "@/lib/calendar";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const MEAL_LABEL: Record<string, string> = {
  preworkout: "Preworkout",
  postworkout: "Postworkout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

type Item = { name: string; qty?: string; notes?: string };

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

export default async function NutritionPage() {
  const since = startOfDay(addDays(new Date(), -30));

  const logs = await prisma.nutritionLog.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    take: 200,
  });

  const groups = new Map<string, typeof logs>();
  for (const log of logs) {
    const k = dateKey(log.date);
    const arr = groups.get(k) ?? [];
    arr.push(log);
    groups.set(k, arr);
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Nutrition</h1>
        <p className="text-sm text-[var(--muted)]">
          Food groups by meal. Claude reads these and proposes adjustments.
        </p>
      </header>

      <Card title="Log a meal">
        <LogNutritionForm />
      </Card>

      {groups.size === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">No meals logged in the last 30 days.</p>
        </Card>
      ) : (
        Array.from(groups.entries()).map(([day, dayLogs]) => (
          <Card key={day} title={formatDay(day)}>
            <ul className="space-y-3">
              {dayLogs.map((log) => {
                const items = asItems(log.items);
                return (
                  <li key={log.id} className="border-l-2 border-[var(--border)] pl-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                        {MEAL_LABEL[log.mealType] ?? log.mealType}
                      </span>
                      <Link
                        href={`/nutrition/${log.id}/edit`}
                        className="text-xs text-[var(--accent)]"
                      >
                        Edit
                      </Link>
                    </div>
                    <p className="text-sm">
                      {items
                        .map((i) => (i.qty ? `${i.name} (${i.qty})` : i.name))
                        .join(", ")}
                    </p>
                    {log.notes && (
                      <p className="text-xs text-[var(--muted)] italic mt-0.5">{log.notes}</p>
                    )}
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {new Date(log.date).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
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
