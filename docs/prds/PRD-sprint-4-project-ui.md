# PRD: Sprint 4 — Goal-Type-Aware Project UI

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-12
**Status**: Approved
**GitHub Issue**: #35–#40, #58 (roadmap stories; closed on ship)
**Branch**: main
**UX-research**: invoked — findings at `docs/ux-research/sprint-4-project-ui.md`; §5 finalized from them; Recommendation Ledger ticked in Phase 7.

---

## 1. Overview

### 1.1 Problem Statement
Sprints 1–3 made project goals plannable, coachable, and GitHub-connected — but the dashboard is fitness-only. If chewgether takes focus, Today silently renders the fitness body, the calendar shows no ScheduledItems for the focus goal, and Plan/Progress have no project shapes. The W7 landmine: switching focus does nothing visible.

### 1.2 Proposed Solution
Branch the four surfaces on the **focus goal's** `kind` (modern `isFocus` semantics — the issue ACs' `active:true` wording is stale and is hereby translated):
1. **Today** (`src/app/page.tsx`): focus project goal → `<ProjectTodayView>`; fitness/null → existing body byte-identical.
2. **Calendar**: `scheduled-item` legend kind + `scheduledItemCount` on cells, query gated on project kind.
3. **Plan** (`/goals/[id]/plan`): project goals → `<ProjectPlanView>` month-grouped timeline.
4. **Progress**: milestone burn-down card for focus project goals.

