# PRD: RPG Character Stats — Gamified Engagement Layer

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-09
**Status**: Approved
**GitHub Issue**: N/A — direct-to-main
**Branch**: main
**UX-research**: invoked (background) — findings folded into §9 before development

---

## 1. Overview

### 1.1 Problem Statement

Gabe increasingly interacts with the claude.ai coach and barely opens the app. The app is data-rich (PRs, readiness, baseline checkpoints, hikes) but celebration-poor — the only reward feedback is a once-per-day bullseye pop. Visualizing progress and chasing the goal through the app is not exciting, so engagement drains toward the chat surface.

### 1.2 Proposed Solution

A video-game layer: **RPG character stats**. Gabe is the character. Four attributes — **STR / END / MOB / CON** — each have a level and XP bar, fed by everything he already logs: workouts, sets/volume, PRs, baselines, hikes, mobility, nutrition logs, reviews, and plan adherence. An overall level, a plan-adherence streak, a 16-badge catalog, level-up celebrations, and a quest-framed Today page make opening the app rewarding.

The engine is **derived**: XP/levels/streaks/badges are recomputed from existing history on every read (deterministic, instantly retroactive when rules are tuned). The single exception is one new table for **coach-granted bonus XP**, awarded by the claude.ai coach via a new MCP write tool. The attribute system is a **rule-pack registry keyed by `Goal.kind`** so future goal domains (financial, intellectual, project) can define their own attributes without touching the engine.

### 1.3 Success Criteria

- Opening `/` shows character level, attribute bars, streak, and today's quest XP within the existing page-load envelope (one additional parallel query batch).
- Logging a workout (via MCP) visibly pays XP on Today and can trigger a level-up celebration on next open.
- Coach can call `get_game_state` and `grant_bonus_xp` from claude.ai; bonuses appear in the app's XP log.
- Whole history counts retroactively on day one — no cold start.

---

## 2. User Stories

| ID     | As... | I want to... | So that... | Priority |
|--------|-------|--------------|------------|----------|
| US-001 | Gabe | open Today and see my level, attribute bars, and streak at a glance | the app feels like a game worth opening daily | Must Have |
| US-002 | Gabe | see today's workout framed as a quest with projected XP before training and earned XP after | training has a visible immediate reward | Must Have |
| US-003 | Gabe | view a full character sheet (/character) with what feeds each attribute, badges, XP history, coach bonuses | I can chase specific stats and unlocks | Must Have |
| US-004 | Gabe | keep a streak that respects my plan (rest days count, skipped workouts break it) | the streak rewards adherence, not token logging | Must Have |
| US-005 | Gabe | unlock badges for milestones (first PR, 10k ft elevation, 30-day streak…) | long-arc accomplishments are commemorated | Must Have |
| US-006 | Gabe | see a celebration when I level up | progress moments feel earned | Should Have |
| US-007 | Gabe (via coach) | have my coach see my game state and grant bonus XP with a reason | the coach↔app loop deepens (e.g. "pushed through on 4h sleep: +25") | Should Have |
| US-008 | Gabe | have future non-fitness goals define their own attributes | the game layer survives the multi-domain evolution | Should Have (architecture only) |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. **Game engine** (`src/lib/game/`): `computeGameState()` derives `GameState` (overall level/XP, per-attribute level/XP/progress, streak current+longest+todayCounted, badges with unlock dates, recent XP events) from existing history + `GameBonusXp` rows. Pure core (`computeGameStateFromData`) + fetch wrapper.
2. **Rule-pack registry**: attribute defs + event derivation per `Goal.kind`; fitness pack ships; engine never hardcodes attribute ids; unknown kind falls back to fitness.
3. **XP economy** (all constants in `rules.ts`, table in §4.8): workout completion / volume / cardio / PRs / baselines (+on-time) / hikes (elevation+pack scaled) / mobility / nutrition days / reviews / adherence days / streak milestones / coach bonuses.
4. **Level curve**: cost of L→L+1 = base·L (`levelFromXp(xp, base)`); ATTR_LEVEL_BASE=60, OVERALL_LEVEL_BASE=150. Overall XP = Σ attribute XP + unattributed bonuses.
5. **Plan-adherence streak**: per in-plan day via batch override-aware ledger — rest=success; non-rest succeeds on (completed workout) OR (completed hike) OR (all due baselines logged); planned-hike skipped with no workout breaks; today excluded from break scan but counts when already succeeded.
6. **Badges**: 16-badge v1 catalog (§4.9), predicates over the engine pass, derived unlock dateKeys, locked badges visible with hints.
7. **Today page**: compact `CharacterHeader` (~72 px row: level medallion, overall XP bar, 4 attribute micro-bars, streak flame; links to /character) + `QuestCard` ribbon in the hero (projected XP pre-training → earned XP breakdown post). The existing TodayCelebration completion Bullseye **moves into the QuestCard** (signed off — one completion moment; daily pop fires on the quest Bullseye). **All content below the hero unchanged.** Training stays the star.
8. **/character page**: overall section, per-attribute cards with "what feeds this stat", streak detail, badge wall, XP event list (last 30), coach bonus log, retroactivity disclosure line.
9. **Level-up celebration**: client island, localStorage `goaldmine.lastSeenLevel` gate (silent first install), imperative class add (no setState), CSS-only `level-up-burst` keyframes with tokens, reduced-motion disabled.
10. **MCP tools**: `get_game_state` (read), `grant_bonus_xp` (write) — §4.2.
11. **Persistence**: `GameBonusXp` model only (§4.1).

