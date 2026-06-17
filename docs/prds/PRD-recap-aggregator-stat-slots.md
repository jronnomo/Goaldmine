# PRD — Recap Aggregator: kind-aware stat slots + weeks-to-target header (#68)

**Slug:** recap-aggregator-stat-slots · **Issue:** #68 (board #8, Sprint 6, P0) · **Date:** 2026-06-16
**Depends on:** #67 (`goal-presentation.ts` registry — shipped, `189f006`).
**UX-research:** skipped — pure data-aggregator (`recap.ts`); no UI surface is rendered in this story (the card consumes `statSlots` in #69).

## 1. Problem & Goal
`computeWeeklyRecap` always computes fitness stats (`workoutsCompleted/volumeLb/prCount/hikeElevationFt`) and a program-week header. To let the recap card go kind-aware (#69), the bundle must additionally carry **resolved stat slots** declared by the goal's presentation config, plus a **weeks-to-target** header for project goals — while the fitness numbers and legacy fields stay **byte-identical** and **no project query runs for a fitness goal**.

## 2. Scope
**In (only `src/lib/recap.ts`):**
- Restructure `computeWeeklyRecap`: **goal-first fetch → `presentationForGoal(goal)` → gated project queries** (run `logEntry.findFirst` / `scheduledItem.groupBy` ONLY when the presentation's slots declare them).
- Add `ResolvedStatSlot` type + `resolveStatSlot(slot, ctx)` (pure over already-fetched data; switches on `slot.source.from`; no Prisma inside).
- `WeeklyRecap` gains `statSlots: ResolvedStatSlot[]`. The 4 legacy fields **remain** (MCP stats JSON + highlight logic still read them).
- `RecapProgramHeader` gains `weeksToTarget: number | null` + `targetDateLabel: string | null`, computed via USER_TZ-correct helpers, populated only when `headerStyle === "weeks-to-target"` and the goal has a `targetDate`.

**Out:** any change to `recap-card.tsx` (that's #69 — the card still reads legacy fields until then); any Prisma/MCP/schema change; touching the `"READINESS"`/header strings in the card.

## 3. Design

### 3.1 Fetch restructure
1. Compute week window (unchanged).
2. **`await` the goal first** (focus goal or `opts.goalId`), exactly the current query.
3. `const presentation = presentationForGoal(goal)`.
4. Determine needed project sources from `presentation.statSlots`:
   - `logKeys = slots where source.from==="logLatest" → source.metricKey`
   - `schedTypes = slots where source.from==="scheduledItem" → source.itemType`
5. Single batch: the 5 always-needed fetches (`workouts`, `allExerciseSummaries`, `hikes`, `plan`, `gameState`) **plus** — only when `goal && (logKeys.length || schedTypes.length)` — the project fetches. For a fitness goal both lists are empty ⇒ zero project queries execute (AC #7).
   - `logLatest: Map<string, number|null>` ← `prisma.logEntry.findFirst({ where:{ goalId, metric:<key>, value:{ not:null } }, orderBy:{ date:"desc" } })` → `row?.value ?? null`.
   - `scheduledAgg: Map<string, {done:number,total:number}>` ← `prisma.scheduledItem.groupBy({ by:["status"], where:{ goalId, type:<itemType> }, _count:{ _all:true } })` → `total = Σ all`, `done = count where status==="done"`.

### 3.2 `resolveStatSlot` (in `recap.ts`, exported)
```ts
export type ResolvedStatSlot = { key: string; label: string; value: string; isNull: boolean };
type StatSlotCtx = {
  recap: { workoutsCompleted: number; volumeLb: number | null; prCount: number; hikeElevationFt: number | null };
  logLatest: Map<string, number | null>;
  scheduledAgg: Map<string, { done: number; total: number }>;
  breakdown: TargetProgress[];   // from computeReadiness; [] when no targets
  targets: GoalTarget[];
};
```
Switch on `slot.source.from`, then format by `slot.format`:
- `recapField` → read `ctx.recap[field]`; `isNull = value===null`. Formats: `int`→`String(v)`, `volumeLb`→`fmtVolume(v)`, `elevationFt`→`fmtElevation(v)`.
- `logLatest` → `v = ctx.logLatest.get(metricKey) ?? null`; `isNull = v===null`. `currency`→ `v===null ? "—" : "$"+fmtComma(v)`.
- `scheduledItem` → `agg = ctx.scheduledAgg.get(itemType) ?? {done:0,total:0}`; `ratioOfTotal`→ `\`${agg.done}/${agg.total}\``; `isNull = agg.total===0`.
- `targetCurrent` → read from `ctx.breakdown` by metric (current value); `isNull` when no data. (No current slot uses this; implement defensively → `"—"`/`isNull:true` when absent.)
- `percent` → `v===null ? "—" : \`${v}%\``.
Import `fmtComma`/`fmtVolume`/`fmtElevation` from `@/lib/goal-presentation` (the #67 module) — single formatter source.

### 3.3 Header weeks-to-target
When `presentation.headerStyle === "weeks-to-target"` AND `goal?.targetDate`:
- `weeksToTarget = Math.max(0, Math.round((startOfDay(targetDate).getTime() - startOfDay(asOf).getTime()) / (7*86_400_000)))` — same epoch-on-`startOfDay` pattern as the existing program-day math (USER_TZ-correct; no raw `getDate()`).
- `targetDateLabel = new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", timeZone: process.env.USER_TZ ?? "America/Denver" }).format(targetDate)` — same pattern as `weekRangeLabel`.
Else both `null`. All 3 `RecapProgramHeader` construction sites (no-plan ~293, with-plan ~310, catch-fallback ~460) add the 2 fields (null in the fitness/program-week + fallback cases).

### 3.4 statSlots assembly + fallback
- Main return: `statSlots = presentation.statSlots.map(s => resolveStatSlot(s, ctx))`.
- Catch fallback (~455): resolve `DEFAULT_PRESENTATION.statSlots` against the zero ctx (legacy fields 0/null, empty maps) so the error card still shows the 4 fitness cells (`"0"`/`"—"`/`"0"`/`"—"`) — parity with today; header's 2 new fields `null`.

## 4. Edge cases
- Project goal with no `targetDate` (someday) → `weeksToTarget/targetDateLabel` null (header omits). Chewgether HAS one.
- Unknown/null kind → `DEFAULT_PRESENTATION` (fitness slots) → no project query.
- `logLatest` miss (no MRR rows) → `"—"`, `isNull:true`. `scheduledAgg` with planned-only → `"0/7"`, `isNull:false`.

## 5. Acceptance criteria
1. `npx tsc --noEmit`, changed-file lint, `npm run build` all green.
2. Goal-first fetch → `presentationForGoal` → gated batch; **no `logEntry.findFirst`/`scheduledItem.groupBy` runs for a fitness focus goal** (verify by code inspection: project fetches are inside the `logKeys.length || schedTypes.length` guard).
3. `WeeklyRecap.statSlots` present; 4 legacy fields unchanged and still returned.
4. **Fitness byte-identical:** for the Elbert focus goal, `statSlots` = `[{key:"workouts",value:"2",isNull:false},{key:"volume",value:"2,370 lb",isNull:<volumeLb===null>},{key:"prs",value:"1",isNull:false},{key:"elevation",value:"5,200 ft",isNull:<hikeElevationFt===null>}]` shape — values equal what the card prints today; `isNull` mirrors `volumeLb===null`/`hikeElevationFt===null`.
5. **Chewgether:** `computeWeeklyRecap(asOf,{goalId:"cmqbfseel0000cgdn3oz1uz2u"})` → `statSlots` `[{key:"mrr",value:"—",isNull:true},{key:"milestones",value:"0/7",isNull:false}]`; `header.weeksToTarget ≈ 15`; `header.targetDateLabel` reflects Sep 30.
6. `RecapProgramHeader` carries the 2 new fields at all 3 sites; fitness header has them null.
7. MCP `weekly_summary_data` / `generate_recap_card` for the fitness goal returns the unchanged stats shape (4 legacy fields intact).
8. USER_TZ: no raw `setHours/getDate/getMonth/getFullYear`; new date math via `startOfDay` + `Intl … timeZone: USER_TZ`.

## 6. Verification
- `npx tsc --noEmit` + `npm run build`.
- `grep -nE "setHours|setDate|getHours|getDate\(|getMonth\(|getFullYear" src/lib/recap.ts` → only pre-existing `.getTime()` epoch math (allowed); no new bare date primitives.
- Dev server + MCP curl `weekly_summary_data` for the fitness goal → 4 legacy fields intact.
- A scratch node/tsx assertion (or the #85 Vitest, later) confirming the Chewgether + fitness `statSlots` shapes — at minimum, code-inspection + build for this story.
