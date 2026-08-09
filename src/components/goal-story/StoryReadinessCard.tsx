// src/components/goal-story/StoryReadinessCard.tsx
// Server component — no "use client" (ReadinessChart is the client leaf).
// Always renders a card: the frozen/live readiness-over-time arc, or a muted
// hint when no series was captured (legacy achieved goal, or a zero-target
// goal never had one to sample). Never omitted — see GoalStorySection.

import { Card } from "@/components/Card";
import { ReadinessChart } from "@/components/ReadinessChart";
import type { GoalStory } from "@/lib/goal-story-core";

export function StoryReadinessCard({ series }: { series: GoalStory["readinessSeries"] }) {
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
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Readiness arc not captured for this completion — reopen and re-complete the goal to
          record it.
        </p>
      )}
    </Card>
  );
}
