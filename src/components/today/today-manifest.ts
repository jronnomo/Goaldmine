// Today-page section manifest (today-page-ia research, UXR-TIA-05/06).
// The page builds a keyed node map; TODAY_SECTION_ORDER is the single source
// of truth for vertical order — a literal table of contents, deliberately NOT
// a priority field with a runtime sort (UXR-TIA-05: a sort destroys the
// table-of-contents benefit and invites persisted per-user ordering).
//
// Keys are stable string literals, never array indexes (UXR-TIA-06): index
// keys would re-key subtrees whenever a conditional section appears or
// disappears, unmounting everything below.
//
// Non-goal (UXR-TIA-31): never wrap the "timeline" section (TodayTimeline) in
// a CollapsibleCard — its permanently-mounted aria-live region would be
// removed from the accessibility tree inside content-visibility:hidden
// content, silently dropping future announcements.

import type { ReactNode } from "react";

// The "Fuel Rail + Weight Ladder" order (today-page-ia §2.2, with the
// FuelRail at the owner-directed position immediately AFTER the timeline —
// the report's own A′ variant — so the approved centerpiece keeps its rows
// above the fold). ACT zone through "session"; TRACK zone after the divider.
// CUT from the manifest (UXR-TIA-14/25): the FeasibilityReadout Card (Reach
// survives as the Tier-4 chip riding the hero eyeline), the Nutrition Card
// (its scalar IS the FuelRail; detail lives at /nutrition + the Log sheet),
// and Recent workouts (strict subset of /history take:50).
export const TODAY_SECTION_ORDER = [
  "character",
  "other-goals",
  "hero",
  "timeline",
  "fuel-rail",
  "baseline-prominent",
  "session",
  "zone-divider",
  "deferred-lid",
  "baselines-completed-lid",
] as const;

export type TodaySectionKey = (typeof TODAY_SECTION_ORDER)[number];

/**
 * Order the page's section nodes by TODAY_SECTION_ORDER, dropping absent
 * (null/undefined/false) sections. Pure — unit-tested for order invariants.
 */
export function orderedTodaySections(
  nodes: Partial<Record<TodaySectionKey, ReactNode>>,
): { key: TodaySectionKey; node: ReactNode }[] {
  return TODAY_SECTION_ORDER.filter(
    (key) => nodes[key] != null && nodes[key] !== false,
  ).map((key) => ({ key, node: nodes[key]! }));
}
