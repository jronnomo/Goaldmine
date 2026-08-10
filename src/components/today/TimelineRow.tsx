// TimelineRow — SERVER COMPONENT
// One row of the Unified Today timeline (program-views research §7.1):
// status glyph · title (truncating) · optional TypeBadge · fixed-width mark
// lane. The row is ≥44px; the title <Link> is the row's single interactive
// target in v1 (the lane is static — no attribution sheet until the
// ActivityGoalLink read story), so there is no nested-interactive hazard
// (UXR-PV-14 satisfied by construction).
//
// The status glyph is ✓/○ — deliberately NOT ● (● is slot-0's goal identity;
// reusing it for row state would collide with the mark grammar).

import Link from "next/link";
import { MarkLane, type LaneMark } from "@/components/MarkLane";
import { TypeBadge } from "@/components/TypeBadge";
import type { TimelineEntry } from "@/lib/day-rhythm";

export function TimelineRow({
  entry,
  marks,
}: {
  entry: TimelineEntry;
  marks: LaneMark[];
}) {
  return (
    <li data-testid={`timeline-row-${entry.id}`} className="flex items-center gap-2">
      <Link
        href={entry.href}
        className="flex flex-1 min-w-0 items-center gap-2 min-h-[44px] rounded-lg px-1 hover:bg-[var(--accent-soft)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span
          aria-hidden
          className={`shrink-0 text-sm ${
            entry.filled ? "text-[var(--success)]" : "text-[var(--muted)]"
          }`}
        >
          {entry.filled ? "✓" : "○"}
        </span>
        <span className="flex-1 min-w-0 truncate text-sm">
          <span className={`font-medium ${entry.filled ? "text-[var(--muted)]" : ""}`}>
            {entry.title}
          </span>
          {entry.detail && (
            <span className="text-xs text-[var(--muted)]"> · {entry.detail}</span>
          )}
          <span className="sr-only">{entry.filled ? " — done" : " — not logged yet"}</span>
        </span>
        {entry.itemType && <TypeBadge type={entry.itemType} />}
      </Link>
      <MarkLane marks={marks} itemId={entry.id} />
    </li>
  );
}
