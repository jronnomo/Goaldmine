# PRD: Goal Story & Time-Aware History

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-08-09
**Status**: Approved
**GitHub Issue**: N/A — direct to phase branch
**Branch**: feature/phase1-auth
**UX-research**: skipped — reuses existing chart components and idioms (ReadinessChart/HistoryChart, CSS-var tokens, ProjectTrendsView timeline precedent); no new visual vocabulary

---

## 1. Overview

### 1.1 Problem Statement

Completing a goal deactivates its plan — and every rendering path keys on the *active* plan. Nothing is deleted (logs, plans, overrides, revisions all persist), but the interpretive layer goes dark: past days lose their prescription lens (`resolveDay` hardcodes `getActiveProgram()`), plan-scoped day overrides become invisible, the changelog vanishes from achieved goal pages, and readiness-over-time is never surfaced for archived goals. The user wants to look back years later and truly visualize, compare, and reflect on the whole storyline.

### 1.2 Proposed Solution

1. **Time-aware day resolution**: past dates resolve against the plan that covered them (active or archived) via a new `getProgramForDate()` — the calendar and `/days/[dateKey]` keep their prescription lens forever. Overrides and baseline checkpoints come along automatically. Today/future behavior is byte-identical.
2. **Frozen readiness arc**: `complete_goal` captures the weekly readiness series into the completion snapshot (optional field, no schema change).
3. **Story section** on the achieved-goal trophy page: readiness arc chart, start→final targets table, per-baseline progression charts, phase timeline annotated with plan-revision reasoning (restores the changelog), hike arc, project metric arcs.
4. **`get_goal_story` MCP read tool**: the full story bundle for any goal (achieved = frozen; active = story-so-far) — serves retrospective sessions and years-later reflection chats.

### 1.3 Success Criteria

- A date under the deactivated Mt. Elbert plan renders its planned workout, overrides, and baseline checkpoints on `/days/[dateKey]`, the calendar, and `get_day`/`get_week` — marked as archived.
- Today page output is byte-identical to before (regression tests + smoke).
- New completions freeze the readiness series; the trophy page renders the full story with zero live readiness computation for achieved goals (R9).
- `get_goal_story` returns the bundle for achieved and active goals; leaky-reads green.
- Zero schema changes; all four gates green (baseline 911 tests).

---

## 2. User Stories

