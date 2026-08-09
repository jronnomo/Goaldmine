// src/components/goal-story/StoryMetricArcs.tsx
// Server component — no "use client" (HistoryChart is the client leaf).
// Project-only: one HistoryChart per `log:*` target metric arc. Points already
// arrive in HistoryChart's {date, value, label} shape (getLogMetricSeries via
// goal-story.ts) — same pass-through idiom as ProjectTrendsView.tsx.

import { Card } from "@/components/Card";
import { HistoryChart } from "@/components/HistoryChart";
import type { GoalStory } from "@/lib/goal-story-core";

export function StoryMetricArcs({ arcs }: { arcs: GoalStory["metricArcs"] }) {
  if (arcs.length === 0) return null;

  return (
    <>
      {arcs.map((arc) => (
        <Card key={arc.metric} title={arc.label}>
          {arc.points.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No {arc.label} logged in this window.</p>
          ) : (
            <HistoryChart
              data={arc.points}
              units={arc.units}
              domain={arc.domain}
              ariaLabel={`${arc.label} trend chart`}
            />
          )}
        </Card>
      ))}
    </>
  );
}
