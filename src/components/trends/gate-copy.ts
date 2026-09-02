// src/components/trends/gate-copy.ts — the five withheld-state strings
// (research §3.3, which supersedes the blueprint on wording — UXR-TRENDS-30).
//
// Every string states the THRESHOLD and the ACTUAL value, interpolated, never
// static — the difference between a gate that teaches and a gate that
// stonewalls. `implausible_result` is the only one naming a likely cause,
// because it is the only one the user cannot fix by waiting (UXR-TRENDS-31).
// Shared by the rail caption (line1 only — live during the drag, R12) and the
// window panel (both lines) so the two can never disagree.

import {
  MIN_NUTRITION_DAYS_FOR_TDEE,
  MIN_WEIGH_INS_FOR_TDEE,
  MIN_WEIGH_IN_SPAN_DAYS,
  MIN_WINDOW_DAYS_FOR_TDEE,
  type WindowAggregate,
} from "@/lib/trends-core";

export function tdeeGateCopy(
  agg: WindowAggregate,
): { line1: string; line2: string } | null {
  switch (agg.energy.observedTdeeReason) {
    case "window_too_short":
      return {
        line1: `Maintenance needs at least ${MIN_WINDOW_DAYS_FOR_TDEE} days. This window is ${agg.window.days}.`,
        line2: "Nothing is estimated until then.",
      };
    case "insufficient_nutrition_days":
      return {
        line1: `Maintenance needs at least ${MIN_NUTRITION_DAYS_FOR_TDEE} logged days. This window has ${agg.nutrition.loggedDays}.`,
        line2: "Nothing is estimated until then.",
      };
    case "insufficient_nutrition_coverage":
      // Both counts, not a percentage — the ratio is the rule, the counts are
      // what the reader can act on.
      return {
        line1: `Under half this window's days have meals logged — ${agg.nutrition.loggedDays} of ${agg.coverage.totalDays}.`,
        line2: "An average that thin would be misleading, so it isn't used.",
      };
    case "insufficient_weigh_ins":
      return {
        line1: `Maintenance needs ${MIN_WEIGH_INS_FOR_TDEE} weigh-ins at least ${MIN_WEIGH_IN_SPAN_DAYS} days apart. This window has ${agg.weight.readingDays}.`,
        line2: "Nothing is estimated until then.",
      };
    case "implausible_result":
      return {
        line1:
          "This window's weight change and logged intake don't produce a believable number.",
        line2: "That usually means a weigh-in is off, or a big day went unlogged.",
      };
    default:
      return null;
  }
}
