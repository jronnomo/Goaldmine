// Calendar marker icon — renders a legend entry's glyph identically wherever
// it appears (day cells, the legend list, the detail panel) so the calendar
// always matches the goal's custom legend.
//
// `trained` keeps the Bullseye SVG (the brand target motif); its legend icon
// string is decorative. Every other kind renders the legend entry's own icon,
// which is goal-specific — set per flavor or via the update_goal_legend MCP
// tool — so a hike goal shows 🥾 / ⛏️ / 🏔️ and a strength goal shows 🏋️ / 🏆.
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
