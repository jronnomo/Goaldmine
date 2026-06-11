# PRD: Goal-state controls & explanations (pause plan + state education)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-10
**Status**: Approved (user-requested follow-on to #62)
**GitHub Issue**: follow-on to #62 (closed) — no separate issue
**Branch**: main
**UX-research**: invoked — docs/ux-research/goal-state-controls.md (UXR-62B ledger). Dev waits for findings; placement/pattern/copy decisions marked [UXR-B].

## 1. Overview

### 1.1 Problem
Two gaps surfaced immediately after #62 shipped: (a) `Plan.active` has no UI — a tracked-but-not-focus goal's auto-scaffolded plan sprays generic retest markers (live: Backflip + Handstand emit ~24 noise events/30d each) and the only off-switch is a manual DB update; (b) the four goal states (Focus / Tracked / Untracked / Someday) plus the new plan-paused state have no in-app explanation — the user asked for "hover descriptions" of options and consequences, and this is a touch PWA where hover doesn't exist.

### 1.2 Solution
A **Pause/Resume plan** control (server action + UI per ux-research placement) with a guard that the focus goal's plan cannot be paused, plus **touch-native consequence explanations** for every state control per the ux-research pattern (popover / legend / microcopy — [UXR-B] decides). Hover remains a desktop progressive enhancement.

### 1.3 Success criteria
- Pausing Backflip's plan from the UI removes its retest markers from calendar/Today/MCP events while the goal row, 8/31 pin, and coach visibility stay intact; Resume restores them.
- Every state control on /goals and /goals/[id] explains its consequence without hover, at 390px, both themes.
- Focus plan cannot be paused (action throws; control hidden/disabled per [UXR-B]).

## 2. Requirements

### REQ-201 — `setPlanActive` server action (S)
`src/lib/goal-actions.ts` (or plan-actions.ts — match existing grouping): `setPlanActive(goalId: string, active: boolean)`. Pausing: sets the goal's single active plan `active=false`. Resuming: re-activates the goal's most-recent plan (mirror setFocusGoal's latest-plan logic; ensure ≤1 active per goal). Guard: throw "Cannot pause the focus goal's plan — switch focus first." when `goal.isFocus` and `active=false`. Revalidate `/`, `/calendar`, `/goals`, `/goals/[id]`. No redirect.
Acceptance: pausing removes the goal's baseline-retest events from `getGoalEvents` output (its plans[] take-1 active query returns none); resume restores; focus guard throws; tsc/lint clean.

### REQ-202 — Pause/Resume UI + paused indicator ([UXR-B] placement) (S)
Control per research (expected: full control on /goals/[id] near the plan card; compact "plan paused" indicator on /goals rows). Confirmation/warning copy per research strings. ≥44px tap target, tokens only, both themes. Resume equally prominent when paused.
Acceptance: control renders, fires action, reflects state; paused goals show the indicator; focus goal shows no pause control.

### REQ-203 — State consequence explanations ([UXR-B] pattern + copy) (M)
The research-chosen touch pattern explaining: Focus, Tracked, Untracked, Someday, Plan active, Plan paused — exact strings from the research report. Applied on /goals (and /goals/[id] where controls live). Desktop hover (`title` or popover-on-hover) as progressive enhancement only. If the pattern needs a client component, keep it minimal and isolated.
Acceptance: each control's consequence readable via tap at 390px; no layout breakage on the already-dense /goals rows; aria: popover/expandable content reachable by screen reader.

## 3. Out of scope
MCP `set_plan_active` / `set_goal_tracked` tools (coach-side parity — Phase 2/3 backlog, noted on #62); skipping plan scaffolding at goal creation (Phase 3 #64); any change to focus/track semantics.

## 4. Edge cases
Goal with zero plans (resume = no-op with message); multiple historical plans (resume picks latest by createdAt — match setFocusGoal); paused goal made focus (setFocusGoal already force-activates latest plan — verify, document); someday goal with paused plan (chips coexist).

## 5. Test plan
tsc/lint/build; live check: pause Backflip + Handstand plans → getGoalEvents 30-day count for them drops to 1 each (target-date only); /goals shows paused indicators; resume Backflip → events return; focus pause guard throws. Browser smoke 390px both pages.
