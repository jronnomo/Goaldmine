// MarkLegendStrip — SERVER COMPONENT
// One-line legend that teaches the goal marks once per surface (program-views
// research R4/UXR-PV-12) instead of paying word chips on every row. Renders
// null at ≤1 identity — a single-goal surface has nothing to disambiguate.

import { GoalMark } from "@/components/GoalMark";
import type { GoalIdentity } from "@/lib/goal-identity";

export function MarkLegendStrip({ identities }: { identities: GoalIdentity[] }) {
  if (identities.length <= 1) return null;
  const shaped = identities.filter((i) => i.shape !== null);
  const overflow = identities.length - shaped.length;
  return (
    <p
      data-testid="mark-legend-strip"
      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)]"
    >
      {shaped.map((identity) => (
        <span key={identity.goalId} className="inline-flex items-center gap-1 min-w-0">
          <GoalMark identity={identity} state="logged" size={11} />
          <span className="truncate">{identity.label}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span>
          +{overflow} more {overflow === 1 ? "goal" : "goals"}
        </span>
      )}
    </p>
  );
}
