import Link from "next/link";
import { Card } from "@/components/Card";
import { LogBaselineForm } from "@/components/LogBaselineForm";
import { prisma } from "@/lib/db";
import type { ProgramTemplate } from "@/lib/program-template";

export const dynamic = "force-dynamic";

export default async function LogBaselinePage({
  searchParams,
}: {
  searchParams: Promise<{ testName?: string }>;
}) {
  const { testName } = await searchParams;
  const presetName = testName ? decodeURIComponent(testName) : null;

  const plan = await prisma.plan.findFirst({
    where: { active: true, goal: { isFocus: true } },
    orderBy: { updatedAt: "desc" },
  });
  const template = (plan?.planJson as unknown as ProgramTemplate | undefined) ?? null;

  const knownTests = template
    ? template.baselineWeek.flatMap((d) =>
        d.tests.map((t) => ({
          name: t.testName,
          units: t.units,
          protocol: t.protocol,
          dayOfWeek: d.dayOfWeek,
        })),
      )
    : [];

  const presetUnits = presetName
    ? knownTests.find((t) => t.name === presetName)?.units ?? null
    : null;
  const presetProtocol = presetName
    ? knownTests.find((t) => t.name === presetName)?.protocol ?? null
    : null;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/baselines" className="text-sm text-[var(--accent)]">
          ← Records
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Log baseline result</h1>
        <p className="text-sm text-[var(--muted)]">
          Initial test or retest. Pick from the program&apos;s scheduled tests, or pick &ldquo;Other&rdquo;.
        </p>
      </header>

      {presetProtocol && (
        <Card title="Protocol">
          <p className="text-sm whitespace-pre-wrap">{presetProtocol}</p>
        </Card>
      )}

      <Card>
        <LogBaselineForm
          knownTests={knownTests}
          presetName={presetName}
          presetUnits={presetUnits}
        />
      </Card>
    </div>
  );
}