### 3.2 Secondary Requirements

1. MoreSheet "Character" nav row.
2. `docs/project-gotchas.md` entries: derived/retroactive XP; baseline-mirror double-count guard; alias-map → XP fragmentation.
3. Engine exposes `goalKind` so UI can hide gamification for unpacked kinds.

### 3.3 Out of Scope

- Per-goal attribute config column (`Goal.attributeConfig Json`) — noted for future, not built.
- Rule packs for non-fitness kinds.
- Persisted XP ledger / event sourcing; XP for project `ScheduledItem`/`LogEntry`.
- Cache-tag revalidation (`unstable_cache`) — v1 computes per request.
- Push notifications, sounds, multiplayer/social anything.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

```prisma
model GameBonusXp {
  id        String   @id @default(cuid())
  date      DateTime // USER_TZ midnight via parseDateInput
  amount    Int
  reason    String
  attribute String?  // attribute id valid for active goal kind; null = overall-only
  source    String   @default("coach")
  createdAt DateTime @default(now())

  @@index([date])
}
```

Migration: `npx prisma migrate dev --name add_game_bonus_xp` then `npx prisma generate`. Purely additive — safe on shared Neon. No backfill.

### 4.2 MCP Tool Surface

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|
| `get_game_state` | Derived RPG state for the coach | Read | Recomputed per call; includes today's quest projection |
| `grant_bonus_xp` | Coach-granted XP with reason | Write | Attribute validated dynamically vs rule pack; date via `parseDateInput` |

**get_game_state** — no input. Returns `{ goalKind, level, xp, xpIntoLevel, xpToNext, attributes: [{ id, label, level, xp, intoLevel, toNext }], streak: { current, longest, todayCounted }, badges: last 10 unlocked [{ id, name, dateKey }], lockedBadgeCount, recentEvents: last 20 [{ dateKey, ruleId, label, xp, attribute }], questToday: { projectedXp, earnedXp, complete } }`.

**grant_bonus_xp** inputSchema:
```ts
{
  amount: z.number().int().min(1).max(500).describe("XP to grant"),
  reason: z.string().min(3).max(300).describe("Why — shown in the app's XP log"),
  attribute: z.string().optional().describe("Attribute id for the active goal kind (e.g. STR|END|MOB|CON); omit for overall-only XP"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Defaults to today (USER_TZ)"),
}
```
Returns `{ granted: { id, amount, reason, attribute, dateKey }, newState: { level, xp, attributes: [{ id, level }] } }`. Handlers use the existing `safe()` wrapper + `registerTool` pattern.

Curl smoke:
```sh
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"grant_bonus_xp","arguments":{"amount":50,"reason":"smoke test","attribute":"END"}}}'
```

### 4.3 Server Actions

None. All writes via MCP; pages are read-only consumers of `computeGameState()`. (No `revalidatePath` wiring needed; affected pages are `force-dynamic`.)

### 4.4 Pages / Components

- **New route**: `src/app/character/page.tsx` — server, `force-dynamic`.
- **New components** (`src/components/game/`): `CharacterHeader` (server), `AttributeBar` (server), `XpBar` (server), `StreakFlame` (server), `QuestCard` (server), `BadgeWall` (server), `XpEventList` (server), `LevelUpCelebration` (**client**, the only island).
- **Modified**: `src/app/page.tsx` (header + quest strip; existing content untouched), `src/components/MoreSheet.tsx` (Character row), `src/app/globals.css` (keyframes).
- **Navigation**: no BottomNav change; entry = Today header tap + MoreSheet row.

### 4.5 Date / Time Semantics

