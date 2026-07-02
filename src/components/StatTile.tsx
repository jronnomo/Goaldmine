// src/components/StatTile.tsx
//
// Shared stat-tile idiom, lifted from the duplicated WeightStat tile in
// src/app/progress/page.tsx (blueprint §5). Server-safe — no client JS.
// Migrating the existing duplicates onto this component is an optional
// follow-up, not v1 scope (PRD §3.2 item 1).

export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "success" | "danger" | "muted";
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
    <div className="rounded-lg border border-[var(--border)] py-2 text-center">
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
