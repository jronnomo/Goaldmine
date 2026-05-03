import type { TargetProgress } from "@/lib/readiness";

export function ReadinessBreakdown({ breakdown }: { breakdown: TargetProgress[] }) {
  return (
    <ul className="space-y-2">
      {breakdown.map((b) => {
        const pct = b.progress === null ? null : Math.round(b.progress * 100);
        return (
          <li key={b.target.metric}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium truncate pr-2">{b.target.label}</span>
              <span className="text-[var(--muted)] tabular-nums shrink-0">
                {pct === null ? "—" : `${pct}%`}
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
              <span className="ml-1">· weight {Math.round(b.target.weight * 100)}%</span>
            </p>
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
