# PRD: Goal Completion Ceremony & Archival

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-08-09
**Status**: Complete
**GitHub Issue**: N/A — direct to phase branch
**Branch**: feature/phase1-auth
**UX-research**: skipped — reuse of existing celebration/card patterns (TodayCelebration, LevelUpCelebration, coal/parchment card templates); user chose keep-it-simple

---

## 1. Overview

### 1.1 Problem Statement

The founder just completed their first big long-term goal — and the app did nothing. `Goal.status="achieved"` exists in the schema but is inert: no `completedAt` timestamp, no persisted final snapshot, no XP, no badge, no celebration, no archival. Worse, an achieved goal keeps emitting calendar events, shows a red "Nd ago" overdue chip on `/goals`, and renders as a peer in the flat goals list. Finishing a goal — the entire point of the product — is currently an anticlimax.

### 1.2 Proposed Solution

Make goal completion a first-class, celebrated lifecycle event:

1. A **`complete_goal`** write path (MCP tool + dashboard form → shared `completeGoalCore`) that in one transaction sets `status="achieved"` + `completedAt` + a persisted **completion snapshot** (per-target start→final, readiness score, days elapsed, weeks basis), releases focus, untracks the goal, and deactivates its plans. Backdatable (optional past date, snapshot computed as of end-of-day USER_TZ) and reversible via **`reopen_goal`**.
2. **Game payoff**: a `goal.achieved` XP rule scaled by goal size (150 base + 25/week capped at 12 + 50/target-met capped at 5; max 700) and six new badges (first/3rd/5th/10th goal + per-kind firsts).
3. **Display**: a Completed trophy section on `/goals`, a trophy header on `/goals/[id]`, a 🏆 calendar event on the completion date, a one-shot celebration animation, and a shareable Satori "Goal Completed" card (`generate_completion_card` tool + `/recap/completion` route).
4. **Coach integration**: updated coach rules (both repo locations) so the coach proposes completion conversationally, narrates the ceremony payload, and runs the focus-handoff covenant.

### 1.3 Success Criteria

- Completing a goal via MCP or dashboard produces: archived goal (off calendar/Today), persisted snapshot, XP event on the completion date, badge unlock(s), visible trophy row, and a renderable completion card.
- Backdated completion places the XP event on the backdated dateKey and computes the snapshot as of that day's end (USER_TZ).
- `reopen_goal` fully reverses the lifecycle change; XP/badges recompute automatically (derived engine).
- The character page does NOT reset to Level 1 when the only goal's plan is deactivated (program fallback).
- All 4 code gates clean; ~613 Vitest tests still green plus new suites.

---

## 2. User Stories

| ID     | As a... | I want to... | So that... | Priority |
|--------|---------|--------------|------------|----------|
| US-001 | user who finished a goal | mark it complete (possibly backdated to the real finish date) | the achievement is recorded with a frozen final snapshot | Must Have |
| US-002 | the coach (claude.ai via MCP) | call `complete_goal` and receive a ceremony payload (snapshot, XP, badges, level diff, remaining goals) | I can narrate the celebration and propose the next focus goal | Must Have |
| US-003 | user | see completed goals in a trophy section on /goals with final stats | my finished goals are permanently displayed, not mixed with active work | Must Have |
| US-004 | user | earn meaningful XP and badges for completing a goal | the game system honors the biggest achievement type in the app | Must Have |
| US-005 | user | get a shareable "Goal Completed" card image | I can share the win outside the app | Must Have |
| US-006 | user | reopen a goal completed by mistake | the action is reversible without data surgery | Must Have |
| US-007 | user | see a celebration animation the first time I view the completed goal | the moment feels rewarding | Should Have |
| US-008 | brand-new user (zero rows) | see no completion surfaces | empty states stay clean | Must Have |
| US-009 | user who completed a goal | write a post-goal reflection, co-authored with the coach who gathers my logs/history to jog my memory | the lessons of the whole journey are captured alongside the trophy | Must Have |

