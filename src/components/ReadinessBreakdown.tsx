import type { TargetProgress } from "@/lib/readiness";

export function ReadinessBreakdown({
  breakdown,
  showGating = false,
}: {
  breakdown: TargetProgress[];
  /** #290 (/program target breakdown): render a small "gate" chip next to
   *  gating targets. Additive + default-off — existing callers unchanged. */
  showGating?: boolean;
}) {
  return (
    <ul className="space-y-3">
      {breakdown.map((b) => {
        const pct = b.progress === null ? null : Math.round(b.progress * 100);
        return (
          <li key={b.target.metric}>
            <div className="flex justify-between text-sm mb-1 gap-2">
              <span className="font-medium truncate pr-2">
                {b.target.label}
                {showGating && b.target.gating === true && (
                  <span className="ml-1.5 inline-block align-middle rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    gate
                  </span>
                )}
              </span>
              <span className="text-[var(--muted)] tabular-nums shrink-0">
                {pct === null ? "—" : `${pct}%`}{" "}
                <span className="text-xs">· w{Math.round(b.target.weight * 100)}</span>
              </span>
            </div>
            <div className="h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-[var(--muted)] mt-1">
              {b.current === null ? "no data" : `${formatVal(b.current)} ${b.target.units}`}
              {" → "}
              {formatVal(b.target.target)} {b.target.units}
              {b.start !== null && b.start !== undefined && b.start !== b.target.target && (
                <span> · started {formatVal(b.start)}</span>
              )}
            </p>
            {b.target.rationale && (
              <p className="text-xs text-[var(--muted)] mt-1 italic border-l-2 border-[var(--border)] pl-2">
                {b.target.rationale}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatVal(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}
