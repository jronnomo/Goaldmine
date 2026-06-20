# Architecture Critique — PRD: Route resolveLegend through presentation.legendDefault (#73)

**Reviewer:** Devil's Advocate · **Date:** 2026-06-17  
**Verdict up front:** APPROVE WITH ONE MANDATORY TEST FIX  
The refactor is behavior-equivalent, type-safe, and client-clean. One test gap is a must-fix: the correctness of the entire default branch depends on `DEFAULT_PRESENTATION.legendDefault === "fitness"` (spread-inherited, not explicitly set), and no proposed test pins it.

---

## 1. Behavior Equivalence

**Claim (PRD §3.1):** `legendDefault === "project" ? PROJECT : DEFAULT` reproduces the exact truth table of the current branch at `legend.ts:96–101`.

**Verification** (every input case checked against `legend.ts:96–101`):

| Input | Old code | New code | Match? |
|---|---|---|---|
| `null` | `!null` → true; `null?.kind === "project"` → false → DEFAULT | `null && …` → null; `presentationForGoal(null)` → `DEFAULT_PRESENTATION.legendDefault = "fitness"` → DEFAULT | ✓ |
| `undefined` | `!undefined` → true; `undefined?.kind === "project"` → false → DEFAULT | same path as null → DEFAULT | ✓ |
| `{ kind: "project", legend: null }` | kind `=== "project"` → PROJECT | `presentationForGoal({kind:"project"})` → `PROJECT_PRESENTATION.legendDefault = "project"` → PROJECT | ✓ |
| `{ kind: "fitness", legend: null }` | `"fitness" === "project"` → false → DEFAULT | `FITNESS_PRESENTATION.legendDefault = "fitness"` → DEFAULT | ✓ |
| `{ kind: "galaxy-brain", legend: null }` | `"galaxy-brain" === "project"` → false → DEFAULT | `DEFAULT_PRESENTATION.legendDefault = "fitness"` → DEFAULT | ✓ |
| `{ kind: null, legend: null }` | `null === "project"` → false → DEFAULT | `typeof null === "string"` → false → `presentationForGoal(null)` → DEFAULT | ✓ |
| `{ kind: 42, legend: null }` | `42 === "project"` → false → DEFAULT (cast is unsound but runtime-correct) | `typeof 42 === "string"` → false → `presentationForGoal(null)` → DEFAULT | ✓ |
| `{ kind: "project", legend: <valid> }` | `legend != null` → skip branch → `LegendSchema.safeParse` → stored | unchanged — stored-legend path not touched | ✓ |
| `{ kind: "fitness", legend: <invalid> }` | parse fails → DEFAULT | unchanged | ✓ |

**Conclusion: truth table is perfectly preserved.** No input produces different output between old and new.

**Latent extensibility gap (not a regression, shared with current code):** the new `legendDefault === "project"` binary works only for the 2-entry registry. A future `{ kind: "health", legendDefault: "health" }` entry would silently fall to DEFAULT_LEGEND instead of a hypothetical `HEALTH_DEFAULT_LEGEND`. The current inline code has the same structural limit. Document this assumption or replace with a map lookup in a follow-up PR.

---

## 2. Type Narrowing

**Current code (`legend.ts:98`):**
```ts
(goal as { kind?: string } | null | undefined)?.kind === "project"
```
This is an **unsound cast** — the parameter type is `kind?: unknown`, so the `as` assertion tells tsc "trust me, kind is string | undefined" without a runtime guard. Unsound but runtime-correct (any non-"project" value, including non-strings, yields false from `===`).

**Proposed code:**
```ts
goal && typeof goal.kind === "string" ? { kind: goal.kind } : null
```
- After `typeof goal.kind === "string"`, tsc narrows `goal.kind` to `string`. No cast, no `any`.
- The resulting `{ kind: string }` satisfies `presentationForGoal`'s parameter `{ kind?: string | null } | null | undefined`.
- When `goal.kind` is absent, `undefined`, `null`, or a non-string, the whole expression evaluates to `null`, which also satisfies the parameter type.

**Verdict: type narrowing is strictly improved.** The `as` cast at `legend.ts:98` is gone; the new narrow is tsc-clean.

---

## 3. Client-Safety / Bundle Purity

**Check 1 — goal-presentation.ts has zero imports:**
`goal-presentation.ts:1–133` contains no `import` statements. It uses only language primitives and `Intl.*`. It is maximally client-safe (no Prisma, no `@/lib/db`, no `@/lib/calendar`, no Node builtins). Confirmed by grep.

**Check 2 — no cycle:**
Current import graph: `CalendarMonth.tsx → legend.ts → (zod only)`.  
After refactor: `CalendarMonth.tsx → legend.ts → goal-presentation.ts` (zero imports).  
`goal-presentation.ts` does NOT import `legend.ts` (grep confirmed: no import in goal-presentation.ts).  
**No cycle.** ✓

**Check 3 — goal-presentation.ts needs no edits for this PR:**
`legendDefault` is already present on every `GoalPresentation` entry (`goal-presentation.ts:52, 89, 111`). `DEFAULT_PRESENTATION` inherits it via `...FITNESS_PRESENTATION` spread (`goal-presentation.ts:114–118`). The import direction is legend.ts → goal-presentation.ts. PRD is correct that no edit to goal-presentation.ts is needed. ✓

---

## 4. Test Soundness

