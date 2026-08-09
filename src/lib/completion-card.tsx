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

/** Rows beyond this cap collapse into a single "+N more" line so the card
 *  never overflows its canvas on goals with many targets. */
const MAX_TARGET_ROWS = 6;

function fmtTargetValue(v: number | null, units: string): string {
  if (v === null) return "—";
  const n = fmtComma(v);
  return units ? `${n} ${units}` : n;
}

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
  target,
  tok,
}: {
  target: GoalCompletionSnapshot["targets"][number];
  tok: ReturnType<typeof getTemplate>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }}>
      <div
        style={{
          display: "flex",
          width: 34,
          fontSize: 30,
          fontFamily: tok.fontSans,
          fontWeight: tok.fontWeight.semibold,
          color: target.met ? tok.success : tok.mutedText,
          lineHeight: 1,
        }}
      >
        {target.met ? "✓" : "·"}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          fontSize: 30,
          fontFamily: tok.fontSans,
          fontWeight: tok.fontWeight.regular,
          color: tok.primaryText,
          overflow: "hidden",
          lineClamp: 1,
        }}
      >
        {target.label}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 28,
          fontFamily: tok.fontSans,
          fontWeight: tok.fontWeight.semibold,
          color: tok.mutedText,
          flexShrink: 0,
        }}
      >
        {`${fmtTargetValue(target.start, "")} → ${fmtTargetValue(target.final, target.units)}`}
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
  // Met-first ordering, capped to MAX_TARGET_ROWS + a "+N more" summary line.
  const orderedTargets = [...snapshot.targets].sort((a, b) => Number(b.met) - Number(a.met));
  const visibleTargets = orderedTargets.slice(0, MAX_TARGET_ROWS);
  const hiddenCount = orderedTargets.length - visibleTargets.length;

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
            paddingTop: 28,
            paddingBottom: 28,
            gap: 16,
          }}
        >
          {visibleTargets.map((t) => (
            <TargetRow key={t.metric} target={t} tok={tok} />
          ))}
          {hiddenCount > 0 && (
            <div
              style={{
                display: "flex",
                fontSize: 26,
                fontFamily: tok.fontSans,
                fontWeight: tok.fontWeight.regular,
                color: tok.mutedText,
              }}
            >
              {`+${hiddenCount} more`}
            </div>
          )}
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
