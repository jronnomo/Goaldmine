# Architecture Blueprint — Weekly Recap Card

**Author**: Architect Agent
**Date**: 2026-06-15
**Feature**: Weekly Recap Card
**PRD**: `docs/prds/PRD-weekly-recap-card.md`
**UX**: `docs/ux-research/weekly-recap-card.md`

> This document is the FROZEN INTERFACE CONTRACT between Stream A (Engine + Render + MCP) and Stream B (Routes + Page). Stream B may NOT deviate from type definitions, function signatures, or export names in §2–§3. Stream A may NOT deviate from the shapes Stream B depends on. If a conflict arises, STOP and ask the Orchestrator — do not resolve independently.

---

## 1. File Plan

| Action | Path | Purpose | Key Exports | Owning Stream |
|--------|------|---------|-------------|---------------|
| CREATE | `src/lib/recap.ts` | Data aggregator — single source of all weekly stats | `computeWeeklyRecap`, `WeeklyRecap`, all sub-types | **A** |
| CREATE | `src/lib/recap-templates.ts` | Frozen token constants for Coal + Parchment templates | `COAL`, `PARCHMENT`, `RecapTemplate`, `getTemplate` | **A** |
| CREATE | `src/lib/recap-card.tsx` | Satori-compatible JSX shared by routes AND MCP tool | `RecapCard`, `RecapStorySlide` | **A** |
| MODIFY | `src/lib/mcp/tool-helpers.ts` | Add image+text result helper | `imageAndJsonResult` | **A** |
| MODIFY | `src/lib/mcp/tools.ts` | Register `generate_recap_card` tool | (new registration block) | **A** |
| CREATE | `src/app/recap/fonts/Geist-Regular.ttf` | Bundled font — labels, body, footer (subset ≤40KB) | (asset) | **A** |
| CREATE | `src/app/recap/fonts/Geist-SemiBold.ttf` | Bundled font — Template A display/values/hero (subset ≤40KB) | (asset) | **A** |
| CREATE | `src/app/recap/fonts/DMSerifDisplay-Regular.ttf` | Bundled font — Template B all display type (subset ≤40KB) | (asset) | **A** |
| CREATE | `src/app/recap/card/route.tsx` | GET /recap/card?weekOffset&goalId&template → 1080×1920 PNG | (route handler) | **B** |
| CREATE | `src/app/recap/story/[slide]/route.tsx` | GET /recap/story/1|2|3?weekOffset&goalId&template → 1080×1920 PNG | (route handler) | **B** |
| CREATE | `src/app/recap/page.tsx` | Server component — initial recap read + page shell | (default export) | **B** |
| CREATE | `src/components/RecapClient.tsx` | Client component — week selector, template switcher, download buttons | `RecapClient` | **B** |
| MODIFY | `src/app/progress/page.tsx` | Add "Share recap" entry link | (link addition) | **B** |
| MODIFY | `src/components/BottomNav.tsx` | Widen Progress `match` predicate to include `/recap` | (one-line predicate change) | **B** |

**Font strategy**: Source from Google Fonts (`geist` npm ships only `.woff2`; DM Serif Display not in the package). Download `.ttf` originals, subset to Latin Basic + digits + `· % — / , . :` via `pyftsubset` (fonttools) or glyphhanger. Target ≤40KB per file, ≤120KB total. Store under `src/app/recap/fonts/`. Load via `fs.readFileSync` as shown in §5. The bundled `Geist-Regular.ttf` at `node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf` may be used for Regular only as a fallback during dev to unblock Stream A, but the properly-subsetted file under `src/app/recap/fonts/` is the production asset.

---

## 2. Type Definitions (FROZEN — copy-paste into `src/lib/recap.ts`)

