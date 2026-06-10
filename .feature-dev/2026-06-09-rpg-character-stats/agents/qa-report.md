# QA Report — RPG Character Stats
**Date**: 2026-06-09  
**HEAD**: 0dab18d  
**Auditor**: QA Agent  
**Verdict**: MINOR FIXES

---

## Requirements Status

| Req | Description | Status | Evidence |
|-----|-------------|--------|----------|
| REQ-001 | GameBonusXp model + migration | PASS | schema.prisma lines 332–342 match PRD §4.1 exactly; migration SQL is pure `CREATE TABLE` + one index (additive only) |
| REQ-002 | Types + rules + attribute registry | PASS | types.ts zero Prisma imports; rules.ts has all constants incl. post-v2 amendments (Consistency, REVIEW_WEEKLY=25, Plank Max Hold→STR, hikeXp()); attributes-registry.ts has rulePackForGoal with fitness fallback |
| REQ-003 | Engine: fetch + ledger + PR replay + streak | PASS* | getActiveProgram standalone before Promise.all (CRIT-1); pure nested select (CRIT-2); all-time unbounded history (CRIT-3); PR replay matches recordsSetInWorkout semantics (HIGH-4); streak two-pass with today grace; milestone emission correct (HIGH-3); 1/day workout.completed cap enforced via workoutCompletedDays Set. *See ISSUE-1 for inline questToday planned-hike gap. |
| REQ-004 | Badges — 16 predicates | PASS | All 16 BadgeSpecs present in badges.ts; pure predicates; evaluateBadges sorts unlocked asc then locked |
| REQ-005 | Quest projection (quest.ts) | PARTIAL | quest.ts exists with correct `projectQuestXp` + `earnedTodayXp` — but neither function is imported anywhere. Engine has its own inline questToday that also omits planned-hike XP from projectedXp. See ISSUE-1 and ISSUE-2. |
| REQ-006 | MCP tools (get_game_state + grant_bonus_xp) | PASS | Both wrapped in safe(); zod with .describe(); parseDateInput used; dynamic rulePackForGoal validation (no hardcoded enum); idempotency check on (date, amount, reason) (HIGH-1); return shapes match blueprint §5 exactly |
| REQ-007 | Game UI components (9 files) | PASS* | 8 server components + 1 client island (LevelUpCelebration); tokens only (no hex found); progressbar ARIA on XpBar and AttributeBar; LevelUpCelebration: localStorage gate, imperative classList.add, level-decrease silent (case 4). globals.css: @keyframes level-up-burst, .level-up-ring, reduced-motion guard. *See ISSUE-3 for missing overall XP label on header. |
| REQ-008 | /character page + MoreSheet row | PASS | force-dynamic; all 6 sections (portrait→streak→attrs→badges→XP log→footnote); retroactivity footnote present; MoreSheet CharacterIcon (bust silhouette, 20px stroke-1.5) |
| REQ-009 | Today page integration | PASS | computeGameState() in Promise.all as 5th arm; CharacterHeader above hero, hidden when goalKind null; QuestCard inside hero replaces standalone TodayCelebration (fold signed off); all pre-existing sections (baselines, blocks, nutrition, recent workouts) unchanged |
| REQ-010 | Gotchas doc entries | PASS | docs/project-gotchas.md §E has 3 entries: XP derived/retroactive, baseline mirror double-count, alias-map XP fragmentation |