| ID     | As a... | I want to... | So that... | Priority |
|--------|---------|--------------|------------|----------|
| US-001 | user | open any past day and still see what was prescribed, even after completing that goal | history keeps its meaning | Must Have |
| US-002 | user | see my archived goal's full story (readiness arc, baseline progressions, plan evolution, hikes) on its trophy page | I can reflect and compare years later | Must Have |
| US-003 | the coach (MCP) | pull the whole story bundle in one `get_goal_story` call | retrospective sessions are evidence-rich without 10 tool calls | Must Have |
| US-004 | the coach | read past weeks via `get_week`/`get_day` under archived plans | history questions get real answers, not "outside the active plan window" | Must Have |
| US-005 | user | NOT be able to edit history (overrides/skip on archived days) | the record stays trustworthy | Must Have |
| US-006 | user with a pre-feature completion (Elbert) | recapture the frozen arc by reopen + re-complete | my flagship goal gets the full story | Should Have |
| US-007 | brand-new user | see nothing new/broken (no plans, no stories) | empty states stay clean | Must Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. `getProgramForDate(date, now?)` + pure `pickProgramForDate()` in `program.ts`: active-covers → active (identical); else PAST dates only (USER_TZ dateKey compare) → covering plan by `updatedAt desc` (coverage = startedOn + planJson.totalWeeks*7, filtered in JS); else fall through to active program / null. Returns `ProgramForDate = ActiveProgramSnapshot & {source: "active"|"archived"}`.
2. `resolveDay`: ctx-injectable `program?`; uses `getProgramForDate` otherwise; additive `ResolvedDay.resolvedPlan {id, name, source} | null`. Override fetch/baseline checkpoints work via the historical plan automatically.
3. `getCalendarMonth`: plan-windows list overlapping the grid; per-cell pick via the shared pure helper; overrides `planId IN (...)` keyed `planId|dateKey`; `CalendarDayCell.planSource?`; conflicts skipped on archived cells.
4. UI markers: dimmed archived cells + legend line on calendar; "Archived plan · {name}" badge on `/days/[dateKey]`; DayOverrideForm/SkipDayControl hidden on archived days (write guards in day-actions untouched).
5. `get_week`: guard via `getProgramForDate` ("outside any plan window"); `ctx.program` passed to the 7 resolveDay calls; description updated. `get_day` inherits.
6. `GoalCompletionSnapshot` v1 + optional `readinessSeries?: {dateKey, score}[]`; parser validates when present (malformed fails closed), legacy rows parse; `computeCompletionSnapshot` captures via `computeReadinessSeries(createdAt, targets, completedAt, goalId)`, capped 104 points.
7. `goal-story-core.ts` (pure): `GoalStory` type (serializable; timeline revisions carry summary/reasoning, NO triggerNote) + `clipToWindow` + `derivePhaseTimeline`.
8. `goal-story.ts` (server): `getGoalStory(goalId)` — achieved → frozen series/targets (zero live readiness, R9); active → live story-so-far; latest plan regardless of active + revisions → timeline; fitness → baseline arcs (targets' `baseline:*` ∪ template baselineWeek, clipped to window) + hike arc (goalId query, no userId); project → metric arcs via `getLogMetricSeries`.
9. `get_goal_story` MCP tool (Zod `{goalId}`, safe(), near get_goal) + leaky-reads case.
10. Trophy page: changelog restored via latest-plan-with-revisions fallback; `GoalStorySection` mounted after Reflection card; 6 components in `src/components/goal-story/` reusing ReadinessChart/HistoryChart idioms; legacy hint when series absent: "Readiness arc not captured for this completion — reopen and re-complete the goal to record it."

### 3.2 Secondary Requirements

1. First-ever test coverage for `computeReadinessSeries`.
2. Story section works for achieved project goals (metric arcs) as well as fitness.

### 3.3 Out of Scope

- Per-date revision reconstruction (as-completed lens is locked).
- `/compare` archived-goal inclusion (`compare.ts:47` active filter — known limitation, flagged).
- Goal-events decoration for archived goals beyond the existing 🏆 event.
- Any schema change, index, or migration.
- Editing history (override writes on archived days).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

**None.** `readinessSeries` lives inside the existing `Goal.completionSnapshot` Json. No migration (prod migrations are manual — deliberately avoided).

### 4.2 MCP Tool Surface

| Tool | Purpose | Read/Write | Notes |
|------|---------|------------|-------|
| `get_goal_story` (new) | Full story bundle for a goal | Read | Achieved=frozen, active=story-so-far; leaky-reads case; no triggerNote in revisions |
| `get_week` (mod) | Time-aware guard + program ctx | Read | Coach-visible semantics change via description |
| `get_day` (inherits) | Time-aware via resolveDay | Read | Additive `resolvedPlan` field |

`get_goal_story` Zod: `{ goalId: z.string().describe(...) }`. Returns the `GoalStory` shape (§ blueprint D6). Sample curl per template conventions.

### 4.3 Server Actions

None new. Existing day-actions write guards untouched (active-plan-only writes).

### 4.4 Pages / Components

- Modified: `src/app/days/[dateKey]/page.tsx` (badge + hide write controls on archived), calendar month UI (dim + legend), `src/app/goals/[id]/page.tsx` (changelog fallback + Story mount).
- New: `src/components/goal-story/{GoalStorySection, StoryReadinessCard, StoryTargetsTable, StoryBaselineArcs, StoryMetricArcs, StoryTimeline, StoryHikeArc}.tsx` — server components except chart leafs (reuse existing client ReadinessChart/HistoryChart).
- No BottomNav/nav changes.

### 4.5 Date / Time Semantics

"Past" = `dateKey(date) < dateKey(now)` USER_TZ via calendar-core — never raw Date comparison. All series/window keys are dateKeys/ISO strings crossing boundaries.

### 4.6 Deferral / Override Awareness

resolveDay remains the single source of truth; historical days flow through the same deferral-aware machinery with the historical program injected. No `getTodayContext` misuse.

### 4.7 Tenant Scoping & Auth

All plan/goal/hike/log reads via `getDb()` (PlanDayOverride is the documented non-owned exception, raw reads keyed by scoped-client-derived plan ids). `get_goal_story` selects exclude userId; revisions exclude triggerNote. No route/auth changes.

### 4.8 Third-Party Dependencies

None.

---

## 5. UI/UX Specifications

390px single column. Story section stacks Cards after Reflection: Readiness arc (h-48 AreaChart or legacy hint) → Targets start→final table (met ✓) → Phase timeline (phase bands + interleaved revision entries with collapsible reasoning) → Baseline arcs (HistoryChart per test) → Hike arc (compact rows: date · route · mi/ft · pack) → Metric arcs (project). Calendar archived days: `opacity-70` day titles + legend line "Dimmed days: from a completed plan". Day page: muted "Archived plan · {name}" badge under the date header. Accessibility: charts keep the role="img" + computed aria-sentence idiom; `<details>` for reasoning.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| Today covered by active plan | Byte-identical resolution (regression-tested) |
| Today/future NOT covered by any plan | Same as today: out_of_plan against active program/null — archived fallback NEVER applies to non-past dates |
| Past date covered by two plans | `updatedAt desc` winner (documented) |
| Past date covered by no plan | out_of_plan (unchanged) |
| Brand-new user (zero plans) | getProgramForDate null; everything renders as today |
| Achieved goal, snapshot without readinessSeries (legacy/Elbert) | Story renders everything else + recapture hint; no live recompute |
| Malformed readinessSeries in stored Json | Series field dropped in isolation (S8); rest of snapshot parses — trophy card intact, arc shows the recapture hint |
| Legacy Program-table fallback covers a past date a real Plan also covers | The Plan-table candidate wins (correct override keying + archived badge); legacy row still serves legacy-only users and today/future dates (SMOKE-1 fix) |
| Achieved goal with zero targets | No readiness chart/targets rows; timeline/hikes still render |
| Plan-less goal (never scaffolded) | timeline null; story still renders logs-based arcs |
| Archived day override write attempt | UI controls hidden; server guards unchanged (active-plan-only) |
| get_week on never-covered week | "outside any plan window" error |
| DST-spanning series | weekly cursor via calendar-core helpers (existing behavior) |

---

## 7. Security Considerations

Tenant scoping per §4.7; leaky-reads case for `get_goal_story` (no private note types — triggerNote excluded by design; no cross-tenant rows; no userId in payloads). No new routes; no raw SQL; no dangerouslySetInnerHTML.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` 0 errors · 2. [ ] lint no new errors · 3. [ ] `npm run test` green (new suites incl. program.test.ts, series coverage, goal-story tests, parser roundtrips) · 4. [ ] build succeeds
5. [ ] resolveDay today-regression test: active-covered date resolves identically to pre-change
6. [ ] resolveDay historical test: archived plan date → isInPlan, override visible, baselinesDue populated, `resolvedPlan.source="archived"`
7. [ ] getCalendarMonth mixed-month test: per-cell planSource correct, per-plan overrides found, no conflicts on archived cells
8. [ ] `get_day` on a past Elbert-plan date returns prescription + resolvedPlan archived (curl)
9. [ ] `get_week` succeeds on an archived-plan week; errors on never-covered dates
10. [ ] complete_goal freezes readinessSeries (≤104 points); parser roundtrips with/without/malformed
11. [ ] `get_goal_story` returns frozen bundle for achieved goal, live for active; leaky-reads green
12. [ ] Achieved `/goals/[id]` renders Story section + restored changelog; legacy snapshot shows recapture hint
13. [ ] Archived day/calendar markers render; override/skip controls hidden on archived days
14. [ ] No schema/migration changes in the diff
15. [ ] All date logic via `@/lib/calendar(-core)`; "past" checks by USER_TZ dateKey

---

## 9. Open Questions

None — resolved in discovery (as-completed lens; full story; freeze + legacy hint; get_goal_story yes; zero schema changes).

---

## 10. Test Plan

Per §8 + blueprint Part 3: program.test.ts (boundaries, ordering, past-gate, Today contract), readiness.test.ts series cases, goal-completion-core parser roundtrips + capture cap, calendar historical/regression/mixed-month, goal-story achieved-vs-active (asserts computeReadiness NOT called for achieved), leaky-reads, get_week tools test. MCP curl: get_day (past Elbert date), get_week (archived week), get_goal_story (achieved + active). Browser 390px: Today unchanged, calendar mixed month, historical day, trophy Story. No migration steps.

---

## 11. Appendix

### 11.1 Discovery Notes
Triggered by the founder's concern that moving between goals "wipes" history. Exploration showed data persists but the interpretive layer keys on active plans. Decisions locked via AskUserQuestion (4/4 recommended options). Elbert completed pre-feature → recapture path documented.

### 11.2 References
- Blueprint: `.feature-dev/2026-08-09-goal-story/agents/architecture-blueprint.md`
- Prior feature: `docs/prds/PRD-goal-completion-ceremony.md`
- Precedents: goal-completion.ts:111 latest-plan idiom; ProjectTrendsView timeline; ReadinessChart/HistoryChart idioms; list_planned_hikes field selection
