// Calendar marker icon — renders a legend entry's glyph identically wherever
// it appears (day cells, the legend list, the detail panel) so the calendar
// always matches the goal's custom legend.
//
// `trained` keeps the Bullseye SVG (the brand target motif); its legend icon
// string is decorative. Every other kind renders the legend entry's own icon,
// which is goal-specific — set per flavor or via the update_goal_legend MCP
// tool — so a hike goal shows 🥾 / ⛏️ / 🏔️ and a strength goal shows 🏋️ / 🏆.
//
// `ForeignGoalMarker` is the claim-ring variant for non-focus ("foreign") goal
// markers — UXR-62-01 (outline ring shape channel) + UXR-62-02 (opacity channel).
// Bullseye stays EXCLUSIVE to focus training and is never rendered here.
import { Bullseye } from "@/components/Bullseye";
import type { LegendEntry } from "@/lib/legend";

export function MarkerIcon({
  entry,
  size = 14,
}: {
  entry: LegendEntry;
  size?: number;
}) {
  if (entry.kind === "trained") {
    // Bullseye needs size >= 14 to render its red center ring.
    return <Bullseye filled size={Math.max(size, 14)} aria-hidden />;
  }
  return (
    <span
      aria-hidden
      title={entry.label}
      className={`leading-none ${entry.kind === "hike-planned" ? "opacity-40" : ""}`}
      style={{ fontSize: size }}
    >
      {entry.icon}
    </span>
  );
}

/**
 * Claim-ring variant for non-focus (foreign) goal markers on the calendar and legend.
 *
 * UXR-62-01: outline (not border) so the ring is inset and doesn't reflow the tight
 *            gap-0.5 marker row; outline-offset creates a tiny breathing gap.
 * UXR-62-02: opacity ~0.65 as a redundant second channel (survives if ring softens
 *            at 13px on certain devices / themes).
 * Bullseye stays EXCLUSIVE to focus training — this component never renders it.
 */
export function ForeignGoalMarker({
  icon,
  label,
  size = 13,
}: {
  icon: string;
  label: string;
  size?: number;
}) {
  return (
    <span
      data-testid="cal-foreign-marker"
      aria-hidden
      title={label}
      className="leading-none inline-flex items-center justify-center opacity-[0.65]"
      style={{
        fontSize: size,
        // UXR-62-01: claim-ring — 1px muted outline, inset via outline (not border)
        outline: "1px solid var(--muted)",
        outlineOffset: "1px",
        borderRadius: "9999px",
      }}
    >
      {icon}
    </span>
  );
}
