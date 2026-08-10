// ZoneDivider — SERVER COMPONENT. The hairline between the ACT zone (the
// day's ask) and the TRACK zone (collapsed reference lids) — today-page-ia
// §2.4. One 10px word + a 1px rule, zero new CSS. The HOST gates it: it must
// render ONLY when the TRACK zone is non-empty (UXR-TIA-28/69) — an orphan
// label over nothing is the near-empty-copy failure the reorder removes.

export function ZoneDivider() {
  return (
    <div data-testid="today-zone-divider" className="flex items-center gap-2 px-1 py-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Tracking
      </span>
      <span aria-hidden className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
