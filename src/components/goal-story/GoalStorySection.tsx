// src/components/goal-story/GoalStorySection.tsx
// Server orchestrator — mounted on the trophy page (goals/[id]/page.tsx)
// after the Reflection card. Renders each sub-card from the GoalStory bundle,
// skipping the ones that are empty for this goal's kind (fitness vs project)
// or state. `StoryReadinessCard` is the one exception — it always renders
// (with a muted hint when the series wasn't captured), per REQ-006(c).
//
// `story === null` means the goal has no story to tell yet (getGoalStory
// only returns null for a not-found goal — the caller on goals/[id]/page.tsx
// already resolved the goal, so this is defensive) — omit the whole section.

import type { GoalStory } from "@/lib/goal-story-core";
import { StoryReadinessCard } from "./StoryReadinessCard";
import { StoryTargetsTable } from "./StoryTargetsTable";
import { StoryBaselineArcs } from "./StoryBaselineArcs";
import { StoryTimeline } from "./StoryTimeline";
import { StoryHikeArc } from "./StoryHikeArc";
import { StoryMetricArcs } from "./StoryMetricArcs";

export function GoalStorySection({ story }: { story: GoalStory | null }) {
  if (!story) return null;

  return (
    <>
      <StoryReadinessCard series={story.readinessSeries} targetsTotal={story.targets.length} />
      <StoryTargetsTable targets={story.targets} />
      <StoryBaselineArcs arcs={story.baselineArcs} />
      <StoryTimeline timeline={story.timeline} />
      <StoryHikeArc hikes={story.hikeArc} />
      <StoryMetricArcs arcs={story.metricArcs} />
    </>
  );
}
