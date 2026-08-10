// MarkLane — SERVER COMPONENT
// The fixed-width right-hand claim lane of a Unified Today timeline row
// (program-views research R3/UXR-PV-10/11): up to GOAL_MARK_SLOT_CAP shaped
// marks + a bare `+N` for overflow identities, right-aligned so the lanes
// read as a column across rows. Renders null when the row serves no goals.
//
// v1 is non-interactive (no attribution sheet yet — that story reads
// ActivityGoalLink rows). The marks are aria-hidden; a words-only summary is
// provided for screen readers (precedent: AssayTargetRows).

import { GoalMark, type GoalMarkState } from "@/components/GoalMark";
import type { GoalIdentity } from "@/lib/goal-identity";

export type LaneMark = { identity: GoalIdentity; state: GoalMarkState };

export function MarkLane({
  marks,
  itemId,
  size = 14,
}: {
  marks: LaneMark[];
  itemId: string;
  size?: number;
}) {
  if (marks.length === 0) return null;

  // Slot order keeps every lane's marks in the same x-order (position
  // constancy — you can read a column of ● down the page).
  const ordered = [...marks].sort((a, b) => a.identity.slot - b.identity.slot);
  const shaped = ordered.filter((m) => m.identity.shape !== null);
  const overflow = ordered.length - shaped.length;

  const words = ordered
    .map((m) => `${m.identity.label} ${m.state === "logged" ? "logged" : "claimed"}`)
    .join(", ");

  return (
    <span
      data-testid={`mark-lane-${itemId}`}
      className="flex w-[64px] shrink-0 items-center justify-end gap-1"
    >
      {shaped.map((m) => (
        <GoalMark
          key={m.identity.goalId}
          identity={m.identity}
          state={m.state}
          size={size}
          data-testid={`mark-${m.identity.goalId}-${itemId}`}
        />
      ))}
      {overflow > 0 && (
        <span aria-hidden className="text-[10px] text-[var(--muted)] tabular-nums">
          +{overflow}
        </span>
      )}
      <span className="sr-only">
        Counts toward {ordered.length} {ordered.length === 1 ? "goal" : "goals"}: {words}.
      </span>
    </span>
  );
}
