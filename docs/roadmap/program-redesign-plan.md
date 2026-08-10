# Roadmap: Program-Model Redesign (multi-goal days)

**Author**: Claude (Planning Lead) + Jerry
**Date**: 2026-08-09
**Status**: Approved
**Board**: Goaldmine Roadmap (#8)
**Source docs**: `docs/program-redesign/01-current-state-analysis.md` (verified current state) · `docs/program-redesign/02-rfc-program-model.md` (owner-approved RFC, resolved §7) · run artifacts in `.roadmap/2026-08-09-program-redesign/`

## 1. Problem & End-State

Today the day is owned by whichever `Plan.active=true` row wins a focus-first sort (`getActiveProgram()`, `src/lib/program.ts:24-57`); `Goal.isFocus` is single-select by code convention only, project goals have no daily presence (`PlanDayOverride` is keyed to `planId`), and a stale legacy `Program` row can shadow the real plan and silently break overrides. The owner runs three complementary goals (handstand, 10% body-fat cut, AWS SAA) advanced by the same activities — the model can't represent that.

End-state: an active **Program** (one per user, DB-enforced) owns window + membership; its reparented `Plan` stays the rotation document (`Plan.goalId` = rotation-owning goal); activities fan out to goals via materialized `ActivityGoalLink` rows written by rules at log time; Today/calendar/dashboard render the union with per-item goal badges. Readiness scoring untouched.

## 2. Driving Vertical(s)

1. **Founder "Phase 2A"** — handstand (owns rotation) + cut + AWS; one Monday walk+AWS session advances all three (the RFC §3 acceptance case, asserted by an E2E test).
2. **chewgether "$1k/mo"** — the pure-project Program with **no Plan at all**. Design invariant from the Devil's Advocate pass: an active Program with no active Plan must yield "no rotation today", never fall through to an unscoped cross-goal plan query (the founding bug).

## 3. Non-Goals

Readiness scoring changes; achieved-goal snapshots/XP/retrospectives (R9/R10 — Elbert stays byte-stable); game-engine ledger semantics in v1; auth/tenancy redesign (compliance only); historical link backfill (links start at cutover); `isFocus` column drop (backlog, post-initiative); `recent_history` truncation and unrelated MCP ergonomics.

## 4. Target Architecture

### 4.1 Data model (Prisma)
- **M1**: `ALTER TABLE "Program" RENAME TO "LegacyProgram"` (lossless). Same commit: `SCOPED_MODELS` string rename (else silent isolation hole), 7 call-site renames (`program.ts:44,90`; `export-data.ts:94`; `scripts/founder-cutover.ts:77`; `scripts/verify-no-null-userid.ts:78`; `scripts/verify-tenant-isolation-full.ts:169,440`), `prisma/seed.ts:22-31` deleted. Fallback-branch removal gated on a founder-history coverage-verify script. Runbook: apply migration only after the code deploy rolls over.
- **M2** (one additive migration, read by nothing until M3): new `Program { name, status draft|active|completed|archived, startedOn, endsOn?, notes?, userId }` + raw SQL partial unique index `ON "Program"("userId") WHERE status='active'`; `Goal.programId?` + `Plan.programId?` (SetNull, indexed); `ActivityGoalLink { activityType, activityId, goalId, source auto|explicit, note?, activityDate, userId }` with `@@unique([activityType, activityId, goalId])` (polymorphic — no activity FK; delete-hooks + nightly orphan verifier compensate); `WriteReceipt { userId, requestId, toolName, resultJson }` `@@unique([userId, requestId])`; `SavedMeal { name, items Json, macros Json?, defaultServings }`; `Baseline.capped Boolean @default(false)`. `User` gets distinct relation names for `LegacyProgram` vs `Program`. All four new models join `SCOPED_MODELS` in the same commit; `db:verify-owned` + `db:verify-isolation` run in-PR.
- **Founder backfill is a script** (`scripts/founder-program-backfill.ts`), not SQL — membership is judgment-laden. It must set **and assert** `Plan.programId`, not just `Goal.programId` (forgetting it silently falls through while `isFocus` is still populated, masking itself).

### 4.2 The seam (day resolution)
- `getActiveProgram()` signature and **`.id`-means-Plan-id contract frozen** (≈6 planId-keyed call sites, incl. every `PlanDayOverride` lookup). New behavior: if the user has an active Program row → `plan.findFirst({ active: true, programId })`; if that Program owns no active Plan → **null ("no rotation")**. The legacy isFocus-tiebreak query fires **only when the user has zero Program rows** (per-tenant rollout + instant rollback by archiving the Program row).
- New `getActiveProgramMembership()` carries Program-shaped context (Program's own id, member goals) — `ActiveProgramSnapshot` never grows (keeps `game/engine.ts` decoupled).
- `ResolvedDay` gains **new** keys `program` and `scheduledItemsToday` (union across member goals), distinct from the shipped `resolvedPlan` key.
- `get_today_plan`/`get_day`/`get_week`/`get_session_brief` merge program context; `today-shapers.ts` becomes a merger (replacing the project-branch nuller); `getTodayContext` deleted (strict-subset verified first). Calendar generalizes `otherGoalEvents` to member goals; game engine untouched in v1.

### 4.3 MCP tool surface
New pack: `create_program`, `update_program`, `set_program_status` (clean error on second-active), `attach_goal_to_program` (rejects achieved goals — R9), `detach_goal_from_program`, `attach_plan_to_program`, `get_program_overview`, `attribute_activity` (add: explicit wins over auto; remove: always wins), `list_activity_links` (filters on `activityDate`). Descriptions follow the `list_planned_hikes` pattern (mental-model hook, verbatim phrasings, explicit do-nots). `set_active_goal` becomes a documented compat shim whose new blast radius (switching Programs deactivates the whole current one) ships in its description **and** COACH_INSTRUCTIONS in the same PR (three-places rule, gotcha §B.6). Stale `set_plan_active`/`create_goal` descriptions fixed in passing. `TOOL-DIFFS.md` written incrementally in `docs/program-redesign/`. Connector reconnect noted for every tool-touching sprint.

### 4.4 Attribution (auto-link rules, v1 = append-only)
- Workout: exercise-name hint match only (`canonicalExerciseName` ∩ canonicalized `Goal.attributionHints` — promoted from display-only). Hooks: `createWorkoutCore` **and** `appendBaselineToDayWorkout` (bypasses the core, gotcha §E.2). *(The RFC's "workout category" input has no schema column — explicit scope reduction.)*
- Hike / LogEntry: mirror their existing `goalId` into a `source:"auto"` link at write; `Hike.goalId` stays authoritative.
- NutritionLog: auto-links to **fitness-kind** member goals only (unconditional linking would permanently attach meals to project goals under append-only rules).
- Delete integrity: ≈9 delete call sites across dashboard/MCP (only Workout has a shared core today) — consolidate + hook all in M2 (against an empty table), plus a **nightly orphan-link verifier** script as a named story.
- Links drive display/badging/history — **never readiness** (`readiness.ts` / `goal-targets.ts` untouched).

### 4.5 UI seams
Unified Today = **one timeline with per-item goal chips — never per-goal sections** (hard constraint from RFC §7 sign-off; a shared activity must not repeat). `ProjectTodayView` dies (own PR, after parity check for Program-less project users). New `/program` dashboard (server component; `computeReadinessSeriesSampled` reuse; Recharts leaves client-only). Cross-goal calendar via generalized goal-events. `/progress` extension is R9-safe. B4 nutrition fixes (surface the hidden date control; add `/days/[dateKey]` log entry point; append-vs-new) and the SavedMeal composer quick-pick ride the views sprint. All new pages mobile-first at 390px. UX-research pass precedes this sprint (runs in parallel with earlier sprints).

### 4.6 Coaching / prompt
COACH_INSTRUCTIONS + MCP server instructions get the Program mental model at S4 (membership, one-active constraint, shim semantics) and the merged-payload description at S5. Connector reconnect after each tool-surface deploy.

## 5. Phasing (epics → sprints)

| Sprint | Epic | Ships | Leaves main deployable because |
|---|---|---|---|
| 1 | Deploy safety & standalone fixes | M0 build-inlined `prisma migrate status` gate (verified against the real Vercel build command, proven by a deliberate failing deploy); B7 recap emoji→SVG + `/recap/completion` font tracing; B2 export IDs (+rpe/notes); B1 orphanedOverride fix + tests | zero schema change; isolated fixes |
| 2 | Legacy retirement (M1) | coverage-verify script → rename migration + sweep → fallback deletion | rename is lossless; gated on verification. Sized "fast if clean / slow if gaps" |
| 3 | Additive schema (M2) | Program, ActivityGoalLink(+activityDate), programId cols, WriteReceipt, SavedMeal(+MCP), Baseline.capped(+tools), SCOPED_MODELS+verifiers, delete-hook consolidation, orphan verifier | nothing reads the new tables yet |
| 4 | Seam flip (M3) | Program-first selector (zero-rows fallback rule) + membership fn; program MCP pack; auto-link engine; `attribute_activity`/`list_activity_links`; founder backfill; shim + COACH_INSTRUCTIONS; backend acceptance slice | other tenants have no Program rows → unchanged; founder rollback = archive the Program row |
| 5 | Program-shaped day (M4a) | ResolvedDay new keys; four read tools merged + leaky-reads; shapers merger; getTodayContext deleted; TOOL-DIFFS; full §3 acceptance E2E | additive payload fields only |
| 6 | Views (M4b) | Unified Today; ProjectTodayView deletion; /program; cross-goal calendar; /progress; B4; SavedMeal UI | UI additions/replacements; deletion PR revertable |
| 7 | isFocus sweep & cleanup (M4c) | ~20 read-site batches; stale descriptions; column drop → Backlog | mechanical, per-batch revert |

## 6. Risks & Open Questions

- **Highest risk**: the seam (S4). Mitigated by the frozen `.id` contract, zero-Program-rows fallback rule, backfill assertion on `Plan.programId`, and the pulled-forward backend acceptance slice.
- **M0 could be a no-op** if the Vercel build command bypasses npm scripts — the story requires verifying the live setting and observing a real failing deploy.
- **Polymorphic link orphans** — delete-hooks + nightly verifier; hooks land against an empty table.
- **Three independent day-resolvers** (calendar buildCell, game engine, deleted getTodayContext) — engine deliberately untouched v1; calendar via existing goal-events seam.
- Migrations additive/reversible, SQL-diff reviewed, guarded dev apply, manual prod apply (M0 enforces ordering). USER_TZ via `@/lib/calendar` only; new date params through `parseDateInput`.
- Open (deferred, tracked in Backlog): per-goal XP attribution; link retraction/re-run sweeps; historical backfill; `isFocus` column drop; app-UI Program wizard.
