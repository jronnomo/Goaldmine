# QA Report — Sprint 4: Goal-Type-Aware Project UI

**Date**: 2026-06-12  
**QA Agent**: Sonnet (Claude Code)  
**Base commit**: `11d5710`  
**Sprint 4 HEAD**: `78fee81` (merge of 3 worktree branches via `43afbe5` → `78fee81`)  
**Files reviewed**: 12 modified/new files + git diffs

---

## Verdict

**MINOR FIXES**

Three `Intl.DateTimeFormat` calls without `timeZone` in new server components. Fix is 3-line, low-risk. All other requirements pass. Seven UXR provisional items require manual visual verification on a real 390px device before close of #58.

---

## 1. Requirements Status

### REQ-001 / #35 — Today page focus-goal branching

| AC | Result | Notes |
|----|--------|-------|
| Parallel fetch (no waterfall) | PASS | `Promise.all([getActiveProgram(), getFocusGoal()])` at `page.tsx:21` |
| project kind → `ProjectTodayView` early return | PASS | `page.tsx:42–44` |
| fitness/null → existing body byte-identical | PASS | Confirmed via git diff; 0 changes below line 49 |
| null goal + null program → NoActiveProgram card | PASS | `page.tsx:27–38`; condition `!program && focusGoal?.kind !== "project"` |
| Precedence comment present | PASS | `page.tsx:41` |
| `getTodayContext(program!)` non-null assertion | PASS | `page.tsx:49`; guaranteed non-null by truth table |

**Status: PASS**

---

### REQ-002 / #36 — ProjectTodayView

| AC | Result | Notes |
|----|--------|-------|
| Today's items (planned+done, startOfDay..endOfDay) | PASS | `ProjectTodayView.tsx:33–41` |
| MRR card: latest mrr LogEntry vs log:mrr target | PASS | `:43–47` (metric: "mrr" bare key, target find by "log:mrr") |
| "— / $Y" when no entries | PASS | `mrrValue ?? null` → `"—"` at `:211` |
| MRR card hidden when no log:mrr target | PASS | `mrrTarget != null &&` gate at `:206` |
| Next milestone: planned, date > today, hidden when none | PASS | `addDays(todayStart, 1)` gate at `:56`; `nextMilestone != null &&` at `:242` |
| Empty state copy | PASS | "Nothing scheduled today — open Claude to plan tomorrow or log MRR." `:165` |
| QuestCard Hero layout (ribbon + left rail) | PASS | `section` with `border-l-2` + `borderLeftColor: var(--accent)` at `:118–120` |
| ≥44px tap target rows | PASS | `min-h-[44px]` on Link at `:178` |
| TypeBadge chips | PASS | `TypeBadge` component `:268–274` |
| UrgencyChip (≤14d warning, overdue danger) | PASS | `UrgencyChip` at `:289–308`; `MILESTONE_WARNING_DAYS=14` |
| Once-per-day pop, project-scoped key | PASS | `celebStorageKey = goaldmine.project-celebrated.{id}.{dateKey}` at `:107` |
| Progress prop to TodayCelebration | PASS | `progress={progress}` passed at `:139` |
| testIDs: project-today-view, project-today-checklist, project-today-empty, project-today-item-{id}, mrr-progress-card, next-milestone-card | PASS | All present in component |
| milestoneDueLabel Intl.DateTimeFormat | **PARTIAL** | Missing `timeZone` param at `:101` — see USER_TZ table |

**Status: PASS with 1 MINOR issue (USER_TZ on milestoneDueLabel)**

---

### REQ-003 / #37 — Legend plumbing

