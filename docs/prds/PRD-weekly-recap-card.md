# PRD: Weekly Recap Card

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-15
**Status**: Draft
**GitHub Issue**: N/A — direct-to-main
**Branch**: main
**UX-research**: invoked — `/ux-research` (visual card design; findings fold into §5 before Phase 4)

---

## 1. Overview

### 1.1 Problem Statement
Gabe is launching a fitness/hiking/dev Instagram page where the **Sunday weekly recap** is the backbone post. He already logs everything (workouts, hikes, baselines, goal targets) in goaldmine. Today, turning that logged data into a postable visual means manual work. We want goaldmine to **emit a share-ready 9:16 card** (and a 3-slide Stories set) straight from the week's data, so the recap post is half-built automatically — both from the app and from a request to Claude in claude.ai.

### 1.2 Proposed Solution
Add a **goal-generic** weekly recap surface:
1. A `computeWeeklyRecap()` aggregator (`src/lib/recap.ts`) that bundles a week's stats — program week + day-of-90 header, workouts, volume, PRs, hike elevation, streak, and a **focus-goal progress %** computed via the existing `computeReadiness` engine (so the bar always relates to whatever goal is in focus, anchored to that goal's baseline→target metrics).
2. Server-side **image rendering** via Next's built-in `ImageResponse` (`next/og`) producing a 1080×1920 PNG card plus a 3-slide Stories set, in a couple of style templates.
3. A `/recap` dashboard page to preview, pick the week, switch template, and download the PNG / Stories set.
4. An MCP tool `generate_recap_card` that returns the rendered PNG **inline** plus the structured stats, defaulting to the focus goal + current week, and accepting optional `goalId` / `weekOffset`.

This is overwhelmingly a **read + render** feature: no new persisted data, no Prisma migration. The progress bar is deliberately **not** Elbert-specific — goaldmine is the enduring multi-goal hub, so the card works for any catalogued focus goal with zero code change.

### 1.3 Success Criteria
- From `/recap`, Gabe downloads a 1080×1920 PNG of the current week and a 3-slide Stories set.
- The progress bar reflects the **focus goal's** readiness score and shows the goal's objective as its label — swap the focus goal and the card relabels/recomputes automatically.
- In claude.ai, "make my recap card" returns the card image inline plus the week's numbers as data.
- Header reads "Week N · Day M of {totalProgramDays}" (dynamic = `plan.totalWeeks × 7`, currently **84** for the 12-week plan) anchored to the active plan's `startedOn`.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.

---

## 2. User Stories

| ID | As Gabe, I want to... | So that... | Priority |
|----|-----------------------|-----------|----------|
| US-001 | open `/recap` and see this week's stats rendered as a 9:16 card | I can post a Sunday recap in seconds | Must Have |
| US-002 | download the card as a 1080×1920 PNG | I can drop it straight into a Reel/post | Must Have |
| US-003 | have the progress bar reflect my **focus goal's** baseline→target progress with the goal's name | the card stays meaningful as goals change (not hardcoded to Elbert) | Must Have |
| US-004 | ask Claude in claude.ai to generate my recap card and get the image + numbers back | I can make a card from my phone without opening the app | Must Have |
| US-005 | download a 3-slide Stories set | I can post a swipe-through recap to Stories | Should Have |
| US-006 | pick a past week and/or a different style template | I can backfill or vary the look | Should Have |
| US-007 | generate a card for a specific goal via `goalId` | any catalogued goal can have its own recap | Nice to Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. `computeWeeklyRecap(asOf, { goalId?, weekOffset? })` returns a typed `WeeklyRecap` bundling: week boundaries (Mon–Sun, USER_TZ), `programWeek`, `dayOfProgram`, `totalProgramDays`, `goal { id, objective, progressPct, topMetricLabel? }`, `workoutsCompleted`, `volumeLb`, `prCount` (+ `prs[]`), `hikeElevationFt`, `streakDays`, and empty-state flags.
2. Progress % comes from `computeReadiness(goal.targets, weekEnd, goal.id).score` — goal-generic, baseline-anchored. No Elbert-specific math.
3. Default week scope = **current week through today** (`weekOffset: 0`), selectable backward.
4. Header: `Week {programWeek} · Day {dayOfProgram} of {totalProgramDays}` anchored to the focus goal's active plan `startedOn`; `totalProgramDays = plan.totalWeeks * 7` (**dynamic — 84** for the current 12-week plan; NOT a fixed 90, per discovery sign-off).
5. Render a 1080×1920 PNG card via `next/og` `ImageResponse` from a `WeeklyRecap` + `template` id.
6. Render a 3-slide Stories set (hero / numbers / closing), each 1080×1920.
7. `/recap` page: preview, week selector, template switcher, "Download card" + "Download Stories" actions.
8. MCP `generate_recap_card` tool: returns inline PNG (`image` content block) + structured stats (`text` JSON). Inputs: `weekOffset` (default 0), `goalId` (optional → focus goal), `template` (optional).

