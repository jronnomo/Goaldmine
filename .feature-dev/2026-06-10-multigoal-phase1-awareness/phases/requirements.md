# Requirements — Multi-goal Phase 1: Cross-goal Awareness

PRD: docs/prds/PRD-multigoal-phase1-awareness.md (source of truth). Issue #62 / Epic #61.

---

## REQ-101 — Schema migration + focus/active core split (L)

**Description**: Single migration `multigoal_phase1`: `Goal.isFocus Boolean @default(false)` + `@@index([isFocus])`; `Goal.targetDate` → `DateTime?`; `Hike.goalId String?` FK → Goal `onDelete: SetNull` + index + `Goal.hikes` relation. Hand-appended backfill: `isFocus=true` on most-recently-updated active goal. New `src/lib/goal-focus.ts` (`getFocusGoal`, `getActiveGoalsWithPlans`). `getActiveProgram()` scopes to `{ active: true, goal: { isFocus: true } }` with existing fallbacks. `setActiveGoal` → `setFocusGoal` (isFocus flip only; target forced active; per-goal single-active-plan; NO global deactivation). New `setGoalTracked(id, tracked)` (guard: cannot untrack focus). `createGoalCore`: drop global updateMany calls; focus only when none exists; accept null targetDate (12-week default plan). Flip all single-goal `active:true` call sites to focus-scoped (PRD §3.1.14 + plan table: calendar.ts:77/471/737, records.ts:197 via REQ-102 seam, plan-lint.ts:221, game/engine.ts:932, mcp/tools.ts fallbacks ~602/881/913/1186/3825/3879/3947, baselines/new/page.tsx). Null-targetDate guards at every reader (goals pages, calendar pin calendar.ts:132+602, plan-lint goal-date rule, progress/readiness target line, sorting nulls-last).

