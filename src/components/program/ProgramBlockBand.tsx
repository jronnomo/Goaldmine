// src/components/program/ProgramBlockBand.tsx
//
// Proportional block/phase band for the /program header card (#290,
// UXR-PV-29). Segments are weighted by DAY COUNT — equal-width segments
// would lie about a 25-day block being as long as a 56-day one. The current
// block's segment fills like a mini progress bar; past blocks are full,
// future blocks empty.
//
// Static, no motion — a band is a fact, not an event (UXR-PV-77, the shipped
// ReachMeter precedent). Labels come from the plan's own phase names (the
// user's words); "Block N of M" phrasing is deliberately avoided (UXR-PV-31).
//
// Server component — pure render from precomputed segments.

export type ProgramBlockSegment = {
  key: string;
  label: string;
  /** Relative width — day count of the block. */
  weight: number;
  /** 0..1 fill (past = 1, future = 0, current = partial). */
  fill: number;
  current: boolean;
};

export function ProgramBlockBand({
  blocks,
  caption,
  "data-testid": testId,
}: {
  blocks: ProgramBlockSegment[];
  caption?: string | null;
  "data-testid"?: string;
}) {
  if (blocks.length === 0) return null;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  return (
    <div data-testid={testId ?? "program-block-band"}>
      <div className="flex gap-1" aria-hidden="true">
        {blocks.map((b, i) => (
          <div
            key={b.key}
            data-testid={`program-block-${i}`}
            title={b.label}
            className="relative h-1.5 overflow-hidden rounded-full bg-[var(--border)]/60"
            style={{ flexGrow: Math.max(b.weight, 1), flexBasis: 0 }}
          >
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                b.current ? "bg-[var(--accent)]" : "bg-[var(--muted)]/70"
              }`}
              style={{ width: `${Math.round(clamp01(b.fill) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      {caption && <p className="mt-1.5 text-xs text-[var(--muted)]">{caption}</p>}
    </div>
  );
}
