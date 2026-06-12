# Requirements — Sprint 4: Goal-Type-Aware Project UI

Source of truth: `docs/prds/PRD-sprint-4-project-ui.md` + issues #35–#40/#58 (ACs normative with the global translation: "active goal/active:true" → **focus goal/isFocus** per user decision).

## REQ-001 — Today page focus-goal branching (#35) · M · Dev A
`src/app/page.tsx`: fetch focus goal (getFocusGoal pattern, parallel — no waterfall) and branch on kind. project → ProjectTodayView; fitness/null → existing body BYTE-IDENTICAL (do not reformat fitness JSX). Precedence comment. Null goal + null program → existing NoActiveProgram card.

## REQ-002 — ProjectTodayView (#36) · M · Dev A
New `src/components/ProjectTodayView.tsx` (server): today's planned items (startOfDay..endOfDay), MRR card (latest `mrr` LogEntry vs `log:mrr` target; "— / $Y"; hidden if no target), next milestone (planned, type=milestone, date > today; hidden if none), empty state. Layout per PRD §5 (UXR-finalized).

## REQ-003 — Legend plumbing (#37) · S · Dev B
`legend.ts`: + 'scheduled-item' in LegendKindSchema (+describe update); PROJECT_DEFAULT_LEGEND fallback for project goals with null legend (PRD §3.2.1, mechanism per blueprint); DEFAULT_LEGEND unchanged. `MarkerIcon`: kind renders via icon-string span (no crash). `CalendarMonth.markersFor()`: push when scheduledItemCount > 0. `calendar.ts`: CalendarDayCell + scheduledItemCount: number; getCalendarMonth goal select + kind: true.

## REQ-004 — Calendar ScheduledItem query (#38) · S · Dev B
getCalendarMonth Promise.all + ScheduledItem query gated goal?.kind==='project' (fitness/null: zero queries, counts 0); status IN (planned,done); dateKey() bucketing; existing fields byte-identical. No double-render with goal-events foreign markers (focus goal excluded from otherGoalEvents — verify).

## REQ-005 — ProjectPlanView (#39) · M · Dev C
`goals/[id]/plan/page.tsx` fetch gains kind; project → new `ProjectPlanView.tsx` (server): month-grouped items, status glyphs ○/●/strikethrough, type badges, dates, "X of Y milestones complete", empty state. Fitness path unchanged.

## REQ-006 — Milestone burn-down (#40) · S · Dev C
`progress/page.tsx`: burn-down card gated focus kind==='project' && milestoneCount>0 (total/done/remaining/next upcoming). stats page verify-only. Zero extra queries for fitness.

## REQ-007 — Sprint 4 QA gate (#58) · S · QA
Browser smoke 390px both verticals; fitness byte-identical regression; tsc/build green. Fixtures via Epic B/C MCP tools + set_active_goal flips; full cleanup.
