# Completion report — #230 (+#248 bundled) — 2026-07-09

## Shipped (commit 8e194a3 on feature/phase1-auth)
1. **MoreSheet guided re-entry**: "Set up your first goal" row (→ /onboarding, cookie-independent) atop the nav rows when goalCount === 0; house row anatomy incl. focus-visible styles.
2. **Calendar first-run card**: Get-started Card above the grid, gated on `goalCount === 0` — NOT the AC's `!goal`, which the Devil's Advocate proved is a false first-run signal (goal = focus-only; focus deletion never reassigns → established users could have !goal with goals). Old bare "No active plan" line suppressed only in the true 0-goal case.
3. **#248 closed by bundling**: `src/lib/goal-count.ts` — React.cache'd getGoalCount() as the single source for layout, Today's gate, and calendar; empirically verified ONE query per `/` request (temp instrumentation, reverted). Per-request-memo safety follows the getCurrentUserId precedent (no module-global; no cross-tenant leak — DA-verified with repo precedent + docs).
4. **#233 merge-friction minimized**: layout's count is a standalone statement outside the meal Promise.all (that block is slated for deletion by #233), with an in-code comment saying why.

## Decisions taken autonomously (flag for user review)
- Row links to `/onboarding` (guided flow) — premise was weakened (raw GoalCreateForm reachable via More → Goals), so the value is guided-flow discoverability; AC permitted either target.
- #248 bundled (audit's own prescription; ~22 lines; avoids shipping a known double-query).

## Verification
tsc 0 · 664/664 · lint 0 errors · build OK. Founder: `/` + MoreSheet + calendar unchanged (browser + RSC payload, goalCount:7). Minted 0-goal user: gate redirect intact without cookie (307 → /onboarding); with dismissal cookie: Today's card renders, goalCount:0 threads through RSC to BottomNav, calendar card renders above grid with bare line absent. MoreSheet 0-goal row verified via RSC payload + code path (browser cookie-injection for the minted session was correctly refused by tooling guardrails — noted, not worked around). Temp rows/scripts cleaned.

## Process
DA APPROVE-WITH-FIXES — its calendar-gate catch (C1) was a real shipped-bug preventer. Dev agent self-corrected a stale base (275acd7 proof) and empirically verified the dedupe. Architect skipped (PRD-as-blueprint). QA by orchestrator.

## Follow-up
Sprint 11 remainder: #231 (recap empty-week guards) — last one. #233 note: rebases on this; the layout comment marks the boundary.
