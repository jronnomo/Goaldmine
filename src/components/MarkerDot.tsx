// Calendar marker dot — the single compact per-kind glyph. Rendered in both
// calendar day cells and the legend list (and detail panel) so the three
// surfaces always agree on what a marker looks like.
//
// `trained` keeps the Bullseye motif (the brand target); `goal-date` is the
// one summit day so it gets the mountain glyph; everything else is a small
// uniform colored dot. Colors map to semantic tokens in globals.css.
import { Bullseye } from "@/components/Bullseye";
import type { LegendKind } from "@/lib/legend";

const DOT_COLOR: Record<
  Exclude<LegendKind, "trained" | "goal-date">,
  string
> = {
  "hike-completed": "bg-[var(--success)]",
  "hike-planned": "bg-[var(--success)] opacity-40",
  override: "bg-[var(--warning)]",
  baseline: "bg-[var(--accent)]",
};

export function MarkerDot({
  kind,
  size = 8,
}: {
  kind: LegendKind;
  size?: number;
}) {
  if (kind === "trained") {
    return <Bullseye filled size={size + 2} aria-hidden />;
  }
  if (kind === "goal-date") {
    return (
      <span
        aria-hidden
        className="leading-none"
        style={{ fontSize: size + 3 }}
      >
        🏔️
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${DOT_COLOR[kind]}`}
      style={{ width: size, height: size }}
    />
  );
}