```typescript
// ─── Template ────────────────────────────────────────────────────────────────

export type RecapTemplate = "coal" | "parchment";

export type RecapSlide = 1 | 2 | 3;

// ─── Sub-types ───────────────────────────────────────────────────────────────

/** A PR set during the recap week — one row per canonical exercise. */
export type RecapPR = {
  /** canonicalExerciseName output — never the raw Strong name. */
  name: string;
  /** The best value (weight lb, reps, seconds, etc.). */
  bestValue: number;
  /** Human-readable unit string from ExerciseSummary (e.g. "lb", "reps", "sec"). */
  units: string;
};

/** Goal progress block. Null when no focus goal exists. */
export type RecapGoalBlock = {
  id: string;
  /** Goal.objective text — may be long; card must wrap/truncate. */
  objective: string;
  /**
   * 0–100 readiness score, or null when all targets are missing / no targets.
   * NULL must render as "—" (muted) — never as "0%".
   * Computed as: computeReadiness(targets, weekEnd, goal.id).score,
   * with null when snapshot.missing.length === targets.length || targets.length === 0.
   */
  progressPct: number | null;
  /**
   * Human label for the highest-weight non-missing target (e.g. "Body weight").
   * Used as a sub-label on the progress bar. Null when no usable targets.
   */
  topMetricLabel: string | null;
  /**
   * "fitness" | "project" | string — from Goal.kind.
   * Used for the small goal-kind accent mark (fitness→rust, project→gold, unknown→gold).
   */
  kind: string;
};

/** Program header data. All fields null when no active plan. */
export type RecapProgramHeader = {
  /** 1-based week number, capped at totalWeeks. Null when no active plan. */
  programWeek: number | null;
  /** 1-based day of program, clamped to [1, totalProgramDays]. Null when no active plan. */
  dayOfProgram: number | null;
  /** plan.template.totalWeeks * 7. Dynamic — currently 84 for the 12-week plan. NOT a hardcoded 90. */
  totalProgramDays: number | null;
};

// ─── WeeklyRecap (the central contract) ──────────────────────────────────────

/**
 * The complete weekly recap data bundle. Produced by computeWeeklyRecap().
 * Consumed by RecapCard, RecapStorySlide, and the MCP tool's stats text block.
 * Stream B codes entirely against this type — do not change field names or nullability
 * without coordinating with Stream A.
 */
export type WeeklyRecap = {
  // ── Time window ──────────────────────────────────────────────────────────
  /** Monday 00:00:00 USER_TZ of the recap week. */
  weekStart: Date;
  /** Sunday 23:59:59.999 USER_TZ of the recap week. */
  weekEnd: Date;
  /** weekOffset as passed in (0 = current week, -1 = last week, etc.). */
  weekOffset: number;
  /**
   * Display date range string, e.g. "Jun 9 – Jun 15".
   * Pre-formatted so card JSX doesn't do date math.
   */
  dateRangeLabel: string;

  // ── Program header ───────────────────────────────────────────────────────
  header: RecapProgramHeader;

  // ── Goal progress ────────────────────────────────────────────────────────
  /**
   * Null when no focus goal exists.
   */
  goal: RecapGoalBlock | null;

  // ── Weekly activity stats ─────────────────────────────────────────────────
  /** Count of completed workouts in the week. Zero when none. */
  workoutsCompleted: number;
  /**
   * Total volume in lb across all completed-workout sets (weightLb * reps).
   * Duration-only (cardio) sets contribute 0.
   * Null (not 0) when workoutsCompleted === 0 — renders as "—".
   */
  volumeLb: number | null;
  /** Count of exercises whose all-time PR (bestDate) fell in this week. */
  prCount: number;
  /** Subset of ExerciseSummary rows whose bestDate ∈ [weekStart, weekEnd]. */
  prs: RecapPR[];
  /**
   * Total hike elevation gain (ft) for completed hikes in the week.
   * Null (not 0) when no hikes — renders as "—".
   */
  hikeElevationFt: number | null;
  /**
   * Current game-engine streak (gameState.streak.current).
   * NOTE: always reflects NOW, not the streak as of weekEnd for past weeks.
   * This is an accepted limitation — document in card footer copy for past weeks.
   */
  streakDays: number;

  // ── Empty-state flags ────────────────────────────────────────────────────
  /** True when getActiveProgram() returns null. */
  noProgram: boolean;
  /**
   * True when goal is null OR goal.progressPct is null
   * (no focus goal, or focus goal has no/all-missing targets).
   */
  noGoalTargets: boolean;
  /** True when workoutsCompleted === 0 AND hikeElevationFt === null. */
  emptyWeek: boolean;
};
```

---

## 3. Function Signatures (FROZEN)

### 3.1 `computeWeeklyRecap` — `src/lib/recap.ts`

```typescript
/**
 * Aggregates all weekly recap data for the given week.
 *
 * @param asOf   Reference date to anchor "current week" (typically `new Date()`).
 *               Pass `new Date()` from route handlers and the MCP tool.
 * @param opts.goalId      If provided, use this goal instead of the focus goal.
 * @param opts.weekOffset  Integer in [-26, 0]. 0 = current week through asOf.
 *                         Applied as: addDays(startOfWeekMonday(asOf), weekOffset * 7).
 *
 * @returns Promise<WeeklyRecap> — never throws; errors surface as null/zero fields.
 */
export async function computeWeeklyRecap(
  asOf: Date,
  opts?: { goalId?: string; weekOffset?: number },
): Promise<WeeklyRecap>
```

**Implementation notes (Stream A):**

1. `weekOffset` defaults to `0`. Clamp to `[-26, 0]` before use (defensively — Zod handles it at the MCP layer).
2. Week window:
   ```typescript
   const thisMonday = startOfWeekMonday(asOf);
   const monday = addDays(thisMonday, (opts?.weekOffset ?? 0) * 7);
   const sunday = endOfWeekSunday(monday);
   ```
3. Focus goal query:
   ```typescript
   const goal = opts?.goalId
     ? await prisma.goal.findFirst({ where: { id: opts.goalId } })
     : await prisma.goal.findFirst({
         where: { isFocus: true },
         orderBy: { updatedAt: "desc" },
       });
   const targets = (goal?.targets as unknown as GoalTarget[] | null) ?? [];
   ```
4. Progress %:
   ```typescript
   const snapshot = targets.length > 0
     ? await computeReadiness(targets, sunday, goal!.id)
     : null;
   // null when no targets OR all missing:
   const progressPct =
     !snapshot || snapshot.missing.length === targets.length ? null : snapshot.score;
   ```
