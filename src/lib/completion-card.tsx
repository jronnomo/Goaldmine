// src/lib/completion-card.tsx
// Satori-compatible JSX for the "Goal Completed" shareable card (REQ-008).
// Formats: story 1080×1920 · post 1080×1350 (default at the route) · square 1080×1080.
// Inline styles ONLY — no Tailwind, no CSS vars, no CSS grid.
// Flex-only layout (every multi-child div has display:"flex"). No DOM/browser APIs.
// No conic-gradient — the readiness hero reuses recap-card.tsx's inline-SVG
// ProgressRing (dasharray sweep), decoupled from WeeklyRecap types (R4).
//
// Consumes GoalCompletionSnapshot (src/lib/goal-completion-core.ts, Stage 0) —
// a frozen, versioned record of the goal at completion time. Renders
// defensively: a zero-target snapshot (targetsTotal === 0) skips the ring and
// target rows in favor of a centered completed-date/days-elapsed block.

import React from "react";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";
import type { RecapTemplate, RecapCardFormat } from "@/lib/recap";
import { getTemplate } from "@/lib/recap-templates";
import { ProgressRing } from "@/lib/recap-card";
import { fmtComma } from "@/lib/goal-presentation";
import { buildEvidenceRows, type EvidenceRow } from "@/lib/goal-assay-core";

/**
 * Per-format target-row geometry. This is a static keepsake image, not an
 * interactive list — there is no "tap to see more," so every row that fits
 * must be shown, and rows that don't fit are dropped silently (the footer's
 * "x/y TARGETS" stat is the accounting, never a "+N more" teaser).
 *
 * `cap` is chosen empirically per format by rendering the founder's actual
 * 9-target shape (one 2-line label, mixed met/unmet) and looking at the PNG:
 * story and post have enough canvas height to show all 9 once rows are
 * tightened a notch; square's 1:1 canvas cannot, so it keeps a real cap —
 * `buildEvidenceRows`'s reserve-last-slot-for-the-first-miss rule (mirrored
 * from goal-assay-core.ts, itself ported from this file) guarantees a capped
 * card can never structurally hide every miss behind a wall of checkmarks.
 */
type TargetRowLayout = {
  cap: number;
  rowGap: number;
  labelFontSize: number;
  valueFontSize: number;
  iconSize: number;
  zonePadY: number;
};

const TARGET_ROW_LAYOUT: Record<RecapCardFormat, TargetRowLayout> = {
  story: { cap: 12, rowGap: 16, labelFontSize: 30, valueFontSize: 28, iconSize: 26, zonePadY: 28 },
  post: { cap: 9, rowGap: 10, labelFontSize: 26, valueFontSize: 24, iconSize: 22, zonePadY: 16 },
  square: { cap: 6, rowGap: 8, labelFontSize: 22, valueFontSize: 20, iconSize: 18, zonePadY: 10 },
};

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** yyyy-mm-dd -> "Mon D, YYYY". Pure string formatting — dateKey is already
 *  USER_TZ-resolved by the caller, so this never touches Date/timezone math. */
function fmtCompletedDate(dateKeyStr: string): string {
  const parts = dateKeyStr.split("-");
  if (parts.length !== 3) return dateKeyStr;
  const [y, m, d] = parts as [string, string, string];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m) - 1;
  const label = mi >= 0 && mi < 12 ? MONTHS[mi] : m;
  return `${label} ${Number(d)}, ${y}`;
}

// ─── FooterStat — a single cell in the bottom stat strip ──────────────────────

