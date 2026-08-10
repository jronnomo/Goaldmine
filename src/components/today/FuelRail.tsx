// FuelRail — SERVER COMPONENT. Tier-2 compact strip (today-page-ia §2.4):
// the nutrition SCALAR promoted into the glance zone; the composer stays in
// the thumb zone (Log sheet). No h2 — Tier 2's defining trait; the eyebrow
// carries the label. Leads with REMAINING calories (goal-gradient,
// UXR-TIA-10), protein second.
//
// ⚠ NEVER a Bullseye here (UXR-TIA-08): ceil(p×4) renders any p>0.75
// byte-identical to "done" — the h-1.5 track+fill meter is the house grammar
// for a partial readout (CeilingRule) and reads honestly at 78%.
//
// Totals come from the SHARED fallback-aware sum (UXR-TIA-09, BLOCKING) — the
// same helper NutritionToday's day total uses, so the strip and the nutrition
// detail can never contradict.
//
// Zero-row rule (UXR-TIA-11, deliberate departure from TodayMacroSummary's
// return-null): a brand-new user must discover logging, so the rail degrades
// to eyebrow + "Nothing logged yet" + the Log affordance instead of vanishing.
//
// No celebration at 100% (UXR-TIA-34): the once-per-day pop is claimed by
// TodayCelebration, a calorie target is not a completion (the failure mode is
// going OVER — signalled by the word "over", never --danger alone), and the
// rail ships zero motion.

import Link from "next/link";
import { FuelLogButton } from "@/components/today/FuelLogButton";
import {
  sumPlanTargetMacros,
  sumLoggedDayMacrosWithPlanFallback,
  hasAnyMacros,
  formatDayMacros,
  type LoggedMealMacrosLike,
} from "@/lib/nutrition-macros";
import type { NutritionPlan } from "@/lib/nutrition-plan";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function FuelRail({
  logs,
  plan,
}: {
  logs: LoggedMealMacrosLike[];
  plan: NutritionPlan | null | undefined;
}) {
  const target = sumPlanTargetMacros(plan);
  const soFar = sumLoggedDayMacrosWithPlanFallback(logs, plan);
  const targetPositive = hasAnyMacros(target);
  const soFarPositive = hasAnyMacros(soFar);
  const mealsCount = logs.length;
  const mealsLabel = `${mealsCount} meal${mealsCount === 1 ? "" : "s"}`;

  // ── Zero-row: nothing logged AND no plan target → discovery state ──────────
  if (mealsCount === 0 && !targetPositive) {
    return (
      <div
        data-testid="today-fuel-rail"
        className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
      >
        <div className="flex items-center gap-3">
          <Link
            href="/nutrition"
            className="flex-1 min-w-0 flex items-baseline gap-2 min-h-[44px] -my-2 py-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Fuel
            </span>
            <span className="text-sm text-[var(--muted)]">Nothing logged yet</span>
          </Link>
          <FuelLogButton />
        </div>
      </div>
    );
  }

  // ── Headline: remaining-led (calories vs the day's target) ─────────────────
  const remainingCal = Math.max(0, target.calories - soFar.calories);
  const overCal = Math.max(0, soFar.calories - target.calories);
  let headline: string;
  if (targetPositive && target.calories > 0) {
    headline =
      overCal > 0
        ? `${fmt(overCal)} cal over · ${fmt(target.calories)} target`
        : `${fmt(remainingCal)} left of ${fmt(target.calories)} cal`;
  } else if (soFar.calories > 0) {
    headline = `${fmt(soFar.calories)} cal`;
  } else if (soFarPositive) {
    headline = formatDayMacros(soFar);
  } else {
    headline = mealsLabel; // meals logged, nothing computable
  }

  // ── Subline: protein second, then meal count ────────────────────────────────
  const sublineParts: string[] = [];
  if (target.proteinG > 0) {
    sublineParts.push(`Protein ${fmt(soFar.proteinG)} / ${fmt(target.proteinG)}g`);
  } else if (soFar.proteinG > 0) {
    sublineParts.push(`Protein ${fmt(soFar.proteinG)}g`);
  }
  if (!targetPositive) sublineParts.push("No daily target set");
  sublineParts.push(mealsLabel);
  const subline = sublineParts.join(" · ");

  // ── Meter: continuous fill, target days only ───────────────────────────────
  const pct =
    targetPositive && target.calories > 0
      ? Math.min(100, Math.round((soFar.calories / target.calories) * 100))
      : null;

  return (
    <div
      data-testid="today-fuel-rail"
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
    >
      <div className="flex items-stretch gap-3">
        <Link
          href="/nutrition"
          className="flex-1 min-w-0 space-y-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] shrink-0">
              Fuel
            </span>
            <span
              data-testid="today-fuel-headline"
              className="text-base font-mono font-medium tabular-nums truncate"
            >
              {headline}
            </span>
          </span>
          {pct !== null && (
            <span
              data-testid="today-fuel-meter"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${pct}% of daily calorie target`}
              className="block h-1.5 rounded-full bg-[var(--border)]/60 overflow-hidden"
            >
              <span
                className="block h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${pct}%` }}
              />
            </span>
          )}
          <span className="block text-xs text-[var(--muted)] tabular-nums">{subline}</span>
        </Link>
        <FuelLogButton />
      </div>
    </div>
  );
}
