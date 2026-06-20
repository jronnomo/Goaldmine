# Architecture Critique — PRD-today-rest-copy (#72)

**Reviewer role:** Devil's Advocate · Date: 2026-06-17  
**Files reviewed:** PRD, `src/app/page.tsx`, `src/lib/goal-presentation.ts`, `src/lib/goal-presentation.test.ts`, `.claude/quality-tools.md`  
**Code state verified against:** current `fix/nutrition-macro-residual` branch

---

## Critical

### C-1 — AC#6 is unverifiable by the vitest suite; `restCopy: null` can be silently skipped

`DEFAULT_PRESENTATION` today (goal-presentation.ts:114–117) is:

```ts
export const DEFAULT_PRESENTATION: GoalPresentation = {
  ...FITNESS_PRESENTATION,
  kind: "__default__",
};
```

The spread copies `restCopy: "A short walk or light stretch..."` from `FITNESS_PRESENTATION`. The PRD correctly prescribes adding `restCopy: null` to override it. **But no test in the suite asserts `DEFAULT_PRESENTATION.restCopy === null`.** The goal-presentation.test.ts Case 4 block (lines 124–166) tests `.kind` and `.statSlots` only — never `.restCopy`. Running `npx vitest run` returns 20/20 today AND would return 20/20 even if the developer forgets to write the `restCopy: null` line. The PRD's verification section says "20/20" as if this gate is sufficient — it is not for AC#6.

**Fix required in the PRD / dev checklist:** Either (a) add a test assertion `expect(DEFAULT_PRESENTATION.restCopy).toBeNull()` to Case 4, or (b) note explicitly in the verification plan that AC#6 must be confirmed by manual inspection of the source line, not by vitest.

---

## Concerns

### C-2 — `DEFAULT_PRESENTATION.restCopy` is currently the fitness string, not null

Confirmed by code read (goal-presentation.ts:114–117): the spread is not overridden today. Any code path that hits `DEFAULT_PRESENTATION.restCopy` before this PR lands would silently get the fitness recovery copy. The grep shows no caller outside `page.tsx` (the proposed site) reads `.restCopy` at all (`recap-card.tsx` reads `.headerStyle`, `.ringLabel`, `.statSlots` only; `recap.ts` same). So there is no live regression, but the PRD's "Safe:" rationale in §3.1 should clarify that DEFAULT_PRESENTATION currently has the fitness string via the spread — "safe" refers to no existing assertion breaking, not to DEFAULT_PRESENTATION already being null.

### C-3 — `presentation` is computed before the `NoActiveProgram` early-return (line 29); never used on that path

The PRD places `const presentation = presentationForGoal(focusGoal)` after `Promise.all` (line ~26), before the guard at line 29. That means `presentation` is allocated and discarded on the null-program path. `presentationForGoal` is confirmed pure (no DB, no Prisma, no Node built-ins — see goal-presentation.ts:1–6 contract comment), so there is no correctness problem. However, it is a minor style concern: the variable is declared in scope but never reachable on two of the three exit paths (NoActiveProgram at line 29, ProjectTodayView at line 44). It would read more cleanly placed after the project early-return (line 46), where `focusGoal` is guaranteed non-project and non-null-program. This is not a bug but is worth flagging.

**Counter-argument for the PRD's approach:** Placing it early keeps the data-fetch block (`Promise.all`) and derived constants co-located before any branching. Either placement is correct; the early placement is defensible given purity.

### C-4 — JSX short-circuit: `&&` with `null` is safe; no `0`-render pitfall

`presentation.restCopy` is typed `string | null` (goal-presentation.ts:51). The proposed gate `{isRestDay && presentation.restCopy && (<p…/>)}` short-circuits cleanly: `null` renders nothing; a non-empty string is always truthy. The `0`-renders-as-text gotcha (a classic JSX footgun) does not apply here because the type is never `number`. Confirmed safe.

---

## Suggestions (non-blocking)

### S-1 — Add one vitest assertion to seal AC#6