All stories apply to every tenant (not founder-only). The founder will be the first exerciser via backdated completion.

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. Schema: `Goal.completedAt DateTime?`, `Goal.completionSnapshot Json?`, `@@index([userId, status])`. Additive migration `add_goal_completion`.
2. `GoalCompletionSnapshot` v1 type (pure, client-safe, versioned) + defensive `parseCompletionSnapshot()`. Snapshot stores **inputs** (targets start/final/met, weeks basis, readiness, feasibility tier, days elapsed, `xpBasis`); engine derives XP live from `xpBasis` — the "XP is fully derived" invariant holds.
3. `completeGoalCore(goalId, date?)`: guards (exists; not already achieved; date not future; date ≥ createdAt), snapshot computed BEFORE mutation via `computeReadiness(targets, endOfDay(date), goalId)`, then one `$transaction` of sequential **top-level** calls: `goal.update({status:"achieved", completedAt, completionSnapshot, isFocus:false, active:false})` + `plan.updateMany({where:{goalId, active:true}, data:{active:false}})`.
4. `reopenGoalCore(goalId)`: guard status==="achieved"; restore `status:"active"`, `completedAt:null`, snapshot→`Prisma.JsonNull` (returned in response), `active:true`; does NOT restore focus or reactivate plans (returns `hints: {latestPlanId, hadFocus}`).
5. MCP `complete_goal` (Zod: `goalId`, optional `date` via `parseDateInput`): returns ceremony payload `{goal, snapshot, xp, badgesUnlocked, levelBefore, levelAfter, focusReleased, planDeactivated, remainingActiveGoals, message}` using uncached `computeGameStateFresh` for the before/after diff.
6. MCP `reopen_goal`: returns `{goal, discardedSnapshot, xpRemoved, hints}`.
7. MCP `generate_completion_card` (goalId, template coal|parchment, format story|post|square): requires achieved + parseable snapshot; returns image + snapshot JSON.
8. `update_goal` handler REJECTS `status:"achieved"` with redirect message (enum kept for schema stability); `active`/`abandoned` unchanged. `list_goals` rows gain `completedAtDateKey`.
9. Engine: `EngineContext.completedGoals[]`; achieved-goals query in `_computeGameState`; `goal.achieved` XP events at `dateKey(completedAt)`, attribute null; `goalAchievedXp(weeks, targetsMet) = 150 + min(weeks,12)*25 + min(targetsMet,5)*50` (constants in rules.ts GOAL_XP); unparseable snapshot → base XP fallback.
10. **Engine program fallback**: when no active plan exists, fall back to most-recently-updated plan (`getMostRecentProgram()` in program.ts); `emptyState()` only when no plan ever existed. Prevents character-page wipe after completing the only goal.
11. Badges (16→22): `goal-first`, `goal-third`, `goal-fifth`, `goal-tenth`, `goal-fit-finisher`, `goal-ship-it`; unlock dateKey = qualifying goal's completedAt dateKey.
12. Calendar cleanup: `getActiveGoalsWithPlans()` adds `status:"active"` filter; new `GoalEventType` `"goal-completed"` (hardcoded 🏆 icon — NO legend-kind enum change); `setFocusGoalCore` refuses achieved goals.
13. Dashboard: server actions `completeGoal(id, form)` / `reopenGoal(id)` calling the cores + revalidatePath [`/`, `/goals`, `/goals/${id}`, `/calendar`, `/progress`, `/character`, `/recap`]; `GoalCompleteForm` (date input, defaults today) on `/goals/[id]`; trophy header + reopen + celebration on achieved `/goals/[id]`; Completed `<details>` section on `/goals`; `GoalEditForm` drops the Achieved option.
14. `GoalCompletedCelebration`: client one-shot on `/goals/[id]`, localStorage key `goaldmine.celebrated.goal.<goalId>.<completedDateKey>`; Today's QuestCard single-completion-moment invariant untouched.
15. Satori card: `src/lib/completion-card.tsx` reusing coal/parchment tokens + exported `ProgressRing` (inline SVG — no conic-gradient); `renderCompletionCard` in recap-render.tsx; `GET /recap/completion` route.
16. Coach rules updated in BOTH `docs/server-instructions/goaldmine-rules.md` and `COACH_INSTRUCTIONS` (`src/lib/mcp/instructions.ts`): propose completion conversationally, narrate ceremony, offer card, run set_active_goal covenant for freed focus, and offer a retrospective session (see 17).
17. **Post-goal retrospective**: `Goal.retrospective Json?` (versioned `GoalRetrospective` v1: `reflection` narrative + optional `wins[]`, `challenges[]`, `lessons[]`, `nextSteps[]`, `authoredWith: "user" | "user+coach"`, `updatedAt`). MCP write tool `log_goal_retrospective` (guard: goal must be achieved; full-replace upsert returning the previous version). Coach rules: after the ceremony (or any later session), offer a co-authored reflection — coach gathers the journey's evidence first (`compare_dates` createdAt→completedAt, metric/exercise history, past reviews/notes), drafts with the user, writes only after explicit approval (propose-before-applying covenant). Display: reflection section on the achieved `/goals/[id]` trophy view (parse defensively; absent → subtle "No reflection yet — ask your coach to run a retrospective" hint). `reopen_goal` KEEPS the retrospective (human-authored content is never discarded); re-completion keeps it too. No new read tool — `get_goal` returns the row.

