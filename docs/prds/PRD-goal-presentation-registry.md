# PRD — Goal-Presentation Registry Module (`goal-presentation.ts`)

**Slug:** goal-presentation-registry · **Issue:** #67 (board #8, Sprint 6, P0) · **Date:** 2026-06-16
**Source design:** `docs/roadmap/multi-domain-goal-engine-plan.md` §4.2 + `.roadmap/2026-06-16-multi-domain-goal-engine/agents/plan-blueprint.md` §1 (twice-vetted).
**UX-research:** skipped — pure lib module; no UI behavior change (formatters move but render byte-identically; no consumer rewires in this story).

## 1. Problem & Goal
The recap card / Today / progress surfaces hardcode fitness content (`WORKOUTS/VOLUME/PRs/ELEVATION`, `READINESS`, `Day M of 90`). We need a single, pure, client-safe seam that declares **per-goal-kind presentation config** so later stories (#68/#69/#72–#74) can drive those surfaces from it. This story creates ONLY the seam — no surface is rewired yet (that's #68/#69). It is the P0 unblocker for all of Sprint 6/7/9.

## 2. Scope
**In:**
- New module `src/lib/goal-presentation.ts` — **pure / client-safe** (no Prisma, no `@/lib/calendar`, no Node built-ins; `Intl.*` is allowed). Importable by Satori JSX (`recap-card.tsx`) AND server components.
- Types: `StatFormat`, `StatSource`, `StatSlot`, `HeaderStyle`, `GoalPresentation`.
- Hoisted formatters `fmtComma`, `fmtVolume`, `fmtElevation` (moved verbatim from `recap-card.tsx:13–23`).
- Entries: `FITNESS_PRESENTATION` (4 `recapField` slots, ring `READINESS`, header `program-week`), `PROJECT_PRESENTATION` (2 slots — MRR `logLatest` + MILESTONES `scheduledItem doneOverTotal`; ring `PROGRESS`; header `weeks-to-target`; `restCopy: null`), `DEFAULT_PRESENTATION` (`__default__` clone of fitness).
- `presentationForGoal(goal): GoalPresentation` resolving on `goal.kind` with `__default__` fallback.
- Update `recap-card.tsx` to import the hoisted formatters from the new module (remove the local copies) — proves Satori-importability + single formatter source.

**Out (later stories):**
- Computing `weeksToTarget`/`targetDateLabel` or resolving slots (`resolveStatSlot`) → #68.
- Driving recap-card ring/header/grid from the registry → #69.
- Today/progress/legend rewiring → #72–#74. (#67 only *declares* `legendDefault`.)
- Any Prisma / MCP change → none, ever, for this module.

## 3. The shapes (verbatim from blueprint §1.3)
```ts
export type StatFormat = "int" | "volumeLb" | "elevationFt" | "currency" | "ratioOfTotal" | "percent";
export type StatSource =
  | { from: "recapField"; field: "workoutsCompleted" | "volumeLb" | "prCount" | "hikeElevationFt" }
  | { from: "logLatest"; metricKey: string }
  | { from: "scheduledItem"; itemType: string; agg: "doneOverTotal" | "doneCount" | "openCount" }
  | { from: "targetCurrent"; metric: string };
export type StatSlot = { key: string; label: string; source: StatSource; format: StatFormat };
export type HeaderStyle = "program-week" | "weeks-to-target" | "none";
export type GoalPresentation = {
  kind: string;
  ringLabel: string;
  headerStyle: HeaderStyle;
  statSlots: StatSlot[];
  restCopy: string | null;
  legendDefault: "fitness" | "project";
};
```
Fitness/project entries + `presentationForGoal` + `__default__` fallback exactly per blueprint §1.4–§1.5.

## 4. Edge cases
- `presentationForGoal(null)` / `undefined` / `{kind: undefined}` / unknown kind → returns `DEFAULT_PRESENTATION` (kind `"__default__"`), never throws.
- `kind: "fitness"` / `"project"` → exact entry.
- Formatter parity: `fmtVolume(null)` → `"—"`, `fmtVolume(2370)` → `"2,370 lb"`; `fmtElevation(null)` → `"—"`, `fmtElevation(5200)` → `"5,200 ft"` (identical to current recap-card output — byte-identical guarantee).

## 5. Acceptance criteria
1. `npx tsc --noEmit`, `npm run lint`, `npm run build` all green.
2. `src/lib/goal-presentation.ts` is pure: no import of `@/lib/db`, `@/generated/prisma`, `@/lib/calendar`, `fs`, `path`, or anything server-only (`grep` clean).
3. `recap-card.tsx` imports `fmtVolume`/`fmtElevation` (and `fmtComma` if still used) from `@/lib/goal-presentation`; its local copies are removed; the Satori card still builds (Turbopack build is the proof).
4. `presentationForGoal` returns the right entry for `fitness`/`project` and `__default__` for null/unknown — covered by the Sprint-6 test story (#70); for THIS story, the build + a smoke assertion suffices.
5. `PROJECT_PRESENTATION` has exactly 2 stat slots (MRR, MILESTONES), `ringLabel: "PROGRESS"`, `restCopy: null`. `FITNESS_PRESENTATION` has 4 `recapField` slots, `ringLabel: "READINESS"`. (Anti-vertical guardrails.)
6. No behavior change to any rendered surface (formatters moved verbatim; no consumer reads `statSlots`/`ringLabel` from the registry yet).

## 6. Verification
- `npx tsc --noEmit` + `npm run build` (build exercises the Satori card import path).
- `grep -nE "from \"@/lib/(db|calendar)\"|generated/prisma|require\(|\\bfs\\b|\\bpath\\b" src/lib/goal-presentation.ts` → empty (purity).
- Confirm `fmtVolume`/`fmtElevation` no longer defined in `recap-card.tsx` and imported instead.
</content>