All engine bucketing via `dateKey`/`startOfDay`/`endOfDay`/`addDays` from `@/lib/calendar`. `grant_bonus_xp.date` through `parseDateInput`. Client island receives precomputed `level: number` only — no Date math in the browser. QA grep: no raw `setHours|getDate()|getMonth()|getFullYear` outside `@/lib/calendar`.

### 4.6 Override-Awareness

The day ledger replays override precedence **in memory** using `templateForRotationDay` (calendar.ts:701) + `rotationBaselineNamesForDate` (calendar.ts:713) + a `PlanDayOverride` map keyed by dateKey — honoring `workoutJson` precedence and `baselineTestNames: []` = "explicitly none". Never loops `resolveDay` (per-day queries); never reads `planJson` without layering overrides. QuestCard consumes the `resolveDay(now)` result already fetched by the Today page.

### 4.7 Third-Party Dependencies

None.

### 4.8 XP Economy (fitness pack — all tunable in `rules.ts`)

| Rule id | Trigger | XP | Attribute |
|---|---|---|---|
| `workout.completed` | completed workout (max 1/day) | 25 | by day category: upper/lower/power/calisthenics→STR, zone2-mobility→MOB, long-endurance→END, off-plan→STR |
| `workout.volume` | Σ weightLb×reps per workout | +1/1,000 lb, cap 15 | STR |
| `workout.cardio` | Σ duration-only set seconds | +1/10 min, cap 10 | END |
| `pr.set` | chronological PR replay (canonical names; Epley/reps/duration via records.ts) | 40, cap 3/day | STR; overrides map → MOB (squat-hold/toe-touch/shoulder), END (run/step-up/bike) |
| `baseline.logged` | each Baseline row | 20 | per BASELINE_ATTRIBUTE map |
| `baseline.onTime` | within checkpoint window | +10 | CON |
| `hike.completed` | completed hike | 30 + 10/1,000 ft (cap +60) + 10 if pack ≥20 lb | END |
| `mobility.session` | MobilityCheckin OR completed zone2-mobility day (1/day) | 15 | MOB |
| `nutrition.day` | ≥2 NutritionLog rows on a day | 5 | CON |
| `review.weekly` | Note type=review | 25 | CON |
| `adherence.day` | ledger day succeeded | 10 | CON |
| `streak.milestone` | run crosses 7/14/30/60/90 | 50/75/100/150/200 | CON |
| `bonus.coach` | GameBonusXp row | row amount | row attribute or overall-only |

**Guards**: PRs sourced only from workout sets (baseline mirror rows pay `baseline.logged`, not PRs); 1/day completion cap defuses mirror double-count; only `status="completed"` earns; canonicalization imported from `records.ts` (`canonicalExerciseName`, `bestSetSummary`, `epley1RM`) — never reimplemented.

### 4.9 Badge Catalog (v1)

1 First Blood (first completed workout) · 2 On Record (first PR) · 3 PR Machine (10 PRs) · 4 Baseline Scholar (all initial-week tests logged) · 5 Retest Ritualist (full retest checkpoint week done) · 6 Trail Rat (first completed hike) · 7 Vert Collector (≥10,000 ft cumulative) · 8 High Pointer (single hike ≥3,000 ft) · 9 Elbert Ready (single hike ≥4,000 ft) · 10 One Week Strong (7-day streak) · 11 Fortnight Forge (14-day) · 12 Iron Month (30-day) · 13 Set Centurion (500 sets) · 14 Hundred-Ton Hauler (200,000 lb tonnage) · 15 Clean Week (7 consecutive nutrition days) · 16 Self-Examined (first review).

### 4.10 Engine Query Plan

One `Promise.all`, ~10 queries bounded to the plan window (~84 days): program+plan, active goal, workouts(+exercises+sets), hikes, baselines, nutrition (select date/mealType), review notes, mobility checkins, overrides, bonus rows. Wrapped in React `cache()` so `/`, nested components, and same-request consumers share one computation.

---

## 5. UI/UX Specifications

> Final visual treatment comes from UX research (§9). Structural spec below.

### 5.1 Screen Descriptions

**Today (`/`) — modified.** New top row (CharacterHeader, ~72 px, whole row tappable → /character):
```
┌──────────────────────────────────────┐
│ (Lv7)  ▓▓▓▓▓▓▓░░░ 320/450      🔥12 │   ← medallion · overall bar · streak
│  STR 9 ▂▂▂  END 7 ▂▂  MOB 5 ▂  CON 11│   ← micro-bars + levels
└──────────────────────────────────────┘
```
Hero section gains a QuestCard strip: pre-training "⚔ Today's quest · ~70 XP · bonus: PR chance" → post "✓ Quest complete · +112 XP" with per-event lines. Everything below (baselines due, workout blocks, nutrition, recent workouts) unchanged.

