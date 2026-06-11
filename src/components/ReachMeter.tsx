// src/components/ReachMeter.tsx
// Presentational 5-segment Reach meter. Client-safe — imports rarity-core types only.
// No DB, no "use client", no new client components.
//
// UXR-63-01: on-screen axis noun = "Reach" (engine/MCP keep "rarity")
// UXR-63-03: glyph = discrete 5-segment fill; fill count = tier ordinal; empty = --border
// UXR-63-04/UXR-63-18: 3-hue ramp — Common/Uncommon --muted, Rare --accent,
//   Epic/Legendary --warning (blueprint placeholder color map overruled per UXR-63-18)
// UXR-63-05: ~3px×9px segments (sm), ~4px×12px (md), gap ~1.5px, radius 1px
// UXR-63-06: Bullseye is reserved for focus; meter is a separate glyph
// UXR-63-19: Someday/unrated — 5 empty --border segments; aria-label "Feasibility not yet rated"
// UXR-63-21: no animation
// UXR-63-22: tier word ≥12px; --warning on cream ~4.6:1 AA edge — keep text ≥12px

import type { RarityTier } from "@/lib/rarity-core";

type TierConfig = {
  fill: number;
  color: string;
  label: string;
  bold: boolean;
};

// UXR-63-18: 3-hue ramp replaces blueprint placeholder map
const TIER_CONFIG: Record<RarityTier, TierConfig> = {
  common:    { fill: 1, color: "var(--muted)",   label: "Common",    bold: false },
  uncommon:  { fill: 2, color: "var(--muted)",   label: "Uncommon",  bold: false },
  rare:      { fill: 3, color: "var(--accent)",  label: "Rare",      bold: false },
  epic:      { fill: 4, color: "var(--warning)", label: "Epic",      bold: false },
  // UXR-63-04: Legendary word bold — second channel distinguishing 5 from 4 at subline scale
  legendary: { fill: 5, color: "var(--warning)", label: "Legendary", bold: true  },
};

export type ReachMeterProps = {
  tier: RarityTier | null;
  /** Show the tier word alongside the segments (UXR-63-02). Default false. */
  label?: boolean;
  /** Segment size: sm ~3×9px for sublines, md ~4×12px for cards. Default sm. */
  size?: "sm" | "md";
  /** title= attribute for desktop hover — used for coach-override annotation (UXR-63-11) */
  title?: string;
};

export function ReachMeter({ tier, label = false, size = "sm", title }: ReachMeterProps) {
  const config = tier ? TIER_CONFIG[tier] : null;
  const fillCount = config?.fill ?? 0;
  const fillColor = config?.color ?? "var(--muted)";

  // UXR-63-05: segment geometry
  const segW = size === "md" ? "w-[4px]" : "w-[3px]";
  const segH = size === "md" ? "h-[12px]" : "h-[9px]";
  const gapClass = size === "md" ? "gap-[2px]" : "gap-[1.5px]";

  // UXR-63-19: unrated; UXR-63-08: roomy surface always includes word
  const ariaLabel = tier
    ? `Reach: ${config!.label} — ${fillCount} of 5`
    : "Feasibility not yet rated";

  return (
    <span
      className={`inline-flex items-center ${gapClass}`}
      title={title}
      aria-label={ariaLabel}
      role="img"
    >
      {/* 5 discrete segments (UXR-63-03) */}
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block ${segW} ${segH} rounded-[1px]`}
          style={{ backgroundColor: i < fillCount ? fillColor : "var(--border)" }}
          aria-hidden
        />
      ))}
      {/* Optional tier word — bold only at Legendary (UXR-63-04) */}
      {label && (
        <span
          className={`ml-1.5 text-xs${config?.bold ? " font-bold" : ""}`}
          style={{ color: tier ? fillColor : "var(--muted)" }}
          aria-hidden
        >
          {tier ? config!.label : "—"}
        </span>
      )}
    </span>
  );
}
