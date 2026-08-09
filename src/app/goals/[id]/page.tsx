import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { GoalEditForm, type CopySource } from "@/components/GoalEditForm";
import { GoalCompleteForm } from "@/components/GoalCompleteForm";
import { GoalReferences } from "@/components/GoalReferences";
import { PendingNotes, type PendingNote } from "@/components/PendingNotes";
import { PlanChangelog, type ChangelogEntry } from "@/components/PlanChangelog";
import { PlanOverview } from "@/components/PlanOverview";
import { ReadinessBreakdown } from "@/components/ReadinessBreakdown";
import { ReachMeter } from "@/components/ReachMeter";
import { getDb } from "@/lib/db";
import { lastTrainedForGoals, relativeTrainedLabel, parseAttributionHints } from "@/lib/goal-attribution";
import type { GoalReference } from "@/lib/goal-actions";
import { reopenGoal, setPlanActive } from "@/lib/goal-actions";
import type { GoalTarget } from "@/lib/goal-targets";
import type { ProgramTemplate } from "@/lib/program-template";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";
import { USER_TZ, dateKey } from "@/lib/calendar";
import { computeReadiness } from "@/lib/readiness";
import { computeGoalFeasibility } from "@/lib/rarity";
import { parseCoachFeasibility, RARITY_TIERS, type RarityTier } from "@/lib/rarity-core";
import { presentationForGoal } from "@/lib/goal-presentation";
import { parseCompletionSnapshot, parseGoalRetrospective } from "@/lib/goal-completion-core";
import { getGoalStory } from "@/lib/goal-story";
import { GoalStorySection } from "@/components/goal-story/GoalStorySection";
import { AssayMonument, formatCompletedDateKey } from "@/components/goal-assay/AssayMonument";
import { AssayCeremonyController } from "@/components/goal-assay/AssayCeremonyController";
import type { SummitSheetBadge, SummitSheetReach, SummitSheetStatCell } from "@/components/goal-assay/SummitSheet";
import { ceremonyTier, heroStatPrecedence } from "@/lib/goal-assay-core";

// R3 (binding): tier strings frozen inside a JSON snapshot are untyped —
// validate against the closed RarityTier set before handing them to ReachMeter
// rather than trusting the cast.
function asRarityTier(t: string | null): RarityTier | null {
  return t !== null && (RARITY_TIERS as readonly string[]).includes(t) ? (t as RarityTier) : null;
}

export const dynamic = "force-dynamic";

