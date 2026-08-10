// GoalMark — SERVER COMPONENT
// One goal's monochrome geometric identity mark (program-views research
// UXR-PV-02/05/13). State reuses the Bullseye's own semantic: hollow ○ □ △ =
// claimed today, filled ● ■ ▲ = logged/completed today. The glyph is
// aria-hidden — words-only descriptions live on the enclosing lane
// (UXR-PV-11) — and the hue is decoration only: shape carries identity
// (iso-luminant palette, research F1).

import type { GoalIdentity } from "@/lib/goal-identity";

export type GoalMarkState = "claimed" | "logged";

export function GoalMark({
  identity,
  state,
  size = 14,
  "data-testid": testId,
}: {
  identity: GoalIdentity;
  state: GoalMarkState;
  size?: number;
  "data-testid"?: string;
}) {
  // Overflow identities (slot ≥ cap) have no glyph of their own — the lane's
  // +N bucket represents them (see MarkLane).
  if (identity.shape === null) return null;
  return (
    <span
      aria-hidden
      data-testid={testId}
      data-mark-state={state}
      className="leading-none shrink-0"
      style={{ color: identity.hue, fontSize: `${size}px` }}
    >
      {state === "logged" ? identity.glyphFilled : identity.glyphHollow}
    </span>
  );
}
