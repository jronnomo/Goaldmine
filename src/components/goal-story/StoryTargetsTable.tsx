// src/components/goal-story/StoryTargetsTable.tsx
// Server component. Zero-query — every value comes straight off
// `GoalStory.targets` (already resolved by goal-story.ts: frozen snapshot
// rows for an achieved goal, live-equivalent rows for an active one).

import { Card } from "@/components/Card";
import type { GoalStory } from "@/lib/goal-story-core";

export function StoryTargetsTable({ targets }: { targets: GoalStory["targets"] }) {
  if (targets.length === 0) return null;

  return (
    <Card title="Targets: start → final">
      <ul className="space-y-2.5">
        {targets.map((t) => (
          <li key={t.metric} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{t.label}</span>
            <span className="text-[var(--muted)] shrink-0 text-xs text-right">
              {t.start ?? "—"} → {t.final ?? "—"} {t.units}
              <span className="mx-1">·</span>
              target {t.target}
            </span>
            <span
              className={`shrink-0 text-sm ${t.met ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
              aria-label={t.met ? "target met" : "target not met"}
            >
              {t.met ? "✓" : "✗"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