function FooterStat({
  value,
  label,
  tok,
  displayFont,
  displayWeight,
}: {
  value: string;
  label: string;
  tok: ReturnType<typeof getTemplate>;
  displayFont: string;
  displayWeight: number;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: Math.round(tok.fontSize.statValue * 0.72),
          fontFamily: displayFont,
          fontWeight: displayWeight,
          color: tok.primaryText,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: tok.fontSize.statLabel,
          fontFamily: tok.fontSans,
          fontWeight: tok.fontWeight.regular,
          color: tok.mutedText,
          letterSpacing: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── TargetRow — one per-target start→final line ──────────────────────────────

function TargetRow({
  row,
  tok,
  layout,
}: {
  row: EvidenceRow;
  tok: ReturnType<typeof getTemplate>;
  layout: TargetRowLayout;
}) {
  const { target, formattedRange } = row;
  const iconBoxSize = layout.iconSize + 8;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }}>
      <div
        style={{
          display: "flex",
          width: iconBoxSize,
          height: iconBoxSize,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {target.met ? (
          // Check mark — stroked path, no glyph. Satori/resvg render SVG
          // natively; the loaded fonts (Geist/DMSerifDisplay) lack U+2713,
          // which rendered as a tofu box (▯) in the shipped card.
          <svg width={layout.iconSize} height={layout.iconSize} viewBox="0 0 24 24">
            <path
              d="M4.5 12.5L9.5 17.5L19.5 6.5"
              fill="none"
              stroke={tok.success}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          // Unmet-target marker — filled dot, muted color.
          <svg width={layout.iconSize} height={layout.iconSize} viewBox="0 0 24 24">
            <circle cx={12} cy={12} r={4} fill={tok.mutedText} />
          </svg>
        )}
      </div>
      {/* display:"block" (not "flex") is required for satori's lineClamp to
       *  take effect — its layout engine only honors lineClamp on block
       *  boxes, so a flex label here would wrap unclamped (verified via
       *  rendered PNG: a long label overflowed to 2 full lines despite an
       *  earlier lineClamp:1 attempt on a flex box — silently ignored). */}
      <div
        style={{
          display: "block",
          flex: 1,
          fontSize: layout.labelFontSize,
          lineHeight: 1.2,
          fontFamily: tok.fontSans,
          fontWeight: tok.fontWeight.regular,
          color: tok.primaryText,
          overflow: "hidden",
          lineClamp: 2,
        }}
      >
        {target.label}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: layout.valueFontSize,
          fontFamily: tok.fontSans,
          fontWeight: tok.fontWeight.semibold,
          color: tok.mutedText,
          flexShrink: 0,
        }}
      >
        {formattedRange}
      </div>
    </div>
  );
}

// ─── CompletionCard — the full "Goal Completed" card ───────────────────────────

/**
 * Satori-compatible JSX for the shareable "Goal Completed" card. Canvas size
 * comes from the format-resolved recap template tokens (reused verbatim —
 * REQ-008 introduces no new palette/typography). Used by:
 * `/recap/completion` route handler AND (later) the `generate_completion_card`
 * MCP tool (REQ-009, out of this file's scope).
 */
