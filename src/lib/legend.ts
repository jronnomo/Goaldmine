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
import { presentationForGoal } from "@/lib/goal-presentation";

// Why "skipped" is deliberately NOT a LegendKind:
//
//   1. Closed-enum ripple: adding a new LegendKind requires a render branch in
//      CalendarMonth.tsx AND coach-facing coaching in every tool that mentions
//      legend kinds. A skipped day is a transient UI acknowledgement, not a
//      goal-configured semantic category the user would put in their legend.
//   2. markersFor suppression: CalendarMonth only renders markers whose kind
//      exists in the goal's stored legend. If "skipped" were a kind, goals that
//      pre-date the addition would silently suppress it (no legend entry → no
//      marker) — a confusing invisible state.
//   3. The ✕ glyph is rendered directly in DayCell (REQ-65-4) outside the
//      markersFor / findLegendEntry pipeline, so it always shows regardless of
//      the goal's configured legend.
export const LegendKindSchema = z.enum([
  "trained",
  "hike-completed",
  "hike-planned",
  "override",
  "goal-date",
  "baseline",
  "scheduled-item", // REQ-003: project goal scheduled items on the calendar
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
    "Which render condition this entry drives (closed enum — see src/lib/legend.ts). " +
    "Values: trained, hike-completed, hike-planned, override, goal-date, baseline, scheduled-item.",
  ),
});

export type LegendEntry = z.infer<typeof LegendEntrySchema>;

export const LegendSchema = z.array(LegendEntrySchema);

export type Legend = z.infer<typeof LegendSchema>;

// Default legend for hike-flavored goals (current Mt. Elbert program).
export const DEFAULT_LEGEND: readonly LegendEntry[] = [
  { icon: "●", label: "Trained", kind: "trained" },
  { icon: "🥾", label: "Outdoor day", kind: "hike-completed" },
  { icon: "🥾", label: "Hike planned", kind: "hike-planned" },
  { icon: "⛏️", label: "Custom day", kind: "override" },
  { icon: "🏔️", label: "Goal date", kind: "goal-date" },
  { icon: "◎", label: "Baseline due", kind: "baseline" },
];

// REQ-003 / PRD §3.2.1: fallback legend for project goals with null legend column.
// Avoids requiring a manual update_goal_legend call before calendar markers appear.
// Uses ◆ (U+25C6) per UXR-s4-04; goal-date icon 🎯 per UXR-s4-06.
export const PROJECT_DEFAULT_LEGEND: readonly LegendEntry[] = [
  { icon: "◆", label: "Scheduled item", kind: "scheduled-item" },
  { icon: "🎯", label: "Goal date", kind: "goal-date" },
];

/**
 * Resolve a goal's legend. Returns the goal's stored legend if it parses,
 * otherwise the default. Safe to call with `null`, `undefined`, or a goal
 * row that lacks a legend column entirely.
 */
export function resolveLegend(
  goal: { legend?: unknown; kind?: unknown } | null | undefined,
): readonly LegendEntry[] {
  if (!goal || goal.legend == null) {
    // Route default through the presentation registry so all kind-aware surfaces
    // share one source of truth (PRD legend-via-registry §3.1).
    const legendDefault = presentationForGoal(
      goal && typeof goal.kind === "string" ? { kind: goal.kind } : null,
    ).legendDefault;
    return legendDefault === "project" ? PROJECT_DEFAULT_LEGEND : DEFAULT_LEGEND;
  }
  const parsed = LegendSchema.safeParse(goal.legend);
  return parsed.success ? parsed.data : DEFAULT_LEGEND;
}

export function findLegendEntry(
  legend: readonly LegendEntry[],
  kind: LegendKind,
): LegendEntry | undefined {
  return legend.find((e) => e.kind === kind);
}
