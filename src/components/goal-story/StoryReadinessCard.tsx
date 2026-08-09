// src/components/goal-story/StoryReadinessCard.tsx
// Server component — no "use client" (ReadinessChart is the client leaf).
// Always renders a card: the frozen/live readiness-over-time arc, or a muted
// hint when no series was captured (legacy achieved goal, or a zero-target
// goal never had one to sample). Never omitted — see GoalStorySection.
//
// UXR-GCU-51 fix (goal-celebration-upgrade.md §8.5, report 10.5):
// `readinessSeries === null` is ambiguous — it means EITHER "zero-target
// goal" (there was never anything to sample) OR "legacy pre-freeze
// completion" (targets existed but the series wasn't captured yet). The old
// copy ("reopen and re-complete to record it") only makes sense for the
// second case; for a zero-target goal there is nothing to record, ever, no
// matter how many times it's reopened. Disambiguate via `targetsTotal`
// (threaded from `story.targets.length` by GoalStorySection) rather than
// guessing from `series` alone.

import { Card } from "@/components/Card";
import { ReadinessChart } from "@/components/ReadinessChart";
import type { GoalStory } from "@/lib/goal-story-core";

export function StoryReadinessCard({
  series,
  targetsTotal,
}: {
  series: GoalStory["readinessSeries"];
  /** `story.targets.length` — 0 means this goal never had targets to sample. */
  targetsTotal: number;
}) {
  return (
    <Card title="Readiness arc">
      {series && series.length > 0 ? (
        // dateKey strings ("yyyy-mm-dd") are already valid ISO date strings —
        // ReadinessChart's Point.date only ever passes through `new Date(...)`,
        // so no reformatting is needed crossing this boundary.
        <ReadinessChart
          data={series.map((p) => ({ date: p.dateKey, score: p.score }))}
          ariaLabel="Readiness arc chart"
        />
      ) : targetsTotal === 0 ? (
        <p className="text-sm text-[var(--muted)]">No measurable targets were set on this goal.</p>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Readiness arc not captured for this completion — reopen and re-complete the goal to
          record it.
        </p>
      )}
    </Card>
  );
}
