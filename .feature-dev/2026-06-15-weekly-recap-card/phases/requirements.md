# Requirements — Weekly Recap Card

PRD: `docs/prds/PRD-weekly-recap-card.md`. No Prisma migration (read-only feature).

---

## REQ-001 — `computeWeeklyRecap()` aggregator (the data engine)
**Description:** New `src/lib/recap.ts` exporting `computeWeeklyRecap(asOf, opts?)` → typed `WeeklyRecap`. Bundles a week's stats: Mon–Sun boundaries (USER_TZ, `weekOffset`-shifted), `programWeek`, `dayOfProgram`, `totalProgramDays`, `goal { id, objective, progressPct|null, topMetricLabel? }`, `workoutsCompleted`, `volumeLb`, `prCount` + `prs[]`, `hikeElevationFt`, `streakDays`, and empty-state flags (`noProgram`, `noGoalTargets`, `emptyWeek`).
**Goal-generic rule (critical):** `progressPct` = `computeReadiness(focusGoal.targets, weekEnd, focusGoal.id).score`. `topMetricLabel` from the readiness `breakdown` (highest-weight target with data). NO hardcoded "Elbert"/mountain logic. `goalId` opt → that goal; else focus goal (`isFocus: true`).
**Reuses:** week queries (mirror `weekly_summary_data` in `tools.ts`), `computeReadiness` (`@/lib/readiness`), `getExerciseSummaries`/`getBaselineSummaries` (`@/lib/records`) for PRs-this-week (bestDate ∈ week), `@/lib/program` for `programWeek`/plan `startedOn`, `getGameState().streak.current` (`@/lib/game/engine`).
**Files:** create `src/lib/recap.ts`.
**Acceptance:** `tsc` clean; `progressPct` matches `computeReadiness().score` for the focus goal; `grep -ri "elbert" src/lib/recap.ts` empty; week math only via `@/lib/calendar`; `volumeLb` = Σ(weightLb×reps) over completed-workout sets in the week; `prCount` = exercises whose all-time `bestDate` ∈ week.
**Deps:** none. **Complexity:** M.

## REQ-002 — Shared card render module (satori-compatible JSX)
**Description:** New `src/lib/recap-card.tsx` exporting `RecapCard({ recap, template })` and `RecapStorySlide({ recap, template, slide })` — pure JSX consuming a `WeeklyRecap`, used by BOTH the image routes (REQ-003) and the MCP tool (REQ-005) so card markup has one source. Must render under `next/og` `ImageResponse` (flexbox only, inline styles, NO CSS vars, NO grid, bundled font). Implements the header band, goal block + progress bar, 5-stat grid, footer, and empty/zero states. Templates + exact palette/typography/spacing come from `docs/ux-research/weekly-recap-card.md`.
**Files:** create `src/lib/recap-card.tsx` (+ any bundled font asset under `src/app/recap/`).
**Acceptance:** exports both components; consumes the REQ-001 `WeeklyRecap` type; no CSS-var/grid usage; renders ≥2 templates; zero/empty states render (no blanks); long goal objective wraps/truncates.
**Deps:** REQ-001 (type), UX findings. **Complexity:** M-L.

## REQ-003 — Image route handlers (PNG export)
**Description:** New route handlers returning `ImageResponse`: `src/app/recap/card/route.tsx` (GET `?weekOffset&goalId&template` → 1080×1920 PNG) and `src/app/recap/story/[slide]/route.tsx` (GET slide `1|2|3` → 1080×1920 PNG). Each calls `computeWeeklyRecap()` then renders `RecapCard`/`RecapStorySlide`. Set correct `runtime`/font loading for `next/og`. Validate/clamp query params.
**Files:** create the two route files.
**Acceptance:** `GET /recap/card?weekOffset=0` → 1080×1920 PNG; `GET /recap/story/{1,2,3}` → 1080×1920 PNG; builds under Turbopack; bad params clamped, no 500 on empty week.
**Deps:** REQ-001, REQ-002. **Complexity:** M.

## REQ-004 — `/recap` page + client controls
**Description:** New `src/app/recap/page.tsx` (server component: reads `computeWeeklyRecap` for the initial preview/stats) + `src/components/RecapClient.tsx` (`"use client"`: week selector ◀/▶, template switcher, "Download card" + "Download Stories" buttons pointing at the REQ-003 routes). Phone-first controls using existing Tailwind tokens; preview shows the card image (scaled) via the card route. Entry affordance from the Progress hub ("Share recap").
**Files:** create `src/app/recap/page.tsx`, `src/components/RecapClient.tsx`; modify the Progress hub page to add the entry link.
**Acceptance:** `/recap` renders preview + week selector + template switch + 2 download buttons at 390px; tap targets ≥44px; tokens not hardcoded colors; empty-week renders.
**Deps:** REQ-001, REQ-003. **Complexity:** M.

## REQ-005 — `generate_recap_card` MCP tool (+ image result helper)
**Description:** Register `generate_recap_card` in `src/lib/mcp/tools.ts`; add an image-aware result helper (e.g. `imageResult(pngBuffer, stats)`) alongside `safe()` in `src/lib/mcp/tool-helpers.ts`. Tool calls `computeWeeklyRecap()`, renders `RecapCard` via `ImageResponse` → arrayBuffer → base64, returns content blocks: `{ type:"image", data, mimeType:"image/png" }` + `{ type:"text", text: JSON.stringify(stats) }`. Inputs (Zod, `.describe()`): `weekOffset` int default 0 `[-26,0]`, `goalId` optional, `template` optional enum. Errors → `isError` text, not broken image.
**Files:** modify `src/lib/mcp/tools.ts`, `src/lib/mcp/tool-helpers.ts`.
**Acceptance:** `tools/list` shows the tool w/ title+description; `tools/call {weekOffset:0}` returns image + text blocks; `weekOffset:5` → validation error; defaults to focus goal; goal-generic stats.
**Deps:** REQ-001, REQ-002. **Complexity:** M.

---

## Work streams (parallel)
- **Stream A — Engine & Render & MCP:** REQ-001, REQ-002, REQ-005 (owns `src/lib/recap.ts`, `src/lib/recap-card.tsx`, `tools.ts`, `tool-helpers.ts`). Defines the export contract.
- **Stream B — Routes & Page:** REQ-003, REQ-004 (owns `src/app/recap/**`, `src/components/RecapClient.tsx`, Progress-hub edit). Codes against Stream A's exported `computeWeeklyRecap` / `WeeklyRecap` / `RecapCard` contract (Architect pins exact signatures).
- No shared-file overlap; only B imports A's modules. Architect must freeze interfaces before parallel dev.
