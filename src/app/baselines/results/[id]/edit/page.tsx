import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { EditBaselineForm } from "@/components/EditBaselineForm";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EditBaselinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await prisma.baseline.findUnique({ where: { id } });
  if (!row) notFound();

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link
          href={`/baselines/test/${encodeURIComponent(row.testName)}`}
          className="text-sm text-[var(--accent)]"
        >
          ← {row.testName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Edit baseline result</h1>
        <p className="text-sm text-[var(--muted)]">
          Logged {new Date(row.createdAt).toLocaleString()}
        </p>
      </header>

      <Card>
        <EditBaselineForm
          id={row.id}
          testName={row.testName}
          defaults={{
            value: String(row.value),
            units: row.units,
            date: row.date.toISOString().slice(0, 10),
            notes: row.notes ?? "",
          }}
        />
      </Card>
    </div>
  );
}
