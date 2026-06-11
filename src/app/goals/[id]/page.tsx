import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { GoalEditForm, type CopySource } from "@/components/GoalEditForm";
import { GoalReferences } from "@/components/GoalReferences";
import { PendingNotes, type PendingNote } from "@/components/PendingNotes";
import { PlanChangelog, type ChangelogEntry } from "@/components/PlanChangelog";
import { PlanOverview } from "@/components/PlanOverview";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { ReachMeter } from "@/components/ReachMeter";
import { prisma } from "@/lib/db";
import type { GoalReference } from "@/lib/goal-actions";
import { setPlanActive } from "@/lib/goal-actions";
import type { GoalTarget } from "@/lib/goal-targets";
import type { ProgramTemplate } from "@/lib/program-template";
import { computeReadiness } from "@/lib/readiness";
import { computeGoalFeasibility } from "@/lib/rarity";
import type { CoachFeasibility } from "@/lib/rarity-core";

export const dynamic = "force-dynamic";

export default async function GoalDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // UXR-63-10: ?stackWarning — whitelist-only (L10: only "epic" | "legendary" accepted)
  searchParams: Promise<{ stackWarning?: string }>;
}) {
  const [{ id }, { stackWarning: rawStackWarning }] = await Promise.all([params, searchParams]);
  // L10: whitelist check — only "epic" or "legendary" trigger the banner
  const stackWarning =
    rawStackWarning === "epic" || rawStackWarning === "legendary" ? rawStackWarning : null;

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

  // Compute goal feasibility + coach override in parallel with readiness (UXR-63-10)
  const [readiness, feasibility] = await Promise.all([
    targets.length > 0 ? computeReadiness(targets, new Date(), goal.id) : Promise.resolve(null),
    computeGoalFeasibility({ id: goal.id, targetDate: goal.targetDate, targets: goal.targets, kind: goal.kind }),
  ]);

  // Parse coachFeasibility from DB (typed as JsonValue | null by Prisma)
  function parseCoach(raw: unknown): CoachFeasibility | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.tier !== "string" ||
      typeof r.rationale !== "string" ||
      typeof r.assessedAt !== "string" ||
      r.assessedBy !== "coach"
    ) return null;
    return {
      tier: r.tier as CoachFeasibility["tier"],
      rationale: r.rationale,
      assessedAt: r.assessedAt,
      assessedBy: "coach",
    };
  }
  const coachFeasibility = parseCoach(goal.coachFeasibility);

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
      {/* UXR-63-16: one-time post-creation banner at the decision moment — ?stackWarning=epic|legendary
          UXR-63-13: caps at --warning, NEVER --danger; UXR-63-15: exact copy strings from §0
          data-testid="stack-warning-banner" per UXR §7 */}
      {stackWarning && (
        <div
          data-testid="stack-warning-banner"
          className="rounded-2xl border border-[var(--warning)] border-l-[3px] p-4 space-y-1.5"
          style={{ backgroundColor: "color-mix(in srgb, var(--warning) 8%, var(--card))" }}
        >
          <p className="text-sm flex items-baseline gap-1.5">
            <span className="text-[var(--warning)]" aria-hidden>◣</span>
            <span className="text-[var(--foreground)]">
              {stackWarning === "legendary" ? (
                <>
                  <strong>Legendary reach.</strong>{" "}
                  As set, this is near-impossible in the time set. Bring it to your coach to extend the timeline, or pause it until your slate clears.
                </>
              ) : (
                <>
                  <strong>Epic reach.</strong>{" "}
                  Hitting this by {goal.targetDate ? new Date(goal.targetDate).toLocaleDateString() : "the target date"} is a hard ask off your current pace. Talk it over with your coach, or give the deadline more room.
                </>
              )}
            </span>
          </p>
        </div>
      )}

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

      {/* UXR-63-10: Reach card between Readiness and Plan — computed + coach side-by-side
          UXR-63-11: computed value NEVER hidden; coach override shown with rationale + assessedAt
          data-testid="goal-reach-card" per UXR §7 */}
      {feasibility.tier !== null || coachFeasibility !== null ? (
        <Card title="Reach" data-testid="goal-reach-card">
          {/* Side-by-side: Computed | Coach (UXR-63-10, UXR-63-11) */}
          <div className="flex gap-6 mb-3">
            {/* Computed */}
            <div data-testid="goal-reach-computed">
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] mb-1">Computed</p>
              <ReachMeter tier={feasibility.tier} label size="md" />
              {feasibility.basis && (
                <p className="text-xs text-[var(--muted)] mt-1">basis: {feasibility.basis}</p>
              )}
            </div>
            {/* Coach override — shown only when present (UXR-63-11) */}
            {coachFeasibility && (
              <div data-testid="goal-reach-coach">
                <p className="text-[10px] uppercase tracking-wide text-[var(--accent)] mb-1">Coach</p>
                <ReachMeter tier={coachFeasibility.tier} label size="md" />
                <p className="text-xs text-[var(--muted)] mt-1">
                  {new Date(coachFeasibility.assessedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
          {/* Coach rationale */}
          {coachFeasibility?.rationale && (
            <p className="text-xs text-[var(--muted)] italic border-l-2 border-[var(--accent)] pl-2 mb-3">
              &ldquo;{coachFeasibility.rationale}&rdquo;
            </p>
          )}
          {/* Per-target breakdown table — ReadinessBreakdown idiom (UXR-63-10, PRD §3.1.8) */}
          {feasibility.perTarget.length > 0 && (
            <ul className="space-y-3" data-testid="goal-reach-pertarget">
              {feasibility.perTarget.map((t) => (
                <li key={t.metric}>
                  <div className="flex justify-between text-sm mb-0.5 gap-2">
                    <span className="font-medium truncate pr-2">{t.label}</span>
                    <span className="text-[var(--muted)] shrink-0 text-xs">
                      {t.verdict === "met" ? "met" : t.verdict === "unknown" ? "no data" : t.verdict}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    {t.requiredRate !== null && t.plausibleRate !== null ? (
                      <>
                        required {t.requiredRate.toFixed(2)}/wk
                        {" · "}
                        plausible {t.plausibleRate.toFixed(2)}/wk
                        {t.ratio !== null && ` · ${t.ratio.toFixed(1)}× pace`}
                      </>
                    ) : t.verdict === "met" ? (
                      "Target met"
                    ) : (
                      "No rate data"
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {/* Plan card — shows when there are any plans (active or paused). REQ-202 */}
      {hasPlan && (
        <Card
          title="Plan"
          action={
            <div className="flex flex-wrap items-center gap-3 text-sm">
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
