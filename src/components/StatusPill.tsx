// src/components/StatusPill.tsx
//
// Shared status-summary pill, extracted verbatim from RecordsSummary's local
// copy (#236) and consolidated with baselines/page.tsx's near-identical
// definition (which used a different tone-name vocabulary for the same
// colors). Server-safe — no client JS.

export function StatusPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  const cls =
    tone === "success"
      ? "border-[var(--success)]/40 text-[var(--success)]"
      : tone === "warning"
        ? "border-[var(--warning)]/40 text-[var(--warning)]"
        : tone === "danger"
          ? "border-[var(--danger)]/40 text-[var(--danger)]"
          : "border-[var(--border)] text-[var(--muted)]";
  return (
    <div className={`rounded-lg border ${cls} py-2`}>
      <p className="text-lg font-semibold tabular-nums">{count}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}