No schema changes, no MCP changes, no new server actions (the #36 "done affordance" links to the day page; mutations stay with Claude/MCP per the plan-is-conversational principle).

### 1.3 Success Criteria
- With a project goal in focus: Today/calendar/plan/progress all render project shapes at 390px.
- With the fitness goal in focus: all four surfaces byte-identical to pre-Sprint-4 (regression gate), zero ScheduledItem queries on fitness paths.
- tsc/lint/build clean.

---

## 2. User Stories

| ID | As... | I want to... | So that... | Priority |
|----|-------|--------------|------------|----------|
| US-001 | Gabe (PWA) | see today's scheduled project items when chewgether is focus | "what do I do today" works for both verticals | Must Have |
| US-002 | Gabe | see MRR progress vs target on Today | the goal number is always in view | Must Have |
| US-003 | Gabe | see scheduled-item markers on the calendar | launch deadlines are visible in month view | Must Have |
| US-004 | Gabe | see a phase/milestone timeline on the plan page | shared visual of scheduled vs upcoming with Claude | Should Have |
| US-005 | Gabe | see milestone burn-down on Progress | "am I tracking toward $1k MRR" without coaching | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. **Focus-goal resolution** (#35): `page.tsx` fetches the focus goal via the `getFocusGoal()` pattern (`src/lib/goal-focus.ts:41`) **in parallel** with existing fetches (no waterfall). Branch: `kind==='project'` → project body; else existing body **byte-identical** (the fitness JSX must not be touched/reformatted). Precedence rule (focus project goal wins over lingering fitness Program) documented in an inline comment. Null goal + null program → existing NoActiveProgram card.
2. **ProjectTodayView** (#36, new server component `src/components/ProjectTodayView.tsx`): (a) today's ScheduledItems (status planned, `startOfDay(now)..endOfDay(now)`) — title, type badge, done affordance linking to `/days/<dateKey>`; (b) MRR card: latest `mrr` LogEntry value vs the `log:mrr` target in `goal.targets` → "$X / $Y MRR", "— / $Y" when no entries, card hidden when no log:mrr target; (c) next upcoming milestone (earliest planned `type='milestone'` with date > today) — title, due date, days remaining (`@/lib/calendar` math), hidden when none; (d) empty state when no items today: "Nothing scheduled today — ask Claude to schedule items for this goal".
3. **Legend plumbing** (#37): extend `LegendKindSchema` with `'scheduled-item'` (enum extended, not replaced); update its `.describe()`; `MarkerIcon` icon-string branch handles it (no crash); `markersFor()` pushes when `cell.scheduledItemCount > 0`; `CalendarDayCell` gains `scheduledItemCount: number` (0 default); `getCalendarMonth` goal select gains `kind: true`; `DEFAULT_LEGEND` unchanged (fitness fallback untouched).
4. **Calendar data** (#38): ScheduledItem query inside `getCalendarMonth`'s Promise.all, gated `goal?.kind === 'project'` (fitness/null → constant 0, no query); `status IN ('planned','done')`; bucketed by `dateKey()` (workoutsByKey idiom); all existing cell fields byte-identical.
5. **ProjectPlanView** (#39, new server component): `/goals/[id]/plan` branches on `goal.kind` (page-level fetch gains `kind`); items ordered date asc, grouped by month ("June 2026" headings); each row: type badge, title, status icon (planned ○ / done ● / skipped strikethrough), due date; summary "X of Y milestones complete"; empty state; fitness path renders the existing sections unchanged.
6. **Milestone burn-down** (#40): `/progress` adds a card gated on focus `kind==='project'` AND milestone count > 0: total/done/remaining + next upcoming milestone; `/stats` is verify-only (readiness already resolves `log:*` per Epic A). Zero extra queries for fitness goals.
7. **Marker dedup**: focus-goal ScheduledItems render ONLY via the new legend kind; the `goal-events.ts` scheduled-item events feed non-focus goals (ForeignGoalMarker) — confirm no double markers for the focus goal.

### 3.2 Secondary Requirements
1. Project goals likely have null `legend` → `DEFAULT_LEGEND` (no scheduled-item entry) would suppress markers. Decision: when the focus goal is `kind='project'` and its legend is null, `resolveLegend` (or the calendar page) falls back to a `PROJECT_DEFAULT_LEGEND` including `scheduled-item` (+ `goal-date`) — architect finalizes mechanism. This avoids requiring a manual `update_goal_legend` call before markers appear.
2. Type badges + status icons reuse Tailwind tokens; no hardcoded colors.

### 3.3 Out of Scope
- Mutating ScheduledItems from the UI (no complete-buttons calling server actions — Sprint 5+ candidate).
- Chewgether goal seeding (#41–48), MCP changes, BottomNav changes, fitness convergence (#50).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
N/A — reads only (`Goal.kind/targets/legend`, `ScheduledItem`, `LogEntry`).

### 4.2 MCP Tool Surface
N/A — no tool changes (no connector reload this sprint).

### 4.3 Server Actions
N/A — no mutations.

### 4.4 Pages / Components
- MODIFY `src/app/page.tsx` — focus-goal fetch + kind branch (fitness JSX untouched).
- NEW `src/components/ProjectTodayView.tsx` (server) — props: goal {id, objective, targetDate, targets}; does its own prisma reads (items today, latest mrr entry, next milestone) in one Promise.all.
- MODIFY `src/lib/legend.ts`, `src/components/MarkerIcon.tsx`, `src/components/CalendarMonth.tsx` (markersFor + type import), `src/lib/calendar.ts` (CalendarDayCell + getCalendarMonth).
- MODIFY `src/app/goals/[id]/plan/page.tsx` + NEW `src/components/ProjectPlanView.tsx` (server).
- MODIFY `src/app/progress/page.tsx` (+ optional NEW `src/components/MilestoneBurnDown.tsx`, may be inline per issue).
- `src/app/stats/page.tsx`: verify-only.

### 4.5 Date / Time Semantics
All "today"/"upcoming"/bucketing via `@/lib/calendar` (`startOfDay`, `endOfDay`, `dateKey`, `addDays`); days-remaining math from dateKey-level diffs, never raw `getDate()`.

### 4.6 Override-Awareness
Fitness path untouched (still `resolveDay`). ScheduledItems are orthogonal to `PlanDayOverride`.

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications

**FINALIZED from `/ux-research` findings — `docs/ux-research/sprint-4-project-ui.md` is NORMATIVE for all visuals (chosen direction "QuestCard Hero" + settled companion surfaces; §7 implementation scope incl. testIDs; §8 accessibility; §9 provisional-verify list; UXR-s4-NN ledger ticked at ship).**

### 5.1 Screen Descriptions (per UXR, summarized)
- **Project Today** (UXR-s4-01/02/03/13/14/20): accent-soft hero ribbon with 2px left accent rail; live `Bullseye` at `progress = doneToday/totalToday` (28px, center `var(--target-fg)`); "Today's work" checklist inside the ribbon (○ muted / ● success, type-badge chips, ≥44px link rows → day page) + "N done · M remaining" tally; below: MRR card (big pair "$X / $Y" + thin accent bar, NO chart) and single-line next-milestone card (urgency chip: warning ≤14d, danger overdue; hidden when none). Empty state: hollow Bullseye + "Nothing scheduled today — open Claude to plan tomorrow or log MRR", MRR card promotes to slot 2. Once-per-day `bullseye-pop` when all items done (reuse TodayCelebration client island, project-scoped localStorage key; reduced-motion → filled, no pop).
- **Calendar** (UXR-s4-04/05/06/07): scheduled-item marker = ◆ U+25C6 in `var(--accent)`; `PROJECT_DEFAULT_LEGEND = [◆ scheduled-item, 🎯 goal-date]` fallback for null-legend project goals; `goal-events.ts` foreign icon 📅 → ◆ for consistency; markersFor pushes after baseline, before goal-date; MARKER_CAP 3 unchanged.
- **Project Plan** (UXR-s4-08/09/10/11): top "X of Y milestones complete"; `CollapsibleCard` per month (current month defaultOpen), per-month "X/Y done" header; rows = status glyph + type chip + title + right date; skipped = strikethrough title; empty months suppressed.
- **Burn-down** (UXR-s4-12): "X of Y milestones complete" + 3-stat grid (total/done/remaining) + thin accent scope bar + next-milestone line; NO Bullseye.
- **Do-not-animate** (UXR-s4-17): MRR bar, ◆ marker, timeline rows, burn-down bar.

### 5.2 Navigation Flow
No new routes; entries via existing BottomNav (Today, Plan→/calendar, Progress) and /goals/[id] → plan.

### 5.3 Responsive + Mobile-First Spec
390px primary; tap targets ≥44px (the day-page link rows); `<Card>` everywhere; tokens only (`--accent/--border/--card/--muted/--success/--warning`).

### 5.4 Accessibility
Status icons get aria-labels/title; badges are text chips (not color-only); contrast per tokens.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| Focus project goal, no items today | Empty-state card (#36 copy) |
| No log:mrr LogEntries | "— / $Y"; no crash |
| No log:mrr target in goal.targets | MRR card hidden |
| No upcoming milestones | milestone card hidden |
| Project goal with null legend | project default legend fallback (§3.2.1) — markers still render |
| No ScheduledItems at all (plan page) | Empty-state card (#39 copy) |
| Fitness focus | Byte-identical everything; zero ScheduledItem queries |
| Focus goal null + program null | Existing NoActiveProgram card |
| Project focus + lingering fitness Program rows | Project body wins (precedence comment) |
| ScheduledItem with far-future date (no due sentinel) | renders in month group like any other |
| 390px overflow (long titles) | truncate/break-words per existing idioms |

---

## 7. Security Considerations
Read-only server components behind existing auth posture; no user-input rendering beyond DB strings already rendered elsewhere; no dangerouslySetInnerHTML.

---

## 8. Acceptance Criteria
Issue ACs **#35–#40, #58 are normative** with one global translation: "active goal (active:true)" → **focus goal (isFocus:true)** per user decision. Summary gates:
1. [ ] tsc/lint/build clean
2. [ ] Project focus: all four surfaces render per §5 at 390px
3. [ ] Fitness focus: byte-identical regression (render-branch diffs empty; no new queries)
4. [ ] USER_TZ audit clean on all new code
5. [ ] §6 edge cases verified
6. [ ] UX-research ledger ticked (shipped/reworked/dropped per rec)

---

## 9. Open Questions
None — all resolved:
- Legend fallback → `PROJECT_DEFAULT_LEGEND` via `resolveLegend(goal {legend, kind})` (UXR-s4-06; calendar goal select gains `kind`).
- Marker glyph → ◆ accent gold (UXR-s4-04); foreign 📅 → ◆ (UXR-s4-05, scope addition to #37).
- Today layout → QuestCard Hero (UXR-s4-01); CharacterHeader omitted on the project path (research: project early-return precedes computeGameState; revisit when game engine grows project rules).
- The UXR §9 ⚠ provisional list (7 items) is the QA visual-verify checklist for #58.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
Standard three gates.

### 10.2 MCP curl smoke
Only as fixture tooling (no tool changes): create temp project goal, `schedule_item` today task, `log_metric mrr`, link + temp milestones + `sync_github_milestones`, `set_active_goal` flips.

### 10.3 Browser smoke (the #58 gate)
1. Dev server; fitness focus → snapshot Today/calendar/plan/progress (reference).
2. Temp project goal with fixtures → `set_active_goal` → walk all four surfaces at 390px: items list, MRR card, milestone card, calendar markers, plan timeline, burn-down.
3. Empty-state pass: second temp project goal with no data → Today empty card, plan empty card, no burn-down.
4. `set_active_goal` back to fitness → diff against reference (byte-identical).
5. Cleanup: gh milestones deleted, temp goals deleted, fitness focus confirmed.

### 10.4 Migration verification
N/A.

---

## 11. Appendix

### 11.1 Discovery Notes
Full Sprint 4; focus-goal semantics translation; UX research invoked. Exploration ground truth in the approved plan (`~/.claude/plans/smooth-mixing-garden.md`) and `.feature-dev/2026-06-12-sprint-4-project-ui/agents/research-output.md`.

### 11.2 References
Issues #35–40, #58 · Epic B/C PRDs · `src/lib/goal-focus.ts` (getFocusGoal) · `src/lib/legend.ts` · `src/lib/calendar.ts:98` (getCalendarMonth) · `src/lib/metrics-registry.ts` (GoalTarget, log:mrr) · goal-events.ts:183 (foreign scheduled-item markers)
