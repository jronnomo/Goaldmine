// src/components/goal-story/StoryTimeline.tsx
// Server component. Styled div list per ProjectTrendsView.tsx precedent — NO
// new chart type. Renders the plan's phase bands (name, week range, calendar
// dates) with revisions interleaved chronologically: a revision buckets into
// the phase whose [startKey, endKey] contains its createdAtKey; a revision
// that lands outside every phase's window (e.g. logged before the plan's
// first phase started, or a template with irregular phase coverage) falls
// into a trailing "Other revisions" list instead of being silently dropped.
//
// S5 (architecture-blueprint-v2.md, binding): this timeline is intentionally
// triggerNote-FREE — GoalStory.timeline crosses the get_goal_story MCP tool
// boundary, where triggerNoteId can point at a private note type. The
// restored Changelog card elsewhere on this page (PlanChangelog) is the
// full-fidelity same-tenant view with triggerNote excerpts; this component
// is the other, deliberately note-free, half of that split — badge styling
// idiom (badgeClass below) is duplicated from PlanChangelog.tsx rather than
// imported, since PlanChangelog doesn't export it.

import { Card } from "@/components/Card";
import { parseDateKey, USER_TZ } from "@/lib/calendar-core";
import type { GoalStory } from "@/lib/goal-story-core";

type Timeline = NonNullable<GoalStory["timeline"]>;
type Revision = Timeline["revisions"][number];

function fmtDate(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: USER_TZ,
  }).format(parseDateKey(key));
}

// Duplicated from PlanChangelog.tsx's badgeClass — same styling idiom, kept
// local since PlanChangelog doesn't export it and this component must stay
// triggerNote-free (no reason to couple to that module beyond the idiom).
function badgeClass(source: string): string {
  switch (source) {
    case "claude":
      return "border-[var(--accent)]/40 text-[var(--accent)]";
    case "note":
      return "border-[var(--warning)]/40 text-[var(--warning)]";
    default:
      return "border-[var(--border)] text-[var(--muted)]";
  }
}

function RevisionRow({ r }: { r: Revision }) {
  return (
    <li className="rounded-lg border border-[var(--border)] p-2 text-xs space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{r.summary}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 border ${badgeClass(r.triggerSource)}`}>
          {r.triggerSource}
        </span>
      </div>
      <p className="text-[var(--muted)]">{fmtDate(r.createdAtKey)}</p>
      {r.reasoning && (
        <details>
          <summary className="text-[var(--accent)] cursor-pointer">Reasoning</summary>
          <p className="whitespace-pre-wrap mt-1 text-[var(--muted)]">{r.reasoning}</p>
        </details>
      )}
    </li>
  );
}

export function StoryTimeline({ timeline }: { timeline: GoalStory["timeline"] }) {
  if (!timeline) return null;

  const phases = [...timeline.phases].sort((a, b) => a.weekStart - b.weekStart);
  const buckets: Revision[][] = phases.map(() => []);
  const leftover: Revision[] = [];
  for (const r of timeline.revisions) {
    const idx = phases.findIndex((p) => r.createdAtKey >= p.startKey && r.createdAtKey <= p.endKey);
    if (idx === -1) leftover.push(r);
    else buckets[idx]!.push(r);
  }
  const byDate = (a: Revision, b: Revision) => a.createdAtKey.localeCompare(b.createdAtKey);
  for (const b of buckets) b.sort(byDate);
  leftover.sort(byDate);

  return (
    <Card title="Plan timeline">
      <p className="text-xs text-[var(--muted)] mb-3">
        {timeline.planName} · {timeline.weeksTotal} weeks · started {fmtDate(timeline.startedOnKey)}
      </p>
      <ul className="space-y-3">
        {phases.map((phase, i) => (
          <li
            key={`${phase.name}-${phase.weekStart}`}
            className="rounded-lg border border-[var(--border)] p-3 space-y-2"
          >
            <div>
              <p className="font-medium text-sm">{phase.name}</p>
              <p className="text-xs text-[var(--muted)]">
                Weeks {phase.weekStart}–{phase.weekEnd} · {fmtDate(phase.startKey)} –{" "}
                {fmtDate(phase.endKey)}
              </p>
            </div>
            {buckets[i]!.length > 0 && (
              <ul className="space-y-2">
                {buckets[i]!.map((r) => (
                  <RevisionRow key={r.id} r={r} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {leftover.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-2">
            Other revisions
          </p>
          <ul className="space-y-2">
            {leftover.map((r) => (
              <RevisionRow key={r.id} r={r} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