### PRD §8 Acceptance Criteria

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | `npx tsc --noEmit` 0 errors | NOT VERIFIED | Read-only QA; code is type-consistent from inspection |
| 2 | `npm run lint` no new errors | NOT VERIFIED | Read-only QA |
| 3 | `npm run build` succeeds | NOT VERIFIED | Read-only QA |
| 4 | Migration applied; GameBonusXp in generated client | PASS | SQL is correct CREATE TABLE; schema model matches |
| 5 | tools/list includes both tools with titles/descriptions | PASS | Both registerTool calls present with title + description strings |
| 6 | get_game_state returns §4.2 shape | PASS | Return shape matches blueprint §5 exactly |
| 7 | grant_bonus_xp {attribute:"END"} lands; invalid attr → error with valid ids | PASS | Dynamic validIds from rulePackForGoal; error message lists valid ids |
| 8 | `/` renders CharacterHeader + QuestCard; baselines/blocks/nutrition/recent intact | PASS | page.tsx confirms all pre-existing sections unchanged; CharacterHeader + QuestCard added |
| 9 | `/character` renders all sections incl. locked badges + retroactivity footnote | PASS | character/page.tsx has all 6 ordered sections |
| 10 | grep raw Date methods → only @/lib/calendar usages | PASS | grep returned only a comment line in engine.ts (line 7) |
| 11 | No resolveDay loops; one Promise.all | PASS | engine.ts: resolveDay never called; 1 standalone await + 1 Promise.all(9 queries) |
| 12 | LevelUpCelebration sole "use client"; imperative class; localStorage gate; level-up-burst; reduced-motion | PASS | Only file in game/ with "use client"; useEffect with imperative classList.add; LS_KEY guard; CSS class .level-up-ring with @media guard |
| 13 | Rest-day streak success | PASS | engine.ts:228 `if (isRestDay) { streakSuccess = true; }` |
| 14 | Badge predicates fire from historical data | LOGICALLY PASS | Predicates correct; DB smoke test not run (read-only) |

---

## USER_TZ Audit

**Grep pattern**: `setHours|setDate|getHours|getDate()|getMonth()|getFullYear()`

