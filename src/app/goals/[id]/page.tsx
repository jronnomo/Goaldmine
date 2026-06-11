import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { GoalEditForm, type CopySource } from "@/components/GoalEditForm";
import { GoalReferences } from "@/components/GoalReferences";
import { PendingNotes, type PendingNote } from "@/components/PendingNotes";
import { PlanChangelog, type ChangelogEntry } from "@/components/PlanChangelog";
import { PlanOverview } from "@/components/PlanOverview";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { prisma } from "@/lib/db";
import type { GoalReference } from "@/lib/goal-actions";
import { setPlanActive } from "@/lib/goal-actions";
import type { GoalTarget } from "@/lib/goal-targets";
import type { ProgramTemplate } from "@/lib/program-template";
import { computeReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export default async function GoalDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const goal = await prisma.goal.findUnique({
    where: { id },
    include: {
      plans: {
        where: { active: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          revisions: {
            orderBy: { createdAt: "desc" },
            include: { triggerNote: true },
          },
        },
      },
    },
  });
  if (!goal) notFound();
  const activePlan = goal.plans[0];

  // When no active plan, check if a paused plan exists — UXR-62B-04
  // (active=false IS the paused state; no schema change needed)
  const mostRecentPlan = activePlan
    ? null
    : await prisma.plan.findFirst({
        where: { goalId: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, active: true },
      });
  const isPaused = !!mostRecentPlan; // has plan(s) but none active
  const hasPlan = !!activePlan || isPaused;

  // Server actions — bound here so form actions need no client component
  const pausePlan = setPlanActive.bind(null, goal.id, false);
  const resumePlan = setPlanActive.bind(null, goal.id, true);

  // Pending notes = unresolved notes (no resolvedAt). Cleared either by an
  // apply_plan_revision that includes their id, or by an explicit resolve.
  let pendingNotes: PendingNote[] = [];
  if (activePlan) {
    const notes = await prisma.note.findMany({
      where: { resolvedAt: null },
      orderBy: { date: "desc" },
      take: 25,
    });
    pendingNotes = notes.map((n) => ({
      id: n.id,
      date: n.date,
      body: n.body,
      type: n.type,
    }));
  }

  const changelog: ChangelogEntry[] = activePlan
    ? activePlan.revisions.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        triggerSource: r.triggerSource,
        summary: r.summary,
        reasoning: r.reasoning,
        triggerNote: r.triggerNote
          ? {
              id: r.triggerNote.id,
              body: r.triggerNote.body,
              type: r.triggerNote.type,
              date: r.triggerNote.date,
            }
          : null,
      }))
    : [];

  const targets = (goal.targets as unknown as GoalTarget[] | null) ?? [];
  const references = (goal.references as unknown as GoalReference[] | null) ?? [];
  const readiness = targets.length > 0 ? await computeReadiness(targets, new Date(), goal.id) : null;

  const otherGoals = await prisma.goal.findMany({
    where: { id: { not: id } },
    orderBy: { updatedAt: "desc" },
  });
  const copySources: CopySource[] = otherGoals
    .filter((g) => Array.isArray(g.targets) && (g.targets as unknown[]).length > 0)
    .map((g) => ({
      id: g.id,
      objective: g.objective,
      targetDate: g.targetDate?.toISOString() ?? "",
      targetCount: (g.targets as unknown[]).length,
    }));

  // Server component: new Date() is safe here — rendered once per request, never re-renders.
  const nowMs = new Date().getTime();
  const days = goal.targetDate
    ? Math.ceil((new Date(goal.targetDate).getTime() - nowMs) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/goals" className="text-sm text-[var(--accent)]">
          ← Goals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{goal.objective}</h1>
        <p className="text-sm text-[var(--muted)]">
          {goal.targetDate ? (
            <>
              {new Date(goal.targetDate).toLocaleDateString()}
              {days !== null && ` · ${days < 0 ? `${-days} days past` : `${days} days out`} `}
            </>
          ) : (
            // UXR-62B-10: title= desktop hover hint for Someday state
            <span
              className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] mr-1"
              title="No target date — no countdown and no deadline pressure. Add one anytime."
            >
              Someday
            </span>
          )}
          {" "}· {goal.status}
        </p>
      </header>

      <Card title="Edit">
        <GoalEditForm
          id={goal.id}
          copySources={copySources}
          defaultValues={{
            objective: goal.objective,
            targetDate: goal.targetDate ? new Date(goal.targetDate).toISOString().slice(0, 10) : "",
            notes: goal.notes ?? "",
            status: goal.status,
            targets: JSON.stringify(targets, null, 2),
          }}
        />
      </Card>

      <Card title="References">
        <GoalReferences goalId={goal.id} references={references} />
      </Card>

      {readiness && (
        <Card title="Readiness">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-4xl font-semibold tracking-tight">{readiness.score}<span className="text-base text-[var(--muted)]">/100</span></p>
            {readiness.missing.length > 0 && (
              <p className="text-xs text-[var(--muted)]">
                {readiness.missing.length} target{readiness.missing.length === 1 ? "" : "s"} no data yet
              </p>
            )}
          </div>
          <ReadinessBreakdown breakdown={readiness.breakdown} />
        </Card>
      )}

      {/* Plan card — shows when there are any plans (active or paused). REQ-202 */}
      {hasPlan && (
        <Card
          title="Plan"
          action={
            <div className="flex items-center gap-3 text-sm">
              {activePlan && (
                <>
                  <Link href={`/goals/${goal.id}/plan`} className="text-[var(--accent)]">
                    Full plan →
                  </Link>
                  <Link href={`/goals/${goal.id}/revise`} className="text-[var(--accent)]">
                    Revise
                  </Link>
                </>
              )}
              {/* Pause/Resume toggle — hidden entirely on focus goal (server-guarded). UXR-62B-04 */}
              {!goal.isFocus && (
                <form action={activePlan ? pausePlan : resumePlan}>
                  <button
                    type="submit"
                    // Pause = muted/quiet (recommended for non-focus skill goals). UXR-62B-04
                    // Resume = accent-soft CTA (more consequential — restarts retest-marker spray). UXR-62B-05
                    className={`min-h-[44px] text-xs rounded-full border px-3 ${
                      activePlan
                        ? "border-[var(--border)] text-[var(--muted)]"
                        : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]"
                    }`}
                    // UXR-62B-10: title= desktop hover hint
                    title={
                      activePlan
                        ? "Its 12-week plan posts retest days to the calendar on its own schedule."
                        : "Silences this plan's retest days. Goal stays tracked — date, coach, rarity intact."
                    }
                  >
                    {activePlan ? "Pause" : "Resume"}
                  </button>
                </form>
              )}
            </div>
          }
        >
          {/* Always-on consequence line — state-before-action, no modal needed. UXR-62B-06 */}
          {!goal.isFocus && (
            <p className="text-xs text-[var(--muted)] mb-3">
              {activePlan
                ? "Its 12-week plan posts retest days to the calendar on its own schedule."
                : "Silences this plan's retest days. Goal stays tracked — date, coach, rarity intact."}
            </p>
          )}
          {activePlan && (
            <PlanOverview
              plan={{
                id: activePlan.id,
                name: activePlan.name,
                startedOn: activePlan.startedOn,
                endsOn: activePlan.endsOn,
                weeks: activePlan.weeks,
                template: activePlan.planJson as unknown as ProgramTemplate,
              }}
            />
          )}
        </Card>
      )}

      {activePlan && (
        <Card
          title={`Pending notes${pendingNotes.length > 0 ? ` (${pendingNotes.length})` : ""}`}
        >
          <PendingNotes notes={pendingNotes} goalId={goal.id} />
        </Card>
      )}

      {activePlan && (
        <Card title={`Changelog${changelog.length > 0 ? ` (${changelog.length})` : ""}`}>
          <PlanChangelog entries={changelog} goalId={goal.id} />
        </Card>
      )}

      {goal.notes && (
        <Card title="Notes">
          <p className="text-sm whitespace-pre-wrap">{goal.notes}</p>
        </Card>
      )}
    </div>
  );
}