### 3.2 Secondary Requirements
9. At least **two** style templates (final visual direction from `/ux-research`).
10. Graceful empty states (no workouts, no goal targets, pre-program) — card still renders.

### 3.3 Out of Scope
- Persisting cards / a gallery of past cards (regenerate on demand).
- Direct posting to Instagram (manual download → post).
- Video / animated cards (still images only; ClipForge owns video).
- Auth on the dashboard (tracked separately; `/recap` follows existing unauthenticated dashboard convention).
- Editing stats by hand — the card reflects logged data only.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
**No schema changes. No migration.** Feature is read-only over existing models (`Workout`, `Hike`, `Goal`, `Baseline`, plus game-engine streak). This keeps Neon-shared-prod risk at zero.

### 4.2 MCP Tool Surface

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|
| `generate_recap_card` | Render the week's recap as an image + stats | Read | New. Returns image + text content blocks |

- **Title**: `Generate weekly recap card (shareable image + stats)`
- **Description**: `Render the week's recap as a share-ready 9:16 image plus the underlying numbers. Defaults to the focus goal and the current week (through today). Use for "make my recap card", "weekly recap image", "card for last week". Progress relates to the focus goal's baseline→target metrics. Pass goalId for a specific catalogued goal, weekOffset (0=this week, -1=last week) for a different week.`
- **Zod inputSchema**:
  ```ts
  {
    weekOffset: z.number().int().min(-26).max(0).default(0)
      .describe("0 = current week through today, -1 = last completed week"),
    goalId: z.string().optional()
      .describe("Catalogued goal to feature; defaults to the focus goal"),
    template: z.enum(["<from ux-research>"]).optional()
      .describe("Visual style variant; defaults to the primary template"),
  }
  ```
- **Return**: content blocks → `{ type: "image", data: <base64 PNG>, mimeType: "image/png" }` **and** `{ type: "text", text: JSON.stringify(recapStats) }`. (The `safe()` helper currently wraps a single JSON text block — this tool needs a variant that returns image + text; see §4.4 note.)
- Sample call:
  ```sh
  curl -s -X POST http://localhost:3000/api/mcp \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"generate_recap_card","arguments":{"weekOffset":0}}}'
  ```

### 4.3 Server Actions
None required — downloads are GET requests to image route handlers; no mutations. (No `revalidatePath` needed; nothing is written.)

### 4.4 Pages / Components
- **New lib**: `src/lib/recap.ts` — `computeWeeklyRecap()` + `WeeklyRecap` type. Reuses: week queries (mirror `weekly_summary_data`), `computeReadiness` (`@/lib/readiness`), records (`getExerciseSummaries`/`getBaselineSummaries` from `@/lib/records`), program week (`@/lib/program`), streak (`@/lib/game/engine` `getGameState().streak`).
- **New image renderers** (route handlers returning `ImageResponse`, `runtime` per `next/og` requirements):
  - `src/app/recap/card/route.tsx` — GET `?weekOffset&goalId&template` → 1080×1920 PNG.
  - `src/app/recap/story/[slide]/route.tsx` — GET slide `1|2|3` → 1080×1920 PNG.
- **New shared render module**: `src/lib/recap-card.tsx` — pure JSX templates (`RecapCard`, `RecapStorySlide`) consuming a `WeeklyRecap`, used by **both** the route handlers and the MCP tool (single source of card markup). No DOM/client APIs — must be `ImageResponse`-compatible (flexbox-only, inline styles, supported subset).
- **New page**: `src/app/recap/page.tsx` (server component) + `src/components/RecapClient.tsx` (`"use client"`) for the week selector / template switcher / download buttons (which point at the image route handlers).
- **MCP tool**: register `generate_recap_card` in `src/lib/mcp/tools.ts`; add an image-aware result helper alongside `safe()` in `tool-helpers.ts` (e.g. `imageResult(pngBuffer, stats)`).
- **Navigation**: not in `BottomNav` (5 slots are full). Entry via a "Share recap" affordance on the Progress hub + deep-linkable `/recap`.

