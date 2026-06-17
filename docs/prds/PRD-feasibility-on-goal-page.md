# PRD — Surface FeasibilityReadout on the goal detail page (#79)

**Slug:** feasibility-on-goal-page · **Issue:** #79 (board #8, Sprint 8, P1, Small) · **Date:** 2026-06-17
**Depends on:** #77 (FeasibilityReadout shipped).
**UX-research:** skipped — fills an honesty gap in the EXISTING (already-UX-researched, UXR-63) Reach surface using the already-designed #77 component; no new design-system work.

## 1. Discovery (changes the approach)
`src/app/goals/[id]/page.tsx` **already** computes `feasibility = computeGoalFeasibility(goal)` (line 112) and renders a **rich "Reach" card** (lines 238–297): Computed-vs-Coach `ReachMeter` glyphs + coach rationale + per-target required/plausible/ratio rows. BUT it is gated:
```tsx
{feasibility.tier !== null || coachFeasibility !== null ? ( <rich Reach card/> ) : null}
```
So for a goal with `tier === null` and no coach override (someday / no-targets / **no-data** — e.g. Chewgether today), the page shows **nothing** about feasibility. That is exactly the honesty gap `FeasibilityReadout` (#77) is built for.

## 2. Goal / decision
**Gap-fill, not duplicate or replace.** Keep the rich card for rated/coach-overridden goals (don't regress UXR-63). Render `<FeasibilityReadout>` in the `else` branch — when the rich card is hidden — so an unrated/no-data goal shows the honest readout ("Not enough logged data to rate", "No deadline set — Reach unrated", "Add targets to rate Reach").
- Rejected **replace** (drop the rich card, always use FeasibilityReadout): regresses the richer rated display (coach override, ReachMeter glyph, plausibleRate/ratio).
- Rejected **always-add** (render FeasibilityReadout unconditionally): a rated goal would show TWO feasibility surfaces (the rich card + FeasibilityReadout) — redundant/confusing.

Result: every goal shows honest feasibility — rich card if rated, FeasibilityReadout if unrated. Satisfies the AC's intent ("opening any goal shows its honest feasibility readout") and fills the no-data gap (Chewgether).

## 3. Design (only `src/app/goals/[id]/page.tsx`)
- Import `FeasibilityReadout` from `@/components/FeasibilityReadout` and `USER_TZ` from `@/lib/calendar`.
- `feasibility` is already computed (line 112) — reuse it (no second call).
- Add `const targetDateLabel = goal.targetDate ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: USER_TZ }).format(goal.targetDate) : null;` (server-side; USER_TZ-correct).
- Replace the `: null` at line 297 with:
  ```tsx
  : (
    <FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} />
  )
  ```
- Nothing else changes. The rich-card branch (238–296) is byte-identical. `feasibility` is already un-`.catch`-guarded today (pre-existing — the rich card depends on a non-null `feasibility`); #79 does NOT change that (the existing call's behavior is unchanged).

## 4. Acceptance criteria
1. `goals/[id]/page.tsx` renders `<FeasibilityReadout>` for the viewed goal when the rich Reach card is hidden (unrated: tier null && no coach override), feasibility resolved server-side via the existing `computeGoalFeasibility(goal)` (no MCP round-trip).
2. Works for both: a fitness goal with a tier → the existing rich Reach card (a real readout); Chewgether (tier null, no coach, no-data) → `FeasibilityReadout` honest no-data sub-state.
3. No `Date` passed to `FeasibilityReadout`; feasibility is already serialized; the date label uses `@/lib/calendar` USER_TZ (`Intl` with `timeZone: USER_TZ`).
4. `git diff --stat` shows `src/lib/rarity-core.ts` untouched.
5. `npx tsc --noEmit`, lint, `npm run build`, `npx vitest run` pass.

## 5. Verification
tsc · eslint · build · vitest. Dev render of `/goals/<chewgether_id>` → the Reach area shows the FeasibilityReadout honest "Not enough logged data to rate" (no rich card, since tier null + no coach). `/goals/<elbert_id>` → the existing rich Reach card (tier glyph + per-target rows), unchanged, no duplicate FeasibilityReadout. `git diff --stat src/lib/rarity-core.ts` → empty. Confirm no new raw `setHours/getDate/getMonth/getFullYear` (the new label uses `Intl` + USER_TZ).
