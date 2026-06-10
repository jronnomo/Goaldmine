# Requirements — RPG Character Stats

Source of truth: docs/prds/PRD-rpg-character-stats.md. Architecture blueprint (agents/architecture-blueprint*.md) governs design conflicts.

---

## REQ-001 — GameBonusXp model + migration
**Files**: prisma/schema.prisma, prisma/migrations/*_add_game_bonus_xp
**Description**: Add `GameBonusXp` model exactly per PRD §4.1. Run `npx prisma migrate dev --name add_game_bonus_xp` then `npx prisma generate`.
**Acceptance**: model in schema; migration applied; `GameBonusXp` available from `@/generated/prisma/client`; tsc clean.
**Dependencies**: none. **Complexity**: S

## REQ-002 — Game types + rules + attribute registry (the contract)
**Files**: src/lib/game/types.ts, src/lib/game/rules.ts, src/lib/game/attributes-registry.ts
**Description**: Cross-stream contract per PRD §3.1.1–4 and §4.8: `XpEvent`, `AttributeState`, `GameState`, `BadgeDef`, `UnlockedBadge`, `DayLedgerEntry`, `QuestProjection`, `EngineContext/EngineData`; `levelFromXp(xp, base)` (cost L→L+1 = base·L; ATTR=60, OVERALL=150); FITNESS_XP constants table; `GameRulePack` type, `RULE_PACKS`, `rulePackForGoal(kind)` with fitness fallback. Attribute ids are plain strings to the engine.
**Acceptance**: tsc clean; all rule constants in rules.ts only; no Prisma imports in types.ts; levelFromXp unit-sane (L2@60/180 totals per curve).
**Dependencies**: none (parallel with REQ-001). **Complexity**: M

## REQ-003 — Engine: data fetch + day ledger + PR replay + streak + fold
**Files**: src/lib/game/engine.ts
**Description**: `computeGameState(opts)` (React cache()-wrapped fetch wrapper, one Promise.all ~10 queries bounded to plan window) + pure `computeGameStateFromData(data, now)`. `buildDayLedger`: in-memory override-aware replay via `templateForRotationDay` + `rotationBaselineNamesForDate` + overrides map (workoutJson precedence; baselineTestNames:[] = explicitly none). PR replay: chronological walk using `canonicalExerciseName`/`bestSetSummary`/`epley1RM` from records.ts. Plan-adherence streak per PRD §3.1.5 (rest=success; today grace; longest tracked). Fold events → attribute XP → levels → overall. Empty state when no program (`goalKind: null`).
**Acceptance**: PRD §8.6/8.10/8.11/8.13; no resolveDay loops; no raw Date methods; statuses filtered to completed; baseline-mirror double-count guard per PRD §4.8 guards.
**Dependencies**: REQ-001, REQ-002. **Complexity**: L

## REQ-004 — Badges
**Files**: src/lib/game/badges.ts
**Description**: 16 BadgeDefs per PRD §4.9, `unlock(ctx) → dateKey|null` derived from engine pass context.
**Acceptance**: all 16 present; predicates pure; ≥1 unlocks against current history (QA verifies via MCP).
**Dependencies**: REQ-002 (types), REQ-003 (ctx shape). **Complexity**: M

## REQ-005 — Quest projection
**Files**: src/lib/game/quest.ts
**Description**: `projectQuestXp(resolvedDay, …)` pre-training sum of deterministic rules for today (completion base by category + adherence + baselines due (+on-time) + planned hike + nutrition); `earnedTodayXp(events, todayKey)`. Pure functions.
**Acceptance**: pure (no queries); projection excludes PR/volume (listed as bonus hints by UI).
**Dependencies**: REQ-002. **Complexity**: S

## REQ-006 — MCP tools get_game_state + grant_bonus_xp
**Files**: src/lib/mcp/tools.ts
**Description**: Register both per PRD §4.2 with existing registerTool + safe() + parseDateInput patterns. Attribute validated dynamically vs `rulePackForGoal(activeGoal.kind).attributes` (error lists valid ids). grant returns granted + condensed newState.
**Acceptance**: PRD §8.5–8.7; zod shapes match PRD; no hardcoded attribute enum.
**Dependencies**: REQ-002 (can stub engine call until REQ-003 lands). **Complexity**: M

## REQ-007 — Game UI components
**Files**: src/components/game/{CharacterHeader,AttributeBar,XpBar,StreakFlame,QuestCard,BadgeWall,XpEventList}.tsx (server), src/components/game/LevelUpCelebration.tsx (client), src/app/globals.css
**Description**: Per PRD §5 + UX research report (docs/ux-research/rpg-character-stats.md — REQUIRED READING; follow chosen direction). Tokens only; bars are token-filled divs with progressbar ARIA; LevelUpCelebration follows TodayCelebration pattern (localStorage `goaldmine.lastSeenLevel`, imperative class, silent first install); `level-up-burst` keyframes + reduced-motion guard.
**Acceptance**: PRD §8.12; only one new "use client" file; no hex colors; 44px targets; both themes sane.
**Dependencies**: REQ-002 (GameState type; build against fixture). **Complexity**: L

## REQ-008 — /character page + MoreSheet row
**Files**: src/app/character/page.tsx, src/components/MoreSheet.tsx
**Description**: Server page (force-dynamic) composing REQ-007 pieces per PRD §5.1 + UX research order; retroactivity footnote; coach-bonus log (✦ marked). MoreSheet "Character" row matching existing row pattern.
**Acceptance**: PRD §8.9; renders with empty data.
**Dependencies**: REQ-002, REQ-007 (fixture-driven until integration). **Complexity**: M

## REQ-009 — Today page integration
**Files**: src/app/page.tsx
**Description**: Add computeGameState() to existing parallel fetch; render CharacterHeader (+LevelUpCelebration) above hero, QuestCard within hero per UX research; ALL existing sections preserved; hide header when goalKind null.
**Acceptance**: PRD §8.8; existing content DOM-verifiable; no extra serial query waterfalls.
**Dependencies**: REQ-003, REQ-005, REQ-007. **Complexity**: M

## REQ-010 — Gotchas doc
**Files**: docs/project-gotchas.md
**Description**: Three entries: XP derived/retroactive; baseline-mirror double-count guard; alias-map additions re-fragment PRs AND XP.
**Acceptance**: entries present, consistent with doc's existing format.
**Dependencies**: REQ-003. **Complexity**: S
