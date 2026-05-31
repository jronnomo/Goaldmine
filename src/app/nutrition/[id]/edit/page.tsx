import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { EditNutritionForm } from "@/components/EditNutritionForm";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

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

function itemsToText(items: Item[]): string {
  return items
    .map((i) => {
      const parts = [i.name];
      if (i.qty) parts.push(i.qty);
      if (i.notes) parts.push(i.notes);
      return parts.join(" | ");
    })
    .join("\n");
}

function localDatetime(d: Date): string {
  // Format as YYYY-MM-DDTHH:MM in local time for <input type="datetime-local">.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditNutritionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await prisma.nutritionLog.findUnique({ where: { id } });
  if (!row) notFound();

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/nutrition" className="text-sm text-[var(--accent)]">
          ← Nutrition
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Edit meal</h1>
        <p className="text-sm text-[var(--muted)]">
          Logged {new Date(row.createdAt).toLocaleString()}
        </p>
      </header>

      <Card>
        <EditNutritionForm
          id={row.id}
          defaults={{
            mealType: row.mealType,
            itemsText: itemsToText(asItems(row.items)),
            notes: row.notes ?? "",
            date: localDatetime(new Date(row.date)),
            macros: {
              calories: row.calories,
              proteinG: row.proteinG,
              carbsG: row.carbsG,
              fatG: row.fatG,
              fiberG: row.fiberG,
              sodiumMg: row.sodiumMg,
            },
          }}
        />
      </Card>
    </div>
  );
}
