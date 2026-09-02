// src/components/trends/CoverageLine.tsx — the visible denominator.
// Plain DOM text, never a tooltip (UXR-TRENDS-34): findable, translatable,
// and structurally incapable of drifting out of sync with the pixels. It
// renders ABOVE the averages it qualifies — coverage after the average is a
// footnote nobody reads; coverage before it is a frame (denominator neglect,
// research §6).
//
// The conditional second line is the answer to T5 (one NutritionLog row per
// meal, every macro column nullable): a day with quick-logged item-only meals
// is EXCLUDED from the averages, not zeroed — and this line says so, so the
// number is qualified rather than quietly wrong. Renders only when the count
// is non-zero (UXR-TRENDS-33).
//
// Directive-free; pure props → JSX.

import type { WindowAggregate } from "@/lib/trends-core";

export function CoverageLine({ coverage }: { coverage: WindowAggregate["coverage"] }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]" data-testid="trends-coverage-line">
        {coverage.nutritionDays} of {coverage.totalDays} days logged ·{" "}
        {coverage.weightDays} {coverage.weightDays === 1 ? "weigh-in" : "weigh-ins"}
      </p>
      {coverage.mealsNoMacroDays > 0 && (
        <p className="text-xs text-[var(--muted)]" data-testid="trends-coverage-partial-line">
          {coverage.mealsNoMacroDays} more {coverage.mealsNoMacroDays === 1 ? "day has" : "days have"}{" "}
          meals with no macros — not counted in these averages.
        </p>
      )}
    </div>
  );
}
