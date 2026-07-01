import Link from "next/link";
import { Bullseye } from "@/components/Bullseye";
import { Card } from "@/components/Card";
import { GoalCreateForm, type CopySource } from "@/components/GoalCreateForm";
import { ReachMeter } from "@/components/ReachMeter";
import { StackReachCard } from "@/components/StackReachCard";
import { getDb } from "@/lib/db";
import { lastTrainedForGoals, relativeTrainedLabel, parseAttributionHints } from "@/lib/goal-attribution";
import { setFocusGoal, setGoalTracked } from "@/lib/goal-actions";
import { computeStackRarity } from "@/lib/rarity";

export const dynamic = "force-dynamic";

function goalProgress(
  g: { createdAt: Date; targetDate: Date | null; status: string },
  now: number,
): number {
  if (g.status === "achieved") return 1;
  if (g.status === "abandoned") return 0;
  if (!g.targetDate) return 0; // someday goal — no progress bar
  const total = g.targetDate.getTime() - g.createdAt.getTime();
  if (total <= 0) return 0;
  const elapsed = now - g.createdAt.getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}

export default async function GoalsPage({
  searchParams,
}: {
  // Follow goals/[id]'s existing searchParams idiom (Next 16: Promise<{}>).
  searchParams: Promise<{ objective?: string }>;
}) {
  const { objective: rawObjective } = await searchParams;
  const defaultObjective = rawObjective ? rawObjective.slice(0, 200) : undefined;

  // Focus goal first (isFocus=true), then tracked (active=true), then by target date
  // (nulls last = someday goals at the bottom), then most-recently-updated.
  // Include most-recent plan per goal (regardless of active status) to detect paused state.
  // One computeStackRarity per request — no re-computation per row (UXR-63-08, PRD §4).
  // attributionHints is a scalar field — included by default in findMany (no explicit select needed).
  const db = await getDb();
  const [goals, stack] = await Promise.all([
    db.goal.findMany({
      orderBy: [
        { isFocus: "desc" },
        { active: "desc" },
        { targetDate: { sort: "asc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
      include: {
        plans: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, active: true },
        },
      },
    }),
    computeStackRarity(),
  ]);
  // UXR-64-07/09: ONE batched query over all hint variants; runs after goals (depends on hints).
  const trainedMap = await lastTrainedForGoals(goals);
  const focusedId = goals.find((g) => g.isFocus)?.id ?? null;

  // Build per-goal map keyed by goalId for O(1) row lookup (UXR-63-07: no recompute)
  const stackByGoalId = new Map(stack.perGoal.map((pg) => [pg.goalId, pg]));

  const copySources: CopySource[] = goals
    .filter((g) => Array.isArray(g.targets) && (g.targets as unknown[]).length > 0)
    .map((g) => ({
      id: g.id,
      objective: g.objective,
      targetDate: g.targetDate?.toISOString() ?? "",
      targetCount: (g.targets as unknown[]).length,
    }));

  // Server component: Date.now() is safe here — rendered once per request, never re-renders.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Track an objective with a date. Optionally tie measurable targets so the Stats page can graph readiness.
        </p>
      </header>

      {/* id="new-goal": deep-link anchor for promote-to-goal path (/goals?objective=...#new-goal) */}
      <div id="new-goal">
        <Card title="New goal">
          <GoalCreateForm copySources={copySources} defaultObjective={defaultObjective} />
        </Card>
      </div>

      {/* UXR-63-08: StackReachCard above the list; quiet for Common–Rare, escalates for Epic/Legendary */}
      <StackReachCard stack={stack} />

      <Card title="All goals">
        {goals.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            <strong className="font-semibold text-[var(--foreground)]">Nothing to aim at yet.</strong>{" "}
            Add a goal — a date, a metric, or both.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--border)]">
              {goals.map((g) => {
                const days = g.targetDate
                  ? Math.ceil((new Date(g.targetDate).getTime() - now) / (1000 * 60 * 60 * 24))
                  : null;
                const pct = goalProgress(g, now);
                const isFocused = g.id === focusedId;
                const setFocus = setFocusGoal.bind(null, g.id);
                const trackAction = setGoalTracked.bind(null, g.id, true);
                const untrackAction = setGoalTracked.bind(null, g.id, false);
                // Tracked goal with a plan where none is active = paused. UXR-62B-01
                const isPlanPaused = g.active && g.plans.length > 0 && !g.plans[0].active;
                // UXR-63-07: per-row effective tier from ONE computeStackRarity; no recompute
                const stackGoal = stackByGoalId.get(g.id);
                const rowTier = stackGoal?.effectiveTier ?? null;
                // UXR-63-11: coach-override marker — small gold "coach" tag + title= on compact surface
                const hasCoach = (stackGoal?.coach ?? null) !== null;
                const computedTierLabel = stackGoal?.computed.tier
                  ? stackGoal.computed.tier.charAt(0).toUpperCase() + stackGoal.computed.tier.slice(1)
                  : "—";
                const coachTitle = hasCoach
                  ? `Coach-set · computed: ${computedTierLabel}`
                  : undefined;
                const rowBody = (
                  <div className="flex items-start gap-2 min-w-0 flex-1 text-left">
                    {/* [UXR-62-12] glyph may use opacity (non-text, AA-safe); never row-level opacity */}
                    <Bullseye
                      size={20}
                      progress={pct}
                      aria-label={`${g.objective}: ${Math.round(pct * 100)}% progress`}
                      className={`shrink-0 mt-0.5${!g.active && !isFocused ? " opacity-55" : ""}`}
                    />
                    <div className="min-w-0">
                      {/* [UXR-62-12] dim untracked objective text by recolor (not row opacity) */}
                      <p className={`font-medium truncate${!g.active && !isFocused ? " text-[var(--muted)]" : ""}`}>
                        {g.objective}
                        {isFocused && (
                          // [UXR-62-11] filled Bullseye size=14 (component min for red center ring) + Focus label
                          // UXR-62B-10: title= for desktop hover hint
                          <span
                            className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide rounded-full border border-[var(--accent)] text-[var(--accent)] px-1.5 py-0.5 align-middle"
                            title="Drives your daily Today plan. Only one goal holds focus at a time."
                          >
                            <Bullseye size={14} progress={1} aria-hidden={true} />
                            Focus
                          </span>
                        )}
                      </p>
                      {/* UXR-63-07: bare meter at START of left-rail muted subline; right rail untouched */}
                      <p className="text-xs text-[var(--muted)] flex items-center gap-1.5 flex-wrap">
                        {/* UXR-63-11: coach-override marker — title= shows computed vs coach on hover */}
                        <ReachMeter
                          tier={rowTier}
                          size="sm"
                          title={coachTitle ?? `Reach: ${rowTier ?? "unrated"}`}
                        />
                        {/* UXR-63-11: small "coach" tag when override is present */}
                        {hasCoach && (
                          <span
                            className="text-[9px] uppercase tracking-wide text-[var(--accent)]"
                            title={coachTitle}
                          >
                            coach
                          </span>
                        )}
                        <span>
                          {g.targetDate ? new Date(g.targetDate).toLocaleDateString() : "Someday"}
                          {g.status !== "active" ? ` · ${g.status}` : ""}
                          {/* UXR-62B-01: plain muted text in existing subline, no new chip or control */}
                          {isPlanPaused && (
                            <span title="Silences this plan's retest days. Goal stays tracked — date, coach, Reach intact.">
                              {" · Plan paused"}
                            </span>
                          )}
                          {/* UXR-64-07/09: trained indicator joins existing muted subline for hinted goals.
                              "no training logged" is factual (UXR-64-09); never "never trained". */}
                          {parseAttributionHints(g.attributionHints).length > 0 && (
                            <span data-testid="goal-row-trained">
                              {" · "}{relativeTrainedLabel(trainedMap.get(g.id) ?? null)}
                            </span>
                          )}
                        </span>
                      </p>
                    </div>
                  </div>
                );
                return (
                  <li key={g.id} className="flex items-start gap-3 py-3">
                    <Link href={`/goals/${g.id}`} className="flex-1 min-w-0 hover:opacity-80">
                      {rowBody}
                    </Link>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      {days !== null ? (
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 border ${
                            days < 0
                              ? "border-[var(--danger)]/40 text-[var(--danger)]"
                              : days <= 14
                                ? "border-[var(--warning)]/40 text-[var(--warning)]"
                                : "border-[var(--border)] text-[var(--muted)]"
                          }`}
                        >
                          {days < 0 ? `${-days}d ago` : `${days}d`}
                        </span>
                      ) : (
                        // [UXR-62-15] Someday chip: neutral border/muted text, no urgency color
                        // UXR-62B-10: title= for desktop hover hint
                        <span
                          className="text-xs rounded-full px-2 py-0.5 border border-[var(--border)] text-[var(--muted)]"
                          title="No target date — no countdown and no deadline pressure. Add one anytime."
                        >
                          Someday
                        </span>
                      )}
                      {!isFocused && (
                        <>
                          {/* Set focus pill — explicit promote action; row tap navigates instead. */}
                          <form action={setFocus}>
                            <button
                              type="submit"
                              className="text-xs rounded-full border px-2 py-0.5 min-h-[44px] border-[var(--accent)] text-[var(--accent)]"
                              title="Drives your daily Today plan. Only one goal holds focus at a time. Focusing a goal also resumes its paused plan."
                            >
                              Set focus
                            </button>
                          </form>
                          {/* [UXR-62-12] Track/Untrack pill — hidden on focus row (server-guarded + hidden)
                              Tracked style: accent-soft bg + accent border; Untracked: border/muted outline
                              UXR-62B-10: title= describes current state (not the action) for desktop hover */}
                          <form action={g.active ? untrackAction : trackAction}>
                            <button
                              type="submit"
                              className={`text-xs rounded-full border px-2 py-0.5 min-h-[44px] ${
                                g.active
                                  ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]"
                                  : "border-[var(--border)] text-[var(--muted)]"
                              }`}
                              title={
                                g.active
                                  ? "Shows on the calendar and to your coach, and counts toward Reach."
                                  : "Parked. Hidden from the calendar, coach, and Reach until you track it again."
                              }
                            >
                              {g.active ? "Untrack" : "Track"}
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* REQ-203: State glossary — one learn-once reference, zero JS, keyboard/SR accessible.
                UXR-62B-07: native <details> pattern, real component samples, DayOverrideForm.tsx styling */}
            <details className="mt-3 pt-3 border-t border-[var(--border)]">
              {/* UXR-62B-07: min-h-[44px] tap target on summary */}
              <summary className="text-sm font-medium cursor-pointer min-h-[44px] flex items-center">
                What do these states mean?
              </summary>
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {/* Focus */}
                <li className="flex items-start gap-3 py-2">
                  <span className="shrink-0 flex items-center pt-0.5">
                    {/* UXR-62B-07: real Focus badge markup from the goal rows above */}
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide rounded-full border border-[var(--accent)] text-[var(--accent)] px-1.5 py-0.5">
                      <Bullseye size={14} progress={1} aria-hidden={true} />
                      Focus
                    </span>
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Focus</strong>
                    {" — "}Drives your daily Today plan. Only one goal holds focus at a time.
                  </p>
                </li>
                {/* Tracked */}
                <li className="flex items-start gap-3 py-2">
                  <span className="shrink-0 flex items-center pt-0.5">
                    {/* UXR-62B-07: real Track pill classes (accent-soft = tracked state) */}
                    <span className="text-xs rounded-full border px-2 py-0.5 bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]">
                      Tracked
                    </span>
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Tracked</strong>
                    {" — "}Shows on the calendar and to your coach, and counts toward Reach.
                  </p>
                </li>
                {/* Untracked */}
                <li className="flex items-start gap-3 py-2">
                  <span className="shrink-0 flex items-center pt-0.5">
                    {/* UXR-62B-07: real Untrack pill classes (border/muted = untracked state) */}
                    <span className="text-xs rounded-full border px-2 py-0.5 border-[var(--border)] text-[var(--muted)]">
                      Untracked
                    </span>
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Untracked</strong>
                    {" — "}Parked. Hidden from the calendar, coach, and Reach until you track it again.
                  </p>
                </li>
                {/* Someday */}
                <li className="flex items-start gap-3 py-2">
                  <span className="shrink-0 flex items-center pt-0.5">
                    {/* UXR-62B-07: real Someday chip classes */}
                    <span className="text-xs rounded-full px-2 py-0.5 border border-[var(--border)] text-[var(--muted)]">
                      Someday
                    </span>
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Someday</strong>
                    {" — "}No target date — no countdown and no deadline pressure. Add one anytime.
                  </p>
                </li>
                {/* Plan active */}
                <li className="flex items-start gap-3 py-2">
                  <span className="shrink-0 flex items-center pt-0.5">
                    {/* UXR-62B-07: Pause button style = muted/quiet (appears when plan IS active) */}
                    <span className="text-xs rounded-full border border-[var(--border)] text-[var(--muted)] px-2 py-0.5">
                      Pause
                    </span>
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Plan active</strong>
                    {" — "}Its 12-week plan posts retest days to the calendar on its own schedule.
                  </p>
                </li>
                {/* Plan paused */}
                <li className="flex items-start gap-3 py-2">
                  <span className="shrink-0 flex items-center pt-0.5">
                    {/* UXR-62B-07: Resume button style = accent CTA (appears when plan IS paused) */}
                    <span className="text-xs rounded-full border bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)] px-2 py-0.5">
                      Resume
                    </span>
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Plan paused</strong>
                    {" — "}{"Silences this plan’s retest days. Goal stays tracked — date, coach, Reach intact."}
                  </p>
                </li>
                {/* Reach — UXR-63-20: ≤90-char definition teaching the inversion (higher = harder) */}
                <li className="flex items-start gap-3 py-2" data-testid="reach-glossary-row">
                  <span className="shrink-0 flex items-center pt-0.5">
                    {/* Real Rare chip sample (UXR-63-20) */}
                    <ReachMeter tier="rare" label size="sm" />
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Reach</strong>
                    {" — "}How big an ask a goal is by its date. Higher tiers are harder to hit in time.
                  </p>
                </li>
                {/* Trained — UXR-64-09: explains the trained subline for hinted goals */}
                <li className="flex items-start gap-3 py-2">
                  <span className="shrink-0 flex items-center pt-0.5">
                    <span className="text-xs text-[var(--muted)]">· trained 3d ago</span>
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    <strong className="font-medium text-[var(--foreground)]">Trained</strong>
                    {" — "}A logged workout included one of this goal&apos;s linked exercises.{" "}
                    &ldquo;no training logged&rdquo; means none yet.
                  </p>
                </li>
              </ul>
            </details>
          </>
        )}
      </Card>
    </div>
  );
}
