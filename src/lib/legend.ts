// Per-goal calendar legend.
//
// The `Goal.legend` Json column stores an array of { icon, label, kind }.
// `kind` drives WHICH cell-render condition the icon attaches to; it is
// intentionally a closed enum because each kind maps to a code-side render
// primitive. Adding new kinds requires both schema-level value + a render
// branch in `src/components/CalendarMonth.tsx`.
//
// `icon` is a short string (emoji or unicode glyph). For `kind: "trained"`
// the icon field is decorative — the calendar always renders the Bullseye
// SVG component for that kind regardless of icon string. The legend itself
// also shows the SVG. The icon string is preserved for symmetry with other
// kinds and is exposed if Claude wants to override it later.
//
// Goals with `legend === null` fall through to DEFAULT_LEGEND below, which
// is tuned for hike-style goals (Mt. Elbert). Powerlifting / marathon /
// snowboard goals will set their own legend via the update_goal_legend MCP
// tool.

import { z } from "zod";

export const LegendKindSchema = z.enum([
  "trained",
  "hike-completed",
  "hike-planned",
  "override",
  "goal-date",
]);

export type LegendKind = z.infer<typeof LegendKindSchema>;

export const LegendEntrySchema = z.object({
  icon: z
    .string()
    .min(1)
    .max(8)
    .describe("Emoji or short glyph rendered in calendar cells and the legend list"),
  label: z
    .string()
    .min(1)
    .max(40)
    .describe("Short human-readable label for the legend list"),
  kind: LegendKindSchema.describe(
    "Which render condition this entry drives (closed enum — see src/lib/legend.ts)",
  ),
});

export type LegendEntry = z.infer<typeof LegendEntrySchema>;

export const LegendSchema = z.array(LegendEntrySchema);

// Default legend for hike-flavored goals (current Mt. Elbert program).
export const DEFAULT_LEGEND: readonly LegendEntry[] = [
  { icon: "●", label: "Trained", kind: "trained" },
  { icon: "🥾", label: "Outdoor day", kind: "hike-completed" },
  { icon: "🥾", label: "Hike planned", kind: "hike-planned" },
  { icon: "★", label: "Custom day", kind: "override" },
  { icon: "🏔️", label: "Goal date", kind: "goal-date" },
];

/**
 * Resolve a goal's legend. Returns the goal's stored legend if it parses,
 * otherwise the default. Safe to call with `null`, `undefined`, or a goal
 * row that lacks a legend column entirely.
 */
export function resolveLegend(
  goal: { legend?: unknown } | null | undefined,
): readonly LegendEntry[] {
  if (!goal || goal.legend == null) return DEFAULT_LEGEND;
  const parsed = LegendSchema.safeParse(goal.legend);
  return parsed.success ? parsed.data : DEFAULT_LEGEND;
}

export function findLegendEntry(
  legend: readonly LegendEntry[],
  kind: LegendKind,
): LegendEntry | undefined {
  return legend.find((e) => e.kind === kind);
}
