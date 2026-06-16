// src/lib/recap-card.tsx
// Satori-compatible JSX for the weekly recap card (1080×1920).
// Inline styles ONLY — no Tailwind, no CSS vars, no CSS grid.
// Flex-only layout. No DOM/browser APIs.
// Goal-generic — no hardcoded references to specific goals or people.

import React from "react";
import type { WeeklyRecap, RecapTemplate, RecapSlide } from "@/lib/recap";
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

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

// ─── Bullseye div-stack (blueprint §9) ───────────────────────────────────────

type BullseyeProps = {
  tok: TemplateTokens;
  diameter: number;
  progressPct: number | null;
  goalState: WeeklyRecap["goalState"];
};

function Bullseye({ tok, diameter, progressPct, goalState }: BullseyeProps) {
  const D = diameter;
  const sizes = [D, D * 0.75, D * 0.5, D * 0.25];

  // No data → empty shell
  const hasData = goalState === "has-data" && progressPct !== null;
  const pct = hasData ? progressPct! : 0;

  const ringFilled = [pct >= 25, pct >= 50, pct >= 75, pct >= 100];

  function ringStyle(i: number): React.CSSProperties {
    const size = sizes[i];
    const filled = hasData && ringFilled[i];
    return {
      width: size,
      height: size,
      borderRadius: "9999px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: filled ? tok.bullseyeRingColors[i] : "transparent",
      border: filled ? "none" : `1px solid ${tok.bullseyeUnfilledBorder}`,
    };
  }

  return (
    <div style={ringStyle(0)}>
      <div style={ringStyle(1)}>
        <div style={ringStyle(2)}>
          <div style={ringStyle(3)} />
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
}: {
  recap: WeeklyRecap;
  template: RecapTemplate;
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
      {/* ── Header zone ──────────────────────────────────────────────── */}
      <div
        style={{
          height: tok.zoneHeight.header,
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingTop: tok.igTopChrome,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          paddingBottom: 20,
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
            marginTop: programLine ? 4 : 0,
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
        {/* Bullseye + readiness hero */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <Bullseye
            tok={tok}
            diameter={tok.bullseyeHeroDiameter}
            progressPct={progressPct}
            goalState={recap.goalState}
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
          <div
            style={{
              fontSize: 60,
              fontFamily: displayFont,
              fontWeight: displayWeight,
              color: progressPct !== null ? tok.accentText : tok.mutedText,
            }}
          >
            {fmtPct(progressPct)}
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
      <div
        style={{
          height: tok.zoneHeight.statGrid,
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
      <div
        style={{
          height: tok.zoneHeight.footer,
          backgroundColor: tok.liftedSurface,
          paddingLeft: tok.safeInset,
          paddingRight: tok.safeInset,
          paddingBottom: tok.igBottomChrome,
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

      {/* Big Bullseye hero */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, flex: 1, justifyContent: "center" }}>
        <Bullseye
          tok={tok}
          diameter={tok.bullseyeHeroDiameter}
          progressPct={progressPct}
          goalState={recap.goalState}
        />
        <div style={{ fontSize: tok.fontSize.heroReadinessPct, fontFamily: displayFont, fontWeight: displayWeight, color: progressPct !== null ? tok.accentText : tok.mutedText, lineHeight: 1 }}>
          {fmtPct(progressPct)}
        </div>
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
      {/* Big Bullseye */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, flex: 1, justifyContent: "center" }}>
        <Bullseye
          tok={tok}
          diameter={tok.bullseyeHeroDiameter}
          progressPct={progressPct}
          goalState={recap.goalState}
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