**/character — new.** Stacked Cards: overall level + XP bar; streak (current/longest/today status); 4 attribute cards (level, bar, "feeds: …" line); BadgeWall (unlocked color / locked greyed + hint); XpEventList (last 30, with coach bonuses marked ✦); footnote: "XP is derived from your history and may shift when the plan or rules change."

States: no active program → header hidden, page shows empty state; no history → Level 1, 0 XP, all locked (works day one); unpacked goal kind → header hidden (`goalKind` check).

### 5.2 Navigation Flow

Today header tap → /character → back to Today. MoreSheet → Character. No BottomNav changes.

### 5.3 Responsive + Mobile-First Spec

390 px primary; tap targets ≥44 px (header row is one large target); `<Card>` layout; tokens only (`var(--accent)`, `var(--target)`, `var(--card)`, `var(--border)`, `var(--muted)`, `var(--success)`) — zero hardcoded colors; bars as simple token-filled divs (no chart lib for bars).

### 5.4 Accessibility

Bars get `role="progressbar"` + `aria-valuenow/min/max` + labels; streak flame has text alternative; celebration honors `prefers-reduced-motion`; badge lock state conveyed by text, not color alone; contrast AA in both themes.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active program/plan | Engine returns empty state (`goalKind: null`); Today renders without header; /character shows friendly empty state |
| No history yet | Level 1, 0 XP, streak 0, all badges locked — no errors |
| Goal kind without rule pack | Falls back to fitness pack (v1); `goalKind` exposed for future hiding |
| `grant_bonus_xp` invalid attribute | safe() error listing valid ids from active rule pack |
| `grant_bonus_xp` with no active goal | Granted as overall-only (attribute must be omitted, else error) |
| Baseline test day (mirror workout) | No double-pay: Baseline row → baseline XP; workout sets → PR XP; completion capped 1/day |
| Plan revision / override edits history | XP recomputes retroactively — disclosed on /character |
| localStorage absent/cleared | Celebration stores silently, never fires on first paint |
| DST inside plan window | All bucketing via calendar.ts (USER_TZ) |
| Override with `workoutJson: null` | Ledger falls through to rotation template (same precedence as resolveDay) |
| Skipped-status workout/hike | Earns nothing; planned-hike skip with no workout breaks streak |

---

## 7. Security Considerations

