import {
  hasAnyMacros,
  formatDayMacros,
  remainingMacros,
  type DayMacros,
} from "@/lib/nutrition-macros";

/**
 * Compact "Today so far" macro card for the /nutrition page header.
 * Shows actual logged totals and, when a plan target exists, the remaining
 * calories/macros to fill for the day.
 * Returns null when there is nothing meaningful to display.
 */
export function TodayMacroSummary({
  soFar,
  target,
}: {
  soFar: DayMacros;
  target: DayMacros | null;
}) {
  const targetHasMacros = target !== null && hasAnyMacros(target);
  const soFarHasMacros = hasAnyMacros(soFar);

  // Nothing to display.
  if (!soFarHasMacros && !targetHasMacros) return null;

  const remaining = targetHasMacros ? remainingMacros(target, soFar) : null;

  return (
    <div
      data-testid="today-macro-summary"
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 space-y-1"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Today so far
      </p>
      <p className="font-mono text-sm font-medium tabular-nums text-[var(--foreground)]">
        {soFarHasMacros ? formatDayMacros(soFar) : "—"}
      </p>
      {remaining !== null && target !== null && (
        <p className="text-xs text-[var(--muted)] tabular-nums">
          <span className="font-mono">{formatDayMacros(remaining)}</span>
          {" remaining"}
          {target.calories > 0 && (
            <span> of {Math.round(target.calories)} cal</span>
          )}
        </p>
      )}
    </div>
  );
}
