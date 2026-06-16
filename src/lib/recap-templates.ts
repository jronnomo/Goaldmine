// src/lib/recap-templates.ts
// Frozen palette + typography constants for OG card templates.
// All px values are provisional (verify-visually per UXR-recap-17).
// These are the ONLY hardcoded hex values in the feature — documented exception
// to the no-color-literals invariant (satori cannot read CSS vars).

import type { RecapTemplate } from "@/lib/recap";

export type TemplateTokens = {
  // Background
  bg: string;
  liftedSurface: string; // streak band + footer band bg

  // Hairlines
  hairline: string; // track bg, dividers, unfilled ring shell

  // Text roles
  primaryText: string;
  mutedText: string;
  accentText: string; // bar fill color, hero %, streak numeral

  // Bullseye rings — outline color for unfilled rings; filled rings use barFillBg (gold)
  bullseyeUnfilledBorder: string;

  // Bar
  barTrackBg: string;
  barFillBg: string;
  barHeight: number; // px
  barRadius: number; // px

  // Success / warning (for optional use)
  success: string;

  // Fonts — names must exactly match the `name` field passed to ImageResponse fonts array
  fontSans: string; // "GeistSans" — Geist Regular + SemiBold
  fontSerif: string; // "DMSerifDisplay" — DM Serif Display (Template B only)

  // Type scale (px) — all provisional per UXR-recap-17
  fontSize: {
    headerCounter: number; // WEEK N · DAY M label
    dateRange: number; // date range
    goalObjective: number; // goal objective headline
    readinessLabel: number; // "READINESS" label
    heroReadinessPct: number; // the big % number
    streakNumeral: number; // the big streak number
    statValue: number; // 2×2 stat cell values
    statLabel: number; // 2×2 stat cell labels
    footerWordmark: number; // GOALDMINE footer
  };

  // Font weights
  fontWeight: {
    regular: number; // 400
    semibold: number; // 600
  };

  // Layout (px)
  canvasWidth: number; // 1080
  canvasHeight: number; // 1920
  safeInset: number; // 64 — safe inset from canvas edges
  igTopChrome: number; // 140 — extra top clearance for IG Story chrome
  igBottomChrome: number; // 116 — extra bottom clearance for IG Story chrome

  // Zone heights (px, provisional per UXR-recap-03)
  zoneHeight: {
    header: number; // ~150
    goalBlock: number; // ~440
    streakBand: number; // ~240
    statGrid: number; // ~460
    footer: number; // ~140
  };

  // Progress ring diameters (px)
  bullseyeHeroDiameter: number; // 300 — feed card goal block
  bullseyeStoryDiameter: number; // 400 — story-slide hero (larger canvas centre)
  bullseyeHeaderDiameter: number; // 44
  bullseyeFooterDiameter: number; // 48

  // Stat cell divider color
  statDivider: string;
};

// ── Template A: Coal (dark, bold, default) ────────────────────────────────────
export const COAL: TemplateTokens = {
  bg: "#0F0B07",
  liftedSurface: "#1A130C",
  hairline: "#3A2E1F",

  primaryText: "#F4E9D4",
  mutedText: "#9C8866",
  accentText: "#D4A437",

  bullseyeUnfilledBorder: "#9C8866",

  barTrackBg: "#3A2E1F",
  barFillBg: "#D4A437",
  barHeight: 28,
  barRadius: 14,

  success: "#7FA45C",

  fontSans: "GeistSans",
  fontSerif: "DMSerifDisplay",

  fontSize: {
    headerCounter: 34,
    dateRange: 30,
    goalObjective: 64,
    readinessLabel: 30,
    heroReadinessPct: 300,
    streakNumeral: 140,
    statValue: 88,
    statLabel: 30,
    footerWordmark: 40,
  },

  fontWeight: {
    regular: 400,
    semibold: 600,
  },

  canvasWidth: 1080,
  canvasHeight: 1920,
  safeInset: 64,
  igTopChrome: 140,
  igBottomChrome: 116,

  zoneHeight: {
    header: 150,
    goalBlock: 440,
    streakBand: 240,
    statGrid: 460,
    footer: 140,
  },

  bullseyeHeroDiameter: 300,
  bullseyeStoryDiameter: 400,
  bullseyeHeaderDiameter: 44,
  bullseyeFooterDiameter: 48,

  statDivider: "#3A2E1F",
};

// ── Template B: Parchment (light, minimal, editorial) ─────────────────────────
// NOTE: DM Serif Display drives the headline + all display numerals.
// Gold #8A6212 (~4.96:1 on cream) — ONLY for ≥30px or fills, NEVER small text.
// Small stat labels use mutedText (#7A5E3A, 5.44:1). (UXR-recap-19)
export const PARCHMENT: TemplateTokens = {
  bg: "#FAF3E3",
  liftedSurface: "#FFFBF0",
  hairline: "#D9C8A2",

  primaryText: "#1F1408",
  mutedText: "#7A5E3A",
  accentText: "#8A6212", // bar fill, large display only (see note above)

  bullseyeUnfilledBorder: "#7A5E3A",

  barTrackBg: "#D9C8A2",
  barFillBg: "#8A6212",
  barHeight: 12,
  barRadius: 6,

  success: "#4E6B36",

  fontSans: "GeistSans",
  fontSerif: "DMSerifDisplay",

  fontSize: {
    headerCounter: 30,
    dateRange: 28,
    goalObjective: 80, // DM Serif Display
    readinessLabel: 28,
    heroReadinessPct: 150, // DM Serif Display
    streakNumeral: 140, // DM Serif Display
    statValue: 68, // DM Serif Display
    statLabel: 26, // Geist Regular (muted)
    footerWordmark: 40, // DM Serif Display
  },

  fontWeight: {
    regular: 400,
    semibold: 600,
  },

  canvasWidth: 1080,
  canvasHeight: 1920,
  safeInset: 64,
  igTopChrome: 140,
  igBottomChrome: 116,

  zoneHeight: {
    header: 150,
    goalBlock: 440,
    streakBand: 240,
    statGrid: 460,
    footer: 140,
  },

  bullseyeHeroDiameter: 320, // slightly larger for Parchment's negative-space feel
  bullseyeStoryDiameter: 400,
  bullseyeHeaderDiameter: 44,
  bullseyeFooterDiameter: 48,

  statDivider: "#D9C8A2",
};

export function getTemplate(t: RecapTemplate): TemplateTokens {
  return t === "parchment" ? PARCHMENT : COAL;
}