- Both new MCP tools behind existing bearer auth; no new public routes.
- Zod validation on `grant_bonus_xp` (amount 1–500, reason length, date regex + `parseDateInput`); attribute checked against registry server-side.
- No `dangerouslySetInnerHTML`; `reason` rendered as plain text. No raw SQL.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` 0 errors
2. [ ] `npm run lint` no new errors
3. [ ] `npm run build` succeeds
4. [ ] Migration `add_game_bonus_xp` applied; `GameBonusXp` in generated client
5. [ ] `tools/list` includes `get_game_state` + `grant_bonus_xp` with titles/descriptions
6. [ ] `get_game_state` returns the §4.2 shape; PR-event count consistent with `get_records_summary` canonicalization
7. [ ] `grant_bonus_xp {amount:50, attribute:"END"}` → END XP +50 in subsequent `get_game_state`; invalid attribute → error listing valid ids
8. [ ] `/` renders CharacterHeader + QuestCard at 390 px; baselines/blocks/nutrition/recent sections still present (DOM check)
9. [ ] `/character` renders all sections incl. locked badges + retroactivity footnote
10. [ ] `grep -n 'setHours\|setDate\|getHours\|getDate()\|getMonth()\|getFullYear'` over changed files → only `@/lib/calendar` usages
11. [ ] Engine contains no `resolveDay(` calls inside loops; one Promise.all batch
12. [ ] `LevelUpCelebration` is the only `"use client"` addition; uses imperative class + localStorage gate; `level-up-burst` under reduced-motion guard, tokens only
13. [ ] Streak: rest-day rotation days count as success in ledger output (unit-style spot check via engine pure core)
14. [ ] Badge predicates fire from historical data (≥1 badge unlocked given existing history)

---

## 9. Open Questions — RESOLVED (UX research: docs/ux-research/rpg-character-stats.md; ledger: rpg-character-stats-ledger.md)

Chosen direction: **"The Bullseye is the character."** All ⚠-tagged values below are provisional ranges requiring a human visual pass at 390px in both themes (see report §14) — implement at the suggested starting value.

1. **CharacterHeader** = report Option A, two rows ~72px, whole row one tap target → /character. Row 1: level medallion = real `Bullseye` in `progress` mode (overall XP into level; ⌀36–40px⚠) + gold level chip overlapping lower-right (`--accent` disc, DM Serif numeral, ⌀18–22px⚠) + precise overall XpBar (`--accent` fill on `--accent-soft` track, `320/450` tabular nums) + streak flame. Row 2: four attribute micro-bars `LABEL·level ▓▓▓▒` (height 4–6px⚠). Streak flame = hand-rolled single-path SVG (~16–20px, `currentColor` = `--warning`; filled active / stroked broken; NO emoji); text fallback `12d` if it reads poorly.
2. **QuestCard** = full-width ribbon INSIDE the hero below the date line (`--accent-soft` bg, left accent rule). Pre: hollow Bullseye + "Today's quest · projected ~70 XP" + muted bonus hint. Post: filled Bullseye + `bullseye-pop` + "+N XP" + per-event breakdown lines. Uses Bullseye hollow→filled, NOT ⚔/✓ emoji. **SIGNED OFF (Tech Lead): fold the existing TodayCelebration hero Bullseye into the QuestCard** — exactly one completion moment; the once-per-day pop fires on the quest Bullseye (ledger row 08 approved).
3. **Level-up celebration** = gold double-ring burst behind the medallion + existing `bullseye-pop` on the medallion. CSS spec in report §7: `@keyframes level-up-burst` scale 0.8→2.2⚠, opacity .65→0, 560ms⚠ `cubic-bezier(0.16,1,0.3,1)`, ring `2px solid var(--accent)`⚠, second ring delayed 120ms⚠; `prefers-reduced-motion` → rings hidden, level appears instantly. Burst rings gold only (red comes from the medallion's own rings). No collision with daily pop (different elements: medallion vs quest Bullseye).
4. **BadgeWall** = typographic gold-medal system framed by Bullseye rings: unlocked = filled `--accent` disc + DM Serif 1–2-char monogram (`--accent-fg`) in solid ring; locked = hollow `--muted` ring + greyed monogram + hint text (three channels, never color alone). 4-col grid⚠ (fall back 3-col if labels clip), medal ⌀48–56px⚠, non-interactive, "7 / 16" counter. Optional⚠: hand-rolled mountain glyph for elevation badges, flame for streak badges.
5. **Attribute bars**: header shows LABEL + LEVEL + bar only — NO XP numbers at header size; precise `intoLevel/toNext` numbers live on /character attribute cards.
6. **/character order**: portrait (big medallion + level + precise overall bar) → streak (current/longest/today + next milestone) → 4 attribute cards (small Bullseye + level + bar + precise numbers + "Feeds:" line) → BadgeWall → XP log (last 30, coach bonuses folded in with ✦ + `--accent-soft` tint — NOT a separate section) → retroactivity footnote. New components per report §12 incl. `LevelMedallion`; suggested data-testids there. MoreSheet icon: hand-rolled 20px stroke-1.5 shield/bust⚠.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
`npx tsc --noEmit` · `npm run lint` · `npm run build` — all clean.

### 10.2 MCP curl smoke
With dev server + token (per `.claude/quality-tools.md`): `tools/list` → both tools present; `get_game_state` → sane values (streak cross-checked against /calendar; PR count vs `get_records_summary`); `grant_bonus_xp` 50 END → reflected; invalid attribute → safe error.

### 10.3 Browser smoke
390 px: `/` header+quest render, content intact; tap → `/character`; clear `goaldmine.lastSeenLevel` → reload → burst fires once; reduced-motion → no burst; both themes; MoreSheet row works.

### 10.4 Migration verification
`prisma migrate dev` succeeds on Neon (additive); client regenerates; existing pages unaffected.

---

## 11. Appendix

### 11.1 Discovery Notes

User chose: RPG stats metaphor (over mountain-ascent / treasure-dig / blend); Today-page placement; hybrid engine (derived + coach-bonus table); coach awards XP; plan-adherence streak; full v1 scope (badges, celebrations, quest, character page). Explicit steer: keep multi-domain vision in mind — attributes must be per-goal-kind configurable. Prior preference honored: Today stays training-focused (header energizes, never buries the workout).

### 11.2 References

- Approved plan: `~/.claude/plans/sparkling-greeting-gem.md`
- `docs/project-gotchas.md` · `.claude/quality-tools.md`
- Key reuse: `records.ts` (canonicalExerciseName:145, epley1RM:99, bestSetSummary:549), `calendar.ts` (templateForRotationDay:701, rotationBaselineNamesForDate:713, dateKey/startOfDay/addDays)
- Readiness registry as registry-pattern model: `src/lib/goal-targets.ts`
