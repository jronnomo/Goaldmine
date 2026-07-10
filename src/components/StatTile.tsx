// src/components/StatTile.tsx
//
// Shared stat-tile idiom, lifted from the duplicated WeightStat tile in
// src/app/progress/page.tsx (blueprint §5). Server-safe — no client JS.
// #236 completed the migration: calendar's Stat, progress's WeightStat, and
// MilestoneBurnDown's BurndownStat all render through this component now.

export function StatTile({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string | number;
  tone?: "success" | "danger" | "muted";
  testId?: string;
}) {
  const toneClass =
    tone === "success"
      ? "text-[var(--success)]"
      : tone === "danger"
        ? "text-[var(--danger)]"
        : tone === "muted"
          ? "text-[var(--muted)]"
          : "";
  return (
    <div className="rounded-lg border border-[var(--border)] py-2 text-center" data-testid={testId}>
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
