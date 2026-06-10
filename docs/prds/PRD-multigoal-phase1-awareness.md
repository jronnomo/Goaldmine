# PRD: Multi-goal Phase 1 — Cross-goal Awareness

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-10
**Status**: Approved
**GitHub Issue**: https://github.com/jronnomo/workout-planner/issues/62 (Epic #61)
**Branch**: main
**UX-research**: invoked (background) — findings feed §5 before UI development (REQ-106)

---

## 1. Overview

### 1.1 Problem Statement

`Goal.active` is a single-focus flag. `setActiveGoal` (`src/lib/goal-actions.ts:122`) and `createGoalCore` (`src/lib/goal-core.ts:80-81`) deactivate **every other goal and its plans globally**. Consequences: activating the 5k goal deactivated Elbert's plan entirely, and on the 5k's own race day the day page shows a generic *Full Body Calisthenics* prescription with zero mention of the race. Non-focus goals are invisible: their target dates, retests, and planned hikes don't exist on Today, the calendar, or day pages — and the coach can't see them through MCP either.

### 1.2 Proposed Solution

Split **focus** (the one goal whose plan drives the daily prescription) from **active** (tracked: visible, contributes events, will count in rarity in Phase 2). One goal `isFocus`; many goals `active`. Every active goal contributes goal-tagged **events** — target date (labeled via its own legend, e.g. "Race day 🥇"), baseline retest checkpoints, planned hikes (new nullable `Hike.goalId`), and ScheduledItems — rendered on the calendar, on Today (an "also today / this week" strip), and on day detail pages (race banner above the focus prescription). Existing conflict machinery is extended with **cross-goal conflict kinds** (another goal's event on a hard training day; two goals' key events same week; event within N days of a long effort), surfaced loudly and never auto-resolved. MCP read tools gain full parity so the coach sees exactly what the app shows.

Someday-goal groundwork lands now: `Goal.targetDate` becomes optional with null-safe readers everywhere (no someday UX yet — Phase 3).

### 1.3 Success Criteria

- With 5k active and Elbert focused: 5k race day shows a goal-tagged marker on /calendar, a race banner on /days/<race-date>, an entry on Today during race week, and appears in `get_day(race-date)` output.
- `setFocusGoal(B)` leaves goal A `active: true` and A's plan `active: true`; switching back restores the identical prescription.
- Cross-goal conflict appears when a race lands within 2 days of a long-effort/hike day.
- All goals (incl. date-less) visible via `list_goals` / `get_session_brief` with `isFocus` flags.

---

## 2. User Stories