5. `topMetricLabel`: from `snapshot.breakdown` — find the first `TargetProgress` where `progress !== null`, sorted by `target.weight` descending. Take `target.label`. Null if none.
6. Program header: use `getActiveProgram()` + `getTodayContext`-style day math (verbatim from research-output Q3, using `sunday` as the reference day, NOT `asOf` — so past-week headers reflect the week's last day):
   ```typescript
   const plan = await getActiveProgram();
   // when plan is not null:
   const totalProgramDays = plan.template.totalWeeks * 7;
   const startMidnight = startOfDay(plan.startedOn);
   const refDay = startOfDay(sunday);  // clamp to today for weekOffset=0
   const daysSinceStart = Math.max(0, Math.round(
     (refDay.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24)
   ));
   const programWeek = Math.min(plan.template.totalWeeks, Math.floor(daysSinceStart / 7) + 1);
   const dayOfProgram = Math.max(1, Math.min(totalProgramDays, daysSinceStart + 1));
   ```
7. Volume query: Prisma `workout.findMany({ where: { startedAt: { gte: monday, lte: sunday }, status: "completed" }, include: { exercises: { include: { sets: true } } } })`. Volume = `Σ (set.weightLb * set.reps)` for sets where both are non-null.
8. PRs: `(await getExerciseSummaries()).filter(s => s.bestDate >= monday && s.bestDate <= sunday)`.
9. Hike elevation: `prisma.hike.findMany({ where: { date: { gte: monday, lte: sunday }, status: "completed" } })` → `Σ elevationFt`. Null if zero hikes.
10. Streak: `(await computeGameState()).streak.current`.
11. `dateRangeLabel`: format `monday` and `sunday` as `"Mon D"` in USER_TZ (e.g. `"Jun 9 – Jun 15"`). Use `Intl.DateTimeFormat` with `timeZone: USER_TZ` or a helper from `@/lib/calendar`.
12. All DB access via `import { prisma } from "@/lib/db"`. No raw SQL.
13. `grep -ri "elbert" src/lib/recap.ts` must return empty.

---

### 3.2 `RecapCard` — `src/lib/recap-card.tsx`

```typescript
/**
 * Satori-compatible JSX for the 1080×1920 full card.
 * Inline styles only — no Tailwind classes, no CSS vars, no CSS grid.
 * Flex-only layout. No DOM/browser APIs.
 * Used by: /recap/card route handler AND generate_recap_card MCP tool.
 */
export function RecapCard(props: {
  recap: WeeklyRecap;
  template: RecapTemplate;
}): JSX.Element
```

### 3.3 `RecapStorySlide` — `src/lib/recap-card.tsx`

```typescript
/**
 * Satori-compatible JSX for a single Stories slide (1080×1920).
 * slide 1 = Cover (header + goal + readiness hero)
 * slide 2 = Numbers (streak band + 2×2 stat grid)
 * slide 3 = Closing (big Bullseye + streak + "On to Week N.")
 * Used by: /recap/story/[slide] route handler.
 */
export function RecapStorySlide(props: {
  recap: WeeklyRecap;
  template: RecapTemplate;
  slide: RecapSlide;
}): JSX.Element
```

### 3.4 `imageAndJsonResult` — `src/lib/mcp/tool-helpers.ts`

```typescript
/**
 * Returns an MCP content-block array: one image block + one text/JSON block.
 * The image block uses raw base64 (no data-URI prefix) per MCP ImageContentSchema.
 * The text block is JSON.stringify of stats (the WeeklyRecap, or a subset).
 * NOT wrapped in safe() — the MCP tool handler calls this directly after
 * successful render and catches errors with errorResult() in a try/catch.
 */
export function imageAndJsonResult(pngBuffer: Buffer, stats: unknown) {
  return {
    content: [
      {
        type: "image" as const,
        data: pngBuffer.toString("base64"),
        mimeType: "image/png",
      },
      {
        type: "text" as const,
        text: JSON.stringify(stats, null, 2),
      },
    ],
  };
}
```

---

## 4. Template Token Constants — `src/lib/recap-templates.ts`

Stream A creates this file. Stream B imports `getTemplate(t: RecapTemplate)` (never accesses `COAL`/`PARCHMENT` directly in route files — always via `getTemplate`).

```typescript
// src/lib/recap-templates.ts
// Frozen palette + typography constants for OG card templates.
// All px values are provisional (verify-visually per UXR-recap-17).
// These are the ONLY hardcoded hex values in the feature — documented exception
// to the no-color-literals invariant (satori cannot read CSS vars).

import type { RecapTemplate } from "@/lib/recap";

export type TemplateTokens = {
  // Background
  bg: string;
  liftedSurface: string;   // streak band + footer band bg

  // Hairlines
  hairline: string;         // track bg, dividers, unfilled ring shell

  // Text roles
  primaryText: string;
  mutedText: string;
  accentText: string;       // bar fill color, hero %, streak numeral

  // Bullseye rings (out → in: ring0, ring1, ring2, ring3)
  bullseyeRingColors: [string, string, string, string];
  bullseyeUnfilledBorder: string;

  // Bar
  barTrackBg: string;
  barFillBg: string;
  barHeight: number;        // px
  barRadius: number;        // px

  // Success / warning (for optional use)
  success: string;

  // Fonts — names must exactly match the `name` field passed to ImageResponse fonts array
  fontSans: string;         // "GeistSans" — Geist Regular + SemiBold
  fontSerif: string;        // "DMSerifDisplay" — DM Serif Display (Template B only)

  // Type scale (px) — all provisional per UXR-recap-17
  fontSize: {
    headerCounter: number;   // WEEK N · DAY M label
    dateRange: number;       // date range
    goalObjective: number;   // goal objective headline
    readinessLabel: number;  // "READINESS" label
    heroReadinessPct: number; // the big % number
    streakNumeral: number;   // the big streak number
    statValue: number;       // 2×2 stat cell values
    statLabel: number;       // 2×2 stat cell labels
    footerWordmark: number;  // GOALDMINE footer
  };

  // Font weights
  fontWeight: {
    regular: number;    // 400
    semibold: number;   // 600
  };

  // Layout (px)
  canvasWidth: number;   // 1080
  canvasHeight: number;  // 1920
  safeInset: number;     // 64 — safe inset from canvas edges
  igTopChrome: number;   // 140 — extra top clearance for IG Story chrome
  igBottomChrome: number; // 116 — extra bottom clearance for IG Story chrome

  // Zone heights (px, provisional per UXR-recap-03)
  zoneHeight: {
    header: number;      // ~150
    goalBlock: number;   // ~440
    streakBand: number;  // ~240
    statGrid: number;    // ~460
    footer: number;      // ~140
  };

  // Bullseye hero diameter (px)
  bullseyeHeroDiameter: number; // 300
  bullseyeHeaderDiameter: number; // 44
  bullseyeFooterDiameter: number; // 48

  // Stat cell divider color
  statDivider: string;
};

// ── Template A: Coal (dark, bold, default) ────────────────────────────────────
export const COAL: TemplateTokens = {
  bg:            "#0F0B07",
  liftedSurface: "#1A130C",
  hairline:      "#3A2E1F",

  primaryText:   "#F4E9D4",
  mutedText:     "#9C8866",
  accentText:    "#D4A437",

  // Out→in: ring0 fill / ring1 fill / ring2 fill / ring3 fill
  bullseyeRingColors: ["#C0392B", "#FFFFFF", "#C0392B", "#FFFFFF"],
  bullseyeUnfilledBorder: "#9C8866",

  barTrackBg: "#3A2E1F",
  barFillBg:  "#D4A437",
  barHeight:  28,
  barRadius:  14,

  success: "#7FA45C",

  fontSans:  "GeistSans",
  fontSerif: "DMSerifDisplay",

  fontSize: {
    headerCounter:    34,
    dateRange:        30,
    goalObjective:    64,
    readinessLabel:   30,
    heroReadinessPct: 300,
    streakNumeral:    140,
    statValue:        88,
    statLabel:        30,
    footerWordmark:   40,
  },

  fontWeight: {
    regular:  400,
    semibold: 600,
  },

  canvasWidth:  1080,
  canvasHeight: 1920,
  safeInset:    64,
  igTopChrome:    140,
  igBottomChrome: 116,

  zoneHeight: {
    header:     150,
    goalBlock:  440,
    streakBand: 240,
    statGrid:   460,
    footer:     140,
  },

  bullseyeHeroDiameter:   300,
  bullseyeHeaderDiameter: 44,
  bullseyeFooterDiameter: 48,

  statDivider: "#3A2E1F",
};

// ── Template B: Parchment (light, minimal, editorial) ─────────────────────────
// NOTE: DM Serif Display drives the headline + all display numerals.
// Gold #8A6212 (~4.96:1 on cream) — ONLY for ≥30px or fills, NEVER small text.
// Small stat labels use mutedText (#7A5E3A, 5.44:1). (UXR-recap-19)
export const PARCHMENT: TemplateTokens = {
  bg:            "#FAF3E3",
  liftedSurface: "#FFFBF0",
  hairline:      "#D9C8A2",

  primaryText:   "#1F1408",
  mutedText:     "#7A5E3A",
  accentText:    "#8A6212",   // bar fill, large display only (see note above)

  bullseyeRingColors: ["#A82A1F", "#FFFBF0", "#A82A1F", "#FFFBF0"],
  bullseyeUnfilledBorder: "#7A5E3A",

  barTrackBg: "#D9C8A2",
  barFillBg:  "#8A6212",
  barHeight:  12,
  barRadius:  6,

  success: "#4E6B36",

  fontSans:  "GeistSans",
  fontSerif: "DMSerifDisplay",

  fontSize: {
    headerCounter:    30,
    dateRange:        28,
    goalObjective:    80,     // DM Serif Display
    readinessLabel:   28,
    heroReadinessPct: 150,    // DM Serif Display
    streakNumeral:    140,    // DM Serif Display
    statValue:        68,     // DM Serif Display
    statLabel:        26,     // Geist Regular (muted)
    footerWordmark:   40,     // DM Serif Display
  },

  fontWeight: {
    regular:  400,
    semibold: 600,
  },

  canvasWidth:  1080,
  canvasHeight: 1920,
  safeInset:    64,
  igTopChrome:    140,
  igBottomChrome: 116,

  zoneHeight: {
    header:     150,
    goalBlock:  440,
    streakBand: 240,
    statGrid:   460,
    footer:     140,
  },

  bullseyeHeroDiameter:   320,  // slightly larger for Parchment's negative-space feel
  bullseyeHeaderDiameter: 44,
  bullseyeFooterDiameter: 48,

  statDivider: "#D9C8A2",
};

export function getTemplate(t: RecapTemplate): TemplateTokens {
  return t === "parchment" ? PARCHMENT : COAL;
}
```

**Typography note for `RecapCard` / `RecapStorySlide`:**
- Template A uses `fontSans` (GeistSans) at `semibold` (600) for all display numerals, labels, and objective. Regular (400) for muted sub-labels.
- Template B uses `fontSerif` (DMSerifDisplay) at `regular` (400) for objective, hero %, streak numeral, stat values, and footer wordmark. `fontSans` regular for all muted labels and sub-labels.
- The font `name` field in `ImageResponse({ fonts: [...] })` must exactly match `tok.fontSans` / `tok.fontSerif` strings, and the `weight` field must exactly match 400 or 600.

---

## 5. next/og Specifics

### 5.1 Runtime declaration (all new route files)

```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

These two exports must appear at the top of every new file under `src/app/recap/`.

### 5.2 Font loading (shared pattern for both route handlers)

```typescript
import fs from "fs";
import path from "path";

// Load at module scope (cached on cold start — avoid re-reading per request)
const FONTS_DIR = path.join(process.cwd(), "src/app/recap/fonts");

const fontGeistRegular: ArrayBuffer = fs.readFileSync(
  path.join(FONTS_DIR, "Geist-Regular.ttf")
).buffer as ArrayBuffer;

const fontGeistSemiBold: ArrayBuffer = fs.readFileSync(
  path.join(FONTS_DIR, "Geist-SemiBold.ttf")
).buffer as ArrayBuffer;

const fontDMSerifDisplay: ArrayBuffer = fs.readFileSync(
  path.join(FONTS_DIR, "DMSerifDisplay-Regular.ttf")
).buffer as ArrayBuffer;
```

> IMPORTANT: `fs.readFileSync(...).buffer` returns `ArrayBuffer`. TypeScript may require an explicit `as ArrayBuffer` cast because `Buffer` extends `Uint8Array` and `.buffer` is typed as `ArrayBufferLike`. Add the cast.

### 5.3 ImageResponse options (frozen dimensions)

```typescript
import { ImageResponse } from "next/og";

const IMAGE_OPTIONS = {
  width: 1080,
  height: 1920,
  fonts: [
    { name: "GeistSans",      data: fontGeistRegular,   weight: 400 as const, style: "normal" as const },
    { name: "GeistSans",      data: fontGeistSemiBold,  weight: 600 as const, style: "normal" as const },
    { name: "DMSerifDisplay", data: fontDMSerifDisplay, weight: 400 as const, style: "normal" as const },
  ],
} as const;

// Usage in route handler:
return new ImageResponse(<RecapCard recap={recap} template={template} />, IMAGE_OPTIONS);

// Usage in MCP tool (extract PNG):
const res = new ImageResponse(<RecapCard recap={recap} template={template} />, IMAGE_OPTIONS);
const buf = Buffer.from(await res.arrayBuffer());
// buf is now a Buffer containing the PNG — pass to imageAndJsonResult(buf, recap)
```

### 5.4 Query param validation for route handlers

`/recap/card/route.tsx`:
```typescript
import { z } from "zod";

const CardParamsSchema = z.object({
  weekOffset: z.coerce.number().int().min(-26).max(0).default(0),
  goalId:     z.string().optional(),
  template:   z.enum(["coal", "parchment"]).default("coal"),
});

// In GET handler:
const { searchParams } = new URL(request.url);
const parsed = CardParamsSchema.safeParse(Object.fromEntries(searchParams));
if (!parsed.success) {
  return new Response("Invalid parameters", { status: 400 });
}
const { weekOffset, goalId, template } = parsed.data;
```

`/recap/story/[slide]/route.tsx`:
```typescript
const SlideParamsSchema = z.object({
  weekOffset: z.coerce.number().int().min(-26).max(0).default(0),
  goalId:     z.string().optional(),
  template:   z.enum(["coal", "parchment"]).default("coal"),
});

// Slide from dynamic segment — validate separately:
const slideNum = Number(params.slide);
if (![1, 2, 3].includes(slideNum)) {
  return new Response("Slide must be 1, 2, or 3", { status: 400 });
}
const slide = slideNum as RecapSlide;
```

---

## 6. Data Flows

### Flow A — `/recap/card` route → PNG

```
GET /recap/card?weekOffset=-1&template=coal
  └─► CardParamsSchema.safeParse(searchParams)
  └─► computeWeeklyRecap(new Date(), { weekOffset: -1, goalId? })
        ├─► startOfWeekMonday(now) → addDays → monday/sunday window
        ├─► prisma.goal.findFirst({ isFocus: true })  [or goalId lookup]
        ├─► computeReadiness(targets, sunday, goal.id)
        ├─► prisma.workout.findMany(week window, status:"completed", include sets)
        ├─► getExerciseSummaries() → filter bestDate ∈ [monday, sunday]
        ├─► prisma.hike.findMany(week window, status:"completed")
        ├─► getActiveProgram() → programWeek/dayOfProgram math
        └─► computeGameState().streak.current
  └─► RecapCard({ recap, template: "coal" })
  └─► new ImageResponse(<RecapCard/>, IMAGE_OPTIONS)
  └─► return Response (PNG, Content-Type: image/png)
```

### Flow B — MCP `generate_recap_card` → image + text blocks

```
MCP tools/call generate_recap_card { weekOffset: 0 }
  └─► Zod inputSchema validation (weekOffset int [-26,0], goalId?, template?)
  └─► computeWeeklyRecap(new Date(), { weekOffset: 0 })
  └─► new ImageResponse(<RecapCard recap={recap} template="coal"/>, IMAGE_OPTIONS)
  └─► const buf = Buffer.from(await imageResponse.arrayBuffer())
  └─► return imageAndJsonResult(buf, recap)
        → { content: [
              { type:"image", data: buf.toString("base64"), mimeType:"image/png" },
              { type:"text",  text: JSON.stringify(recap, null, 2) }
           ] }
```

Error path: wrap the entire handler body in `try/catch`; on error return `errorResult(e.message)`.

### Flow C — `/recap` page (server + client)

```
Server: src/app/recap/page.tsx
  └─► computeWeeklyRecap(new Date(), { weekOffset: 0 })  [initial render only]
  └─► renders <RecapClient initialRecap={recap} />

Client: src/components/RecapClient.tsx  ("use client")
  └─► state: weekOffset (int, init 0), template (RecapTemplate, init "coal")
  └─► preview <img src={`/recap/card?weekOffset=${weekOffset}&template=${template}`} />
         (controlled: src updates on state change → browser fetches new PNG)
  └─► "Download card"    → <a href={`/recap/card?weekOffset=...`} download="recap-card.png">
  └─► "Download Stories" → 3 staggered <a> downloads for slides 1/2/3
  └─► Week selector: ◀ (weekOffset - 1, floor -26) / This week / ▶ (weekOffset + 1, ceil 0)
  └─► Template toggle:   "Coal" | "Parchment" buttons (aria-pressed)
```

---

## 7. MCP Tool Registration

**Location**: `src/lib/mcp/tools.ts` — add AFTER the last `server.registerTool(...)` call, before the closing of `registerAll`.

```typescript
// ── generate_recap_card ──────────────────────────────────────────────────────
server.registerTool(
  "generate_recap_card",
  {
    title: "Generate weekly recap card (shareable image + stats)",
    description:
      "Render the week's recap as a share-ready 9:16 image plus the underlying numbers. " +
      "Defaults to the focus goal and the current week (through today). " +
      'Use for "make my recap card", "weekly recap image", "card for last week". ' +
      "Progress relates to the focus goal's baseline→target metrics. " +
      "Pass goalId for a specific catalogued goal, weekOffset (0=this week, -1=last week) for a different week.",
    inputSchema: {
      weekOffset: z
        .number()
        .int()
        .min(-26)
        .max(0)
        .default(0)
        .describe("0 = current week through today, -1 = last completed week"),
      goalId: z
        .string()
        .optional()
        .describe("Catalogued goal to feature; defaults to the focus goal"),
      template: z
        .enum(["coal", "parchment"])
        .optional()
        .describe(
          'Visual style variant: "coal" (dark, bold, default) or "parchment" (light, editorial serif)'
        ),
    },
  },
  async ({ weekOffset, goalId, template }) => {
    try {
      const recap = await computeWeeklyRecap(new Date(), { weekOffset, goalId });
      const tpl: RecapTemplate = template ?? "coal";
      const res = new ImageResponse(
        <RecapCard recap={recap} template={tpl} />,
        IMAGE_OPTIONS,   // defined at module scope with fonts loaded once
      );
      const buf = Buffer.from(await res.arrayBuffer());
      return imageAndJsonResult(buf, recap);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  },
);
```

**Import additions needed at top of `tools.ts`:**
```typescript
import { ImageResponse } from "next/og";
import { computeWeeklyRecap } from "@/lib/recap";
import { RecapCard } from "@/lib/recap-card";
import { imageAndJsonResult, errorResult } from "@/lib/mcp/tool-helpers";
import type { RecapTemplate } from "@/lib/recap";
import fs from "fs";
import path from "path";
```

**Font loading in `tools.ts`** — add at module scope alongside the font loading pattern from §5.2. The MCP route runs as Node.js (`runtime = "nodejs"` in `src/app/api/mcp/route.ts`), so `fs.readFileSync` works. Load fonts once at module scope — they are re-used across calls within the same cold-start lifecycle.

**`IMAGE_OPTIONS` constant** — define at module scope in `tools.ts` (same shape as §5.3). Note: `tools.ts` and the route handlers both need this constant. Do NOT share it from a common module to avoid any import-side-effect issues in the route build graph. Define it independently in both locations with identical values.

---

## 8. Component Hierarchy — `/recap` Page

```
src/app/recap/page.tsx (Server Component)
  export const runtime = "nodejs"
  export const dynamic = "force-dynamic"
  ├─► computeWeeklyRecap(new Date(), { weekOffset: 0 })  — initial data
  └─► <main>
        <h1>Weekly Recap</h1>
        <RecapClient initialRecap={recap} />    ← "use client" boundary
      </main>

src/components/RecapClient.tsx ("use client")
  props: { initialRecap: WeeklyRecap }
  state:
    weekOffset: number (0)    [int, ≥ -26, ≤ 0]
    template: RecapTemplate ("coal")
    imageLoading: boolean
  ├─► Preview image zone (data-testid="recap-preview")
  │     <img
  │       src={`/recap/card?weekOffset=${weekOffset}&template=${template}`}
  │       alt="Weekly recap card preview"
  │       width={540} height={960}   ← scaled 0.5× for 390px phone
  │       onLoad={() => setImageLoading(false)}
  │       onLoadStart={() => setImageLoading(true)}
  │     />
  │     {imageLoading && <div>Loading...</div>}
  ├─► Week selector (min-height 44px tap targets)
  │     <button data-testid="recap-week-prev" disabled={weekOffset <= -26}>◀</button>
  │     <span>{initialRecap.dateRangeLabel /* updated by re-fetching or passed as prop */}</span>
  │     <button data-testid="recap-week-next" disabled={weekOffset >= 0}>▶</button>
  │     NOTE: when weekOffset changes, refresh the label by calling a server
  │     action OR simply updating the preview URL and relying on
  │     the card's dateRangeLabel from computeWeeklyRecap (the server
  │     returns it in the initial recap; for changed weeks, the
  │     label can be derived client-side from weekOffset arithmetic
  │     against initialRecap.weekStart, or fetched lazily via the card URL
  │     — SIMPLE OPTION: derive the date-range label client-side from
  │     `new Date(initialRecap.weekStart.getTime() + weekOffset * 7 * 86400000)`
  │     using Intl.DateTimeFormat. Keep the server action out of scope.
  ├─► Template toggle (min-height 44px)
  │     <button aria-pressed={template==="coal"} data-testid="recap-template-toggle">Coal</button>
  │     <button aria-pressed={template==="parchment"} ...>Parchment</button>
  ├─► Download card (min-height 44px)
  │     <a href={`/recap/card?weekOffset=${weekOffset}&template=${template}`}
  │        download="recap-card.png"
  │        data-testid="recap-download-card">
  │       Download Card
  │     </a>
  └─► Download Stories (min-height 44px each)
        [1, 2, 3].map(slide =>
          <a href={`/recap/story/${slide}?weekOffset=${weekOffset}&template=${template}`}
             download={`recap-story-${slide}.png`}
             data-testid={`recap-download-story-${slide}`}>
            Download Story {slide}
          </a>
        )

Controls styling: use existing Tailwind tokens (var(--accent), var(--card), var(--border), var(--muted)).
max-w-md mx-auto. All tap targets ≥ 44px. The card canvas itself uses inline hex from template — no Tailwind.
```

---

## 9. Bullseye Div-Stack (Card Component Spec)

The div-stack Bullseye is a concentric set of 4 square divs (each with `borderRadius: "9999px"`, `display: "flex"`, `alignItems: "center"`, `justifyContent: "center"`) sized by ratio: ring0 = `D`, ring1 = `D*0.75`, ring2 = `D*0.5`, ring3 = `D*0.25` where `D = tok.bullseyeHeroDiameter`.

Fill logic:
- Compute `filledRings`: how many rings fill toward center based on `progressPct`.
  - `progressPct === null` or `noGoalTargets` → 0 rings filled → render as single outer shell with `border: "4px solid tok.bullseyeUnfilledBorder"`, transparent fill.
  - `progressPct >= 25` → ring0 fills with `bullseyeRingColors[0]`
  - `progressPct >= 50` → ring1 fills with `bullseyeRingColors[1]`
  - `progressPct >= 75` → ring2 fills with `bullseyeRingColors[2]`
  - `progressPct >= 100` → ring3 fills with `bullseyeRingColors[3]`
  - Unfilled rings show `backgroundColor: "transparent"` with a 1px border in `bullseyeUnfilledBorder`.

This is the primary render. Do NOT use `<svg>` or `<img>` for the Bullseye in the OG card — it is div-stack only (UXR-recap-06, UXR-recap-24).

---

## 10. Empty/Zero State Rules (UXR-recap-09, UXR-recap-10)

These rules are the responsibility of BOTH streams — `recap.ts` sets the null correctly; `recap-card.tsx` renders the distinction.

| Field | Zero / null condition | Card display |
|-------|----------------------|--------------|
| `progressPct` | null (no targets / all missing) | `"—"` in `mutedText` |
| `progressPct` | 0 (has targets, has data, score computed as 0) | `"0%"` in `accentText` |
| `volumeLb` | null (workoutsCompleted === 0) | `"—"` in `mutedText` |
| `hikeElevationFt` | null (no hikes) | `"—"` in `mutedText` |
| `workoutsCompleted` | 0 | `"0"` in `primaryText` (normal color) |
| `prCount` | 0 | `"0"` in `primaryText` (normal color) |
| `streakDays` | 0 | `"0"` in `accentText` (normal color) |
| `header.programWeek` | null (no active plan) | Omit "Week N · Day M of N"; show `dateRangeLabel` only |

Cells NEVER collapse — layout footprint is fixed regardless of values. (UXR-recap-09)

---

## 11. Navigation / BottomNav Changes (Stream B)

### `src/components/BottomNav.tsx` — one-line change

At line 57–60, the Progress tab's `match` predicate:

**Before:**
```typescript
match: (p) =>
  p.startsWith("/progress") ||
  p.startsWith("/stats") ||
  p.startsWith("/baselines"),
```

**After:**
```typescript
match: (p) =>
  p.startsWith("/progress") ||
  p.startsWith("/stats") ||
  p.startsWith("/baselines") ||
  p.startsWith("/recap"),
```

### `src/app/progress/page.tsx` — "Share recap" entry link

Add a link after the existing heading / before the goals grid:
```tsx
<Link
  href="/recap"
  className="flex items-center gap-2 text-sm font-medium text-[var(--accent)] hover:opacity-80 transition-opacity"
>
  <span>Share recap</span>
  <span aria-hidden>→</span>
</Link>
```

Exact placement TBD by Stream B within the page (after the page title, before the readiness cards). Tap target ≥ 44px.

---

## 12. Work Streams + Implementation Order

### Stream ownership (ZERO file overlap)

| Stream | Owns | Imports from |
|--------|------|-------------|
| **A** | `src/lib/recap.ts`, `src/lib/recap-templates.ts`, `src/lib/recap-card.tsx`, `src/app/recap/fonts/*`, `src/lib/mcp/tool-helpers.ts` (modification), `src/lib/mcp/tools.ts` (modification) | `@/lib/calendar`, `@/lib/readiness`, `@/lib/records`, `@/lib/program`, `@/lib/game/engine`, `@/lib/db`, `next/og` |
| **B** | `src/app/recap/card/route.tsx`, `src/app/recap/story/[slide]/route.tsx`, `src/app/recap/page.tsx`, `src/components/RecapClient.tsx`, `src/app/progress/page.tsx` (modification), `src/components/BottomNav.tsx` (modification) | `@/lib/recap` (types + computeWeeklyRecap), `@/lib/recap-card` (RecapCard, RecapStorySlide), `@/lib/recap-templates` (getTemplate) |

**No shared file is owned by both streams. Stream B imports from Stream A; Stream A does NOT import from Stream B.**

### Implementation order

```
Phase 0 — Fonts (Stream A, day 1 morning):
  Download + subset Geist-Regular.ttf, Geist-SemiBold.ttf, DMSerifDisplay-Regular.ttf
  Place under src/app/recap/fonts/
  Verify sizes ≤ 40KB each, ≤ 120KB total
  → SPIKE: load a single test font, call ImageResponse, verify PNG returned (unblocks all else)

Phase 1 — Contracts (Stream A, parallel with font spike):
  Create src/lib/recap-templates.ts  [export COAL, PARCHMENT, getTemplate, TemplateTokens]
  Create src/lib/recap.ts            [export WeeklyRecap type + all sub-types; stub computeWeeklyRecap returning hardcoded fixture]
  → Stream B can now import types and write route handlers / page against the stub

Phase 2 — Parallel development:
  Stream A:                               Stream B (can start as soon as Phase 1 lands):
  ├─ Implement computeWeeklyRecap fully   ├─ Implement /recap/card/route.tsx
  ├─ Create src/lib/recap-card.tsx        ├─ Implement /recap/story/[slide]/route.tsx
  │   (RecapCard + RecapStorySlide)       ├─ Implement /recap/page.tsx
  ├─ Add imageAndJsonResult to            ├─ Implement RecapClient.tsx
  │   tool-helpers.ts                     ├─ Modify progress/page.tsx (Share recap link)
  └─ Register generate_recap_card in      └─ Modify BottomNav.tsx (match predicate)
      tools.ts

Phase 3 — Integration:
  Stream A merges first (lib/* + MCP).
  Stream B rebases on A's merge; final end-to-end smoke.

Phase 4 — QA gates:
  npx tsc --noEmit
  npm run lint
  npm run build
  MCP curl: tools/list → generate_recap_card present
  MCP curl: tools/call { weekOffset: 0 } → image + text blocks
  Browser: /recap at 390px → preview + week selector + template toggle + downloads
  curl /recap/card?weekOffset=0 → 1080×1920 PNG
  curl /recap/story/1 → 1080×1920 PNG
```

---

## 13. Critical Decisions (Locked)

| Decision | Value | Source |
|----------|-------|--------|
| Card dimensions | 1080 × 1920 px | PRD §3.1 |
| `runtime` for all new routes + MCP tool path | `"nodejs"` | research-output Q1; mcp/route.ts:7 |
| Template names (Zod enum) | `"coal" \| "parchment"` | UX report §4.5; PRD §9 |
| Default template | `"coal"` | PRD §4.2 |
| Header denominator | Dynamic: `plan.template.totalWeeks * 7` (currently 84) | PRD §4.5; UXR-recap-25 sign-off |
| Progress % source | `computeReadiness(targets, weekEnd, goal.id).score` | PRD §3.1; requirements REQ-001 |
| Progress null condition | `targets.length === 0` OR `missing.length === targets.length` | research-output Risk 4 |
| Volume formula | `Σ (set.weightLb * set.reps)` for non-null pairs | engine.ts:507–530 |
| PR week filter | `ExerciseSummary.bestDate ∈ [monday, sunday]` | research-output Q4 |
| Streak source | `computeGameState().streak.current` (always live) | research-output Risk 7 |
| Bullseye render | Div-stack `borderRadius:9999px` (NOT `<svg>`) | UXR-recap-06, UXR-recap-24 |
| CSS variables in card | Forbidden — hardcoded hex from `recap-templates.ts` only | UX audit A1 |
| CSS Grid in card | Forbidden — flex-only (`flex:1 1 0` rows) | UXR-recap-04; satori constraint |
| Image content-block `data` prefix | Raw base64 — NO `data:image/png;base64,` prefix | research-output Q5 |
| `@resvg/resvg-js` in app code | Forbidden — devDep only; `next/og` uses bundled WASM | research-output dependencies |
| No Prisma migration | Feature is read-only | PRD §4.1 |
| Entry point to `/recap` | "Share recap" link on progress page only; NOT in BottomNav (5/5 slots) | PRD §4.4; research-output line 97 |

---

## 14. Build-Time Spikes (Stream A validates these first, before writing full card JSX)

| # | Spike | Risk | Validation method |
|---|-------|------|-------------------|
| S1 | **Font bundling under Turbopack** — subset `.ttf` loads, fonts render in satori, no tofu, total <500KB | HIGH — satori won't synthesize weight/serif; if font names don't match exactly the render falls back silently | Write a minimal route handler returning `ImageResponse(<div style={{ fontFamily:"GeistSans", fontWeight:600 }}>Test 123</div>)` with only the font files; curl the route and inspect the PNG |
| S2 | **Div-stack Bullseye renders at 300px** — concentric divs fill correctly, no satori layout anomaly | MEDIUM — satori flex behavior at large sizes can be surprising | Add a Bullseye-only slide to the test route above; inspect fill at 0%, 50%, 100% |
| S3 | **`ImageResponse` from inside MCP tool handler** — `await res.arrayBuffer()` resolves without hanging; WASM loads | MEDIUM — WASM deferred load; first call ~100–200ms extra; acceptable | Add a `curl tools/call generate_recap_card { weekOffset: 0 }` smoke after wiring the tool; verify the image block is non-empty base64 |
| S4 | **DM Serif Display at 150px in Parchment** — no tofu on the readiness numeral | MEDIUM — serif must be explicitly subsetted to include digits + `%` + `—` | Include those glyphs in the subset mask; inspect the test PNG |

Spikes S1+S2 can be done with a single throwaway route handler before any `WeeklyRecap` data is wired. This is the first commit Stream A should make.

---

## 15. Acceptance Criteria Cross-Reference

| PRD AC | Owner | Where verified |
|--------|-------|----------------|
| 1. `npx tsc --noEmit` 0 errors | Both | QA Phase 4 |
| 2. `npm run lint` no new errors | Both | QA Phase 4 |
| 3. `npm run build` succeeds | Both | QA Phase 4 |
| 4. `tools/list` returns `generate_recap_card` | A | MCP curl smoke |
| 5. `tools/call {weekOffset:0}` → image + text blocks | A | MCP curl smoke |
| 6. `progressPct` = `computeReadiness(focusGoal.targets, weekEnd, focusGoal.id).score`; grep elbert empty | A | code review + grep |
| 7. `GET /recap/card?weekOffset=0` → 1080×1920 PNG | B | curl + Content-Type check |
| 8. `GET /recap/story/1,2,3` → 1080×1920 PNG each | B | curl × 3 |
| 9. `/recap` renders preview + week selector + template switch + 2 download buttons at 390px | B | browser smoke |
| 10. Header `Week N · Day M of {totalProgramDays}` from plan `startedOn` | A (data) + A (render) | visual check on card |
| 11. All date math via `@/lib/calendar` | A | code review |
| 12. Empty-week + no-targets states render without crashing | A (data) + A (render) | MCP call with empty week |

---

## Summary (12-line handoff to Devil's Advocate and Developers)

**Frozen `WeeklyRecap` fields:**
`weekStart`, `weekEnd`, `weekOffset`, `dateRangeLabel`, `header` (`programWeek|null`, `dayOfProgram|null`, `totalProgramDays|null`), `goal` (`id`, `objective`, `progressPct: number|null`, `topMetricLabel: string|null`, `kind`), `workoutsCompleted`, `volumeLb: number|null`, `prCount`, `prs: RecapPR[]`, `hikeElevationFt: number|null`, `streakDays`, `noProgram`, `noGoalTargets`, `emptyWeek`.

**Stream A file-set:** `src/lib/recap.ts`, `src/lib/recap-templates.ts`, `src/lib/recap-card.tsx`, `src/app/recap/fonts/*.ttf`, `src/lib/mcp/tool-helpers.ts` (+`imageAndJsonResult`), `src/lib/mcp/tools.ts` (+`generate_recap_card` registration).

**Stream B file-set:** `src/app/recap/card/route.tsx`, `src/app/recap/story/[slide]/route.tsx`, `src/app/recap/page.tsx`, `src/components/RecapClient.tsx`, `src/app/progress/page.tsx` (+Share recap link), `src/components/BottomNav.tsx` (+`/recap` to match predicate).

**Risks to scrutinize:**
1. Font bundling (S1): satori will render Geist-Regular fallback silently if `GeistSans`/`DMSerifDisplay` name mismatches — validate with spike before full card JSX.
2. `ImageResponse` WASM in MCP handler (S3): first-call latency ~200ms acceptable but verify it resolves; WASM may not deduplicate across the stateless-server per-request lifecycle.
3. `progressPct` null logic: the condition `snapshot.missing.length === targets.length` must distinguish "no data yet" (null/`"—"`) from a genuinely computed 0 — wrong branch shows a false 0%.
4. Template B gold `#8A6212` (~4.96:1 AA-pass but tight) — only safe at ≥30px or as fill; stat labels in Parchment must use `mutedText` (`#7A5E3A`, 5.44:1), not `accentText`.
5. `streakDays` is always live-now, not historical — this is a PRD-documented caveat, not a bug, but must be surfaced in card footer copy for past weeks.
