// src/components/BetweenGoalsToday.tsx
//
// "Between goals" Today state (fix for the newbie-card regression): a veteran
// user who just completed their only focus goal — before choosing a new one —
// has program === null AND focusGoal === null, which is indistinguishable
// from a brand-new user by those two signals alone. This component renders
// instead of the "Get started" card whenever the user has completion or
// active-goal history, so Today stays calm and specific rather than reverting
// to onboarding copy.
//
// Deliberately NOT the celebratory GoalCompletedCelebration ceremony —
// QuestCard on THIS page owns the one-shot completion moment; a returning
// visit to Today (the common case here, since completion itself happens on
// the goal detail page) must read as calm and settled, never re-celebrate.
//
// Server component, props-only (no getDb/Prisma import here) — the two
// server-action imports below (setFocusGoal) are the same "use server"
// exports /goals already uses for its Focus pill; reused verbatim, not
// forked. Kept pure/props-only otherwise so it renders identically under
// react-dom/server for the fixture-based render-smoke test (mirrors
// GoalStorySection.tsx / GoalStorySection.test.ts).

import Link from "next/link";
import { Card } from "@/components/Card";
import { MarkerIcon } from "@/components/MarkerIcon";
import { resolveLegend, findLegendEntry } from "@/lib/legend";
import { setFocusGoal } from "@/lib/goal-actions";
import { parseCompletionSnapshot } from "@/lib/goal-completion-core";
import { USER_TZ, parseDateKey } from "@/lib/calendar";

export type BetweenGoalsActiveGoal = {
  id: string;
  objective: string;
  kind: string;
  targetDate: Date | null;
  isFocus: boolean;
  active: boolean;
};

export type BetweenGoalsAchieved = {
  id: string;
  objective: string;
  completedAt: Date | null;
  completionSnapshot: unknown;
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: USER_TZ,
});

const shortDateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: USER_TZ,
});

const linkClass =
  "text-sm font-medium text-[var(--accent)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded";

function CompletionAckCard({ achieved }: { achieved: BetweenGoalsAchieved }) {
  const snapshot = parseCompletionSnapshot(achieved.completionSnapshot);
  const completedLabel = snapshot
    ? dateFmt.format(parseDateKey(snapshot.completedDateKey))
    : achieved.completedAt
      ? dateFmt.format(achieved.completedAt)
      : null;

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">🏆</span>
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Goal completed</span>
        </span>
      }
    >
      <p className="text-sm">
        You completed{" "}
        <strong className="font-medium">{snapshot?.objective ?? achieved.objective}</strong>. The
        story and reflection live on its trophy page.
      </p>
      {(completedLabel || snapshot) && (
        <p className="text-xs text-[var(--muted)] mt-2">
          {completedLabel}
          {snapshot?.readiness && ` · readiness ${snapshot.readiness.score}/100`}
          {snapshot && ` · targets ${snapshot.targetsMet}/${snapshot.targetsTotal}`}
          {snapshot && ` · +${snapshot.xpAwardedAtCompletion} XP`}
        </p>
      )}
      <Link href={`/goals/${achieved.id}`} className={`mt-3 inline-block ${linkClass}`}>
        View the story →
      </Link>
    </Card>
  );
}

function NextFocusRow({ goal }: { goal: BetweenGoalsActiveGoal }) {
  const legend = resolveLegend({ kind: goal.kind });
  const glyph = findLegendEntry(legend, "goal-date");
  const setFocus = setFocusGoal.bind(null, goal.id);

  return (
    <li className="flex items-center gap-3 py-3">
      <span className="shrink-0" aria-hidden="true">
        {glyph && <MarkerIcon entry={glyph} size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{goal.objective}</p>
        {goal.targetDate && (
          <p className="text-xs text-[var(--muted)]">{shortDateFmt.format(goal.targetDate)}</p>
        )}
      </div>
      <form action={setFocus} className="shrink-0">
        <button
          type="submit"
          className="text-xs rounded-full border px-3 min-h-[44px] border-[var(--accent)] text-[var(--accent)]"
        >
          Focus
        </button>
      </form>
    </li>
  );
}

export function BetweenGoalsToday({
  activeGoals,
  latestAchieved,
}: {
  activeGoals: BetweenGoalsActiveGoal[];
  latestAchieved: BetweenGoalsAchieved | null;
}) {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {latestAchieved && <CompletionAckCard achieved={latestAchieved} />}

      {activeGoals.length > 0 ? (
        <Card title="Choose your next focus">
          <ul className="divide-y divide-[var(--border)]">
            {activeGoals.map((g) => (
              <NextFocusRow key={g.id} goal={g} />
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <Link
              href="/goals"
              className="hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
            >
              Manage goals →
            </Link>
            <Link
              href="/goals#new-goal"
              className="hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
            >
              or create a new goal
            </Link>
          </div>
        </Card>
      ) : (
        <Card title="Start your next goal">
          <p className="text-sm text-[var(--muted)]">
            No active goal is set right now. Add one whenever you&apos;re ready — a date, a
            metric, or both.
          </p>
          <Link href="/goals#new-goal" className={`mt-3 inline-block ${linkClass}`}>
            Start your next goal →
          </Link>
        </Card>
      )}
    </div>
  );
}
