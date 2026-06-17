# PRD — Today rest-day copy from presentation.restCopy (#72)

**Slug:** today-rest-copy · **Issue:** #72 (board #8, Sprint 7, P1) · **Date:** 2026-06-17
**Depends on:** #67 (`goal-presentation.ts` — `FITNESS_PRESENTATION.restCopy` already authored; project `restCopy:null`).
**UX-research:** skipped — refactor. Drives the existing rest-day tip from the registry; the generic fitness copy was already authored in #67; fitness keeps the same block/gating/Tailwind. No new visual design.

## 1. Goal
The Today rest-day recovery tip is hardcoded Mt. Elbert text (`page.tsx:247–254`). Drive it from `presentationForGoal(focusGoal).restCopy` so it reflects the goal's kind, and omit the block entirely when `restCopy` is null (project / unknown kind). De-hardcodes "Elbert" per memory `goal-progress-bars-are-goal-generic`.

## 2. Scope
**In:**
- `src/app/page.tsx`: compute `const presentation = presentationForGoal(focusGoal);` after the focus-goal fetch (~line 26); render the rest-day block body from `presentation.restCopy`; gate the block on `isRestDay && presentation.restCopy`.
- `src/lib/goal-presentation.ts`: override `DEFAULT_PRESENTATION.restCopy` to `null` (the recovery tip is fitness-domain-specific — must not leak to unknown/null-kind goals; only an explicit `fitness` goal shows it).

**Out:** any other Today change; `ProjectTodayView` (project goals early-return there before the rest block — already correct); the recap card (doesn't read restCopy); the project early-return logic; date math.

## 3. Design
### 3.1 `goal-presentation.ts`
```ts
export const DEFAULT_PRESENTATION: GoalPresentation = {
  ...FITNESS_PRESENTATION,
  kind: "__default__",
  restCopy: null,   // recovery tip is fitness-specific; unknown kinds get no tip
};
```
Safe: the #70 spec asserts `DEFAULT_PRESENTATION.kind` + statSlots labels/keys, NOT `restCopy`. `FITNESS_PRESENTATION.restCopy` stays the authored generic string; `PROJECT_PRESENTATION.restCopy` already `null`.

### 3.2 `page.tsx`
- Import: add `presentationForGoal` from `@/lib/goal-presentation`.
- After the `Promise.all` (line 23–26): `const presentation = presentationForGoal(focusGoal);` (pure; harmless on the early-return paths).
- Replace the block (247–254) with:
```tsx
{isRestDay && presentation.restCopy && (
  <p className="text-xs text-[var(--muted)] border-t border-[var(--border)] pt-3">
    <strong className="text-[var(--foreground)] font-medium">Recovery tip:</strong>{" "}
    {presentation.restCopy}
  </p>
)}
```
Same `<p>` classes + border + "Recovery tip:" label; only the body sentence now comes from the registry (the generic fitness copy, which drops "Mt. Elbert"). When `restCopy` is null → the whole block (incl. the `border-t`) is not rendered.

## 4. Edge cases
- Fitness focus goal → `FITNESS_PRESENTATION.restCopy` (generic string) → tip shows on rest days (no "Mt. Elbert").
- Project focus goal → early-returns to `ProjectTodayView` before this block; even if reached, `restCopy` null → omitted.
- Unknown/null kind → `__default__` → `restCopy` null → no tip (no empty `<p>`, no stray border).

## 5. Acceptance criteria
1. `npx tsc --noEmit`, changed-file lint pass; `npm run build` green.
2. Hardcoded "Mt. Elbert"/aerobic-base literal removed from `page.tsx`; copy comes from `presentation.restCopy`.
3. Null `restCopy` → entire block omitted (no empty `<p>`, no stray `border-t`).
4. Fitness un-regressed: rest-day tip renders with the same block/gating/classes/border; body = `FITNESS_PRESENTATION.restCopy`.
5. `page.tsx` stays a server component (no new `"use client"`); date math unchanged via `@/lib/calendar`.
6. `DEFAULT_PRESENTATION.restCopy === null`; #70 vitest still 20/20.

## 6. Verification
`npx tsc --noEmit` · `npx eslint src/app/page.tsx src/lib/goal-presentation.ts` · `npm run build` · `npx vitest run` (20/20). `grep -n "Mt. Elbert" src/app/page.tsx` → empty. Dev-server render of `/` on the fitness focus goal on a rest day shows the generic recovery tip (no "Mt. Elbert"); confirm no empty block when copy is null (logic inspection — focus goal is fitness today).