| AC | Result | Notes |
|----|--------|-------|
| `LegendKindSchema` extended with `'scheduled-item'` | PASS | `legend.ts:42` |
| `.describe()` updated | PASS | Lists all 7 values at `:58–61` |
| `PROJECT_DEFAULT_LEGEND` added after `DEFAULT_LEGEND` | PASS | `legend.ts:83–86`; `DEFAULT_LEGEND` unchanged at `:71–78` |
| `DEFAULT_LEGEND` byte-identical (unchanged) | PASS | Confirmed in diff |
| `resolveLegend` extended for kind param | PASS | `legend.ts:93–105` |
| Project goals with null legend → `PROJECT_DEFAULT_LEGEND` | PASS | `legend.ts:98–99` |
| Failed-parse fallback | NOTE | Returns `DEFAULT_LEGEND` (not `PROJECT_DEFAULT_LEGEND`) for corrupted project legend. Documented in merge log as acceptable (legends are Zod-validated on write). |
| `MarkerIcon` no-crash for `scheduled-item` | PASS | `MarkerIcon.tsx:30–42` |
| `MarkerIcon.scheduled-item` renders ◆ in `var(--accent)` | PASS | `:37` |
| `data-testid="cal-marker-scheduled-item"` | PASS | `:35` |
| `markersFor` pushes `scheduled-item` after baseline, before goal-date | PASS | `CalendarMonth.tsx:73–74` |
| DC-1 priority comment present | PASS | `CalendarMonth.tsx:66–72` |
| `CalendarDayCell` gains `scheduledItemCount: number` | PASS | `calendar.ts:68–70` |
| `getCalendarMonth` goal select gains `kind: true` | PASS | `calendar.ts:122` |

**Status: PASS**

---

### REQ-004 / #38 — Calendar ScheduledItem query

| AC | Result | Notes |
|----|--------|-------|
| Gated query: project only, zero queries for fitness/null | PASS | `calendar.ts:145–155`; fitness path resolves `Promise.resolve([])` |
| `status IN (planned, done)` | PASS | `calendar.ts:150` |
| `dateKey()` bucketing via `scheduledsByKey` | PASS | `calendar.ts:183–187` |
| All existing cell fields byte-identical | PASS | git diff confirms no removals/changes to existing `buildCell` return fields |
| No double-render for focus goal | PASS | `otherGoalEventsForDate = filterOtherGoalEvents(..., focusGoalId)` filters out focus goal events at `calendar.ts:254–257` |
| `buildCell` receives `scheduledsByKey` arg | PASS | `calendar.ts:259` |
| `buildCell` returns `scheduledItemCount: args.scheduledsByKey.get(k) ?? 0` | PASS | `calendar.ts:448` |
| Two-phase fetch (MED-1 trade-off documented) | PASS | Phase-1 sequential goal fetch + Phase-2 parallel; comment present at `:112–116` |

**Note**: Focus goal's ScheduledItems are fetched twice — once in Phase 2 `scheduledItemsForCal` and once inside `getGoalEventsResult` (query 3, all active goals). Correctly filtered at render via `filterOtherGoalEvents`. This is an aesthetic inefficiency, not a bug.

**Status: PASS**

---

### REQ-005 / #39 — ProjectPlanView

| AC | Result | Notes |
|----|--------|-------|
| Branch BEFORE `!plan` check | PASS | `goals/[id]/plan/page.tsx:30–32` |
| Items ordered date asc, grouped by month | PASS | `ProjectPlanView.tsx:24–43` |
| `CollapsibleCard` per month, current `defaultOpen` | PASS | `:97–99` |
| Per-month "X/Y done" in title | PASS | `:98` |
| Top "X of Y milestones complete" summary | PASS | `:72–80` |
| Status glyphs: ○ planned/skipped, ● done, strikethrough for skipped title | PASS | `:125` (●/○), `:133–138` (line-through for isSkipped) |
| Type badges (milestone accent / launch-step warning / task neutral) | PASS | `TypeBadgePlan` at `:161–173` |
| Due dates per row | PASS | `:145–147` |
| Empty state card | PASS | `:82–87` |
| Empty months suppressed | PASS | No group created for months with 0 items |
| Fitness plan path unchanged | PASS | git diff confirms only 9 lines added before `const plan = goal.plans[0]` |
| testIDs: project-plan-view, plan-month-{yyyy-mm} | PASS | `:64`, `:96` |
| monthLabel uses `Date.UTC` day-15 anti-trap | PASS | `ProjectPlanView.tsx:53` (HIGH-1 fix) |
| monthLabel uses `timeZone: USER_TZ` | PASS | `:57` |
| dueLabel Intl.DateTimeFormat | **PARTIAL** | `:105–108` missing `timeZone` — see USER_TZ table |

**Status: PASS with 1 MINOR issue (USER_TZ on dueLabel)**

---

### REQ-006 / #40 — Milestone burn-down

