import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { ReviseForm } from "@/components/ReviseForm";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RevisePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ noteId?: string }>;
}) {
  const [{ id: goalId }, { noteId }] = await Promise.all([params, searchParams]);

  const db = await getDb();
  const goal = await db.goal.findUnique({
    where: { id: goalId },
    include: { plans: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!goal) notFound();
  const plan = goal.plans[0];
  if (!plan) {
    return (
      <div className="max-w-md mx-auto p-4">
        <Card title="No plan attached">
          <p className="text-sm text-[var(--muted)]">
            This goal has no active plan to revise.{" "}
            <Link href={`/goals/${goal.id}`} className="text-[var(--accent)]">
              Back to goal
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const note = noteId
    ? await db.note.findUnique({ where: { id: noteId } })
    : null;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href={`/goals/${goal.id}`} className="text-sm text-[var(--accent)]">
          ← {goal.objective}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Revise plan</h1>
        <p className="text-sm text-[var(--muted)]">
          {plan.name}
        </p>
      </header>

      {note && (
        <Card title="Triggered by">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-1">
            {note.type} · {new Date(note.date).toLocaleString()}
          </p>
          <p className="text-sm whitespace-pre-wrap">{note.body}</p>
        </Card>
      )}

      <Card title="Revision">
        <ReviseForm
          planId={plan.id}
          noteId={note?.id ?? null}
          currentSnapshot={JSON.stringify(plan.planJson, null, 2)}
        />
      </Card>

      <p className="text-xs text-[var(--muted)] px-1">
        For a substantive revision (cascades, week shifts, nutrition tuning), the cleanest path is
        to chat with your coach in claude.ai — it will read the note, reason over the cascade, and
        apply the revision directly. This form is the manual fallback.
      </p>
    </div>
  );
}
