# PRD — Route resolveLegend through presentation.legendDefault (#73)

**Slug:** legend-via-registry · **Issue:** #73 (board #8, Sprint 7, P1) · **Date:** 2026-06-17
**Depends on:** #67 (`goal-presentation.ts` — `legendDefault` field already on every entry).
**UX-research:** skipped — refactor. Behavior-preserving rewire of one branch; no visual/legend-content change.

## 1. Goal
`resolveLegend` carries its own `kind === "project"` branch (`legend.ts:~98`). Route that default selection through `presentationForGoal(goal).legendDefault` so legend and every other kind-aware surface share one source of kind→config truth. Byte-identical output; the stored-legend path is untouched.

## 2. Scope
**In:** `src/lib/legend.ts` — replace the inline `kind === "project"` default branch with the registry's `legendDefault`. Add a focused `src/lib/legend.test.ts` regression guard (resolveLegend has no DB dependency — imports only zod + the client-safe registry).
**Out:** `goal-presentation.ts` (no edit needed — `legendDefault` already exists; the "touch" is only the import direction: legend.ts imports the registry, never vice-versa). The `LegendKind` enum + `CalendarMonth.tsx` coupling. `DEFAULT_LEGEND`/`PROJECT_DEFAULT_LEGEND` constants (unchanged).

## 3. Design
### 3.1 `legend.ts`
Add `import { presentationForGoal } from "@/lib/goal-presentation";` (client-safe; legend.ts is already imported by `CalendarMonth.tsx`). Rewrite the default branch:
```ts
export function resolveLegend(
  goal: { legend?: unknown; kind?: unknown } | null | undefined,
): readonly LegendEntry[] {
  if (!goal || goal.legend == null) {
    const legendDefault = presentationForGoal(
      goal && typeof goal.kind === "string" ? { kind: goal.kind } : null,
    ).legendDefault;
    return legendDefault === "project" ? PROJECT_DEFAULT_LEGEND : DEFAULT_LEGEND;
  }
  const parsed = LegendSchema.safeParse(goal.legend);
  return parsed.success ? parsed.data : DEFAULT_LEGEND;
}
```
- `goal.kind` is typed `unknown` here → narrow with `typeof goal.kind === "string"` before passing to `presentationForGoal` (which expects `kind?: string | null`). Avoids a cast/`any`.
- **Equivalence:** `project` → PROJECT_DEFAULT_LEGEND; everything else (fitness / null / unknown kind → `__default__`, all `legendDefault:"fitness"`) → DEFAULT_LEGEND. Exactly the current truth table.
- The stored-legend path (valid → own legend; present-but-invalid → DEFAULT_LEGEND) is unchanged.

### 3.2 `src/lib/legend.test.ts` (new — regression guard)
Vitest, no mocks needed (legend.ts imports only zod + the pure registry):
- `resolveLegend(null)` → DEFAULT_LEGEND (reference-equal or deep-equal).
- `resolveLegend({kind:"fitness", legend:null})` → DEFAULT_LEGEND.
- `resolveLegend({kind:"project", legend:null})` → PROJECT_DEFAULT_LEGEND.
- `resolveLegend({kind:"galaxy-brain", legend:null})` → DEFAULT_LEGEND (unknown kind → fitness default).
- `resolveLegend({kind:"project", legend:<valid LegendEntry[]>})` → the stored legend (NOT PROJECT_DEFAULT_LEGEND) — proves stored path wins.
- `resolveLegend({kind:"fitness", legend:<invalid>})` → DEFAULT_LEGEND (invalid → fallback).
Also lock the mapping the refactor depends on: `expect(FITNESS_PRESENTATION.legendDefault).toBe("fitness")`, `expect(PROJECT_PRESENTATION.legendDefault).toBe("project")`.

## 4. Acceptance criteria
1. `resolveLegend` selects its default via `presentationForGoal(goal).legendDefault`, not the inline `kind === "project"` check.
2. Stored-legend path unchanged (valid → own; invalid → DEFAULT_LEGEND).
3. Fitness un-regressed: fitness/null-kind + null legend → DEFAULT_LEGEND (byte-identical entries/order). `LegendKind` enum + CalendarMonth coupling untouched.
4. Project: project + null legend → PROJECT_DEFAULT_LEGEND via the registry.
5. `goal-presentation.ts` purity preserved (legend.ts imports the registry, not vice-versa; no Prisma/`@/lib/calendar` in the registry).
6. `npx tsc --noEmit`, changed-file lint, `npm run build`, `npx vitest run` all pass.

## 5. Verification
`npx tsc --noEmit` · `npx eslint src/lib/legend.ts src/lib/legend.test.ts` · `npm run build` · `npx vitest run` (food-units + goal-presentation + new legend spec all green). `grep -n "kind === \"project\"" src/lib/legend.ts` → empty (inline branch gone).