### 4.5 Date / Time Semantics
- Week boundaries via `startOfWeekMonday` / `endOfWeekSunday` / `addDays` from `@/lib/calendar` (USER_TZ-aware); `weekOffset` shifts by `weekOffset * 7` days, mirroring `weekly_summary_data`.
- `dayOfProgram = days between plan.startedOn (USER_TZ startOfDay) and weekEnd + 1`, clamped to `[1, totalProgramDays]`.
- No raw `setHours`/`getDate` — all through `@/lib/calendar`. MCP tool takes no `date: string` (only `weekOffset` int), so `parseDateInput` is N/A.

### 4.6 Override-Awareness
Orthogonal — the recap reports logged history + goal readiness, not the prescribed plan-day. It does **not** read prescriptions, so `resolveDay` vs `getTodayContext` does not apply. (The only plan read is `plan.startedOn`/`totalWeeks` for the header counter.)

### 4.7 Third-Party Dependencies
- **`next/og` `ImageResponse`** — built into Next 16 (satori + resvg under the hood); no new package. Verify it builds under Turbopack and pick the correct route `runtime`. `@resvg/resvg-js` already in the repo as a fallback path if `next/og` proves problematic under Turbopack.
- Fonts: use a bundled font file (e.g. an existing/added `.ttf` under `src/app/recap/`) passed to `ImageResponse` — system fonts aren't available in the renderer.

---

## 5. UI/UX Specifications

> Final visual direction (layout, color, typography, the 2 templates, Stories slide breakdown) comes from `/ux-research`. The card is **not** bound by the 390px phone tokens — it is a fixed 1080×1920 canvas. Placeholders below; replace with research output before Phase 4.

### 5.1 Screen Descriptions
**`/recap` page (390px):** preview thumbnail of the card (scaled), a week selector (`◀ This week ▶`), a template toggle, and two primary buttons ("Download card", "Download Stories"). Loading state while the preview image loads; empty-week state shows the card with zeroed stats and an encouraging line.

**The card (1080×1920):** header band (`Week 3 · Day 19 of 90`), goal objective + progress bar (focus-goal readiness %), a stat grid (workouts, volume, PRs, elevation, streak), and a footer mark. Empty/zero values render as `0` / `—`, never blank.

**Stories set (3 × 1080×1920):** slide 1 hero (header + goal + bar), slide 2 the numbers grid, slide 3 closing (streak / "on to Week N").

### 5.2 Navigation Flow
Progress hub → "Share recap" → `/recap`. Direct deep-link `/recap` works. Back returns to Progress. Image route handlers are linked by the download buttons (open/save the PNG).

