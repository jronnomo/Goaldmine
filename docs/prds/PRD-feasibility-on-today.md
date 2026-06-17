# PRD — Surface FeasibilityReadout on Today (#78)

**Slug:** feasibility-on-today · **Issue:** #78 (board #8, Sprint 8, P1, Medium) · **Date:** 2026-06-17
**Depends on:** #77 (FeasibilityReadout shipped). Research: `.feature-dev/2026-06-17-feasibility-on-today/agents/research-output.md`.
**UX-research:** skipped — places an already-designed component (#77) at constrained insertion points; no new design-system work; fitness Today otherwise unchanged.

## 1. Goal
Render `<FeasibilityReadout>` on the Today page for both the fitness focus goal (`src/app/page.tsx` hero) and a project focus goal (`src/components/ProjectTodayView.tsx`), with feasibility resolved **server-side** via `computeGoalFeasibility(goal)` — the same fn `get_goal` calls (no MCP round-trip). No `Date` crosses into the component.

## 2. Key facts (from research)
- `computeGoalFeasibility(goal: GoalLike, opts?): Promise<GoalFeasibility>` (`rarity.ts:190`). `GoalLike = { id: string; targetDate: Date | null; targets: unknown /*raw Prisma Json*/; kind: string }`. Returns a **fully serializable** `GoalFeasibility` (`computedAt` is an ISO string; no Date anywhere). Same call `get_goal` makes (`tools.ts:897`).
- `FeasibilityReadout` props: `{ feasibility: GoalFeasibility; targetDateLabel?: string | null }`; server component.
- **Pitfall A:** `getFocusGoal()` returns a Pick WITHOUT `targets` — so page.tsx must obtain targets to build `GoalLike`.
- **Pitfall B:** `focusGoal` can be null on the fitness path — guard.
- **Pitfall C:** `ProjectTodayView`'s goal prop Pick is `id | objective | targetDate` — missing `kind`; add it (page.tsx already passes a focusGoal that has `kind`).
- `targetDateLabel`: format `goal.targetDate` server-side via `Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:USER_TZ}).format(...)`; null when `targetDate===null`. Done in the caller, never in FeasibilityReadout.

## 3. Design
### 3.1 `src/app/page.tsx` (fitness hero)
- After the fitness-path guards (focusGoal non-null, not project), build the feasibility input. Since `focusGoal` lacks `targets`, fetch a minimal GoalLike: `const goalForFeas = await prisma.goal.findUnique({ where: { id: focusGoal.id }, select: { id: true, targetDate: true, targets: true, kind: true } })`. (Single targeted query; Today is `force-dynamic`.)
- `const feasibility = goalForFeas ? await computeGoalFeasibility(goalForFeas) : null;`
- `const targetDateLabel = goalForFeas?.targetDate ? new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone: USER_TZ}).format(goalForFeas.targetDate) : null;` (import `USER_TZ` from `@/lib/calendar`).
- Render `{feasibility && <FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} />}` at the insertion point: **immediately after the fitness hero `</section>` (~line 255), before the baselines block (~258)**. Fitness Today is otherwise visually unchanged.
- **Caching:** `computeGoalFeasibility` does per-target queries; one call per render is acceptable (matches get_goal). If a `cache()` wrapper exists, reuse; else a single await is fine.

### 3.2 `src/components/ProjectTodayView.tsx`
- Add `kind` to the goal-prop `Pick<Goal, ...>` (additive).
- It already fetches `goalRow.targets` (its own Promise.all) + has `goal.targetDate` + now `goal.kind`. Build GoalLike and `const feasibility = await computeGoalFeasibility({ id: goal.id, targetDate: goal.targetDate, targets: goalRow.targets, kind: goal.kind })`.
- `const targetDateLabel = goal.targetDate ? new Intl.DateTimeFormat(...USER_TZ...).format(goal.targetDate) : null;` (`USER_TZ` already imported, line 11).
- Render `<FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} />` **between the MRR card block (after ~238) and the next-milestone card (`{nextMilestone != null && (` ~242)**. Stays a server component (no `"use client"`).

### 3.3 No Date / serialization
`GoalFeasibility` is serializable (computedAt string). `FeasibilityReadout` is a server component, so no RSC→client boundary is crossed by it. Confirm neither file passes `feasibility` or a `Date` into a CLIENT child (research: `TodayCelebration` client child receives only primitives). `targetDateLabel` is a string.

### 3.4 `FeasibilityReadout.tsx`
**No change expected** (it's done in #77). The "touch" is precautionary — only change it if a real prop gap surfaces (none expected).

## 4. Acceptance criteria
1. page.tsx fitness hero renders `<FeasibilityReadout>` with feasibility from `computeGoalFeasibility(focusGoal's GoalLike)` server-side (not MCP). Guarded for null focusGoal.
2. `ProjectTodayView` renders `<FeasibilityReadout>` between the MRR card and the next-milestone card, feasibility resolved server-side from its already-fetched targets + `goal.targetDate` + `goal.kind`; stays a server component.
3. No `Date` instance passed into `FeasibilityReadout` or any client child; feasibility passed already-serialized; `targetDateLabel` a pre-formatted USER_TZ string.
4. Chewgether: project Today shows the honest no-data readout ("Not enough logged data to rate") today; fitness Today shows that goal's feasibility readout; fitness Today otherwise visually unchanged.
5. `git diff --stat` shows `src/lib/rarity-core.ts` untouched.
6. `npx tsc --noEmit`, lint, `npm run build`, `npx vitest run` pass.

## 5. Verification
tsc · eslint · build · vitest. Dev render: fitness Today (focus=Elbert) shows a "Reach" feasibility card after the hero (and the rest unchanged); project Today (via a reverted focus flip to Chewgether, as in #76) shows the "Reach" card with "Not enough logged data to rate" between the MRR and milestone cards. `grep -nE "setHours|getDate\(|getMonth\(|getFullYear" src/app/page.tsx src/components/ProjectTodayView.tsx` → no new raw primitives (Intl with timeZone is allowed). `git diff --stat src/lib/rarity-core.ts` → empty.
