import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { SnapshotView } from "@/components/SnapshotView";
import { prisma } from "@/lib/db";
import type { ProgramTemplate } from "@/lib/program-template";
import { diffSnapshots, type SectionDiff } from "@/lib/snapshot-diff";

export const dynamic = "force-dynamic";

export default async function RevisionDetail({
  params,
}: {
  params: Promise<{ id: string; revisionId: string }>;
}) {
  const { id: goalId, revisionId } = await params;

  const revision = await prisma.planRevision.findUnique({
    where: { id: revisionId },
    include: {
      plan: { select: { id: true, name: true, goalId: true } },
      triggerNote: true,
    },
  });
  if (!revision || revision.plan.goalId !== goalId) notFound();

  // Find the previous revision (chronologically just before this one).
  const previous = await prisma.planRevision.findFirst({
    where: {
      planId: revision.planId,
      createdAt: { lt: revision.createdAt },
    },
    orderBy: { createdAt: "desc" },
  });

  const after = revision.snapshotJson as unknown as ProgramTemplate;
  const before = (previous?.snapshotJson as unknown as ProgramTemplate | undefined) ?? null;

  const diff = diffSnapshots(before, after);
  const changedDayIndices = new Set(diff.dayDiffs.filter((d) => d.changed).map((d) => d.dayOfWeek));

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href={`/goals/${goalId}`} className="text-sm text-[var(--accent)]">
          ← Goal
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{revision.summary}</h1>
        <p className="text-sm text-[var(--muted)]">
          {new Date(revision.createdAt).toLocaleString()} · source {revision.triggerSource}
          {previous && " · changes vs previous revision"}
          {!previous && " · initial state"}
        </p>
      </header>

      {revision.triggerNote && (
        <Card title="Trigger note">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-1">
            {revision.triggerNote.type} ·{" "}
            {new Date(revision.triggerNote.date).toLocaleString()}
          </p>
          <p className="text-sm whitespace-pre-wrap">{revision.triggerNote.body}</p>
        </Card>
      )}

      {revision.reasoning && (
        <Card title="Reasoning">
          <p className="text-sm whitespace-pre-wrap">{revision.reasoning}</p>
        </Card>
      )}

      <Card title="What changed">
        <ul className="space-y-1 text-sm">
          <DiffRow label="Phases" status={diff.phases} />
          <DiffRow label="Weekly split" status={diff.weeklySplit} />
          <DiffRow label="Daily mobility" status={diff.dailyMobility} />
          <DiffRow label="Baseline week" status={diff.baselineWeek} />
          <DiffRow label="Hiking superset" status={diff.hikingSuperset} />
          <DiffRow label="Plan metadata" status={diff.meta} />
        </ul>
        {changedDayIndices.size > 0 && (
          <p className="text-xs text-[var(--muted)] mt-2">
            Days changed: {[...changedDayIndices].sort((a, b) => a - b).map((d) => `Day ${d}`).join(", ")}
          </p>
        )}
      </Card>

      <Card title="Original plan">
        <SnapshotView template={before} highlight={changedDayIndices} />
      </Card>

      <Card title="Updated plan">
        <SnapshotView template={after} highlight={changedDayIndices} />
      </Card>

      <details className="rounded-lg border border-[var(--border)] p-3">
        <summary className="text-xs uppercase tracking-wide text-[var(--muted)] cursor-pointer">
          Raw JSON snapshots
        </summary>
        <div className="grid gap-2 mt-2">
          <div>
            <p className="text-xs font-medium mb-1">Before</p>
            <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-60 overflow-auto bg-[var(--background)] border border-[var(--border)] rounded-lg p-2">
              {before ? JSON.stringify(before, null, 2) : "—"}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">After</p>
            <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-60 overflow-auto bg-[var(--background)] border border-[var(--border)] rounded-lg p-2">
              {JSON.stringify(after, null, 2)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

function DiffRow({ label, status }: { label: string; status: SectionDiff }) {
  return (
    <li className="flex justify-between items-baseline gap-2">
      <span>{label}</span>
      <span
        className={`text-xs uppercase tracking-wide shrink-0 ${
          status === "changed" ? "text-amber-500" : "text-[var(--muted)]"
        }`}
      >
        {status}
      </span>
    </li>
  );
}