| ID | As... | I want to... | So that... | Priority |
|----|-------|--------------|------------|----------|
| US-001 | Gabe | my 5k race day to show a race banner above whatever the focus plan prescribes | I never discover a race got planned over | Must Have |
| US-002 | Gabe | to make the 5k goal tracked without deactivating Elbert's plan | both goals progress at once | Must Have |
| US-003 | Gabe | other goals' key dates goal-tagged on the calendar and Today | I can see my whole stack at a glance | Must Have |
| US-004 | coach (claude.ai) | get_today_plan/get_day/get_week/get_session_brief to include other goals' events + conflicts | I can weave secondary goals into the focus plan conversationally | Must Have |
| US-005 | coach | to be warned when another goal's event collides with a hard training day | I resolve it via overrides before it bites | Must Have |
| US-006 | Gabe | to log a hike against a specific goal | the right goal gets the credit/marker | Should Have |
| US-007 | Gabe | goal creation to not silently steal focus | adding a goal never swaps my daily plan | Must Have |
| US-008 | Gabe (Phase 3 prep) | the data model to allow a goal with no target date | "achieve a handstand someday" is capturable later without another sweep | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. **Schema** (one migration `multigoal_phase1`): `Goal.isFocus Boolean @default(false)` + `@@index([isFocus])`; `Goal.targetDate` → `DateTime?`; `Hike.goalId String?` FK → Goal (`onDelete: SetNull`) + `@@index([goalId])` + `Goal.hikes Hike[]`. Backfill SQL appended inside the migration: `isFocus = true` on the most-recently-updated `active = true` goal.
2. **Focus resolution module** `src/lib/goal-focus.ts`: `getFocusGoal()`, `getActiveGoalsWithPlans()` (active goals + their single active plan, `take: 1` by `updatedAt desc`).
3. **`getActiveProgram()`** (`src/lib/program.ts:27`) scopes to the focus goal's active plan: `where: { active: true, goal: { isFocus: true } }`; keep existing fallbacks (global active plan → Program table) for transition states.
4. **`setFocusGoal`** (rename of `setActiveGoal`): flips `isFocus` (clear others, set target), forces target `active: true, status: "active"`, ensures the target goal has exactly one active plan (latest). **Removes** the global goal/plan deactivation. Same revalidates + `/calendar` redirect.
5. **`setGoalTracked(id, tracked)`** new server action: toggles `Goal.active`. Throws when untracking the focus goal ("Switch focus to another goal first"). Revalidates `/`, `/calendar`, `/goals`, `/stats`.
6. **`createGoalCore`**: drop both global `updateMany` calls; created goal `active: true`; `isFocus: true` only when `tx.goal.count({ where: { isFocus: true } }) === 0`; accept `targetDate: Date | null` (null → `weeks` defaults 12, plan `endsOn = addDays(now, 84)`).
7. **Goal events module** `src/lib/goal-events.ts`: `getGoalEvents(range)` → `GoalEvent[]` (shape §4.4) in ≤3 queries; `eventsByDateKey()`, `otherGoalEvents()` helpers. Event sources: target dates (label/icon from each goal's legend `goal-date` entry), baseline retest checkpoints (pure rotation math per plan), planned hikes (attributed `hike.goalId ?? focusGoalId`), planned ScheduledItems.
8. **records.ts factor**: extract pure `baselineCheckpointDates(template, startedOn)`; refactor `getBaselineSchedule` → `getBaselineScheduleForPlan(plan, opts)` + focus-plan wrapper (replaces global `plan.findFirst({active:true})` at `records.ts:196-199`).
9. **Cross-goal conflicts module** `src/lib/goal-conflicts.ts`: pure `crossGoalConflicts(args)` + exported tunable `CROSS_GOAL_RULES = { raceProximityDays: 2, hardCategories: [...] }`. Kinds: `event-on-hard-day`, `key-events-same-week`, `event-near-long-effort`. Each conflict: `{ dateKey, kind, withDates, goalId, goalObjective, label }` with a human-readable `label` surfaced verbatim.
10. **`WeekConflict` widening** (`src/lib/calendar.ts:42-49`): kind union gains the three cross-goal kinds; optional `goalId`, `label`. Backward compatible.
11. **resolveDay/calendar wiring**: `ResolvedDay` gains `otherGoalEvents` + `crossGoalConflicts`; `resolveDay(date, ctx?)` optional pre-assembled-events context (absent → fetch internally, +≤3 queries); `getCalendarMonth` assembles events once for the grid range, `CalendarDayCell` gains `otherGoalEvents`, cross-goal conflict fills `cell.conflict` only when no same-goal conflict exists; month return gains `otherGoals` for the legend card.
12. **UI**: calendar foreign-goal markers + "Other goals" legend section + DayDetail event rows; Today `OtherGoalsStrip` (server component, renders nothing when empty); day-page target-date banner above the prescription + warning-styled conflict banner; goals page Focus badge / Track-Untrack pill / "Someday" chip. Final visual treatment per ux-research findings.
13. **MCP parity** (§4.2): events + conflicts + focus semantics across get_today_plan, get_day, get_week, get_session_brief, list_goals, get_goal, create_goal, update_goal, log_hike, list_planned_hikes, compute_readiness + focus-scoped fallbacks; server instructions reworded.
14. **Null-targetDate safety** at every reader: goals pages, calendar pin, plan-lint goal-date rule, MCP outputs (`targetDate ? dateKey : null`), progress/readiness target line, sorting (`nulls: "last"`).

### 3.2 Secondary Requirements

1. `log_hike` planned-per-day idempotency check scoped to the resolved goalId (two goals may each plan a hike on the same day).
2. `get_today_plan` keeps `activeGoal` as a duplicate of the new `focusGoal` key for one release (saved-prompt compatibility).
3. Code comment on read-time `hike.goalId ?? focus` attribution semantics.

### 3.3 Out of Scope

Merged daily prescriptions; rarity/feasibility scoring (Phase 2 #63); guided intake & someday UX (Phase 3 #64); deterministic plan merging or auto-resolution of conflicts; rarity display; per-goal day overrides for non-focus plans (non-focus retest events are rotation-derived — documented limitation).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

```prisma
model Goal {
  // ...existing...
  targetDate DateTime?              // WAS required — someday-goal groundwork
  isFocus    Boolean  @default(false) // exactly one true; drives daily prescription
  hikes      Hike[]
  @@index([isFocus])
}

model Hike {
  // ...existing...
  goalId String?
  goal   Goal?   @relation(fields: [goalId], references: [id], onDelete: SetNull)
  @@index([goalId])
}
```

Migration plan:
- Name: `multigoal_phase1`. Commands: `npx prisma migrate dev --name multigoal_phase1 --create-only`, hand-append backfill, then `npx prisma migrate dev` + `npx prisma generate`.
- Backfill (same transaction):
  ```sql
  UPDATE "Goal" SET "isFocus" = true WHERE "id" = (
    SELECT "id" FROM "Goal" WHERE "active" = true ORDER BY "updatedAt" DESC LIMIT 1);
  ```
- ⚠ Neon shared with prod: all three ALTERs are metadata-only (ADD COLUMN constant default, DROP NOT NULL, ADD nullable FK) — additive and safe. `onDelete: SetNull` (NOT Cascade) preserves delete_goal's "hikes survive" contract (`tools.ts:4120`).

### 4.2 MCP Tool Surface

No new tools; modified tools below. All inputs via existing Zod patterns; dates via `parseDateInput`. **Connector reload required in claude.ai after deploy.**

| Tool | R/W | Change |
|------|-----|--------|
| `get_today_plan` | R | goal lookup → `isFocus`; field `focusGoal` (duplicate `activeGoal` kept 1 release); ResolvedDay carries `otherGoalEvents` + `crossGoalConflicts`; description explains focus-vs-active |
| `get_day` | R | same ResolvedDay fields flow through; description note |
| `get_week` | R | events assembled once for the week, passed via resolveDay ctx; response gains top-level `otherGoalEvents`, `crossGoalConflicts` |
| `get_session_brief` | R | goal → focus-scoped; new `otherActiveGoals: [{id, objective, targetDate, daysToGo, nextEvent}]` (30-day window); `currentWeekConflicts` = weekConflicts ∪ cross-goal conflicts |
| `list_goals` | R | add `isFocus`; orderBy `[{isFocus:"desc"},{active:"desc"},{targetDate:{sort:"asc",nulls:"last"}}]`; description: "active = tracked & contributes events; isFocus = drives the daily prescription" |
| `get_goal` | R | `isFocus` in output; description sentence |
| `compute_readiness` | R | no-goalId fallback → `isFocus`; copy "focus goal" |
| `create_goal` | W | `targetDate` optional ("omit for a someday goal"); no focus-steal (focus only when none exists); description updated |
| `update_goal` | W | `targetDate` nullable input (clearing allowed); null-safe output |
| `log_hike` | W | optional `goalId` ("which goal this hike trains; omit = focus goal"); validate goal exists & active; planned-per-day idempotency scoped to resolved goalId |
| `list_planned_hikes` | R | include `goalId` + goal objective per hike |
| `grant_bonus_xp`, lint-ack tools, `get_pending_notes` | W/R | internal goal/plan fallbacks → focus-scoped |
| `delete_goal` | W | description: hikes survive, their goalId nulls out |
| Server instructions (`src/app/api/mcp/route.ts:27-29`) | — | "Exactly one goal has isFocus (drives the daily prescription); other active goals stay visible — their events and conflicts surface in get_today_plan/get_day/get_week/get_session_brief." |

Sample smoke (shape check):
```sh
curl -s -X POST http://localhost:3000/api/mcp -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_day","arguments":{"date":"<5k-race-date>"}}}'
# expect: otherGoalEvents: [{type:"target-date", label:"Race day", goalObjective:"...5k...", ...}]
```

### 4.3 Server Actions

| Action | File | FormData | Mutation | revalidatePath | Redirect |
|--------|------|----------|----------|----------------|----------|
| `setFocusGoal` (renamed from `setActiveGoal`) | goal-actions.ts | `id` | isFocus flip; target active; per-goal single active plan | `/`, `/calendar`, `/goals`, `/goals/[id]`, `/stats` | `/calendar` |
| `setGoalTracked` (new) | goal-actions.ts | `id`, `tracked` | `Goal.active` toggle; guard focus | `/`, `/calendar`, `/goals`, `/stats` | no |
| `createGoal` / `updateGoal` | goal-actions.ts | `targetDate` now optional/clearable | per §3.1.6 + null handling | existing | existing |

### 4.4 Modules & Types

```ts
// src/lib/goal-events.ts
export type GoalEventType = "target-date" | "baseline-retest" | "planned-hike" | "scheduled-item";
export type GoalEvent = {
  goalId: string; goalObjective: string; goalKind: string; isFocusGoal: boolean;
  dateKey: string; type: GoalEventType; icon: string; label: string; detail?: string;
};
export async function getGoalEvents(range: { start: Date; end: Date }): Promise<GoalEvent[]>;
export function eventsByDateKey(events: GoalEvent[]): Map<string, GoalEvent[]>;
export function otherGoalEvents(events: GoalEvent[], focusGoalId: string | null): GoalEvent[];

// src/lib/goal-conflicts.ts
export const CROSS_GOAL_RULES = { raceProximityDays: 2, hardCategories: [/* non-rest, non-zone2 */] };
export type CrossGoalConflictKind = "event-on-hard-day" | "key-events-same-week" | "event-near-long-effort";
export type CrossGoalConflict = { dateKey: string; kind: CrossGoalConflictKind; withDates: string[];
  goalId: string; goalObjective: string; label: string };
export function crossGoalConflicts(args: { events: GoalEvent[]; focusGoalId: string | null;
  focusProgram: ActiveProgramSnapshot | null; plannedHikeDateKeys: string[];
  overrideDateKeys?: string[]; range: { start: Date; end: Date } }): CrossGoalConflict[];
```

### 4.5 Date / Time Semantics

All event date math through `@/lib/calendar` (`dateKey`, `parseDateKey`, `addDays`, `startOfDay`, `endOfDay`, `startOfWeekMonday`); MCP `date`/`goalId` inputs via `parseDateInput` / Zod. Retest checkpoints = `addDays(plan.startedOn, week * 7)` per plan. No raw Date arithmetic in new modules.

### 4.6 Override-Awareness

Focus prescription continues exclusively through `resolveDay` (never `getTodayContext`). Cross-goal `event-on-hard-day` uses `templateForRotationDay` (template-level); a `workoutJson` override on the date suppresses the conflict when `overrideDateKeys` provided — otherwise documented as advisory. Non-focus goals' retest events ignore that plan's `PlanDayOverride.baselineTestNames` (documented Phase-1 limitation in module header).

### 4.7 Third-Party Dependencies

None.

---

## 5. UI/UX Specifications

> Visual treatment is subject to ux-research findings (running in background); structure below is the baseline contract. Tokens only (`var(--accent)`, `var(--warning)`, `var(--target)`, `var(--card)`, `var(--border)`, `var(--muted)`), both themes, 390px-first.

### 5.1 Screens

**/calendar** — foreign-goal events render that goal's own legend icon, visually distinguished from focus markers (ux-research decides: ring/chip/etc., must survive 13px markers in ~48px cells). Legend card gains an "Other goals" section: each non-focus active goal's `goal-date` legend entry + objective. DayDetail panel lists other-goal events as `{icon} {label} — {objective}` rows; cross-goal conflicts render their `label` in `var(--warning)`. Conflict corner wedge (existing) covers cross-goal kinds via `cell.conflict`.

**/ (Today)** — `OtherGoalsStrip` (server component) between `CharacterHeader` and the hero card. Shows non-focus events for today (+ this-week lookahead, 7 days): "**Also today:** 🥇 Race day — Run a sub-25 5k"; muted "This week: ◎ Retest · 1-mile run (Wed)". Renders nothing when empty. Conflict line in warning color when a cross-goal conflict touches today.

**/days/[dateKey]** — when `otherGoalEvents` contains a `target-date` event: prominent banner card ABOVE the header/prescription ("🥇 **Race day — Run a sub-25 5k**", target-tinted border). Other event types: muted line in the header block (style of existing `isGoalDate` line at :53). `crossGoalConflicts`: warning banner with the conflict `label`.

**/goals** — badge "Focus" replaces "Active"; per-row Track/Untrack pill (hidden on focus goal); untracked rows dimmed; null-targetDate rows show a "Someday" chip instead of the days-remaining pill.

### 5.2 Navigation Flow

No new routes, no BottomNav changes. Today strip items and calendar cells deep-link to `/days/<dateKey>` (existing behavior).

### 5.3 Responsive / 5.4 Accessibility

390px primary; tap targets ≥44px; cards via `<Card>`; aria-labels on day cells append event labels ("…, Race day — sub-25 5k, conflict: …"); banner text contrast checked in both themes; no color-only signaling (icon + label always paired).

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No focused goal (all untracked/achieved) | `getActiveProgram` falls back (global active plan → Program table); Today renders as today; `getGoalEvents` still returns active goals' events; focus-scoped MCP fallbacks return "no focus goal" messages |
| Goal with null targetDate | No target-date event, no calendar pin; "Someday" chip; progress 0; sorting nulls-last; lint goal-date rule skipped; MCP outputs `targetDate: null` |
| Multiple goals stuck `isFocus: true` (bad state) | All readers use `findFirst(orderBy: { updatedAt: "desc" })` — deterministic winner (mirrors existing active-goal convention) |
| Hike with goalId of a deleted goal | FK `SetNull` — reverts to focus attribution |
| Untrack the focus goal | Action throws; UI hides the control on the focus row |
| Two goals plan hikes same day | Allowed — log_hike idempotency scoped per goal |
| Event on a day with a workout override | `event-on-hard-day` suppressed when override has workoutJson (when overrideDateKeys provided) |
| Range with zero active non-focus goals | Strips/sections render nothing; MCP arrays empty `[]` |
| DST week spans | All math via `@/lib/calendar` helpers |

---

## 7. Security Considerations

No new routes; `/api/mcp` bearer-token unchanged. New inputs (`goalId` on log_hike, nullable targetDate) validated via Zod + existence checks. No raw SQL outside the hand-written migration backfill (reviewed). No `dangerouslySetInnerHTML`.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` 0 errors; `npm run lint` no new errors; `npm run build` succeeds
2. [ ] Migration applies; SQL check: exactly one `isFocus = true`; ≤1 active plan per goal
3. [ ] `setFocusGoal(B)` leaves goal A `active: true` and A's active plan `active: true` (DB-verifiable)
4. [ ] `createGoalCore` with an existing focused goal does NOT change `isFocus` anywhere; with zero focused goals sets it
5. [ ] `createGoalCore` accepts `targetDate: null` → 12-week plan, `endsOn = addDays(now, 84)`
6. [ ] `getGoalEvents` returns target-date events labeled from each goal's own legend (`goal-date` entry), retests from each plan's own `startedOn` + `baselineWeek`, hikes attributed `goalId ?? focus`, scheduled items
7. [ ] `crossGoalConflicts` is pure (no DB), thresholds only from `CROSS_GOAL_RULES`; emits all three kinds per definitions; race 1 day after long-effort day → `event-near-long-effort`
8. [ ] `resolveDay` output includes `otherGoalEvents` + `crossGoalConflicts`; with ctx provided performs no event queries
9. [ ] `get_day(<race-date>)` curl returns a `target-date` event for the non-focus goal; `get_session_brief` returns `otherActiveGoals` + cross-goal kinds in `currentWeekConflicts`; `list_goals` rows include `isFocus`
10. [ ] `log_hike` with `goalId` stores it; `list_planned_hikes` returns it; same-day planned hikes for two goals both insert
11. [ ] Calendar cells expose `otherGoalEvents`; cross-goal conflict fills `cell.conflict` only when no same-goal conflict
12. [ ] /goals: Focus badge, Track/Untrack pill (absent on focus row), Someday chip for null dates
13. [ ] / (Today): strip renders only when a non-focus event exists within 7 days; /days/<race-date>: banner above prescription
14. [ ] All new date math via `@/lib/calendar` (grep for raw `setHours|getDate(|getMonth(|getFullYear(` in changed files → only `@/lib/calendar` itself)
15. [ ] `revalidatePath` coverage per §4.3
16. [ ] No remaining `prisma.goal.findFirst({ where: { active: true } })` outside intentional multi-goal `findMany` sites

---

## 9. Open Questions

None — resolved in discovery (focus model, hike linking, someday groundwork, no focus-steal on create, untrack-focus blocked, ScheduledItems included, N=2 tunable). UI visual treatment pends ux-research findings (structure fixed in §5).

---

## 10. Test Plan

### 10.1 Gates
`npx tsc --noEmit` · `npm run lint` · `npm run build` — all clean.

### 10.2 MCP curl smoke
With dev server running, `tools/list` then `tools/call` each tool in §4.2: get_today_plan (focusGoal + otherGoalEvents), get_day on the 5k race date, get_week (top-level arrays), get_session_brief (otherActiveGoals, merged conflicts), list_goals (isFocus), create_goal without targetDate, update_goal clearing targetDate, log_hike with goalId, list_planned_hikes, compute_readiness without goalId.

### 10.3 Browser smoke (390px)
`/` strip · `/calendar` markers + legend + wedge + DayDetail rows · `/days/<race-date>` banner · `/goals` focus/track/someday. Cross-check `/` and get_today_plan agree on events.

### 10.4 Migration verification
`prisma migrate dev` clean against Neon; `src/generated/prisma` regenerated; existing goal rows render; backfill check: `SELECT count(*) FROM "Goal" WHERE "isFocus" = true` → 1.

### 10.5 Regression
plan-lint with null targetDate; `get_baseline_schedule` output unchanged for the focus plan; game state stable across a focus switch round-trip; recent_history/export untouched.

---

## 11. Appendix

### 11.1 Discovery Notes
Decisions made in the 2026-06-10 session: `Goal.isFocus` boolean (vs settings singleton); nullable `Hike.goalId` (null = focus, no backfill); targetDate optional now (someday groundwork, epic #61 coordination note); creation does not steal focus; ux-research opted in; untrack-focus blocked; ScheduledItems included as events; raceProximityDays = 2 (tunable in CROSS_GOAL_RULES).

### 11.2 References
Epic #61, issues #62/#63/#64; plan file `~/.claude/plans/mighty-hopping-raven.md`; memory: "Plan is conversational, not auto-resolved", "planJson is a snapshot"; `docs/project-gotchas.md`.