// Word-aware title-case for reusing ringLabel ("READINESS"/"PROGRESS") as a
// Card title — architecture-critique S1. Not `s[0] + s.slice(1).toLowerCase()`
// so a hypothetical future multi-word ringLabel title-cases every word.
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

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

  const db = await getDb();
  const goal = await db.goal.findUnique({
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
  const isAchieved = goal.status === "achieved";
  const activePlan = goal.plans[0];

  // When no active plan, check if a paused plan exists — UXR-62B-04
  // (active=false IS the paused state; no schema change needed).
  // S5 (architecture-blueprint-v2.md, binding): same include shape as the
  // active-plan query above (revisions + triggerNote) — this is what lets the
  // Changelog card render with full fidelity for achieved goals too (REQ-006a):
  // completeGoalCore deactivates every plan on completion, so an achieved
  // goal's plan is always found here, never in `activePlan`.
  const mostRecentPlan = activePlan
    ? null
    : await db.plan.findFirst({
        where: { goalId: id },
        orderBy: { createdAt: "desc" },
        include: {
          revisions: {
            orderBy: { createdAt: "desc" },
            include: { triggerNote: true },
          },
        },
      });
  const isPaused = !!mostRecentPlan; // has plan(s) but none active
  // completeGoalCore deactivates every plan on completion — the Plan card's
  // Pause/Resume toggle (a live plan-management control) has no business
  // showing on an archived goal, so it's suppressed once achieved.
  const hasPlan = !isAchieved && (!!activePlan || isPaused);

  // Server actions — bound here so form actions need no client component
  const pausePlan = setPlanActive.bind(null, goal.id, false);
  const resumePlan = setPlanActive.bind(null, goal.id, true);

  // Pending notes = unresolved notes (no resolvedAt). Cleared either by an
  // apply_plan_revision that includes their id, or by an explicit resolve.
  let pendingNotes: PendingNote[] = [];
  if (activePlan) {
    const notes = await db.note.findMany({
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

  // S5: the plan whose revisions back the Changelog card — the active plan
  // when there is one, else the most-recent (paused/deactivated) plan. Same
  // shape either way (both queries include revisions + triggerNote above), so
  // achieved goals — which never have an active plan — get the fallback and
  // the changelog renders with full fidelity instead of going empty.
  const planForChangelog = activePlan ?? mostRecentPlan;
  const changelog: ChangelogEntry[] = planForChangelog
    ? planForChangelog.revisions.map((r) => ({
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

  // R9 (binding, architecture-blueprint-v2.md): an achieved goal renders ONLY
  // the frozen completion snapshot — never live computeReadiness/
  // computeGoalFeasibility. Running them here would be wasted work and would
  // put a live Reach figure confusingly next to the frozen trophy numbers.
  const [readiness, feasibility, trainedMapDetail] = isAchieved
    ? [null, null, await lastTrainedForGoals([goal])]
    : await Promise.all([
        targets.length > 0 ? computeReadiness(targets, new Date(), goal.id) : Promise.resolve(null),
        computeGoalFeasibility({ id: goal.id, targetDate: goal.targetDate, targets: goal.targets, kind: goal.kind }),
        lastTrainedForGoals([goal]),
      ]);
  // UXR-64-07/09: trained line near header for hinted goals (no training logged vs trained Nd ago).
  const hasHints = parseAttributionHints(goal.attributionHints).length > 0;
  const lastTrained = hasHints ? (trainedMapDetail.get(goal.id) ?? null) : null;

  const targetDateLabel = goal.targetDate
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: USER_TZ }).format(goal.targetDate)
    : null;

  // Parse coachFeasibility from DB using the shared parser (rarity-core.ts).
  // Skipped for achieved goals — the frozen coachFeasibilityTier lives in the
  // completion snapshot instead (REQ-014/R9).
  const coachFeasibility = isAchieved ? null : parseCoachFeasibility(goal.coachFeasibility);

  // REQ-012/014c: completion snapshot + retrospective — parsed once, used by
  // both The Assay monument (REQ-005, below) and the Reflection card.
  const completionSnapshot = isAchieved ? parseCompletionSnapshot(goal.completionSnapshot) : null;
  const retrospective = parseGoalRetrospective(goal.retrospective);
  // REQ-006b: the Story section is achieved-only (frozen retrospective view) —
  // getGoalStory is not called for an active goal on this page (it would be
  // wasted work; the live Readiness/Reach cards below already cover "story so
  // far" for an active goal).
  const story = isAchieved ? await getGoalStory(goal.id) : null;
  const reopen = reopenGoal.bind(null, goal.id);

  // ── REQ-005 — The Assay ceremony scalars ──────────────────────────────────
  // No new query: `story` is already awaited above (report §7.6: "do not add
  // to its ~23 sequential queries"). evidenceDensity (report §4.1 S4 —
  // "hikes, baselines, checkpoints") counts this goal's corroborating history
  // straight off the same bundle: hikes logged, baseline-test checkpoints
  // clipped to the goal's window, and (project-kind) `log:*` metric
  // checkpoints. goal-assay-core.ts stays Prisma-free by design, so this
  // count has to happen here, the one place that already has `story` in
  // hand.
  const evidenceDensity = story
    ? story.hikeArc.length +
      story.baselineArcs.reduce((sum, arc) => sum + arc.points.length, 0) +
      story.metricArcs.reduce((sum, arc) => sum + arc.points.length, 0)
    : 0;

  // The ceremony's plain-scalar props for AssayCeremonyController/SummitSheet
  // — derived from `completionSnapshot` only (V5/REQ-005: no computeGameState
  // call; `snapshot.ceremony` is either present, from REQ-008's capture at
  // completion time, or absent on a legacy row, in which case badges/level
  // are simply omitted below, never recomputed live). `null` exactly when
  // `completionSnapshot` is null — PRD §6: "no monument/ceremony without a
  // snapshot," so the JSX below gates on both together, always in lockstep.
  const ceremony = completionSnapshot
    ? (() => {
        const snapshot = completionSnapshot;
        const tier = ceremonyTier({
          feasibilityTierAtCompletion: snapshot.feasibilityTierAtCompletion,
          xpBasisWeeks: snapshot.xpBasis.weeks,
          targetsMet: snapshot.targetsMet,
          evidenceDensity,
        });
        const heroStat = heroStatPrecedence(snapshot);
        const readinessStart =
          snapshot.readinessSeries && snapshot.readinessSeries.length > 0
            ? snapshot.readinessSeries[0]!.score
            : null;
        const reachTier = asRarityTier(snapshot.feasibilityTierAtCompletion);
        const reach: SummitSheetReach | null = reachTier
          ? { tier: reachTier, label: reachTier.charAt(0).toUpperCase() + reachTier.slice(1) }
          : null;
        const badges: SummitSheetBadge[] = snapshot.ceremony?.badgesUnlocked ?? [];

        // Row count is emergent from what's actually true (Rule C), never
        // tier-branched: the targets/progress cells simply don't exist when
        // there's nothing honest to put in them (Marker floor: 2 cells).
        const statCells: SummitSheetStatCell[] = [
          { value: String(snapshot.daysElapsed), label: "Days elapsed" },
          ...(snapshot.targetsTotal > 0
            ? [{ value: `${snapshot.targetsMet} of ${snapshot.targetsTotal}`, label: "Targets met" }]
            : []),
          { value: `+${snapshot.xpAwardedAtCompletion}`, label: "XP awarded" },
          // heroStatPrecedence's own ceiling guard decides this, not a local
          // re-check: a capped, non-measuring score never gets a cell here
          // either (§8.5).
          ...(heroStat.kind === "readiness"
            ? [
                {
                  value:
                    readinessStart !== null
                      ? `${readinessStart} → ${heroStat.score}`
                      : String(heroStat.score),
                  label: "Weighted progress",
                  caption: heroStat.showDenominator
                    ? `Across ${heroStat.coverage.tested} of ${heroStat.coverage.total} tested`
                    : "Across your targets",
                },
              ]
            : []),
        ];

        return {
          tier,
          objective: snapshot.objective,
          // Report phase-a 1a: "SEP 12, 2025" — uppercase of the same pure
          // string-split formatter the monument itself uses (never `new
          // Date(dateKey)`).
          dateLabel: formatCompletedDateKey(snapshot.completedDateKey).toUpperCase(),
          backdatedSuffix: snapshot.backdated ? "(backdated)" : undefined,
          statCells,
          emptyTargetsHint:
            snapshot.targetsTotal === 0 ? "No targets were set on this goal." : undefined,
          reach,
          badges,
          levelBefore: snapshot.ceremony?.levelBefore ?? null,
          levelAfter: snapshot.ceremony?.levelAfter ?? null,
        };
      })()
    : null;

  const otherGoals = await db.goal.findMany({
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
    // overflow-x-clip (report §7.3/§9 — NOT `hidden`): the monument
    // flourish's flying ring scales to ~2.3x via an absolutely-positioned
    // div; `clip` stops the resulting overflow without creating a scroll
    // container or breaking sticky ancestors (AppHeader).
    <div className="max-w-md mx-auto p-4 space-y-4 overflow-x-clip">
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
                  As set, this is near-impossible in the time set. Bring it to your coach to extend the timeline, or pause it until your slate clears.{" "}
                  Next time, try the coach intake interview — it previews this before anything is created.
                </>
              ) : (
                <>
                  <strong>Epic reach.</strong>{" "}
                  Hitting this by {goal.targetDate ? new Date(goal.targetDate).toLocaleDateString() : "the target date"} is a hard ask off your current pace. Talk it over with your coach, or give the deadline more room.{" "}
                  Next time, try the coach intake interview — it previews this before anything is created.
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
        {/* UXR-64-07/09: muted trained line near header for hinted goals */}
        {hasHints && (
          <p className="text-xs text-[var(--muted)] mt-0.5" data-testid="goal-detail-trained">
            {relativeTrainedLabel(lastTrained)}
          </p>
        )}
      </header>

      {/* B2 (#148): project-only Trends nav link — NOT rendered for fitness goals */}
      {goal.kind === "project" && (
        <div className="flex gap-4 text-sm -mt-1">
          <Link href={`/goals/${goal.id}/trends`} className="text-[var(--accent)]">
            Trends →
          </Link>
        </div>
      )}

      {isAchieved ? (
        <>
          {/* The Assay (REQ-005): a parseable snapshot gets the permanent
              monument + first-view ceremony controller, hoisted above
              everything else in this branch (report §2.1 — "renders proud
              permanently from the top of the viewport"). PRD §6 edge case:
              no monument/ceremony without a parseable snapshot — a legacy or
              tampered achieved row instead keeps the pre-existing degraded
              card (no stats, no share link, Reopen still offered below). */}
          {completionSnapshot && ceremony ? (
            <>
              <AssayMonument snapshot={completionSnapshot} goalId={goal.id} evidenceDensity={evidenceDensity} />
              <AssayCeremonyController
                goalId={goal.id}
                capturedAt={completionSnapshot.capturedAt}
                tier={ceremony.tier}
                objective={ceremony.objective}
                dateLabel={ceremony.dateLabel}
                backdatedSuffix={ceremony.backdatedSuffix}
                statCells={ceremony.statCells}
                emptyTargetsHint={ceremony.emptyTargetsHint}
                reach={ceremony.reach}
                badges={ceremony.badges}
                levelBefore={ceremony.levelBefore}
                levelAfter={ceremony.levelAfter}
              />
            </>
          ) : (
            <Card title="Completed">
              <p className="text-sm text-[var(--muted)]">
                🏆 Completed
                {goal.completedAt
                  ? ` ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: USER_TZ }).format(goal.completedAt)}`
                  : ""}
                {" — no snapshot on file. Reopen and re-complete to capture one."}
              </p>
            </Card>
          )}

          <Card title="Reflection">
            {retrospective ? (
              <div className="space-y-3 text-sm">
                <p className="whitespace-pre-wrap">{retrospective.reflection}</p>
                {retrospective.wins && retrospective.wins.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)] mb-1">Wins</p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {retrospective.wins.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {retrospective.challenges && retrospective.challenges.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)] mb-1">Challenges</p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {retrospective.challenges.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {retrospective.lessons && retrospective.lessons.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)] mb-1">Lessons</p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {retrospective.lessons.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {retrospective.nextSteps && retrospective.nextSteps.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)] mb-1">Next steps</p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {retrospective.nextSteps.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-[var(--muted)] pt-2 border-t border-[var(--border)]">
                  {retrospective.authoredWith === "user+coach" ? "Co-authored with your coach" : "Written by you"}
                  {" · "}
                  {new Date(retrospective.updatedAt).toLocaleDateString()}
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">No reflection yet — ask your coach to run a retrospective.</p>
            )}
          </Card>

          {/* S5: full-fidelity changelog restored for achieved goals — reads
              off planForChangelog (mostRecentPlan fallback), same-tenant page
              so triggerNote excerpts render (unlike the MCP tool's timeline). */}
          {planForChangelog && (
            <Card title={`Changelog${changelog.length > 0 ? ` (${changelog.length})` : ""}`}>
              <PlanChangelog entries={changelog} goalId={goal.id} />
            </Card>
          )}

          {/* REQ-006b: Story section — readiness arc, targets table, baseline
              arcs, phase timeline (triggerNote-free, S5), hike arc, metric
              arcs. Omits itself entirely when story is null. */}
          <GoalStorySection story={story} />

          {/* Report §7.1 spine / phase-a 1c: Reopen demoted below Story
              (peak-end — the last thing on the page should not be an exit
              hatch). Unconditional: this reorder is independent of whether
              the snapshot parsed, so the degraded-card branch above gets it
              too. */}
          <Card title="Reopen">
            <p className="text-xs text-[var(--muted)] mb-3">
              Restores active status. Does not restore focus or resume the plan — do that separately if you want to pick this back up.
            </p>
            <form action={reopen}>
              <button
                type="submit"
                className="min-h-[44px] rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-[var(--accent)] transition"
              >
                Reopen
              </button>
            </form>
          </Card>
        </>
      ) : (
        <>
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

          <Card title="Complete">
            <GoalCompleteForm id={goal.id} defaultDateKey={dateKey(new Date())} />
          </Card>
        </>
      )}

      <Card title="References">
        <GoalReferences goalId={goal.id} references={references} />
      </Card>

      {!isAchieved && readiness && (
        <Card title={titleCase(presentationForGoal(goal).ringLabel)}>
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
          data-testid="goal-reach-card" per UXR §7. R9: entire block skipped when achieved —
          feasibility is null (never computed live) and the frozen tiers render in the trophy card above. */}
      {!isAchieved && feasibility && (feasibility.tier !== null || coachFeasibility !== null ? (
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
      ) : (
        <FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} coach={coachFeasibility} />
      ))}

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
                        : "Silences this plan's retest days. Goal stays tracked — date, coach, Reach intact."
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
                : "Silences this plan's retest days. Goal stays tracked — date, coach, Reach intact."}
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
