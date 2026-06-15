import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { EditNutritionForm } from "@/components/EditNutritionForm";
import { prisma } from "@/lib/db";
import { getQuickPickFoods } from "@/lib/food-actions";
import { toDatetimeLocalValue } from "@/lib/calendar";
import { parseStoredItems } from "@/lib/nutrition-log-ops";

export const dynamic = "force-dynamic";

export default async function EditNutritionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [row, quickPickFoods] = await Promise.all([
    prisma.nutritionLog.findUnique({ where: { id } }),
    getQuickPickFoods(),
  ]);
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
          quickPickFoods={quickPickFoods}
          defaults={{
            mealType: row.mealType,
            items: parseStoredItems(row.items),
            notes: row.notes ?? "",
            date: toDatetimeLocalValue(new Date(row.date)),
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
