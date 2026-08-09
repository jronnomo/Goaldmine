// src/components/goal-assay/AssayTargetRows.tsx
//
// Server component — the "WHAT MOVED" evidence block (PRD 3.1.3, report
// §2.1 item 6). Consumes `buildEvidenceRows` (src/lib/goal-assay-core.ts):
// met-first, capped at ROW_CAP, with Rule B's reserve-last-slot-for-the-
// first-miss corollary already applied by that function — this component
// only formats and lays out whatever rows it's handed. Zero-target goals
// (report §2.2 Marker floor) collapse the block to one honest sentence
// instead of an empty list.
//
// Rule A: no `.assay-*` primitive class is baked into this SSR output.
// Each row instead carries `data-assay="row-<n>"` + a pre-computed
// `--assay-delay` inline custom property (the ~40ms⚠[32-48] per-row stagger
// from report §4.3's B2.1-B2.4) — harmless until AssayFlourish's
// playFlourish adds the real `.assay-rise` class post-hydration. See
// AssayFlourish.tsx's header for the full contract.
//
// a11y: the ✓/· glyph carries its meaning via `aria-label` (met/not met),
// mirroring the existing StoryTargetsTable.tsx idiom, rather than being
// aria-hidden — unlike the hero's purely decorative glyphs, this symbol IS
// the information (color alone must never be the only channel).
//
// testIDs: goal-assay-what-moved (block) · goal-assay-row-{n} (each row).

import { buildEvidenceRows, ZERO_TARGET_EVIDENCE_SENTENCE } from "@/lib/goal-assay-core";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";
import type { CSSProperties } from "react";

/** Report §2.1 item 6 / §5.1: capped at 6, "+N more" beyond that. */
const ROW_CAP = 6;

/** §4.3 B2.1 starts at 360ms; ⚠32-48ms per-row stagger, using the range's
 *  midpoint (40ms) to match globals.css's own disc-stagger comment style. */
const ROW_DELAY_BASE_MS = 360;
const ROW_DELAY_STEP_MS = 40;

function rowDelayStyle(index: number): CSSProperties {
  return { "--assay-delay": `${ROW_DELAY_BASE_MS + index * ROW_DELAY_STEP_MS}ms` } as CSSProperties;
}

export function AssayTargetRows({ targets }: { targets: GoalCompletionSnapshot["targets"] }) {
  const header = (
    <p
      className="text-xs font-bold uppercase"
      style={{ color: "var(--muted)", letterSpacing: "0.09em" }}
      data-assay="what-moved-label"
    >
      WHAT MOVED
    </p>
  );

  if (targets.length === 0) {
    return (
      <div data-testid="goal-assay-what-moved" className="flex flex-col gap-2">
        {header}
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {ZERO_TARGET_EVIDENCE_SENTENCE}
        </p>
      </div>
    );
  }

  const { rows, hiddenCount } = buildEvidenceRows(targets, ROW_CAP);

  return (
    <div data-testid="goal-assay-what-moved" className="flex flex-col gap-2">
      {header}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <li
            key={row.target.metric}
            data-testid={`goal-assay-row-${i}`}
            data-assay={`row-${i}`}
            style={rowDelayStyle(i)}
            className="flex items-center gap-3 text-sm"
          >
            <span
              className="w-4 shrink-0 text-center"
              aria-label={row.target.met ? "target met" : "target not met"}
              style={{ color: row.target.met ? "var(--success)" : "var(--muted)" }}
            >
              {row.target.met ? "✓" : "·"}
            </span>
            <span className="min-w-0 flex-1 truncate">{row.target.label}</span>
            <span
              className="shrink-0 text-right"
              style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
            >
              {row.formattedRange}
            </span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          +{hiddenCount} more
        </p>
      )}
    </div>
  );
}