### 3.2 Secondary Requirements

1. `/goals` Completed rows show compact snapshot stats (readiness %, targets x/y, +XP, completed dateKey).
2. Ceremony payload `message` gives the coach a one-line narration seed.

### 3.3 Out of Scope

- Abandoned-goal display changes (stay in the main list).
- Auto-switching focus to another goal (covenant requires coach proposal).
- Notifications/push (no delivery channel exists).
- Weekly recap card changes; `generate_recap_card` untouched.
- Project-goal attribute XP packs (goal.achieved XP is unattributed by design).
- Editing/regenerating a snapshot after completion (reopen + re-complete instead).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

```prisma
model Goal {
  // ... existing fields ...
  completedAt        DateTime?  // set by completeGoalCore; null while active
  completionSnapshot Json?      // GoalCompletionSnapshot v1 — see src/lib/goal-completion-core.ts
  retrospective      Json?      // GoalRetrospective v1 — post-goal reflection, survives reopen
  @@index([userId, status])
}
```

Migration plan:
- Name: `add_goal_completion`
- `npm run db:which` → `npm run db:migrate -- --name add_goal_completion` → `npx prisma generate` → **restart dev server** (stale bundled client gotcha §B.7)
- Purely additive (two nullable columns + index); safe for existing rows; no backfill. Goal is an existing owned model — no verifier-relevant change, but run `npm run db:verify-owned` as sanity.

Snapshot shape (defined in `goal-completion-core.ts`):

```ts
export type GoalCompletionSnapshot = {
  version: 1;
  completedDateKey: string;        // yyyy-mm-dd USER_TZ
  capturedAt: string;              // ISO
  backdated: boolean;
  objective: string;               // frozen — survives renames
  kind: string;                    // "fitness" | "project"
  daysElapsed: number;             // createdAt → completedAt via calendar-core
  readiness: { score: number; rawScore: number; ceiling: number;
               coverage: { tested: number; total: number }; openGateCount: number } | null;
  targets: Array<{ metric: string; label: string; units: string;
                   start: number | null; final: number | null; target: number;
                   progress: number | null; met: boolean }>;
  targetsMet: number; targetsTotal: number;
  feasibilityTierAtCompletion: string | null;
  coachFeasibilityTier: string | null;
  plan: { planId: string | null; weeksTotal: number | null; weeksElapsed: number | null };
  xpBasis: { weeks: number; targetsMet: number };  // engine derives XP from THESE
  xpAwardedAtCompletion: number;   // narration/display convenience only
};
```