### No mock needed — confirmed

`legend.ts` imports only `zod`. After the refactor it imports `zod` + `goal-presentation.ts`. `goal-presentation.ts` has no imports. The transitive import chain contains no `@/lib/db`, no `prisma`, no server-only module. `legend.test.ts` needs no `vi.mock("@/lib/db")`.

Compare: `goal-presentation.test.ts:16–22` — that file imports `recap.ts` (`resolveStatSlot`), which at `recap.ts:16` imports `@/lib/db`, hence the mandatory mock. `legend.test.ts` never touches `recap.ts`. No mock needed. ✓

### The 6 proposed cases — verified correct

All six cases in PRD §3.2 are correct against the actual `resolveLegend` logic and the actual `presentationForGoal` resolver. ✓

### MANDATORY FIX: missing `DEFAULT_PRESENTATION.legendDefault` assertion

The refactor's correctness for every non-"project" goal depends on `DEFAULT_PRESENTATION.legendDefault === "fitness"`. This value is **not explicitly set** in `goal-presentation.ts` — it arrives via `...FITNESS_PRESENTATION` at `goal-presentation.ts:114`. If a future edit explicitly overrides `legendDefault` in `DEFAULT_PRESENTATION`, the refactor silently breaks (non-project goals with null legend get DEFAULT_LEGEND because `legendDefault` is still not "project", but the invariant that unlocks the correct branch is gone without any test catching it).

**The PRD proposes locking `FITNESS_PRESENTATION.legendDefault` and `PROJECT_PRESENTATION.legendDefault` but NOT `DEFAULT_PRESENTATION.legendDefault`.**

**Fix:** Add to `legend.test.ts`:
```ts
expect(DEFAULT_PRESENTATION.legendDefault).toBe("fitness");
```
This is a one-liner in the existing mapping-lock describe block. Without it, the test suite cannot catch the exact invariant the refactor relies on.

### Minor gap: `resolveLegend(undefined)` case not proposed

The six cases omit `undefined`. This is not a behavioral gap (the truth table above confirms `undefined` → DEFAULT is preserved), but the regression suite is thinner than it could be. Low priority — add if the testing convention favors exhaustive coverage.

---

## 5. Missed Callers / Identity Comparisons

**Callers of `resolveLegend` (verified by grep):**
- `src/app/calendar/page.tsx:21` — `const legend = resolveLegend(goal)` → passes to `CalendarMonth` as a prop
- `src/lib/goal-events.ts:114, 168, 204` — calls and iterates the returned array

**No caller uses `===` identity comparison on the returned array.** `CalendarMonth.tsx` receives `legend` as a prop and passes it to `findLegendEntry` and `markersFor` for iteration only. `goal-events.ts` does the same (iterate, find entries by `kind`). The refactor returns the same object references (`DEFAULT_LEGEND`, `PROJECT_DEFAULT_LEGEND`, or the `parsed.data` array) as the current code does for all inputs, so identity would be preserved anyway. Non-issue. ✓

---

## Findings Summary

### Critical
None.

### Concerns

**C-1 (MUST FIX) — `DEFAULT_PRESENTATION.legendDefault` is untested (`legend.test.ts`).**  
The refactor's default branch is `legendDefault === "project" ? PROJECT : DEFAULT`. For every non-project kind this succeeds only if `DEFAULT_PRESENTATION.legendDefault` stays `"fitness"` (which it inherits via spread at `goal-presentation.ts:114`). No proposed test pins this. A single future edit to `DEFAULT_PRESENTATION` could break the default path silently.  
**Fix:** Add `expect(DEFAULT_PRESENTATION.legendDefault).toBe("fitness")` to the legend test's registry-mapping block.

**C-2 (LOW) — `quality-tools.md` says "Tests do not exist."**  
Since commit `f7a5c48` ("land food-units fix + Vitest test setup"), `vitest.config.ts` exists and `package.json:10` has `"test": "vitest run"`. The file at `.claude/quality-tools.md` is stale.  
**Fix:** Update the QA table in `quality-tools.md` to add a Test row: `Test | npm run test | Vitest; src/**/*.test.ts`. Out of scope for this PR but should be tracked.

### Suggestions

**S-1 — Add `resolveLegend(undefined)` case to legend.test.ts.**  
Completes the truth table (`null`, `undefined`, known-kind-null-legend, unknown-kind, project-stored, fitness-invalid). Low cost, makes the suite exhaustive.

**S-2 — Document the binary `legendDefault === "project"` assumption.**  
The new code is no more extensible than the old `kind === "project"` branch for a future 3rd kind. Add a short comment in `resolveLegend` noting: "extend to a map lookup if a third legendDefault value is ever added." Defers scope without losing the warning.

---

## Verdict

**APPROVE WITH ONE MANDATORY TEST FIX (C-1).**

The refactor is behavior-equivalent across every input case (verified via the full truth table above). The type narrowing strictly improves tsc hygiene by removing the unsound `as` cast at `legend.ts:98`. Client-safety is confirmed: `goal-presentation.ts` has zero imports and introduces no cycle. No mocks are needed in `legend.test.ts`. All six proposed test cases are correct.

**The single most important thing:** Add `expect(DEFAULT_PRESENTATION.legendDefault).toBe("fitness")` to `legend.test.ts`. The refactor's entire default path depends on this spread-inherited value, and the current test plan has a blind spot exactly there.
