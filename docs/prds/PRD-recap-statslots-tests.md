# PRD — Vitest: pin fitness statSlots byte-identical + project slots (#70)

**Slug:** recap-statslots-tests · **Issue:** #70 (board #8, Sprint 6, P1) · **Date:** 2026-06-17
**Depends on:** #68 (`resolveStatSlot` in recap.ts) + #69 (card consumes it) — both shipped.
**UX-research:** skipped — test-only; no UI surface.

## 1. Goal
Lock the registry refactor so it can never silently drift the fitness card strings, and pin the project `—`/`0/7` derivation against regression. A Vitest spec drives `resolveStatSlot` + `presentationForGoal` with synthetic ctx (no DB).

## 2. Scope
**In:** new `src/lib/goal-presentation.test.ts` (Vitest), added to the existing suite (`npx vitest run`).
**Out:** any source change. If a tiny test-infra tweak is needed to import `resolveStatSlot` without a DB (see §4), prefer an in-test `vi.mock`; only touch `vitest.config.ts` as a documented fallback.

## 3. Test cases (all from AC)
1. **Fitness byte-identical:** ctx `{ recap:{workoutsCompleted:2, volumeLb:2370, prCount:1, hikeElevationFt:5200}, logLatest:new Map(), scheduledAgg:new Map(), breakdown:[], targets:[] }`; map `FITNESS_PRESENTATION.statSlots` through `resolveStatSlot` → values `["2","2,370 lb","1","5,200 ft"]`, isNull all `false`, keys `["workouts","volume","prs","elevation"]`, labels `["WORKOUTS","VOLUME","NEW PRs","ELEVATION"]`.
2. **Fitness nulls:** ctx with `volumeLb:null, hikeElevationFt:null` (workouts 0, prs 0) → volume `"—"`/isNull true, elevation `"—"`/isNull true; workouts `"0"`, prs `"0"`.
3. **presentationForGoal fitness:** `presentationForGoal({kind:"fitness"})` → ringLabel `"READINESS"`, headerStyle `"program-week"`, slot labels in order WORKOUTS/VOLUME/NEW PRs/ELEVATION.
4. **Default fallback:** `presentationForGoal(null)` and `presentationForGoal({kind:"galaxy-brain"})` → kind `"__default__"`, same 4 fitness slots (labels/keys identical).
5. **Project Chewgether:** `presentationForGoal({kind:"project"})` → ringLabel `"PROGRESS"`, headerStyle `"weeks-to-target"`. ctx `{ recap:{0/null...}, logLatest:new Map([["mrr", null]]), scheduledAgg:new Map([["milestone",{done:0,total:7,open:7}]]), breakdown:[], targets:[] }`; map `PROJECT_PRESENTATION.statSlots` → `[{key:"mrr",value:"—",isNull:true},{key:"milestones",value:"0/7",isNull:false}]`.
6. **Milestone progress:** scheduledAgg `{done:3,total:7,open:4}` → milestones slot `"3/7"`, isNull false — proves the ScheduledItem aggregate (not `log:milestones_done`) backs the stat.

## 4. The DB-import gotcha (must handle)
`resolveStatSlot` is exported from `src/lib/recap.ts`, which imports `@/lib/db`. `db.ts` calls `createClient()` at module load and **throws `"DATABASE_URL is not set"`** if env is missing — and Vitest does not load dotenv. So a bare `import { resolveStatSlot } from "@/lib/recap"` will throw at collection.
**Fix (primary):** at the top of the test, `vi.mock("@/lib/db", () => ({ prisma: {} }));` — Vitest hoists `vi.mock` above imports, so the throwing `createClient()` never runs. `resolveStatSlot` is pure (no prisma call), so the empty stub is never exercised. Other transitive modules (`program`/`readiness`/`records`/`game`) import the same mocked `prisma`, so one mock covers the chain.
**Fallback (only if the chain still throws):** add `test: { env: { DATABASE_URL: "postgresql://test:test@localhost:5432/test" } }` to `vitest.config.ts` (a dummy that never connects — the suite runs zero queries). Document the choice in the test header.

## 5. Acceptance criteria
1. `npx vitest run` passes (food-units + the new spec).
2. All 6 case groups present and asserting exact strings + isNull + ringLabel/headerStyle.
3. `npx tsc --noEmit`, changed-file lint, `npm run build` green.
4. No source/runtime behavior change; test imports the REAL `resolveStatSlot`/`presentationForGoal` (tests document existing behavior — do not re-implement the logic in the test).

## 6. Verification
`npx vitest run` (all green) · `npx tsc --noEmit` · `npx eslint src/lib/goal-presentation.test.ts` · `npm run build`.
