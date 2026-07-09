# Research / premise-check — #230 (Explore agent, 2026-07-09, HEAD 275acd7)

## 1. layout.tsx
- auth() try/catch :120; signed-out early-return :129-136 (AppHeader user=null + main, NO BottomNav, NO getDb — comment :125-128 explains getCurrentUserId NEXT_REDIRECT hazard).
- Signed-in :139-164: getDb() + Promise.all: nutritionLog.findMany (today's meals), getQuickPickFoods(), listLibraryFoods(), resolveDay(now); derived trackedSoFar/dayTarget.
- BottomNav props :196-202: todaysMeals, quickPickFoods, libraryFoods, trackedSoFar, dayTarget. NO goal count anywhere in layout.

## 2. BottomNav → MoreSheet
- Both "use client". BottomNav props :73-85 (meal-only). MoreSheet invoked :193 with ONLY onClose. MoreSheetProps :6-8. navRows module const :97-146 ({href,label,sub,icon}; order: Character, Goals, Coach prompts, Recap, Compare, Nutrition, History, Journal), rendered :151 — conditional row must be built in-component.

## 3. Onboarding dismissal
- Cookie `gm_onboarding_dismissed_${uid.slice(0,16)}` set in skipOnboarding (onboarding-actions.ts:23-30), 30d, httpOnly/lax, redirect("/").
- Today gate page.tsx:34-43: `if (gateGoalCount === 0 && !cookie) redirect("/onboarding")` — count query at :38.
- Today get-started card page.tsx:53-70: Card "Get started", copy "Welcome to Goaldmine — start by creating your first goal. Once you add a goal with a target date, your Today view fills in automatically." + Link /onboarding "Get started →".
- PREMISE WEAKENED: MoreSheet has a /goals row (:104-109, "View goals or create a new one") and goals/page.tsx:90-94 renders GoalCreateForm unconditionally → create path exists. No /onboarding link on any nav surface (grep). /onboarding = guided flow (OnboardingGoalForm → /onboarding/connect) — the actual gap.

## 4. calendar/page.tsx
- getCalendarMonth() → { cells, monthStart, goal, program, otherGoals } :20. Grid always renders :66-72. "No completed days this month" :75-80. Goal-objective line {goal && …} :127-132. Bare "No active plan. [Create a goal](/goals)…" {!program && …} :133-137 BELOW grid. `goal` ≠ `program` (distinct nulls).

## 5. Sequencing
- #232 OPEN, #233 OPEN (the N2 layout-fetch-deferral — will REMOVE the 4 meal fetches/props; #230 lands first per its own AC; N2 rebases).
- #248 OPEN (Backlog): React.cache getGoalCount as single source for layout + page — naive #230 would double-count per / request; bundle.
- No in-flight worktrees (git worktree list = main only).

## 6. Tests
- No component tests for MoreSheet/BottomNav/layout/calendar. onboarding.test.ts covers resolveRedirectTo (SAFE_REDIRECTS excludes /onboarding as redirect target — unaffected; our row is a plain Link, not a server-action redirect).