**Files**: prisma/schema.prisma, prisma/migrations/*multigoal_phase1/migration.sql, src/lib/goal-focus.ts (new), src/lib/program.ts, src/lib/goal-actions.ts, src/lib/goal-core.ts, src/lib/calendar.ts, src/lib/plan-lint.ts, src/lib/game/engine.ts, src/lib/mcp/tools.ts (focus fallbacks only), src/app/goals/page.tsx (query/order only), src/app/goals/[id]/page.tsx (null guards), src/app/progress/page.tsx, src/app/stats/page.tsx, src/app/calendar/page.tsx (null guard), src/app/baselines/new/page.tsx.

**Acceptance**: PRD criteria 2–5, 14, 16. tsc/lint/build clean. Exactly one isFocus=true after migration; setFocusGoal leaves other goals + plans active; createGoalCore no-steal; null targetDate renders everywhere.

**Depends**: — (blocks all). **Complexity**: L

---

## REQ-102 — Goal events library (M)

**Description**: New `src/lib/goal-events.ts` per PRD §4.4: `getGoalEvents(range)` (≤3 queries: getActiveGoalsWithPlans + planned hikes in range with goalId + planned ScheduledItems in range), `eventsByDateKey`, `otherGoalEvents`. Target-date events labeled via `findLegendEntry(resolveLegend(goal), "goal-date")`. Retest events: factor pure `baselineCheckpointDates(template, startedOn)` into src/lib/records.ts; refactor `getBaselineSchedule` → `getBaselineScheduleForPlan(plan, opts)` + focus-plan wrapper (kills global active-plan read at records.ts:196-199). Hike attribution `hike.goalId ?? focusGoalId` (read-time semantics comment). Module-header comment: non-focus retests are rotation-derived (ignore that plan's overrides) — Phase-1 limitation. All date math via @/lib/calendar.

**Files**: src/lib/goal-events.ts (new), src/lib/records.ts.

**Acceptance**: PRD criterion 6; getBaselineSchedule output unchanged for focus plan (regression); no raw Date arithmetic.

**Depends**: REQ-101. **Complexity**: M

---

## REQ-103 — Cross-goal conflicts library (M)

**Description**: New `src/lib/goal-conflicts.ts`: exported tunable `CROSS_GOAL_RULES = { raceProximityDays: 2, hardCategories }`; pure `crossGoalConflicts(args)` (PRD §4.4 signature) emitting `event-on-hard-day` (via templateForRotationDay; suppressed when overrideDateKeys contains the date), `key-events-same-week` (≥2 goals' target-date/retest events in same focus rotation week; calendar-week fallback when no focus program), `event-near-long-effort` (target-date within ±N days of long-endurance slot or planned hike). Human `label` on every conflict. Widen `WeekConflict` in src/lib/calendar.ts (kind union + optional goalId/label) backward-compatibly; `CalendarDayCell.conflict` type follows.

**Files**: src/lib/goal-conflicts.ts (new), src/lib/calendar.ts (types only).

**Acceptance**: PRD criterion 7; pure (no DB import); existing weekConflicts consumers compile unchanged.

**Depends**: REQ-102 (GoalEvent type). **Complexity**: M

---

## REQ-104 — resolveDay / calendar wiring (M)

**Description**: `ResolvedDay` gains `otherGoalEvents: GoalEvent[]` + `crossGoalConflicts: CrossGoalConflict[]`. `resolveDay(date, ctx?)` optional `{ goalEvents, focusGoalId }` ctx — absent: fetch via getGoalEvents inside existing Promise.all; present: zero extra queries. `getCalendarMonth`: events for grid range in its Promise.all; cells gain `otherGoalEvents`; month-range crossGoalConflicts computed once; cross-goal conflict fills `cell.conflict` only when no same-goal conflict (legacy precedence); return gains `otherGoals: {id, objective, legend}[]`. resolveDay's goal lookup select adds `id`.

**Files**: src/lib/calendar.ts.

**Acceptance**: PRD criteria 8, 11; get_week query count grows by ≤3 total.

**Depends**: REQ-102, REQ-103. **Complexity**: M

---

## REQ-105 — Goals page UI (S)

**Description**: /goals: "Focus" badge (was "Active"); make-focus uses renamed `setFocusGoal`; per-row Track/Untrack pill via `setGoalTracked` (absent on focus row; untracked rows dimmed); "Someday" chip replaces days-pill when targetDate null. /goals/[id] edit form: optional/clearable date input.

**Files**: src/app/goals/page.tsx, src/app/goals/[id]/page.tsx.

**Acceptance**: PRD criterion 12; tokens only, both themes, 390px.

**Depends**: REQ-101. **Complexity**: S

---

## REQ-106 — Calendar / Today / Day-page UI (M)

**Description**: Per PRD §5 + ux-research findings (docs/ux-research/multigoal-phase1-awareness.md — READ FIRST): CalendarMonth foreign-goal markers (distinguished per research), marker cap/overflow, DayDetail other-goal event rows + conflict labels, legend card "Other goals" section, aria-labels. New `src/components/OtherGoalsStrip.tsx` (server) on Today between CharacterHeader and hero; renders nothing when empty. Day page: target-date banner card above prescription; muted lines for other event types; warning conflict banner.

**Files**: src/components/CalendarMonth.tsx, src/components/OtherGoalsStrip.tsx (new), src/app/calendar/page.tsx, src/app/page.tsx, src/app/days/[dateKey]/page.tsx, src/components/MarkerIcon.tsx (if needed).

**Acceptance**: PRD criteria 13 + §5; tokens only; both themes; ≥44px taps.

**Depends**: REQ-104 + ux-research findings. **Complexity**: M

---

## REQ-107 — MCP parity (M)

**Description**: PRD §4.2 table in full: get_today_plan (focusGoal + dup activeGoal), get_day, get_week (ctx-assembled events + top-level arrays), get_session_brief (focus goal, otherActiveGoals 30-day next-event, merged currentWeekConflicts), list_goals (isFocus + ordering), get_goal, compute_readiness, create_goal (optional targetDate, no-steal description), update_goal (nullable date), log_hike (optional goalId + scoped idempotency), list_planned_hikes (goalId + objective), delete_goal description, server instructions (src/app/api/mcp/route.ts:27-29). Tool descriptions explain focus-vs-active.

**Files**: src/lib/mcp/tools.ts, src/app/api/mcp/route.ts.

**Acceptance**: PRD criteria 9, 10; curl smoke per §10.2.

**Depends**: REQ-102, 103, 104. **Complexity**: M

---

## Build order

REQ-101 → {REQ-102, REQ-105} → REQ-103 → REQ-104 → {REQ-106, REQ-107}