export function CompletionCard({
  snapshot,
  goal,
  template,
  format = "story",
}: {
  snapshot: GoalCompletionSnapshot;
  /** Frozen objective (snapshot.objective) is preferred; goal is a defensive fallback. */
  goal: { objective: string; kind: string };
  template: RecapTemplate;
  format?: RecapCardFormat;
}): React.JSX.Element {
  const tok = getTemplate(template, format);
  const isParchment = template === "parchment";
  const displayFont = isParchment ? tok.fontSerif : tok.fontSans;
  const displayWeight = isParchment ? tok.fontWeight.regular : tok.fontWeight.semibold;

  const objective = snapshot.objective || goal.objective;
  const completedLabel = fmtCompletedDate(snapshot.completedDateKey);

  const hasReadiness = snapshot.readiness !== null;
  const readinessScore = snapshot.readiness?.score ?? null;

  const hasTargets = snapshot.targetsTotal > 0;
  const targetLayout = TARGET_ROW_LAYOUT[format];
  // Met-first, capped per-format, with the last visible slot reserved for
  // the first unmet target whenever the naive met-first cap would otherwise
  // hide every miss (buildEvidenceRows — see TARGET_ROW_LAYOUT comment
  // above). No "+N more": this is a static keepsake image, not a list with
  // a next page — the footer's targetsMet/targetsTotal is the accounting.
  const { rows: visibleRows } = buildEvidenceRows(snapshot.targets, targetLayout.cap);

  // Objective can run long (tested at 120 chars) — clamp to 3 lines and shrink
  // the font a step so it still fits the header band on every format.
  const objectiveFontSize = Math.min(tok.fontSize.goalObjective, objective.length > 60 ? 44 : 56);

  const footerStats: Array<{ value: string; label: string }> = [
    { value: `${snapshot.targetsMet}/${snapshot.targetsTotal}`, label: "TARGETS" },
    { value: `+${fmtComma(snapshot.xpAwardedAtCompletion)}`, label: "XP" },
  ];
  if (snapshot.feasibilityTierAtCompletion !== null) {
    footerStats.push({ value: capitalize(snapshot.feasibilityTierAtCompletion), label: "REACH" });
  }
  footerStats.push({ value: String(snapshot.xpBasis.weeks), label: "WEEKS" });

  return (
    <div
      style={{
        width: tok.canvasWidth,
        height: tok.canvasHeight,
        backgroundColor: tok.bg,
        display: "flex",
        flexDirection: "column",
        fontFamily: tok.fontSans,
        color: tok.primaryText,
      }}
    >
      {/* ── IG top chrome clearance ─────────────────────────────────────── */}
      <div style={{ height: tok.igTopChrome, display: "flex" }} />

      {/* ── Header band: trophy eyebrow + frozen objective ───────────────── */}
      <div
        style={{
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingBottom: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 44, lineHeight: 1 }}>🏆</div>
          <div
            style={{
              fontSize: tok.fontSize.headerCounter,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.semibold,
              color: tok.accentText,
              letterSpacing: 3,
            }}
          >
            GOAL COMPLETED
          </div>
        </div>
        <div
          style={{
            fontSize: objectiveFontSize,
            fontFamily: displayFont,
            fontWeight: displayWeight,
            color: tok.primaryText,
            lineHeight: 1.15,
            overflow: "hidden",
            lineClamp: 3,
          }}
        >
          {objective}
        </div>
      </div>

      {/* ── Hairline ─────────────────────────────────────────────────────── */}
      <div style={{ height: 1, backgroundColor: tok.hairline, marginLeft: tok.safeInset, marginRight: tok.safeInset }} />

      {/* ── Hero zone: readiness ring (or centered date block) ───────────── */}
      <div
        style={{
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingTop: 40,
          paddingBottom: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
        }}
      >
        {hasReadiness && (
          <ProgressRing
            tok={tok}
            diameter={tok.bullseyeHeroDiameter}
            progressPct={readinessScore}
            hasData={true}
            displayFont={displayFont}
            displayWeight={displayWeight}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div
            style={{
              fontSize: tok.fontSize.readinessLabel,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.regular,
              color: tok.mutedText,
              letterSpacing: 3,
            }}
          >
            {hasReadiness ? "COMPLETED" : "COMPLETED " + completedLabel.toUpperCase()}
          </div>
          {hasReadiness && (
            <div
              style={{
                fontSize: tok.fontSize.statLabel,
                fontFamily: tok.fontSans,
                fontWeight: tok.fontWeight.regular,
                color: tok.mutedText,
              }}
            >
              {completedLabel}
            </div>
          )}
          <div
            style={{
              fontSize: tok.fontSize.statLabel,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.regular,
              color: tok.mutedText,
            }}
          >
            {`${snapshot.daysElapsed} day${snapshot.daysElapsed === 1 ? "" : "s"} elapsed`}
          </div>
        </div>
      </div>

      {/* ── Hairline ─────────────────────────────────────────────────────── */}
      <div style={{ height: 1, backgroundColor: tok.hairline, marginLeft: tok.safeInset, marginRight: tok.safeInset }} />

      {/* ── Per-target rows (flex:1 absorbs remaining canvas height) ─────── */}
      {hasTargets ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            paddingLeft: tok.safeInset,
            paddingRight: tok.safeInset,
            paddingTop: targetLayout.zonePadY,
            paddingBottom: targetLayout.zonePadY,
            gap: targetLayout.rowGap,
          }}
        >
          {visibleRows.map((row) => (
            <TargetRow key={row.target.metric} row={row} tok={tok} layout={targetLayout} />
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex" }} />
      )}

      {/* ── Hairline ─────────────────────────────────────────────────────── */}
      <div style={{ height: 1, backgroundColor: tok.hairline }} />

      {/* ── Footer stat strip: targets x/y · +XP · Reach tier · weeks ────── */}
      <div
        style={{
          backgroundColor: tok.liftedSurface,
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingTop: 28,
          paddingBottom: 28,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {footerStats.flatMap((stat, i) => {
          const cell = (
            <FooterStat
              key={stat.label}
              value={stat.value}
              label={stat.label}
              tok={tok}
              displayFont={displayFont}
              displayWeight={displayWeight}
            />
          );
          return i === 0
            ? [cell]
            : [<div key={stat.label + "-div"} style={{ width: 1, backgroundColor: tok.statDivider }} />, cell];
        })}
      </div>
    </div>
  );
}
