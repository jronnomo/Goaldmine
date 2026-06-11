// src/components/StackReachCard.tsx
// Stack-level Reach card — sits above the goals list on /goals.
// Server-safe (no "use client"). Presentational only — receives StackRarity, renders nothing when tier is null.
//
// UXR-63-08: StackRarityCard above the list; quiet for Common–Rare; escalates to
//   warning-banner recipe for Epic/Legendary + plain load-bump reason line
// UXR-63-13: banners cap at --warning, NEVER --danger; recipe = border + border-l-[3px] + --foreground body + ◣
// UXR-63-14: warning wash = color-mix(in srgb, var(--warning) 8%, var(--card))
// UXR-63-15: exact copy strings from §0 of the UXR report
// UXR-63-16: one ambient card — not a toast, never re-fires
// UXR-63-21: no animation

import { ReachMeter } from "@/components/ReachMeter";
import type { StackRarity } from "@/lib/rarity-core";

export function StackReachCard({ stack }: { stack: StackRarity }) {
  // Render nothing when unrated (all someday / no dated active goals) — UXR-63-08
  if (stack.tier === null) return null;

  const isEpic = stack.tier === "epic";
  const isLegendary = stack.tier === "legendary";
  const isEscalated = isEpic || isLegendary;

  // UXR-63-15: exact copy strings from §0
  const bannerHeading = isLegendary ? "Legendary reach." : "Epic reach.";
  const bannerBody = isLegendary
    ? "Your current slate is near-impossible in the time set. Talk to your coach about extending a deadline or pausing a goal."
    : "Your tracked goals add up to a hard ask right now. Consider spacing out deadlines, or pausing one with your coach.";

  if (isEscalated) {
    // UXR-63-13/14: warning-banner recipe — border + border-l-[3px] + wash + ◣ + --foreground body
    return (
      <div
        data-testid="stack-rarity-card-escalated"
        className="rounded-2xl border border-[var(--warning)] border-l-[3px] p-4 space-y-2"
        style={{ backgroundColor: "color-mix(in srgb, var(--warning) 8%, var(--card))" }}
      >
        <div className="flex items-center gap-2">
          {/* UXR-63-13: ◣ glyph in --warning, body in --foreground for AA (UXR-63-22) */}
          <span className="text-[var(--warning)]" aria-hidden>◣</span>
          <ReachMeter tier={stack.tier} label size="sm" />
        </div>
        <p className="text-sm text-[var(--foreground)]">
          <strong>{bannerHeading}</strong>{" "}{bannerBody}
        </p>
        {/* Load-bump reason line — muted, mirrors loadBumpReasons (UXR-63-08) */}
        {stack.loadBumpReasons.length > 0 && (
          <p className="text-xs text-[var(--muted)]">
            {stack.loadBumpReasons.join(" · ")}
          </p>
        )}
      </div>
    );
  }

  // Quiet state (Common–Rare) — meter + tier word + optional load-bump reasons
  return (
    <div
      data-testid="stack-rarity-card"
      className="flex items-center gap-2 px-1 py-0.5"
    >
      <span className="text-xs text-[var(--muted)]">Stack reach</span>
      <ReachMeter tier={stack.tier} label size="sm" />
      {stack.loadBumpReasons.length > 0 && (
        <span className="text-xs text-[var(--muted)] ml-1">
          · {stack.loadBumpReasons[0]}
        </span>
      )}
    </div>
  );
}