### 5.3 Responsive + Mobile-First Spec
- `/recap` **controls** follow phone-first tokens (`var(--accent)`, `var(--card)`, `var(--border)`, etc.), tap targets ≥ 44px.
- The **card canvas** is fixed 1080×1920 (it's an export, not responsive UI); its colors come from the chosen template (may use brand hexes, documented in the template, not the app's CSS vars since `ImageResponse` can't read CSS vars).

### 5.4 Accessibility
- `/recap` controls: labeled buttons, visible focus rings, adequate contrast.
- Card text contrast ≥ 4.5:1 against its background (template requirement).
- Download buttons are real `<a download>`/buttons with discernible names.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active program / no plan | Header omits "Week/Day of 90"; show just the date range. No crash. |
| No focus goal or goal has no targets | Progress bar hidden or shows "Set goal targets"; rest of card renders. |
| Empty week (no workouts/hikes) | Card renders with `0`/`—` stats + encouraging line. |
| Focus goal readiness has only `missing` targets | `progressPct` shown as `—`, not `0%` falsely. |
| `weekOffset` out of range | Zod clamps to `[-26, 0]`; invalid → validation error via MCP. |
| DST transition within the week | Week math via `@/lib/calendar` stays correct. |
| Day-of-program > totalProgramDays (plan extended/over) | Clamp to `[1, totalProgramDays]`; if plan extended, use plan's real `totalWeeks*7`. |
| `next/og` font/runtime failure | Route returns a clear 500; MCP tool returns `isError` text, not a broken image. |
| Long goal objective | Truncate/wrap within the card header (template handles overflow). |
| Past-week streak | `streakDays` reflects the game-engine current streak (documented caveat for historical weeks). |

---

## 7. Security Considerations
- MCP `generate_recap_card` is behind the existing bearer-token gate; no new auth bypass.
- `/recap` + image route handlers follow the existing **unauthenticated dashboard** convention (no secret data beyond what the dashboard already exposes). Flag if dashboard auth lands later.
- Inputs validated by Zod (`weekOffset` int range, `goalId` string, `template` enum).
- No `dangerouslySetInnerHTML`; card text is composed from typed values, not raw HTML.
- No raw SQL — Prisma only.
- Never echo `MCP_AUTH_TOKEN` in any image/route/tool output.

---

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit` passes with 0 errors.
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run build` succeeds (incl. the new route handlers under Turbopack).
4. [ ] MCP `tools/list` returns `generate_recap_card` with correct title + description.
5. [ ] MCP `tools/call generate_recap_card {weekOffset:0}` returns an `image` block (base64 PNG) **and** a `text` block of stats.
6. [ ] `computeWeeklyRecap` progress % equals `computeReadiness(focusGoal.targets, weekEnd, focusGoal.id).score` (goal-generic; no hardcoded Elbert reference anywhere — `grep -ri "elbert" src/lib/recap*` is empty).
7. [ ] `GET /recap/card?weekOffset=0` returns a 1080×1920 PNG.
8. [ ] `GET /recap/story/1|2|3` each return a 1080×1920 PNG.
9. [ ] `/recap` renders preview + week selector + template switch + download actions (1 card + 3 Stories slides) at 390px. *(Impl ships per-slide Stories downloads rather than a single "Stories" button — better UX; supersedes the original "2 buttons" wording.)*
10. [ ] Header string equals `Week {programWeek} · Day {dayOfProgram} of {totalProgramDays}` from plan `startedOn`.
11. [ ] All Date math goes through `@/lib/calendar` (no raw `setHours`/`getDate` in new app code).
12. [ ] Empty-week and no-targets states render without crashing.

---

## 9. Open Questions — RESOLVED
- **Visual templates** → ✅ `docs/ux-research/weekly-recap-card.md` (`9b7cae8`). Direction "Bullseye Hero"; two templates **Coal** (dark, default) + **Parchment** (light/serif); pure-flexbox div-stack Bullseye (no SVG); fonts Geist Regular+SemiBold + DM Serif Display (bundle as `.ttf`, subset <500KB); exact hex/type-scale in the report. Stat layout: Day-streak hero band + 2×2 (Workouts/Volume/PRs/Elevation). Honor the report's `tuning⚠`/`decoration⚠` verify-visually list and tick the ledger (`docs/ux-research/weekly-recap-card-ledger.md`) at ship.
- **Card markup sharing under `ImageResponse`** → ✅ Research confirmed: `ImageResponse` is a plain `Response`; callable from the MCP handler via `await res.arrayBuffer()`; `runtime = "nodejs"`; fonts passed as `ArrayBuffer`. Single `recap-card.tsx` serves both paths.
- **Header denominator** → ✅ Dynamic `plan.totalWeeks × 7` (currently 84), per user sign-off — NOT a fixed 90.
- **Build-time spikes to validate in Architecture/dev:** (1) font bundling/subsetting under Turbopack; (2) satori behavior — div-stack is primary, avoid `<svg>`/`<img>` reliance.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
`npx tsc --noEmit` clean · `npm run lint` no new errors · `npm run build` succeeds.

### 10.2 MCP curl smoke
`tools/list` includes `generate_recap_card`; `tools/call` with `{weekOffset:0}` and with `{weekOffset:-1,goalId:"<focus>"}` returns image + stats; invalid `weekOffset:5` → validation error.

### 10.3 Browser smoke
1. `npm run dev`
2. 390px width: open `/recap`; toggle week + template; click both downloads (PNG opens/saves).
3. Cross-check the rendered stats against `weekly_summary_data` + `get_records_summary` curl output for the same week.

### 10.4 Migration verification
N/A — no schema change.

---

## 11. Appendix

### 11.1 Discovery Notes
Feature feeds Gabe's new fitness/hiking/dev Instagram content engine; the Sunday recap is the content backbone. Key decision (saved to memory `goal-progress-bars-are-goal-generic`): the progress bar must derive from each goal's own baseline→target metrics — goaldmine is the enduring multi-goal hub; Elbert is just today's focus. Locked: header "Week N · Day M of 90"; goal-generic progress via `computeReadiness`; current-week-through-today default; MCP returns image + stats; server-side `next/og` render.

### 11.2 References
- `src/lib/readiness.ts` (`computeReadiness`), `src/lib/mcp/tools.ts` (`weekly_summary_data` @ ~1063), `src/lib/records.ts`, `src/lib/program.ts` (weekIndex), `src/lib/game/engine.ts` (streak).
- Memory: `multi-domain-vision`, `goal-progress-bars-are-goal-generic`.