In Case 4 of goal-presentation.test.ts (~line 163), add:

```ts
it("DEFAULT_PRESENTATION.restCopy is null", () => {
  expect(DEFAULT_PRESENTATION.restCopy).toBeNull();
});
```

This makes the vitest suite a complete gate for the PRD and costs one line. Suggested during development, not strictly required for ship.

### S-2 — `quality-tools.md` says "Tests do not exist" — it is stale

`.claude/quality-tools.md` line 24: *"Tests do not exist. If you add Vitest/Playwright later, add a `Test` row above and update the QA-Agent prompt."* Vitest was added in commit `f7a5c48`. The QA table should gain a `Test | npx vitest run | 20/20` row, and the stale note should be removed. Out of scope for this PR but worth a follow-up.

### S-3 — `isRestDay` defined on all paths — confirmed no issue

Line 138: `const isRestDay = !completed && resolved.todayTask === "rest"`. This is always defined by the time execution reaches the rest-day block at line 247, on every code path that can reach it. No undefined-variable risk.

---

## Per-question Answers (cited)

| # | Question | Verdict |
|---|----------|---------|
| 1 | `DEFAULT_PRESENTATION.restCopy → null` safe? | **Yes** — grep confirms only `goal-presentation.ts` defines `restCopy`; `recap-card.tsx:291,778` and `recap.ts:284` call `presentationForGoal` but only destructure `.headerStyle`, `.ringLabel`, `.statSlots` (never `.restCopy`). Test Case 4 asserts `.kind` + `.statSlots` only — no existing test breaks. |
| 2 | Project never mislabels? | **Confirmed** — `page.tsx:44` early-returns to `ProjectTodayView` before line 247. `presentationForGoal(focusGoal)` is pure; computing it before the early-return is harmless (purity contract at goal-presentation.ts:1–6). |
| 3 | Block omission correctness? | **Confirmed** — `{isRestDay && presentation.restCopy && (<p…/>)}` short-circuits to nothing when `restCopy` is `null`. No stray `<p>` or `border-t` is emitted. `string | null` type eliminates the `0`-render pitfall. |
| 4 | Fitness un-regressed? | **Confirmed** — same `<p>` classes, `border-t border-[var(--border)] pt-3`, `"Recovery tip:"` label. Body changes from hardcoded Mt. Elbert text to `FITNESS_PRESENTATION.restCopy` = "A short walk or light stretch today builds the aerobic base and joint resilience your goal needs — treat recovery as training, not a day off." No "Mt. Elbert". Matches AC#2 and AC#4. |
| 5 | Server component / USER_TZ? | **Safe** — `presentationForGoal` is pure; no date math touched; no `"use client"` added. `isRestDay` derives from `resolved.todayTask` which is already computed server-side via `resolveDay(now)` + `@/lib/calendar`. |
| 6 | `isRestDay` defined on all reachable paths? No stale "Elbert" nearby? | **Confirmed** — `isRestDay` at line 138, block at 247, safe. The only remaining "Elbert" literal in the file is in the `<h1>` fallback chain at line 227: `isRestDay ? "Rest / Active Recovery"` — this does not mention Mt. Elbert, so nothing else needs changing in this PR. |

---

## Verdict

**APPROVE WITH ONE ACTION ITEM.** The plan is architecturally correct. All early-return guards, purity assumptions, JSX short-circuit semantics, and server-component constraints hold. The single issue that must be resolved: **add a vitest assertion for `DEFAULT_PRESENTATION.restCopy === null`** (Suggestion S-1) — or at minimum note in the verification plan that AC#6 requires a manual source-line inspection, because the current 20/20 vitest count gives false confidence that DEFAULT_PRESENTATION's `restCopy: null` override was written correctly.

**Single most important thing:** `DEFAULT_PRESENTATION` currently inherits the fitness recovery string from the `...FITNESS_PRESENTATION` spread (goal-presentation.ts:115). The `restCopy: null` override must be written explicitly in the DEFAULT_PRESENTATION object literal — and no test today will catch a silent omission of that line.