`met` = `progress !== null && progress >= 1` (mirrors rarity-core's `"met"` verdict). `weeks` basis = `min(plan.weeks, fullWeeksBetween(plan.startedOn, completedAt))`, fallback `floor(daysElapsed/7)` for plan-less goals.

### 4.2 MCP Tool Surface

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|
| `complete_goal` | Archive + celebrate a finished goal | Write | Backdatable; ceremony payload response |
| `reopen_goal` | Reverse a completion | Write | Returns discarded snapshot |
| `generate_completion_card` | Render shareable completion card | Read (image) | Requires achieved + snapshot; `omit: {userId: true}` on goal query |
| `log_goal_retrospective` | Write/replace the post-goal reflection | Write | Guard: goal achieved; returns previous version; survives reopen |
| `update_goal` (mod) | Reject `status:"achieved"` in handler | Write | Redirect message to complete_goal/reopen_goal |
| `list_goals` (mod) | Add `completedAtDateKey` per row | Read | Existing leaky-reads coverage extends |

`complete_goal` Zod input:
```ts
{
  goalId: z.string().describe("Goal to complete"),
  date: z.string().optional().describe("Completion date yyyy-mm-dd (USER_TZ). Defaults to today. Backdatable — snapshot computed as of end of that day. Must not be in the future or before the goal's creation."),
}
```
Response: `{ goal: {id, objective, kind, status, completedAtDateKey}, snapshot, xp: {awarded, ruleId:"goal.achieved"}, badgesUnlocked: [{id, name}], levelBefore, levelAfter, focusReleased, planDeactivated, remainingActiveGoals: [{id, objective, kind}], message }`. Description carries the propose-before-applying covenant and tells the coach to offer `generate_completion_card` and run the `set_active_goal` covenant when `focusReleased`. No `confirm` flag — reversible.

`reopen_goal` Zod input: `{ goalId: z.string() }`. Response: `{ goal, discardedSnapshot, xpRemoved, hints: {latestPlanId, hadFocus} }`.

`generate_completion_card` Zod input: `{ goalId: z.string(), template: z.enum(["coal","parchment"]).optional(), format: z.enum(["story","post","square"]).optional() }`.

Sample curl (complete):
```sh
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"complete_goal","arguments":{"goalId":"<id>","date":"2026-08-02"}}}'
```

All handlers wrapped in `safe()`. `date` through `parseDateInput`. **Cache gotcha**: `computeGameState` is React-`cache()`d — the handler's before/after diff MUST use a new uncached export `computeGameStateFresh` (= `_computeGameState`).

### 4.3 Server Actions

| Action | FormData fields | Mutation | revalidatePath calls | Redirect? |
|--------|------------------|----------|----------------------|-----------|
| `completeGoal(id, form)` in goal-actions.ts | `date` (optional, yyyy-mm-dd via `parseDateKey`) | `completeGoalCore` | `/`, `/goals`, `/goals/${id}`, `/calendar`, `/progress`, `/character`, `/recap` | No (page re-renders into achieved state → celebration fires) |
| `reopenGoal(id)` | — | `reopenGoalCore` | same list | No |
| `updateGoal` (mod) | stop accepting `"achieved"` status | — | existing | — |

### 4.4 Pages / Components

- **New route**: `src/app/recap/completion/route.tsx` — `GET ?goalId=&template=&format=`, nodejs runtime, force-dynamic, cloned from `recap/card/route.tsx`; loads via `getDb()`; 404 if not achieved/no snapshot. Auth-protected by default middleware.
- **New components**: `GoalCompleteForm.tsx` (client — form + date input + submit via useTransition), `GoalCompletedCelebration.tsx` (client one-shot, cloned from TodayCelebration localStorage pattern + LevelUpCelebration visuals).
- **Modified**: `src/app/goals/page.tsx` (split list: active/abandoned in "All goals"; achieved in collapsed Completed `<details>` with trophy rows); `src/app/goals/[id]/page.tsx` (active → Complete card; achieved → trophy header + card link + Reopen + celebration); `GoalEditForm.tsx` (remove Achieved option).
- **Navigation**: no BottomNav changes. Entry: More → Goals → goal detail.

### 4.5 Date / Time Semantics

- All date math via `@/lib/calendar` / `calendar-core` (`dateKey`, `parseDateKey`, `endOfDay`, day-diff helpers).
- `complete_goal`'s `date` via `parseDateInput`; dashboard form via `parseDateKey`.
- Snapshot cutoff = `endOfDay(completedAt)` USER_TZ (same convention as compare-core).
- Future-date check compares dateKeys in USER_TZ (not raw Date >).

### 4.6 Deferral / Override Awareness

N/A — completion is orthogonal to per-day plan state; no `resolveDay` consumers change. (Deactivating the plan removes the goal from day resolution entirely, which is the intent.)

### 4.7 Tenant Scoping & Auth

- All reads/writes via `getDb()` (Goal, Plan are owned models). Transaction uses the scoped client's `$transaction` with sequential top-level calls — **never nested relation writes** (extension bypass, gotcha §B.10).
- `/recap/completion` protected by default middleware (same as `/recap/card`).
- `generate_completion_card` goal query uses `omit: {userId: true}`; leaky-reads case added.
- No session/invite/OAuth changes.

### 4.8 Third-Party Dependencies

None. Satori/ImageResponse and fonts already in place.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions

**/goals (390px)** — below the existing "All goals" card:

```
┌─ Completed ──────────────────── ▸ ─┐   (collapsed <details>, count badge)
│ 🏆 Summit Mt. Elbert                │
│    Aug 2, 2026 · readiness 94% ·    │
│    targets 4/5 · +650 XP        →   │
└─────────────────────────────────────┘
```

**/goals/[id] — active goal**: new `Card title="Complete"` below Edit: date input (default today) + "Mark complete 🏆" button; copy: "Archives this goal: releases focus, pauses its plan, removes it from the calendar. Reversible."

**/goals/[id] — achieved goal**: trophy header card (🏆 + frozen objective, completed date, readiness ring/score, targets x/y, days elapsed, +XP), "Completion card" link → `/recap/completion?goalId=...`, small "Reopen" form, celebration overlay on first view.

States: loading (server-rendered, N/A), empty (no achieved goals → no Completed section at all), error (core throws → form error display per existing goal-actions pattern).

### 5.2 Navigation Flow

More → Goals → (goal row) → detail → Complete → page re-renders achieved → celebration → card link. Back behavior unchanged.

### 5.3 Responsive + Mobile-First Spec

390px primary; tap targets ≥44px; `<Card>` layout; Tailwind tokens (`var(--accent)`, `var(--border)`, `var(--card)`, `var(--muted)`); no hardcoded colors (trophy 🏆 is text emoji).

### 5.4 Accessibility

Date input labeled; Reopen/Complete buttons have visible focus rings; snapshot stats in readable text (not color-only); `<details>` is natively keyboard-accessible.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active program after completion | Engine falls back to most-recent plan; character page keeps level/XP/badges; `emptyState()` only if no plan ever existed |
| Brand-new user (zero rows) | No Completed section; no goal-completed events; badges locked; engine unchanged |
| Goal with zero targets | `snapshot.readiness = null`, `targetsMet 0/0`, XP = base + weeks component; card renders without target rows |
| Plan-less goal (no Plan rows) | `plan: {planId:null,...}`, weeks basis = `floor(daysElapsed/7)`; planDeactivated empty |
| Already achieved → complete_goal | Error: "already completed — use reopen_goal" |
| Future date | Error (dateKey compare, USER_TZ) |
| Date before goal.createdAt | Error, not clamp |
| Reopen a non-achieved goal | Error |
| Unparseable/legacy snapshot in engine | Base-XP-only fallback; card tool errors cleanly |
| Focus goal completed | isFocus released to nothing; ceremony payload lists remainingActiveGoals for coach covenant |
| Re-complete after reopen | New snapshot computed; celebration re-fires (dateKey in localStorage key) |
| Long objective text on card/rows | Truncate/wrap within card band; test at 390px |

---

## 7. Security Considerations

- Tenant isolation: all Goal/Plan access via `getDb()`; snapshot never includes userId; card route + tool 404/error on other tenants' ids automatically via scoping.
- Route protection: `/recap/completion` covered by default middleware.
- Input validation: Zod on all three tools; FormData parsed defensively; no raw SQL; no `dangerouslySetInnerHTML`.
- Objective strings render as text (React-escaped) on card and pages.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` 0 errors
2. [ ] `npm run lint` no new errors
3. [ ] `npm run test` no new failures; new suites pass (`goal-completion-core.test.ts`, `goal-completion.test.ts`, engine scenario extensions, leaky-reads extension, goal-core extension, tools-level update_goal redirect test)
4. [ ] `npm run build` succeeds
5. [ ] MCP `tools/list` includes `complete_goal`, `reopen_goal`, `generate_completion_card`
6. [ ] `complete_goal` on a dev goal returns full ceremony payload; backdated call places `goal.achieved` XP event on the backdated dateKey (verify via `get_game_state` recentEvents)
7. [ ] `reopen_goal` restores active status, clears completedAt/snapshot, returns discarded snapshot; XP event disappears from recomputed state
8. [ ] `update_goal {status:"achieved"}` returns the redirect error
9. [ ] `generate_completion_card` returns an image for an achieved goal, errors for an active one
10. [ ] Engine scenario test: no-active-plan fallback preserves ledger XP (no emptyState wipe)
11. [ ] `/goals` renders Completed section only when achieved goals exist; achieved rows absent from "All goals"; no overdue chip on achieved goals
12. [ ] `/goals/[id]` achieved state shows trophy header + reopen + card link; active state shows Complete form
13. [ ] `getActiveGoalsWithPlans` excludes `status!="active"` goals (calendar/Today clean)
14. [ ] Calendar shows 🏆 goal-completed event on completion date; no legend-kind enum change
15. [ ] All new date math via `@/lib/calendar`; `parseDateInput` on the tool's date arg
16. [ ] Server actions revalidate all 7 listed routes
17. [ ] Coach rules updated in `docs/server-instructions/goaldmine-rules.md` AND `src/lib/mcp/instructions.ts` (incl. retrospective session flow)
18. [ ] `setFocusGoalCore` refuses achieved goals (test)
19. [ ] `log_goal_retrospective` writes/replaces the reflection on an achieved goal, errors on an active one; `reopen_goal` leaves `retrospective` untouched; achieved `/goals/[id]` renders the reflection (or the no-reflection hint)

---

## 9. Open Questions

None — all resolved in discovery (full package; backdatable + reversible; scaled XP formula as specified; no UX research).

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Tests / Build
Standard four gates. New/updated suites: `src/lib/goal-completion-core.test.ts` (NEW), `src/lib/goal-completion.test.ts` (NEW, vi.mock("@/lib/db") dual-export convention), `src/lib/game/engine.scenario.test.ts` (extend), `src/lib/mcp/leaky-reads.test.ts` (extend), `src/lib/goal-core.test.ts` (extend), tools-level update_goal redirect test.

### 10.2 MCP curl smoke
`tools/list` → 3 new tools. Sequence on a seeded dev goal: `complete_goal` (today) → verify payload → `reopen_goal` → `complete_goal {date: <past>}` → `get_game_state` (XP event on past dateKey, badge unlocked) → `generate_completion_card` → image. `update_goal {status:"achieved"}` → redirect error.

### 10.3 Browser smoke
390px, signed in: `/goals` (Completed section), `/goals/[id]` (complete flow, trophy state, celebration one-shot survives reload without re-firing), `/calendar` (🏆 event, no overdue chip), `/` (Today unaffected), `/character` (level preserved, new badge in wall).

### 10.4 Migration verification
`npm run db:which` (dev branch) → `npm run db:migrate -- --name add_goal_completion` → `npx prisma generate` → restart dev server → `npm run db:verify-owned` sanity.

---

## 11. Appendix

### 11.1 Discovery Notes
User completed their first long-term goal; no ceremony existed. Decisions: full package; backdatable + reversible (founder will backdate); scaled XP + 6-badge set; skip UX research. Current-state map verified: status field inert, engine has no goal inputs, character-page wipe risk at engine.ts:937, computeGameState is React-cache()d, ProgressRing module-private in recap-card.tsx:46.

### 11.2 References
- Approved plan: `~/.claude/plans/mutable-honking-pinwheel.md`
- Gotchas: `docs/project-gotchas.md` §B.6/§B.7/§B.10/§E.1
- Precedents: confirm_week/reopen_week (reversibility), goal-core.ts (core/action split), recap/card/route.tsx (card route), TodayCelebration.tsx (one-shot pattern)
