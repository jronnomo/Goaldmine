// src/lib/recap-card.tsx
// Satori-compatible JSX for the weekly recap card (1080×1920).
// Inline styles ONLY — no Tailwind, no CSS vars, no CSS grid.
// Flex-only layout. No DOM/browser APIs.
// Goal-generic — no hardcoded references to specific goals or people.

import React from "react";
import type { WeeklyRecap, RecapTemplate, RecapSlide, RecapHighlight } from "@/lib/recap";
import { getTemplate, type TemplateTokens } from "@/lib/recap-templates";

// ─── Number formatting helpers (ADDENDUM §F) ─────────────────────────────────

function fmtComma(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function fmtVolume(v: number | null): string {
  return v === null ? "—" : `${fmtComma(v)} lb`;
}

function fmtElevation(v: number | null): string {
  return v === null ? "—" : `${fmtComma(v)} ft`;
}

// ─── ProgressRing — proportional activity ring (% inside) ────────────────────
//
// Replaces the old Bullseye concentric-target. An inline SVG draws a gold arc
// swept to `progressPct`% over a muted track circle (via stroke-dasharray),
// starting at 12 o'clock. The percentage label is centred over the ring. satori
// rasterises the SVG through resvg, which supports dash arrays (conic-gradient is
// validated but NOT rendered by satori 0.25.0).

type ProgressRingProps = {
  tok: TemplateTokens;
  diameter: number;
  progressPct: number | null;
  goalState: WeeklyRecap["goalState"];
  displayFont: string;
  displayWeight: number;
};

function ProgressRing({ tok, diameter, progressPct, goalState, displayFont, displayWeight }: ProgressRingProps) {
  const D = diameter;
  const hasData = goalState === "has-data" && progressPct !== null;
  const pct = hasData ? Math.max(0, Math.min(100, progressPct!)) : null;

  // Ring geometry: stroke is centred on radius r so outer edge = D/2 exactly.
  const sw = Math.round(D * 0.16);
  const r = (D - sw) / 2;
  const cx = D / 2;
  const cy = D / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = pct === null ? circumference : circumference * (1 - pct / 100);
  const trackColor = tok.hairline;
  const pctFontSize = Math.round(D * 0.24);
  const displayText = pct !== null ? `${pct}%` : "—";

  return (
    <div
      style={{
        width: D,
        height: D,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={sw} />
        {pct !== null && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={tok.barFillBg}
            strokeWidth={sw}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={`${dashOffset}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: D,
          height: D,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: pctFontSize,
            fontFamily: displayFont,
            fontWeight: displayWeight,
            color: pct !== null ? tok.accentText : tok.mutedText,
            lineHeight: 1,
          }}
        >
          {displayText}
        </div>
      </div>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ tok, pct }: { tok: TemplateTokens; pct: number | null }) {
  const fillPct = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div
      style={{
        width: "100%",
        height: tok.barHeight,
        borderRadius: tok.barRadius,
        backgroundColor: tok.barTrackBg,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: `${fillPct}%`,
          height: tok.barHeight,
          borderRadius: tok.barRadius,
          backgroundColor: tok.barFillBg,
        }}
      />
    </div>
  );
}

// ─── HighlightBand ────────────────────────────────────────────────────────────

/**
 * Hero-weight featured-highlight callout band.
 * Placed AFTER the goal block hairline, BEFORE the streak band.
 * Satori-safe: flex only, inline styles, no SVG/img, every multi-child div has display:"flex".
 * The gold left-edge accent (8px) stretches full height via default alignItems:"stretch".
 * The `sub` (e.g. "new PR") renders as a gold pill badge to make it unmissable.
 */
function HighlightBand({
  tok,
  highlight,
  displayFont,
  displayWeight,
}: {
  tok: TemplateTokens;
  highlight: RecapHighlight;
  displayFont: string;
  displayWeight: number;
}) {
  return (
    <div
      style={{
        marginLeft: tok.safeInset,
        marginRight: tok.safeInset,
        marginTop: 24,
        marginBottom: 8,
        borderRadius: 20,
        display: "flex",
        flexDirection: "row",
        backgroundColor: tok.liftedSurface,
        overflow: "hidden",
      }}
    >
      {/* Gold left accent — 8px, stretches full height via default alignItems:"stretch" */}
      <div
        style={{
          width: 8,
          backgroundColor: tok.barFillBg,
          flexShrink: 0,
          display: "flex",
        }}
      />
      {/* Content row: icon + text stack */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          gap: 20,
          paddingTop: 28,
          paddingBottom: 28,
          paddingLeft: 24,
          paddingRight: 28,
        }}
      >
        {/* Emoji icon — larger for hero weight */}
        <div
          style={{
            display: "flex",
            fontSize: 60,
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {highlight.icon}
        </div>
        {/* Label + optional gold pill sub */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flex: 1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: 40,
              fontFamily: displayFont,
              fontWeight: displayWeight,
              color: tok.primaryText,
              lineHeight: 1.15,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {highlight.label}
          </div>
          {highlight.sub !== null && (
            /* Gold pill badge — background = gold, text = dark (tok.bg), uppercase */
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                backgroundColor: tok.barFillBg,
                borderRadius: 9999,
                paddingLeft: 20,
                paddingRight: 20,
                paddingTop: 8,
                paddingBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontFamily: tok.fontSans,
                  fontWeight: tok.fontWeight.semibold,
                  color: tok.bg,
                  letterSpacing: 2,
                  lineHeight: 1.2,
                }}
              >
                {highlight.sub.toUpperCase()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RecapCard — full 1080×1920 card ─────────────────────────────────────────

/**
 * Satori-compatible JSX for the 1080×1920 full card.
 * Inline styles only — no Tailwind classes, no CSS vars, no CSS grid.
 * Flex-only layout. No DOM/browser APIs.
 * Used by: /recap/card route handler AND generate_recap_card MCP tool.
 */
export function RecapCard({
  recap,
  template,
  featuredHighlight,
}: {
  recap: WeeklyRecap;
  template: RecapTemplate;
  /** When non-null, renders a gold-accented callout band after the goal block. */
  featuredHighlight?: RecapHighlight | null;
}): React.JSX.Element {
  const tok = getTemplate(template);
  const isParchment = template === "parchment";

  // Header program line
  const programLine =
    recap.header.programWeek !== null
      ? `WEEK ${recap.header.programWeek} · DAY ${recap.header.dayOfProgram} OF ${recap.header.totalProgramDays}`
      : null;

  // Goal state
  const hasGoal = recap.goal !== null;
  const goalObj = recap.goal?.objective ?? "No focus goal";
  const progressPct = recap.goal?.progressPct ?? null;
  const topMetricLabel = recap.goal?.topMetricLabel ?? null;

  // Font choices per template
  const displayFont = isParchment ? tok.fontSerif : tok.fontSans;
  const displayWeight = isParchment ? tok.fontWeight.regular : tok.fontWeight.semibold;

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
      {/* ── IG top chrome clearance (separate spacer so header box is unconstrained) */}
      <div style={{ height: tok.igTopChrome }} />

      {/* ── Header zone ──────────────────────────────────────────────── */}
      <div
        style={{
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingBottom: 20,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {programLine && (
          <div
            style={{
              fontSize: tok.fontSize.headerCounter,
              fontWeight: tok.fontWeight.semibold,
              fontFamily: tok.fontSans,
              color: tok.mutedText,
              letterSpacing: 2,
            }}
          >
            {programLine}
          </div>
        )}
        <div
          style={{
            fontSize: tok.fontSize.dateRange,
            fontFamily: tok.fontSans,
            fontWeight: tok.fontWeight.regular,
            color: tok.mutedText,
          }}
        >
          {recap.dateRangeLabel}
        </div>
      </div>

      {/* ── Hairline ─────────────────────────────────────────────────── */}
      <div style={{ height: 1, backgroundColor: tok.hairline, marginLeft: tok.safeInset, marginRight: tok.safeInset }} />

      {/* ── Goal block zone ──────────────────────────────────────────── */}
      <div
        style={{
          height: tok.zoneHeight.goalBlock,
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingTop: 36,
          paddingBottom: 36,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 40,
        }}
      >
        {/* ProgressRing + readiness label — % lives inside the ring */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <ProgressRing
            tok={tok}
            diameter={tok.bullseyeHeroDiameter}
            progressPct={progressPct}
            goalState={recap.goalState}
            displayFont={displayFont}
            displayWeight={displayWeight}
          />
          <div
            style={{
              fontSize: tok.fontSize.readinessLabel,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.regular,
              color: tok.mutedText,
              letterSpacing: 3,
            }}
          >
            READINESS
          </div>
        </div>

        {/* Goal objective + bar + label */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: 20,
          }}
        >
          {/* Goal kind accent */}
          {hasGoal && recap.goal?.kind && (
            <div
              style={{
                fontSize: 22,
                fontFamily: tok.fontSans,
                fontWeight: tok.fontWeight.regular,
                color: tok.mutedText,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              {recap.goal.kind}
            </div>
          )}

          {/* Objective headline */}
          <div
            style={{
              fontSize: hasGoal ? Math.min(tok.fontSize.goalObjective, 52) : 40,
              fontFamily: displayFont,
              fontWeight: displayWeight,
              color: hasGoal ? tok.primaryText : tok.mutedText,
              lineHeight: 1.15,
              overflow: "hidden",
            }}
          >
            {goalObj}
          </div>

          {/* Progress bar */}
          {recap.goalState !== "no-goal" && recap.goalState !== "no-targets" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <ProgressBar tok={tok} pct={progressPct} />
              {topMetricLabel && (
                <div
                  style={{
                    fontSize: tok.fontSize.statLabel,
                    fontFamily: tok.fontSans,
                    fontWeight: tok.fontWeight.regular,
                    color: tok.mutedText,
                  }}
                >
                  {topMetricLabel}
                </div>
              )}
            </div>
          )}

          {recap.goalState === "no-targets" && (
            <div
              style={{
                fontSize: tok.fontSize.statLabel,
                fontFamily: tok.fontSans,
                fontWeight: tok.fontWeight.regular,
                color: tok.mutedText,
              }}
            >
              Set goal targets to track progress
            </div>
          )}
        </div>
      </div>

      {/* ── Hairline ─────────────────────────────────────────────────── */}
      <div style={{ height: 1, backgroundColor: tok.hairline, marginLeft: tok.safeInset, marginRight: tok.safeInset }} />

      {/* ── Featured Highlight band (conditional) ────────────────────── */}
      {featuredHighlight != null && (
        <HighlightBand
          tok={tok}
          highlight={featuredHighlight}
          displayFont={displayFont}
          displayWeight={displayWeight}
        />
      )}

      {/* ── Streak band ──────────────────────────────────────────────── */}
      <div
        style={{
          height: tok.zoneHeight.streakBand,
          backgroundColor: tok.liftedSurface,
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 32,
        }}
      >
        <div
          style={{
            fontSize: tok.fontSize.streakNumeral,
            fontFamily: displayFont,
            fontWeight: displayWeight,
            color: tok.accentText,
            lineHeight: 1,
          }}
        >
          {String(recap.streakDays)}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: 36,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.semibold,
              color: tok.primaryText,
            }}
          >
            DAY STREAK
          </div>
          <div
            style={{
              fontSize: tok.fontSize.statLabel,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.regular,
              color: tok.mutedText,
            }}
          >
            Current streak
          </div>
        </div>
      </div>

      {/* ── Hairline ─────────────────────────────────────────────────── */}
      <div style={{ height: 1, backgroundColor: tok.hairline }} />

      {/* ── Stat grid (2×2) ──────────────────────────────────────────── */}
      {/* flex:1 so the grid absorbs all remaining canvas height — numbers */}
      {/* fill the lower half of the card rather than leaving a void gap.  */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Row 1 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            borderBottom: `1px solid ${tok.statDivider}`,
          }}
        >
          <StatCell
            tok={tok}
            value={String(recap.workoutsCompleted)}
            label="WORKOUTS"
            displayFont={displayFont}
            displayWeight={displayWeight}
            isNull={false}
          />
          <div style={{ width: 1, backgroundColor: tok.statDivider }} />
          <StatCell
            tok={tok}
            value={fmtVolume(recap.volumeLb)}
            label="VOLUME"
            displayFont={displayFont}
            displayWeight={displayWeight}
            isNull={recap.volumeLb === null}
          />
        </div>
        {/* Row 2 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
          }}
        >
          <StatCell
            tok={tok}
            value={String(recap.prCount)}
            label="NEW PRs"
            displayFont={displayFont}
            displayWeight={displayWeight}
            isNull={false}
          />
          <div style={{ width: 1, backgroundColor: tok.statDivider }} />
          <StatCell
            tok={tok}
            value={fmtElevation(recap.hikeElevationFt)}
            label="ELEVATION"
            displayFont={displayFont}
            displayWeight={displayWeight}
            isNull={recap.hikeElevationFt === null}
          />
        </div>
      </div>

      {/* ── Footer band ──────────────────────────────────────────────── */}
      {/* Feed card: equal top/bottom padding — no IG Story chrome reserve here. */}
      {/* Story slides keep igBottomChrome in their own footer / root padding.   */}
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
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: tok.fontSize.footerWordmark,
            fontFamily: displayFont,
            fontWeight: displayWeight,
            color: tok.primaryText,
            letterSpacing: 4,
          }}
        >
          GOALDMINE
        </div>
        {recap.instagramHandle !== null && (
          <div
            style={{
              fontSize: tok.fontSize.statLabel,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.regular,
              color: tok.mutedText,
            }}
          >
            {recap.instagramHandle}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── StatCell helper ──────────────────────────────────────────────────────────

function StatCell({
  tok,
  value,
  label,
  displayFont,
  displayWeight,
  isNull,
}: {
  tok: TemplateTokens;
  value: string;
  label: string;
  displayFont: string;
  displayWeight: number;
  isNull: boolean;
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
        padding: 24,
      }}
    >
      <div
        style={{
          fontSize: tok.fontSize.statValue,
          fontFamily: displayFont,
          fontWeight: displayWeight,
          color: isNull ? tok.mutedText : tok.primaryText,
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

// ─── RecapStorySlide ──────────────────────────────────────────────────────────

/**
 * Satori-compatible JSX for a single Stories slide (1080×1920).
 * slide 1 = Cover (header + goal + readiness hero)
 * slide 2 = Numbers (streak band + 2×2 stat grid)
 * slide 3 = Closing (big Bullseye + streak + "On to Week N.")
 */
export function RecapStorySlide({
  recap,
  template,
  slide,
}: {
  recap: WeeklyRecap;
  template: RecapTemplate;
  slide: RecapSlide;
}): React.JSX.Element {
  const tok = getTemplate(template);
  const isParchment = template === "parchment";
  const displayFont = isParchment ? tok.fontSerif : tok.fontSans;
  const displayWeight = isParchment ? tok.fontWeight.regular : tok.fontWeight.semibold;

  if (slide === 1) {
    return <SlideOne tok={tok} recap={recap} displayFont={displayFont} displayWeight={displayWeight} isParchment={isParchment} />;
  }
  if (slide === 2) {
    return <SlideTwo tok={tok} recap={recap} displayFont={displayFont} displayWeight={displayWeight} />;
  }
  return <SlideThree tok={tok} recap={recap} displayFont={displayFont} displayWeight={displayWeight} />;
}

// ─── Story slides ─────────────────────────────────────────────────────────────

type SlideProps = {
  tok: TemplateTokens;
  recap: WeeklyRecap;
  displayFont: string;
  displayWeight: number;
};

function SlideOne({ tok, recap, displayFont, displayWeight, isParchment }: SlideProps & { isParchment: boolean }) {
  const programLine =
    recap.header.programWeek !== null
      ? `WEEK ${recap.header.programWeek} · DAY ${recap.header.dayOfProgram} OF ${recap.header.totalProgramDays}`
      : null;

  const hasGoal = recap.goal !== null;
  const goalObj = recap.goal?.objective ?? "No focus goal";
  const progressPct = recap.goal?.progressPct ?? null;
  const topMetricLabel = recap.goal?.topMetricLabel ?? null;

  return (
    <div
      style={{
        width: tok.canvasWidth,
        height: tok.canvasHeight,
        backgroundColor: tok.bg,
        display: "flex",
        flexDirection: "column",
        paddingLeft: tok.safeInset,
        paddingRight: tok.safeInset,
        paddingTop: tok.igTopChrome,
        paddingBottom: tok.igBottomChrome,
        fontFamily: tok.fontSans,
        color: tok.primaryText,
      }}
    >
      {/* Date header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 48 }}>
        {programLine && (
          <div style={{ fontSize: tok.fontSize.headerCounter, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.semibold, color: tok.mutedText, letterSpacing: 2 }}>
            {programLine}
          </div>
        )}
        <div style={{ fontSize: tok.fontSize.dateRange, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText }}>
          {recap.dateRangeLabel}
        </div>
      </div>

      {/* Big ProgressRing hero — % inside the ring, READINESS label below */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, flex: 1, justifyContent: "center" }}>
        <ProgressRing
          tok={tok}
          diameter={tok.bullseyeStoryDiameter}
          progressPct={progressPct}
          goalState={recap.goalState}
          displayFont={displayFont}
          displayWeight={displayWeight}
        />
        <div style={{ fontSize: tok.fontSize.readinessLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText, letterSpacing: 3 }}>
          READINESS
        </div>
      </div>

      {/* Goal objective */}
      <div style={{ marginTop: 48, display: "flex", flexDirection: "column" }}>
        {hasGoal && recap.goal?.kind && (
          <div style={{ fontSize: 22, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText, letterSpacing: 2, marginBottom: 12 }}>
            {recap.goal.kind.toUpperCase()}
          </div>
        )}
        <div style={{ fontSize: isParchment ? tok.fontSize.goalObjective : 56, fontFamily: displayFont, fontWeight: displayWeight, color: hasGoal ? tok.primaryText : tok.mutedText, lineHeight: 1.15 }}>
          {goalObj}
        </div>
        {topMetricLabel && (
          <div style={{ marginTop: 16, fontSize: tok.fontSize.statLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText }}>
            {topMetricLabel}
          </div>
        )}
      </div>

      {/* Footer wordmark */}
      <div style={{ marginTop: 40, display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: tok.fontSize.footerWordmark, fontFamily: displayFont, fontWeight: displayWeight, color: tok.primaryText, letterSpacing: 4 }}>
          GOALDMINE
        </div>
        {recap.instagramHandle !== null && (
          <div style={{ fontSize: tok.fontSize.statLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText }}>
            {recap.instagramHandle}
          </div>
        )}
      </div>
    </div>
  );
}

function SlideTwo({ tok, recap, displayFont, displayWeight }: SlideProps) {
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
      {/* Streak band */}
      <div
        style={{
          backgroundColor: tok.liftedSurface,
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingTop: tok.igTopChrome + 40,
          paddingBottom: 40,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 32,
        }}
      >
        <div style={{ fontSize: tok.fontSize.streakNumeral, fontFamily: displayFont, fontWeight: displayWeight, color: tok.accentText, lineHeight: 1 }}>
          {String(recap.streakDays)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 36, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.semibold, color: tok.primaryText }}>
            DAY STREAK
          </div>
          <div style={{ fontSize: tok.fontSize.statLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText }}>
            Current streak
          </div>
        </div>
      </div>

      <div style={{ height: 1, backgroundColor: tok.hairline }} />

      {/* Stat grid */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "row", borderBottom: `1px solid ${tok.statDivider}` }}>
          <StatCell tok={tok} value={String(recap.workoutsCompleted)} label="WORKOUTS" displayFont={displayFont} displayWeight={displayWeight} isNull={false} />
          <div style={{ width: 1, backgroundColor: tok.statDivider }} />
          <StatCell tok={tok} value={fmtVolume(recap.volumeLb)} label="VOLUME" displayFont={displayFont} displayWeight={displayWeight} isNull={recap.volumeLb === null} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "row" }}>
          <StatCell tok={tok} value={String(recap.prCount)} label="NEW PRs" displayFont={displayFont} displayWeight={displayWeight} isNull={false} />
          <div style={{ width: 1, backgroundColor: tok.statDivider }} />
          <StatCell tok={tok} value={fmtElevation(recap.hikeElevationFt)} label="ELEVATION" displayFont={displayFont} displayWeight={displayWeight} isNull={recap.hikeElevationFt === null} />
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          backgroundColor: tok.liftedSurface,
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingTop: 24,
          paddingBottom: tok.igBottomChrome + 24,
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: tok.fontSize.footerWordmark, fontFamily: displayFont, fontWeight: displayWeight, color: tok.primaryText, letterSpacing: 4 }}>
          GOALDMINE
        </div>
        {recap.instagramHandle !== null && (
          <div style={{ fontSize: tok.fontSize.statLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText }}>
            {recap.instagramHandle}
          </div>
        )}
      </div>
    </div>
  );
}

function SlideThree({ tok, recap, displayFont, displayWeight }: SlideProps) {
  const progressPct = recap.goal?.progressPct ?? null;

  return (
    <div
      style={{
        width: tok.canvasWidth,
        height: tok.canvasHeight,
        backgroundColor: tok.bg,
        display: "flex",
        flexDirection: "column",
        paddingLeft: tok.safeInset,
        paddingRight: tok.safeInset,
        paddingTop: tok.igTopChrome,
        paddingBottom: tok.igBottomChrome,
        fontFamily: tok.fontSans,
        color: tok.primaryText,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* ProgressRing — % inside; streak + "On to Week N." below */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, flex: 1, justifyContent: "center" }}>
        <ProgressRing
          tok={tok}
          diameter={tok.bullseyeStoryDiameter}
          progressPct={progressPct}
          goalState={recap.goalState}
          displayFont={displayFont}
          displayWeight={displayWeight}
        />
        <div style={{ fontSize: tok.fontSize.streakNumeral, fontFamily: displayFont, fontWeight: displayWeight, color: tok.accentText, lineHeight: 1 }}>
          {String(recap.streakDays)}
        </div>
        <div style={{ fontSize: tok.fontSize.readinessLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText, letterSpacing: 3 }}>
          DAY STREAK
        </div>

        {/* "On to Week N." line — only when programWeek is non-null (S-1) */}
        {recap.header.programWeek !== null && (
          <div
            style={{
              fontSize: 48,
              fontFamily: displayFont,
              fontWeight: displayWeight,
              color: tok.primaryText,
              textAlign: "center",
              marginTop: 16,
            }}
          >
            {`On to Week ${recap.header.programWeek + 1}.`}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: tok.fontSize.footerWordmark, fontFamily: displayFont, fontWeight: displayWeight, color: tok.primaryText, letterSpacing: 4 }}>
          GOALDMINE
        </div>
        {recap.instagramHandle !== null && (
          <div style={{ fontSize: tok.fontSize.statLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText }}>
            {recap.instagramHandle}
          </div>
        )}
      </div>
    </div>
  );
}
