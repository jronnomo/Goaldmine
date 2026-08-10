// ReachChip — SERVER COMPONENT. Tier-4: 0px of new vertical space — it rides
// the hero eyeline's already-empty justify-between right slot (today-page-ia
// §2.4). Reuses the exact ReachMeter the /goals surfaces render, so the glyph
// is byte-consistent with /goals/[id]; wraps it in a wayfinding <Link> to the
// goal page (the old FeasibilityReadout Card linked nowhere).
//
// Render this ONLY when a tier exists (UXR-TIA-16) — an unrated goal gets no
// Reach chrome at all, which removes a full Card of apology copy from a new
// user's first screen. Never animated (UXR-63-21).

import Link from "next/link";
import { ReachMeter } from "@/components/ReachMeter";
import type { RarityTier } from "@/lib/rarity-core";

export function ReachChip({
  tier,
  weeksRemaining,
  goalId,
}: {
  tier: RarityTier;
  weeksRemaining: number | null;
  goalId: string;
}) {
  return (
    <Link
      href={`/goals/${goalId}`}
      data-testid="today-reach-chip"
      // min-h + negative-margin idiom (MealEditButton precedent): a 44px tap
      // target inside a 16px line box without growing the eyeline.
      className="flex items-center gap-1.5 shrink-0 min-h-[44px] -my-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <ReachMeter tier={tier} label size="sm" />
      {weeksRemaining != null && (
        <span className="text-xs text-[var(--muted)] tabular-nums">
          {Math.round(weeksRemaining)} wk
        </span>
      )}
    </Link>
  );
}