| File | Hits | Assessment |
|------|------|------------|
| src/lib/game/engine.ts | 0 (comment only at line 7) | PASS |
| src/lib/game/rules.ts | 0 | PASS |
| src/lib/game/types.ts | 0 | PASS |
| src/lib/game/attributes-registry.ts | 0 | PASS |
| src/lib/game/badges.ts | 0 | PASS |
| src/lib/game/quest.ts | 0 | PASS |
| src/components/game/*.tsx (all 9) | 0 | PASS |
| src/app/character/page.tsx | 0 | PASS |
| src/app/page.tsx | 0 | PASS |
| src/components/MoreSheet.tsx | 0 | PASS |

**grant_bonus_xp date**: uses `parseDateInput(input.date)` ✓ / `startOfDay(new Date())` default ✓  
**engine + quest**: exclusively use `dateKey`, `startOfDay`, `endOfDay`, `addDays` from `@/lib/calendar` ✓  
**LevelUpCelebration**: no Date math — receives `level: number` only ✓  
**badges.ts `new Date(dk).getTime()`**: used only for UTC ms arithmetic on YYYY-MM-DD strings (not in restricted method list; DST-safe since both sides are UTC midnight) — ACCEPTABLE  

**VERDICT**: PASS — no restricted raw Date methods outside calendar.ts

---

## Override-Awareness Audit

| Check | Result |
|-------|--------|
| engine.ts buildDayLedger uses overridesByKey Map (not resolveDay) | PASS — lines 151–215 |
| workoutJson != null → override (strict null check; null = explicit clear) | PASS — engine.ts:158 `if (override?.workoutJson != null)` |
| baselineTestNames: [] = "explicitly none" | PASS — engine.ts:167–174 |
| overridesByKey built with `Array.isArray(o.baselineTestNames) ? ... : null` | PASS — engine.ts:1039–1043 |
| page.tsx uses resolveDay(now) for rendered workout | PASS — page.tsx:43 `resolveDay(now)` in Promise.all |
| engine never calls resolveDay | PASS — grep confirms zero calls |

**VERDICT**: PASS

---

## MCP Audit

| Check | get_game_state | grant_bonus_xp |
|-------|---------------|----------------|
| Wrapped in safe() | PASS (tools.ts:1730) | PASS (tools.ts:3882) |
| zod with .describe() | PASS (no inputSchema; read tool) | PASS — all 4 fields .describe() |
| Return shape per PRD §4.2 | PASS — goalKind, level, xp, xpIntoLevel, xpToNext, attributes[{id,label,level,xp,intoLevel,toNext}], streak, badges(last 10 unlocked), lockedBadgeCount, recentEvents(20), questToday | PASS — granted{id,amount,reason,attribute,dateKey}, newState{level,xp,attributes[{id,level}]}, alreadyGranted |
| Dynamic attribute validation (no hardcoded enum) | N/A | PASS — uses `rulePackForGoal(goal?.kind ?? "fitness").attributes` |
| Idempotency check | N/A | PASS — findFirst({date, amount, reason}); returns alreadyGranted:true |
| parseDateInput for date fields | N/A | PASS — tools.ts:3908 |
| reason rendered as plain text | N/A | PASS — XpEventList renders ev.label as {ev.label} in a <span> |
| Amount bounds enforced | N/A | PASS — z.number().int().min(1).max(500) |
| Bearer auth coverage | PASS (inherited from existing route) | PASS (inherited) |

**NOTE — grant_bonus_xp idempotency key precision**: The key `(date, amount, reason)` uses the parsed DateTime object for `date`. Prisma `findFirst({ where: { date } })` performs exact DateTime equality match. Since `parseDateInput` always returns the same UTC midnight for a given YYYY-MM-DD string, retries are correctly deduplicated. The `attribute` field is NOT part of the idempotency key (matches blueprint HIGH-1 spec).

**VERDICT**: PASS

---

## Engine Correctness Deep-Read

| Area | Finding |
|------|---------|
| PR replay vs recordsSetInWorkout semantics | PASS — per-workout canonical grouping first; compare against prior-workout snapshot; first occurrence not a PR; 3/day cap; prBestByExercise updated regardless of PR outcome. Matches records.ts lines 459–545. |
| Baseline mirror double-count guard | PASS — `workoutCompletedDays` Set enforces 1/day workout.completed cap. Baseline mirrors earn baseline.logged + pr.set (intentional per D-6) but NOT a second workout.completed. |
| Streak today-grace rule | PASS — today's streakSuccess=false is excluded from break scan but counts when true; two-pass algorithm is correct. |
| Planned-hike-skip breaks streak | PASS — engine.ts:232 `hasPlannedHike && completedHikes.length === 0 && completedWorkouts.length === 0` → streakSuccess=false |
| Rest day = success | PASS — engine.ts:228 |
| Milestone emission per-run at crossing day | PASS — exact `runLength === threshold` check (not >=); per-run re-earnable (runLength resets to 0 on break) |
| levelFromXp correctness | PASS — loop correct; at 0 XP returns level=1 (no off-by-one); sanity checks match blueprint §4.9 |
| Overall XP = Σ attr + unattributed | PASS — engine.ts:699 |
| hikeXp() used (not flat) | PASS — engine.ts:616; quest.ts:78 |
| Empty state (no program) | PASS — goalKind:null, level:1, empty attributes, all badges locked |
| Volume/cardio XP per-workout (no daily cap) | PASS — intentional per blueprint §4.3.C; documented in rules.ts comment |
| Mobility 1/day via mobilityByDay Set | PASS — zone2-mobility workout marked first; MobilityCheckin skips if already in Set |
| canon/bestSetSummary from records.ts (not reimplemented) | PASS — engine.ts:21 imports both; never reimplemented |
| **ISSUE-1** engine questToday misses planned hike projection | FAIL — see Issues section |

---

## UI Audit

| Check | Status | Notes |
|-------|--------|-------|
| Only LevelUpCelebration is "use client" | PASS | All other 8 game/ components have no "use client" |
| No hardcoded hex in game components | PASS | grep returned empty; all colors via var(--token) |
| ARIA on progress bars | PASS | XpBar: role="progressbar" + aria-valuenow/min/max + aria-label; AttributeBar: same pattern (0–100 pct range) |
| 44px tap targets | PASS | CharacterHeader: min-h-[72px] (entire row); MoreSheet rows: min-h-[48px] |
| DM Serif usage | PASS | LevelMedallion level chip uses var(--font-display); BadgeWall monograms same |
| QuestCard hosts TodayCelebration (fold complete) | PASS | QuestCard.tsx:10 imports TodayCelebration; page.tsx no standalone TodayCelebration |
| Content below hero unchanged | PASS | page.tsx baselines, blocks, nutrition, recent workouts sections identical in structure |
| LevelUpCelebration: level-decrease → silent store | PASS | LevelUpCelebration.tsx:53–55 |
| LevelUpCelebration: first install → silent store | PASS | LevelUpCelebration.tsx:34–37 |
| level-up-burst keyframes in globals.css | PASS | globals.css:125–147 |
| Reduced-motion guard on .level-up-ring | PASS | globals.css:143–147 `display: none` |
| **ISSUE-3** CharacterHeader overall XpBar missing "320/450" label | MINOR — see Issues section |

---

## Code Quality Issues

| ID | Severity | Location | Description |
|----|----------|----------|-------------|
| ISSUE-1 | MINOR | engine.ts:867–900 | Engine's inline `questToday.projectedXp` does not include planned hike XP. `quest.ts`'s `projectQuestXp` correctly calls `hikeXp()` for `input.plannedHikeToday`, but the engine's inline version omits this. Since the page uses `gameState.questToday` (engine path), the QuestCard pre-training projectedXp will be understated by up to ~100 XP on days with a planned hike. The `complete` flag may fire prematurely (earnedXp >= understated projectedXp before hike is logged). Post-training, earnedXp is correct because hike.completed events are generated from actual logged hikes. |
| ISSUE-2 | MINOR | src/lib/game/quest.ts | `projectQuestXp` and `earnedTodayXp` are never imported or called anywhere. The page uses `gameState.questToday` from the engine; quest.ts is dead code. REQ-005's "pure functions" intent is fulfilled by the file existing but neither function is integrated. Not a runtime bug but creates confusion and maintenance debt. |
| ISSUE-3 | MINOR | src/components/game/CharacterHeader.tsx:48–53 | PRD §9.Q1 resolution specifies the overall XpBar on the header should show "320/450 in tabular nums." The CharacterHeader passes `value` and `max` to XpBar but omits the `label` prop, so no XP numbers appear. UX §4 (Q5) says attribute bars omit numbers at header size, but Q1 explicitly specifies the overall bar shows the precise label. The aria-label on the progressbar covers accessibility; the omission is a visual deviation. |
| CLEANUP | TRIVIAL | — | `fixture.ts` and `engine-stub.ts` not present (correct — blueprint §9.11 says delete post-integration). No action needed. |

---

## Mobile-UI Issues

| Check | Status | Notes |
|-------|--------|-------|
| 390px column layout | PASS | max-w-md mx-auto throughout |
| CharacterHeader two rows | PASS | flex flex-col gap-1.5, min-h-[72px] |
| Attribute micro-bar height (4–6px) | PASS | AttributeBar.tsx: `h-1` (Tailwind = 4px) ✓ in spec range |
| Medallion size 36px (header) | PASS | CharacterHeader size=36 |
| BadgeWall 4-column grid | PASS | `grid-cols-4` at 390px |
| Badge medal diameter | PASS | 52px (in 48–56px spec range) |
| StreakFlame SVG 18px | PASS | width/height="18" |
| LevelMedallion level chip positioning | PASS | `position: absolute; bottom/right: -chipSize×0.25` overlap on lower-right |

---

## Edge Case Gaps

| Scenario | Expected | Implementation | Status |
|----------|----------|---------------|--------|
| No active program | goalKind:null; Today hides header; /character shows empty state | PASS — emptyState() + goalKind null check in page.tsx | PASS |
| No history | Level 1, 0 XP, all badges locked | PASS — levelFromXp(0)=level 1; evaluateBadges returns all null dateKey | PASS |
| Goal kind without rule pack | Falls back to fitness | PASS — rulePackForGoal returns FITNESS_RULE_PACK for unknown kind | PASS |
| grant_bonus_xp invalid attribute | Error listing valid ids | PASS — `validIds.join(", ")` in error message | PASS |
| grant_bonus_xp no active goal + attribute given | Error: omit attribute | PASS — tools.ts:3900–3904 | PASS |
| Baseline mirror workout (source="baseline") | baseline.logged + pr.set; no second workout.completed | PASS — workoutCompletedDays cap enforced | PASS |
| Planned hike skipped with no workout | Streak breaks | PASS — engine.ts:232 | PASS |
| localStorage absent (first visit) | Silent store, no celebration | PASS — LevelUpCelebration.tsx:34–37 | PASS |
| Level decrease (retroactive rule change) | Silent store, no celebration | PASS — LevelUpCelebration.tsx:53–55 | PASS |
| Override workoutJson null | Falls through to rotation | PASS — engine.ts:158 strict null check | PASS |
| DST inside plan window | All bucketing via calendar.ts | PASS — no raw Date methods | PASS |
| **Planned hike today — questToday projectedXp** | Should include hikeXp() | FAIL — engine inline questToday misses this (ISSUE-1) | FAIL |

---

## Security Audit

| Check | Status |
|-------|--------|
| Bearer auth coverage on new tools | PASS — both in existing tools.ts behind existing route auth |
| reason rendered as plain text (no XSS) | PASS — XpEventList.tsx:45 `{ev.label}` in span, no dangerouslySetInnerHTML |
| amount bounds: 1–500 | PASS — z.number().int().min(1).max(500) |
| No raw SQL | PASS — all via Prisma client methods |

---

## Performance Audit

| Check | Status |
|-------|--------|
| Engine: standalone getActiveProgram + ONE Promise.all | PASS — _computeGameState: 1 standalone await + Promise.all([9 queries]) |
| No resolveDay inside loops | PASS — grep confirms zero resolveDay calls in engine.ts |
| Select clauses present (no select * / include fat) | PASS — all prisma queries use select with named fields |
| cache() used on computeGameState | PASS — engine.ts:1065 `export const computeGameState = cache(_computeGameState)` |
| page.tsx no serial waterfalls added | PASS — computeGameState() added as 5th arm of existing Promise.all |
| Overrides bounded to plan window | PASS — where: { date: { gte: planStart, lte: planEnd } } |

---

## Migration Audit

| Check | Status |
|-------|--------|
| Additive only (no ALTER TABLE, no DROP) | PASS — migration.sql is a single `CREATE TABLE` + `CREATE INDEX` |
| Correct field types match schema | PASS — TEXT, INTEGER, TIMESTAMP(3) match Prisma types |
| Primary key constraint | PASS — `GameBonusXp_pkey` |
| Index on date | PASS — `GameBonusXp_date_idx` |

---

## Overall Verdict: MINOR FIXES

Three issues found, all minor. No blockers.

---

## Fix Priority List

| Priority | ID | Fix |
|----------|-----|-----|
| P1 (before merge) | ISSUE-1 | In engine.ts `questToday` computation (around line 870), add planned hike XP: check if `hikesByDay.get(todayDk)` has any `status === "planned"` hike, call `hikeXp(hike.elevationFt, hike.packWeightLb)`, add to `projectedXp`. Alternatively, refactor to call `quest.ts`'s `projectQuestXp` and eliminate the inline duplication. |
| P2 (housekeeping) | ISSUE-2 | Either: (a) integrate `quest.ts`'s `projectQuestXp` into the engine to fix ISSUE-1 and make REQ-005 live, or (b) document in quest.ts that it is a pure utility for testing only, or (c) delete it if the engine inline approach is the final design. |
| P3 (visual) | ISSUE-3 | Add `label={`${state.xpIntoLevel} / ${state.xpToNext}`}` to the XpBar in CharacterHeader (line 48–53) per PRD §9.Q1 resolution. Verify no overflow at 390px before shipping. |

---

## Files Audited

| File | Result |
|------|--------|
| prisma/schema.prisma | PASS |
| prisma/migrations/20260610045452_add_game_bonus_xp/migration.sql | PASS |
| src/lib/game/types.ts | PASS |
| src/lib/game/rules.ts | PASS |
| src/lib/game/attributes-registry.ts | PASS |
| src/lib/game/badges.ts | PASS |
| src/lib/game/engine.ts | PASS* (ISSUE-1) |
| src/lib/game/quest.ts | PARTIAL (ISSUE-2 dead code) |
| src/lib/mcp/tools.ts (new tools only) | PASS |
| src/components/game/XpBar.tsx | PASS |
| src/components/game/AttributeBar.tsx | PASS |
| src/components/game/LevelMedallion.tsx | PASS |
| src/components/game/StreakFlame.tsx | PASS |
| src/components/game/QuestCard.tsx | PASS |
| src/components/game/CharacterHeader.tsx | PASS* (ISSUE-3) |
| src/components/game/BadgeWall.tsx | PASS |
| src/components/game/XpEventList.tsx | PASS |
| src/components/game/LevelUpCelebration.tsx | PASS |
| src/app/character/page.tsx | PASS |
| src/app/page.tsx | PASS |
| src/components/MoreSheet.tsx | PASS |
| src/app/globals.css | PASS |
| docs/project-gotchas.md | PASS |