| AC | Result | Notes |
|----|--------|-------|
| `focusProjectGoal` derived from `activeGoals` (no extra query) | PASS | `progress/page.tsx:51` |
| `MilestoneBurnDown` gated: `focusProjectGoal &&` | PASS | `:146–148` |
| Self-gate when 0 milestones (returns null) | PASS | `MilestoneBurnDown.tsx:21` |
| Total/done/remaining 3-stat grid | PASS | `:63–67` |
| Thin accent scope bar, no animation | PASS | `:70–82`; no transition class |
| Next milestone line | PASS | `:85–104` |
| Urgency chip on next milestone | PASS | `:92–101` |
| No Bullseye | PASS | Only `Card` and `BurndownStat` sub-components |
| Zero extra fitness queries | PASS | `focusProjectGoal` is null for fitness → component not rendered |
| testIDs: milestone-burndown-card, burndown-stat-total|done|remaining | PASS | `:54`, `:64–66` |
| nextDueLabel Intl.DateTimeFormat | **PARTIAL** | `MilestoneBurnDown.tsx:45` missing `timeZone` — see USER_TZ table |
| Burn-down card appears BEFORE Weight card | PASS | `progress/page.tsx:144–148` |

**Status: PASS with 1 MINOR issue (USER_TZ on nextDueLabel)**

---

## 2. Byte-Identity Audit

| File | Changes in diff | Fitness path intact? |
|------|----------------|---------------------|
| `src/app/page.tsx` | 2 imports + 15 lines at top (parallel fetch + 2 guards) | PASS — lines 49–352 unchanged |
| `src/app/progress/page.tsx` | 1 import + 4 lines (focusProjectGoal derivation) + 6 JSX lines (MilestoneBurnDown slot) | PASS — all other lines unchanged |
| `src/app/goals/[id]/plan/page.tsx` | 1 import + 9 lines (project branch before !plan check) | PASS — lines 34–404 unchanged |
| `src/lib/calendar.ts` | +3 type fields, +22 lines (two-phase fetch), +7 lines (scheduledsByKey), +2 lines (buildCell arg/return) | PASS — all existing fields preserved; no deletions |

**Verdict**: PASS — fitness regressions clean.

---

## 3. USER_TZ Audit

| File | Line | Issue | Severity | Fix |
|------|------|-------|----------|-----|
| `src/components/CalendarMonth.tsx` | 292 | `cell.date.getDate()` — client-side getDate() uses client TZ | PRE-EXISTING | Not a Sprint 4 issue |
| `src/components/ProjectTodayView.tsx` | 101 | `new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric" })` — no `timeZone` | MINOR | Add `timeZone: process.env.USER_TZ ?? "America/Denver"` |
| `src/components/ProjectPlanView.tsx` | 105–108 | `new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric" })` — no `timeZone` | MINOR | Same fix |
| `src/components/MilestoneBurnDown.tsx` | 45 | Same pattern for nextDueLabel | MINOR | Same fix |
| `src/components/ProjectPlanView.tsx` | 53–58 | `monthLabel` uses `Date.UTC(y, m-1, 15)` + `timeZone: USER_TZ` | PASS | Correctly guarded (HIGH-1 fix) |

**Analysis**: The three missing `timeZone` params are display-only labels (no bucketing or querying). In practice, ScheduledItem dates stored via `parseDateKey` are TZ-aware midnight (e.g., `2026-06-25T06:00:00Z` for MDT midnight), so UTC display shows the same calendar day. However, the code relies on this implicit assumption rather than being explicit. A date stored as UTC midnight (`T00:00:00Z`) would display one day early in the server UTC context. The USER_TZ audit gate in the PRD requires these to be explicit.

**Required fix** (3 places):
```ts
new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric", // where applicable
  timeZone: process.env.USER_TZ ?? "America/Denver",
})
```

---

## 4. UXR Conformance

