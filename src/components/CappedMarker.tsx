/**
 * Compact "capped" marker (#276): the baseline value hit an equipment ceiling
 * (e.g. a 65 lb dumbbell max), so a plateau at this value is expected — not a
 * stall. Display annotation only; capped never feeds PR/readiness math.
 * Minimal by design — full chart treatment lands in Sprint 19.
 */
export function CappedMarker() {
  return (
    <span
      className="ml-1 text-[10px] font-medium tracking-wide text-[var(--muted)]"
      title="Capped by equipment ceiling — a plateau at this value is expected"
      aria-label="capped by equipment ceiling"
    >
      ▲cap
    </span>
  );
}
