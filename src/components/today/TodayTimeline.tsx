// TodayTimeline — SERVER COMPONENT
// The Unified Today timeline card (issue #288; program-views research §7.1,
// "Marked Lane" direction). ONE timeline for the whole active Program: every
// row carries every goal claim it serves in a fixed-width right-hand mark
// lane — never per-goal sections; a shared activity appears once with
// multiple marks (RFC §7 / UXR-PV-09, binding).
//
// Zero-Program tenants: this component renders NULL (no DOM at all) when
// there are no identities — the Today page is byte-identical to its
// pre-timeline render for them (asserted in TodayTimeline.test.ts).
//
// Mark fill is server truth derived from the day's own data (no optimistic
// state, UXR-PV-20); v1 fills a row's marks together — per-goal link receipts
// arrive with the ActivityGoalLink read story. The aria-live region is
// mounted (empty) from the first paint so the future fan-out announcement has
// an existing element to land in (UXR-PV-19).

import { Card } from "@/components/Card";
import { MarkLegendStrip } from "@/components/MarkLegendStrip";
import { TimelineRow } from "@/components/today/TimelineRow";
import type { LaneMark } from "@/components/MarkLane";
import type { GoalIdentity } from "@/lib/goal-identity";
import type { TimelineEntry } from "@/lib/day-rhythm";

export function TodayTimeline({
  identities,
  entries,
}: {
  identities: GoalIdentity[];
  entries: TimelineEntry[];
}) {
  // Zero-Program guard: no active member goals → no timeline, no DOM.
  if (identities.length === 0) return null;

  const identityById = new Map(identities.map((i) => [i.goalId, i]));
  const marksFor = (entry: TimelineEntry): LaneMark[] =>
    entry.goalIds
      .map((goalId) => identityById.get(goalId))
      .filter((i): i is GoalIdentity => i !== undefined)
      .map((identity) => ({
        identity,
        state: entry.filled ? ("logged" as const) : ("claimed" as const),
      }));

  return (
    <Card title="Today" data-testid="today-timeline">
      <div className="space-y-2">
        <MarkLegendStrip identities={identities} />
        {entries.length === 0 ? (
          <p data-testid="timeline-empty" className="text-sm text-[var(--muted)]">
            Nothing scheduled today. Rest is part of the program — log anything
            and it lands here.
          </p>
        ) : (
          <ol className="divide-y divide-[var(--border)]">
            {entries.map((entry) => (
              <TimelineRow key={entry.id} entry={entry} marks={marksFor(entry)} />
            ))}
          </ol>
        )}
        {/* Always-mounted live region: a live region only announces content
            inserted into an element that already existed (UXR-PV-19). */}
        <p
          aria-live="polite"
          role="status"
          data-testid="timeline-live-region"
          className="text-xs min-h-[1rem] text-[var(--muted)]"
        />
      </div>
    </Card>
  );
}