| ID | Recommendation | Status |
|----|---------------|--------|
| UXR-s4-01 | QuestCard Hero ribbon + live Bullseye progress | SHIPPED — `border-l-2` + `borderLeftColor: var(--accent)` + `TodayCelebration progress=` |
| UXR-s4-02 | Empty state copy + MRR promotes to slot 2 | SHIPPED — exact copy; MRR card is naturally slot 2 |
| UXR-s4-03 | MRR big number + thin bar, no chart | SHIPPED — `text-4xl` + `h-1.5` bar |
| UXR-s4-04 | ◆ in `var(--accent)` | SHIPPED — `MarkerIcon.tsx:37`; ⚠ verify legibility at 13px |
| UXR-s4-05 | goal-events.ts icon 📅 → ◆ | SHIPPED — `goal-events.ts:194` |
| UXR-s4-06 | PROJECT_DEFAULT_LEGEND fallback | SHIPPED — `legend.ts:83–99` |
| UXR-s4-07 | markersFor order: ...baseline > scheduled-item > goal-date | SHIPPED — `CalendarMonth.tsx:62–74` |
| UXR-s4-08 | CollapsibleCard per month, current open, top "X/Y milestones" | SHIPPED |
| UXR-s4-09 | ○/●/strikethrough glyphs | SHIPPED |
| UXR-s4-10 | Type badges task/milestone/launch-step | SHIPPED |
| UXR-s4-11 | Empty months suppressed | SHIPPED — no group created for 0-item months |
| UXR-s4-12 | Burn-down = framing + 3-stat + bar + next; NO Bullseye | SHIPPED |
| UXR-s4-13 | Urgency chip ≤14d warning / overdue danger | SHIPPED — `MILESTONE_WARNING_DAYS=14`; ⚠ verify threshold |
| UXR-s4-14 | Once-per-day pop, project-scoped key | SHIPPED — `goaldmine.project-celebrated.{goalId}.{dateKey}`; ⚠ verify feels earned |
| UXR-s4-15 | bullseye-pop timing at 28px | NOT CODE — ⚠ visual verify |
| UXR-s4-16 | Ring discretization at 1–2 items | NOT CODE — ⚠ visual verify |
| UXR-s4-17 | No animation on MRR bar, ◆ marker, burn-down bar, timeline rows | SHIPPED — no `transition-` classes on static surfaces |
| UXR-s4-18 | Contrast spots | NOT CODE — ⚠ visual verify |
| UXR-s4-19 | aria-label/title on status icons; badges are text chips | SHIPPED — `aria-label="Done"/"Planned"/"Skipped"` on all glyphs |
| UXR-s4-20 | One Promise.all, no waterfall | SHIPPED — ProjectTodayView single Promise.all |
| UXR-s4-21 | Bullseye center uses `var(--target-fg)` | SHIPPED — confirmed in `Bullseye.tsx:82–93`; no raw `#fff` |

---

## 5. Quality Issues

### ISSUE-1 (Fix required): USER_TZ — Intl.DateTimeFormat without timeZone in 3 files

- `src/components/ProjectTodayView.tsx:101` — `milestoneDueLabel`
- `src/components/ProjectPlanView.tsx:105` — `dueLabel` per item row
- `src/components/MilestoneBurnDown.tsx:45` — `nextDueLabel`

**Risk**: Low in practice (dates stored via parseDateKey are TZ-aware), but fails the explicit USER_TZ audit requirement. Could display off-by-one day if any ScheduledItem date is stored as UTC midnight.

**Fix**: Add `timeZone: process.env.USER_TZ ?? "America/Denver"` to each `Intl.DateTimeFormat` options object.

---

### ISSUE-2 (Documented acceptable): Legend failed-parse fallback

When a project goal has a non-null but corrupted legend (fails Zod parse), `resolveLegend` returns `DEFAULT_LEGEND` instead of `PROJECT_DEFAULT_LEGEND`. Only the `null` case gets the project default.

**Risk**: Negligible — legends are Zod-validated on write via `update_goal_legend` MCP tool. Corrupted legends are not a realistic scenario.

**Decision**: Documented in merge log as acceptable. No code change needed.

---

### ISSUE-3 (Informational): Double-fetch of focus goal ScheduledItems

