// src/components/goal-story/StoryBaselineArcs.tsx
// Server component — no "use client" (HistoryChart is the client leaf).
// Fitness-only: one HistoryChart per baseline test, clipped to the goal's
// window by goal-story.ts. S6 (architecture-blueprint-v2.md): baseline has no
// goalId column — these are the user's full test history for that test name,
// clipped, same semantics readiness itself uses.

import { Card } from "@/components/Card";
import { HistoryChart } from "@/components/HistoryChart";
import type { GoalStory } from "@/lib/goal-story-core";

export function StoryBaselineArcs({ arcs }: { arcs: GoalStory["baselineArcs"] }) {
  if (arcs.length === 0) return null;

  return (
    <>
      {arcs.map((arc) => (
        <Card key={arc.testName} title={arc.testName}>
          <HistoryChart
            data={arc.points.map((p) => ({ date: p.dateKey, value: p.value }))}
            units={arc.units}
            ariaLabel={`${arc.testName} test progression`}
          />
        </Card>
      ))}
    </>
  );
}
