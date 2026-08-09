// src/components/goal-story/StoryHikeArc.tsx
// Server component. Fitness-only: this goal's hike history (goalId-scoped),
// clipped to the goal's window by goal-story.ts. Compact rows — no chart
// (hikes are sparse/discrete events, not a dense time series).

import { Card } from "@/components/Card";
import { parseDateKey, USER_TZ } from "@/lib/calendar-core";
import type { GoalStory } from "@/lib/goal-story-core";

function fmtDate(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: USER_TZ,
  }).format(parseDateKey(key));
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function StoryHikeArc({ hikes }: { hikes: GoalStory["hikeArc"] }) {
  if (hikes.length === 0) return null;

  return (
    <Card title="Hikes">
      <ul className="space-y-2">
        {hikes.map((h, i) => (
          <li key={`${h.dateKey}-${i}`} className="text-sm">
            <span className="text-[var(--muted)]">{fmtDate(h.dateKey)}</span>
            <span className="mx-1 text-[var(--muted)]">·</span>
            <span className="font-medium">{h.route}</span>
            <span className="mx-1 text-[var(--muted)]">·</span>
            {h.distanceMi} mi / {h.elevationFt} ft gain
            {h.summitFt !== null && (
              <>
                <span className="mx-1 text-[var(--muted)]">·</span>
                summit {h.summitFt} ft
              </>
            )}
            {h.packWeightLb !== null && (
              <>
                <span className="mx-1 text-[var(--muted)]">·</span>
                pack {h.packWeightLb} lb
              </>
            )}
            <span className="mx-1 text-[var(--muted)]">·</span>
            {fmtDuration(h.durationMin)}
            {h.status !== "completed" && (
              <span className="text-[var(--muted)]"> · {h.status}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