In `getCalendarMonth`, the focus project goal's ScheduledItems are fetched in two places:
1. Phase 2 `scheduledItemsForCal` query (gated; for `scheduledItemCount` markers)
2. Inside `getGoalEventsResult` → `scheduledItems` query (all active goals' items; for cross-goal event tracking)

The second set is correctly filtered at render via `filterOtherGoalEvents(events, focusGoalId)` and never shown as `otherGoalEvents`. No double-render occurs.

**Risk**: Zero correctness impact. Minor DB query overhead (one extra indexed query per calendar load when focus goal is a project goal).

**Decision**: Informational only. No code change needed.

---

### ISSUE-4 (Informational): MCP project tools not yet shipped

`schedule_item` and `log_metric` are described in `create_goal`'s tool description as the "project tool pack" but are NOT registered in `src/lib/mcp/tools.ts`. The QA runbook uses direct DB access to create ScheduledItem and LogEntry fixtures.

**Risk**: None for this sprint (PRD explicitly excludes MCP changes). Noted for Sprint 5.

---

## 6. Query-Count Summary

| Surface | Fitness/null focus | Project focus | Net new |
|---------|-------------------|---------------|---------|
| Today (`page.tsx`) | No change | +1 `getFocusGoal` (parallel) + 4 in `ProjectTodayView` | +1 parallel on fitness path; project path replaces all fitness queries |
| Calendar (`getCalendarMonth`) | +0 ScheduledItem queries | +1 sequential goal fetch (Phase 1) + 1 `scheduledItemsForCal` | +1 sequential on all paths (sub-ms goal query); +1 query on project path only |
| Plan (`goals/[id]/plan`) | No change | `ProjectPlanView` adds 1 query (all items for goal) | 0 added for fitness; project early-returns before fitness queries |
| Progress | +0 | `MilestoneBurnDown` adds 1 query | 0 added for fitness (component not rendered) |

---

## 7. Fix List (before #58 close)

| # | File | Line | Change |
|---|------|------|--------|
| F-1 | `src/components/ProjectTodayView.tsx` | 101 | Add `timeZone: process.env.USER_TZ ?? "America/Denver"` to milestoneDueLabel Intl.DateTimeFormat |
| F-2 | `src/components/ProjectPlanView.tsx` | 105 | Add `timeZone: process.env.USER_TZ ?? "America/Denver"` to dueLabel Intl.DateTimeFormat |
| F-3 | `src/components/MilestoneBurnDown.tsx` | 45 | Add `timeZone: process.env.USER_TZ ?? "America/Denver"` to nextDueLabel Intl.DateTimeFormat |

All three are one-line changes to Intl.DateTimeFormat options objects. No logic changes, no type changes, no test changes needed.

---

## 8. UXR Recommendation Ledger Status

Per UXR §9, the following provisional items must be ticked before closing #58:

| ID | Status | Evidence / Action |
|----|--------|------------------|
| UXR-s4-04 | ⚠ VISUAL VERIFY | Check ◆ at 13px in both themes via mockup HTML |
| UXR-s4-13 | ⚠ VISUAL VERIFY | 14d threshold — playtest with real milestone dates |
| UXR-s4-14 | ⚠ VISUAL VERIFY | Off-tap pop timing — confirmed as accepted behavior per fitness parity |
| UXR-s4-15 | ⚠ VISUAL VERIFY | bullseye-pop at 28px — may need entry scale nudge |
| UXR-s4-16 | ⚠ VISUAL VERIFY | 1–2 item discretization — verify ring fill reads honestly |
| UXR-s4-18 | ⚠ VISUAL VERIFY | Contrast on cream/coal — pixel artifact available at `docs/ux-research/sprint-4-project-ui.mockup.html` |
| UXR-s4-21 | SHIPPED | `Bullseye.tsx` confirmed uses `var(--target-fg)` exclusively |

---

## Summary

| Category | Result |
|----------|--------|
| REQ-001 (#35) Today branching | PASS |
| REQ-002 (#36) ProjectTodayView | PASS (1 minor) |
| REQ-003 (#37) Legend plumbing | PASS |
| REQ-004 (#38) Calendar query | PASS |
| REQ-005 (#39) ProjectPlanView | PASS (1 minor) |
| REQ-006 (#40) Burn-down | PASS (1 minor) |
| Byte-identity (fitness regression) | PASS |
| USER_TZ audit | MINOR FIXES (3 files) |
| UXR conformance (code-verifiable) | PASS |
| UXR provisional (visual) | 6 items pending manual verify |
| Code quality (`any`/`@ts-ignore`) | PASS — no violations |
| testIDs complete per UXR §7 | PASS |
