# Program-Redesign Backlog

*Generated from `.roadmap/2026-08-09-program-redesign/coordination/backlog.json` (source of truth for stories). Plan: `docs/roadmap/program-redesign-plan.md`. Board #8 sprint names are offset by +13 (Sprints 14-20) to coexist with prior initiatives.*

## Sprint 1 - Deploy safety & fixes  →  board: **Sprint 14 - Deploy safety & fixes**  (6 stories)

### M0: Inline a build-time migration-status gate that fails Vercel deploys on pending migrations
*P0 - Critical · Small* — so that a schema-changing deploy can never ship the Next.js build ahead of its migration (the completedAt-incident failure mode) — the build itself refuses to proceed instead of relying on a manual runbook step

Acceptance criteria:
- New `scripts/check-migration-status.ts` runs `prisma migrate status` against DATABASE_URL, parses its exit code/output, and exits non-zero with a clear stderr message when there are pending/unapplied migrations; exits 0 (prints a short OK line) when the DB is up to date
- `package.json` `build` script becomes `"build": "tsx scripts/check-migration-status.ts && next build"`; `postinstall` (prisma generate) is untouched and still runs before build in Vercel's install→build pipeline
- Verify (and record in the PR description) the actual Vercel project build command setting (Project Settings → Build & Development) — if it overrides `package.json`'s `build` script with a custom command, update that setting too so the gate is not bypassed; note the finding either way
- Local `npm run build` with DATABASE_URL pointed at the dev branch (fully migrated) succeeds unchanged — no new prompts, no behavior change for the common local case
- Deliberately prove the gate: create a throwaway additive migration locally, apply it to a scratch/dev DB state that is behind (or use a temporary unmigrated branch), run `npm run build`, and confirm it fails with the pending-migration message before invoking `next build`; then bring the DB current and confirm the build proceeds. Document the before/after console output in the PR
- Script has no import-time side effects beyond reading `DATABASE_URL`/`DB_ENV`; it does not run guarded/destructive commands (read-only `prisma migrate status`, no `migrate deploy`) so it is safe to run unconditionally in Vercel's production build environment where `DB_ENV` is not 'development'
- `npx tsc --noEmit` and `npm run lint` remain green with the new script included
- No schema change; this story ships with zero migrations of its own

Touches: scripts/check-migration-status.ts, package.json

### B7: Replace recap highlight emoji with bundled inline SVG and trace fonts for /recap/completion
*P1 - High · Small* — so that recap highlight cards (PR, baseline, hike, badge, custom) render their icons reliably on Vercel instead of depending on next/og's runtime twemoji CDN fetch, closing the same tofu-glyph failure class already fixed for the completion card's check/circle marks

Acceptance criteria:
- In `src/lib/recap.ts`, the five `icon` emoji values (🏆 pr, 📏 baseline, ⛰️ hike, 🎖️ badge, ⭐ custom — lines ~580, ~598, ~608, ~649, ~758) are replaced by a discriminated `icon` identifier (e.g. a small string union or enum) rather than a literal emoji character, since `recap.ts` is the pure/shared layer and must not import JSX
- `src/lib/recap-card.tsx` (~line 214, the highlight icon `<div>{highlight.icon}</div>`) renders each icon identifier as an inline SVG mark — same treatment as `completion-card.tsx:144-166` (stroked/filled SVG paths sized via `tok.highlightIconSize`, no emoji glyph, no external font/CDN dependency)
- All five icon kinds (pr/baseline/hike/badge/custom) have a distinct, recognizable SVG glyph — not all collapsed to one shape
- `next.config.ts` `outputFileTracingIncludes` gains a `/recap/completion` entry pointing at `./src/app/recap/fonts/**`, matching the existing `/recap/card`, `/recap/story/[slide]`, `/api/mcp` entries, so that lambda bundles the fonts it needs instead of `getFont` silently returning null
- Render a sample recap card locally (or via the existing recap smoke path) for at least one highlight of each kind and visually confirm no tofu boxes / missing glyphs
- `npm run test` and `npx tsc --noEmit` stay green; no MCP tool output shape changes, so no connector-reconnect note is needed for this story

Touches: src/lib/recap.ts, src/lib/recap-card.tsx, next.config.ts

### B2: Add exercise/set IDs (+ rpe/notes) to export_workout so update_workout_exercise/update_workout_set instructions are followable
*P1 - High · Medium* — so that the coach can actually look up exercise and set IDs via export_workout as three other tools' descriptions already instruct, instead of needing the recent_history/weekly_summary_data raw-row workaround

Acceptance criteria:
- `FormattableSet` (`src/lib/formatters/types.ts:3-9`) gains `id: string`; `FormattableExercise` (`types.ts:11-17`) gains `id: string`
- `FormattableSet` also gains `rpe: number | null` and `notes: string | null` (currently dropped by the projection despite being real Set columns)
- The `export_workout` projection in `src/lib/mcp/tools.ts` (~2149-2160) passes through `ex.id`, `s.id`, `s.rpe`, `s.notes` for every exercise/set instead of omitting them
- Each formatter that renders exercises/sets (`strong.ts`, `markdown.ts`, `plain.ts`, `json.ts` under `src/lib/formatters/`) is updated so `format:"json"` surfaces the new fields verbatim, and at least one human-readable formatter (markdown or plain) prints the id inline (e.g. a short id suffix or explicit `[id: ...]` marker) so the coach can read it without switching formats; text-only formats do not silently drop rpe/notes that were previously visible nowhere
- Existing export_workout / formatter unit tests updated for the new fields; add a regression test asserting exported exercise/set IDs match the underlying Workout row's real Prisma IDs
- The `update_workout_exercise` (tools.ts:4395), `update_workout_set` (tools.ts:4432), and `workout_ops` (tools.ts:4473) tool descriptions' "look up IDs via export_workout" instruction is now literally true — manually verify by calling export_workout then update_workout_set with the returned id in a local/dev smoke check
- `npm run test`, `npx tsc --noEmit` green
- CONNECTOR RECONNECT NOTE: this changes export_workout's output shape (new id/rpe/notes fields) — reconnect the claude.ai MCP connector after deploy per the repo's tool-set-cache caveat
- Appends the export_workout shape change to docs/program-redesign/TOOL-DIFFS.md (create the file if absent)

Touches: src/lib/formatters/types.ts, src/lib/formatters/strong.ts, src/lib/formatters/markdown.ts, src/lib/formatters/plain.ts, src/lib/formatters/json.ts, src/lib/mcp/tools.ts

### B1: Fix orphanedOverride false positive by reusing override-integrity.ts's no-status-filter hike check
*P1 - High · Medium* — so that get_day stops flagging every summit-day override as an orphaned/phantom hike session regardless of whether a real Hike row backs it — today the flag algebraically reduces to just isOverride && isMirrorOverride(template) because plannedHikeToday is unconditionally nulled on override days

Acceptance criteria:
- Root cause confirmed and documented in the PR: `reconcileLongEffort` (`calendar.ts:1452-1456`) returns `plannedHikeToday: null` unconditionally whenever `isOverride` is true, and the weekly hike query feeding it (`calendar.ts:1010-1017`) filters `status: "planned"` only — so `orphanedOverride` at `calendar.ts:1224-1228` never actually detects backing-row presence on override days
- `orphanedOverride`'s computation is changed to query backing Hike rows the way `override-integrity.ts:44-49`'s `backingDateKeys()` already does (any status, not just 'planned', keyed by dateKey) instead of relying on `plannedHikeToday`, which stays reserved for its original weekly-planning-conflict purpose and is NOT repurposed
- Prefer literally reusing `OVERRIDE_MIRROR_KINDS`'s `backingDateKeys()` (or a shared helper extracted from it) rather than duplicating the query, so there is exactly one definition of 'does a real Hike row exist on this date, any status' shared with the `lint_plan` path
- No import cycle introduced: `override-integrity.ts`'s stated design (imports only calendar-core + db) is preserved; if calendar.ts needs to import from override-integrity.ts, confirm no cycle exists (override-integrity already documents it avoids importing calendar.ts for this reason)
- True-positive test added: an override day whose template is a mirror-kind (long-endurance) AND has no backing Hike row of any status on that date resolves `orphanedOverride: true`
- False-positive regression test added: an override day whose template is a mirror-kind AND DOES have a backing Hike row (including non-'planned' statuses, e.g. 'completed' or 'skipped') resolves `orphanedOverride: false` — this is the exact case that was broken
- Existing calendar.ts / calendar.test.ts suite stays green; `npx tsc --noEmit` clean
- No schema change; no MCP tool output shape change (get_day's orphanedOverride field type is unchanged, only its correctness), so no connector-reconnect note needed

Touches: src/lib/calendar.ts, src/lib/override-integrity.ts, src/lib/calendar.test.ts

### B4a: surface the hidden date/time control in MealComposer create mode
*P1 - High · Small* — MealComposer already has a real datetime-local picker but it hides behind an 'exact time' toggle (MealComposer.tsx:1042-1058) that reads as time-only, and create mode always seeds 'now' — users logging a meal after the fact have no visible way to backdate it. This is a pure UX surfacing fix, no new data model.

Acceptance criteria:
- In MealComposer create mode, the date+time control (the existing datetime-local input at MealComposer.tsx:1042-1050) is visible by default, not hidden behind the 'exact time' disclosure toggle at MealComposer.tsx:1035-1041
- Nudge buttons (Yesterday / -2h / Now, MealComposer.tsx:1009-1032) remain as quick-pick shortcuts alongside the now-visible exact control
- Label/copy makes clear this sets both date and time, not just time-of-day (fixes the 'reads as time-only' finding from current-state analysis §3 B4)
- Edit mode (mode="edit") behavior unchanged — this story only touches create-mode default visibility
- Renders at 390px without layout overflow; hydration-clean
- `npm run test` (MealComposer tests) and `npm run build` green

Touches: src/components/MealComposer.tsx

### B4b: manual nutrition log entry point on /days/[dateKey]
*P1 - High · Small* — The day detail page currently renders NutritionToday with showLogForm={false} (days/[dateKey]/page.tsx:365-373), so a user reviewing or backfilling a past or future day has no way to log a meal for that specific date from the page they're already on — they must navigate elsewhere and cannot easily target that date.

Acceptance criteria:
- days/[dateKey]/page.tsx's Nutrition card (currently showLogForm={false} at line ~371) gains a working log-entry affordance that passes the page's dateKey through to MealComposer create mode, pre-filling the date so the resulting NutritionLog lands on the viewed day, not 'now'
- Works for both past and future dateKey values (backfill and pre-planning use cases)
- Reuses B4a's now-visible date control rather than introducing a second date-input pattern
- Renders at 390px without layout overflow; hydration-clean
- `npm run test` and `npm run build` green; add/update a test asserting the passed dateKey ends up on the created NutritionLog

Depends on: B4a: surface the hidden date/time control in MealComposer create mode

Touches: src/app/days/[dateKey]/page.tsx, src/components/NutritionToday.tsx, src/components/MealComposer.tsx

## Sprint 2 - Legacy retirement  →  board: **Sprint 15 - Legacy retirement**  (4 stories)

### Rename legacy Program table + call-site sweep (M1)
*P0 - Critical · Large* — Frees the Program name for Sprint 3's additive schema (the new Program model) and removes the double-meaning that lets a stale legacy row shadow real Plan resolution — a lossless, purely mechanical rename that must land in one commit so isolation scoping and every call site stay in sync.

Acceptance criteria:
- Migration `ALTER TABLE "Program" RENAME TO "LegacyProgram"` (plus any dependent index/constraint renames) applied via the guarded db:migrate workflow; verified lossless by comparing row counts before/after on the dev DB.
- prisma/schema.prisma model renamed Program -> LegacyProgram with a distinct User relation name (e.g. legacyPrograms) that will not collide with the Sprint-3 new Program model; `npx prisma generate` run and committed.
- Same commit: src/lib/db.ts SCOPED_MODELS updated from "Program" to "LegacyProgram" — grep confirms no lingering bare "Program" entry and no isolation gap (db:verify-isolation / db:verify-owned pass post-rename).
- All seven known call sites updated from db.program/prisma.program to db.legacyProgram/prisma.legacyProgram: src/lib/program.ts:44,90; src/lib/export-data.ts:94; scripts/founder-cutover.ts:77; scripts/verify-no-null-userid.ts:78; scripts/verify-tenant-isolation-full.ts:169,440 (including any hardcoded 'Program (legacy owned)' labels/comments there).
- grep for `db.program.` / `prisma.program.` across src/ and scripts/ (excluding src/generated/prisma) returns zero hits after the sweep.
- prisma/seed.ts's legacy Program seed write (existing findFirst/create block, lines ~22-31) is deleted; seeding still completes successfully end-to-end without creating a legacy row.
- npm run test and npx tsc --noEmit pass after the rename.
- Runbook note committed (PR description + deploy checklist) stating the rename migration must be applied only after the accompanying code deploy has fully rolled over, to avoid a warm-lambda race against old code still querying the pre-rename table name.

Depends on: M0: Inline a build-time migration-status gate that fails Vercel deploys on pending migrations

Touches: prisma/schema.prisma, prisma/migrations/<new>/migration.sql, src/lib/db.ts (SCOPED_MODELS), src/lib/program.ts:44,90, src/lib/export-data.ts:94, scripts/founder-cutover.ts:77, scripts/verify-no-null-userid.ts:78, scripts/verify-tenant-isolation-full.ts:169,440, prisma/seed.ts:22-31 (deleted)

### Founder-history coverage-verify script (legacy Program fallback audit)
*P1 - High · Medium* — De-risks the fallback-branch deletion (story 3) and the M1 rename by proving every past founder date already resolves via Plan-based pickProgramForDate candidates without ever touching the legacy Program table — so removing the fallback later can't silently regress a historical day's plan/override lookup.

Acceptance criteria:
- Script walks every calendar date from the founder's earliest logged activity (or earliest Plan.startedOn) through today, in USER_TZ dateKeys.
- For each date, the script computes coverage via the SAME production code path (calls getPlanWindowCandidates() + pickProgramForDate() from src/lib/program.ts, not a reimplementation) and records whether the winning ProgramForDate came from a real Plan candidate vs the legacy Program-table fallback, using the same id-membership signal pickProgramForDate's SMOKE-1 doc comment describes (activeProgram.id absent from candidates).
- Reports a clear PASS ('N/N dates resolve via Plan candidates, zero legacy fallback hits') or FAIL listing every regressing date with its resolved program id and source.
- Script is read-only (no writes), runnable via `npx tsx scripts/<name>.ts`, and follows the existing verification-script conventions (db:which target awareness; no db:migrate/db:push required to run it).
- A unit test covers the pure date-iteration + fallback-detection logic independent of a live DB, using a fixture with a synthetic legacy-only date to prove the detector flags it correctly.
- Script exits non-zero on any FAIL so it can gate the manual pre-deletion check for story 3.
- PR description or a short docs note records this script as the required pre-check before running the 'Delete legacy Program fallback branch' story.

Touches: scripts/verify-program-coverage.ts (new), src/lib/program.ts (read-only: getActiveProgram, getProgramForDate, pickProgramForDate, getPlanWindowCandidates), scripts/verify-program-coverage.test.ts (new, pure-logic unit test)

### Delete legacy Program fallback branch from getActiveProgram/getMostRecentProgram
*P1 - High · Medium* — Kills the shadowing bug class at its root: once founder history is proven to resolve entirely from Plan candidates, the dead legacy-table read path (and pickProgramForDate's SMOKE-1 special-casing built to compensate for it) can be deleted so there is exactly one program-resolution code path.

Acceptance criteria:
- Gate: the coverage-verify script from story 1 reports zero legacy-fallback hits across founder history immediately before this story starts (linked/quoted in the PR description); if it doesn't, a covering-archived-Plan backfill lands first and the script is re-run clean before proceeding.
- getActiveProgram() and getMostRecentProgram() in src/lib/program.ts no longer query db.legacyProgram — the fallback branch is removed; both now return null (not a legacy snapshot) when no active/any Plan row exists.
- pickProgramForDate's SMOKE-1 legacy-fallback branch (the isLegacyFallback check and its covering-candidate override) is removed as dead code once verified unreachable (activeProgram can no longer be legacy-sourced); its doc comment block is deleted or rewritten to match the simplified contract.
- Existing tests updated in place (not bulk-deleted) to drop legacy-Program fixtures/mocks and assert the new null-on-empty behavior: src/lib/program.test.ts and any of goal-assay-core.test.ts, goal-completion-core.test.ts, goal-story.test.ts, goal-focus.test.ts, recap.test.ts that exercise the legacy fallback.
- npm run test, npx tsc --noEmit, and npm run lint all pass.
- grep confirms no remaining application code path reads db.legacyProgram outside scripts explicitly kept for data archaeology/audit (any such exception is called out by name in the PR description).
- Founder's Today page, calendar, and character page manually spot-checked (or covered by existing E2E/game-engine tests) to confirm unchanged behavior after the branch removal.

Depends on: Founder-history coverage-verify script (legacy Program fallback audit); Rename legacy Program table + call-site sweep (M1)

Touches: src/lib/program.ts (getActiveProgram, getMostRecentProgram, pickProgramForDate), src/lib/program.test.ts, src/lib/goal-assay-core.test.ts, src/lib/goal-completion-core.test.ts, src/lib/goal-story.test.ts, src/lib/goal-focus.test.ts, src/lib/recap.test.ts

### B4c: append-to-existing-meal vs new-meal choice on same-slot log
*P2 - Medium · Medium* — Today there is no append-vs-new affordance: logging a second item for a meal slot that already has an entry silently creates a duplicate meal row instead of offering to add to the existing one, fragmenting a single real meal into multiple NutritionLog rows and skewing daily totals presentation.

Acceptance criteria:
- Renders per approved UX mockups where layout/copy is research-dependent
- When a user logs a new item into a meal slot (breakfast/lunch/dinner/snack) that already has a NutritionLog entry for that date, they are prompted to choose: append to the existing meal (adds items to it, using the existing nutrition-log two-edit-paths care — update_nutrition keeps items+macros in sync, so append must go through that path, not the items[]-only nutrition_log_ops path) or create a new separate meal entry
- Choice UI works at both entry points added in B4a/B4b (MealComposer create mode and the new /days/[dateKey] entry point)
- Appending correctly recomputes and persists combined macros (no desync between logged items and totals)
- Creating new (declining append) behaves exactly as today's create flow
- Renders at 390px, hydration-clean
- `npm run test` (nutrition tests) and `npm run build` green; test covers both the append path (macro totals correct) and the new-meal path

Depends on: B4a: surface the hidden date/time control in MealComposer create mode; B4b: manual nutrition log entry point on /days/[dateKey]

Touches: src/components/MealComposer.tsx, src/components/NutritionToday.tsx, src/lib/nutrition.ts

## Sprint 3 - Additive schema  →  board: **Sprint 16 - Additive schema**  (8 stories)

### Program model, programId columns, and isolation coverage
*P0 - Critical · Medium* — Lays the foundation table for the whole redesign (Program owns window + membership) plus the FK columns that will let Goal/Plan join it in Sprint 4, without anything reading it yet. Getting the DB-enforced one-active-program invariant and tenant scoping right here means Sprint 4's seam flip has zero schema risk left to resolve.

Acceptance criteria:
- New Program model added to prisma/schema.prisma: name String, status String (draft|active|completed|archived), startedOn DateTime, endsOn DateTime?, notes String?, userId String?, createdAt/updatedAt; @@index([userId,status]), @@index([userId,startedOn])
- Migration includes a raw SQL partial unique index CREATE UNIQUE INDEX ... ON "Program"("userId") WHERE status='active' (DB-enforced, not just app-level)
- Goal.programId String? and Plan.programId String? added, FK to Program with onDelete: SetNull, both indexed
- User model carries two distinct relation array field names (one for the Sprint-2-renamed LegacyProgram, one for the new Program) — npx prisma generate succeeds with no ambiguous-relation errors
- prisma migrate diff (or manual SQL review) confirms the migration is purely additive: no DROP/ALTER against existing columns or tables
- npx prisma generate and npx tsc --noEmit both run clean
- Program is added to SCOPED_MODELS in src/lib/db.ts in the same commit
- npm run db:verify-owned and npm run db:verify-isolation both pass green against the dev DB after the migration
- Grep confirms zero application-code references to Program/programId outside schema/migration/verifier files — nothing reads it yet by design (Sprint 4 territory)

Touches: prisma/schema.prisma, prisma/migrations/<new>/migration.sql, src/lib/db.ts, scripts/verify-no-null-userid.ts, scripts/verify-tenant-isolation-full.ts

### ActivityGoalLink model + isolation coverage
*P0 - Critical · Medium* — The polymorphic join table that will let a single logged activity (workout, hike, meal, metric) fan out to multiple goals. Shipping it now, empty, lets the delete-hook consolidation story wire cleanup against a table with zero rows to retrofit, and lets Sprint 4's auto-link engine start writing to a table that's already isolation-audited.

Acceptance criteria:
- New ActivityGoalLink model added: activityType String, activityId String, goalId String (FK to Goal, onDelete: Cascade), source String (auto|explicit), note String?, activityDate DateTime, userId String?, createdAt/updatedAt
- @@unique([activityType, activityId, goalId]); @@index([userId, goalId]); @@index([userId, activityType, activityId]); @@index([activityDate]) for the future orphan verifier and history filters
- No FK to the underlying activity row (Workout/Hike/Measurement/NutritionLog/LogEntry/Baseline) since it's polymorphic — a schema comment documents that delete-hooks (this sprint) plus the nightly orphan verifier (this sprint) compensate for the missing referential integrity
- Migration is additive only; prisma migrate diff shows no destructive ops and composes cleanly with the Program migration from the sibling story
- ActivityGoalLink added to SCOPED_MODELS in src/lib/db.ts in the same commit
- npm run db:verify-owned and npm run db:verify-isolation both pass green
- npx prisma generate and npx tsc --noEmit run clean
- Grep confirms nothing in application code creates or reads ActivityGoalLink rows yet — writes are introduced by the delete-hook-consolidation story (cleanup only) and the auto-link engine ships in Sprint 4

Touches: prisma/schema.prisma, prisma/migrations/<new>/migration.sql, src/lib/db.ts

### Consolidate un-cored delete call sites + hook ActivityGoalLink cleanup
*P0 - Critical · Large* — Today only Workout has a shared delete core (deleteWorkoutCore); Hike, Measurement, Nutrition, Baseline, and LogEntry each delete inline, and Baseline/LogEntry each have two divergent delete paths (dashboard vs MCP). Consolidating into shared cores now, while ActivityGoalLink is still empty, means every delete path already cleans up links before Sprint 4's auto-link engine starts populating the table at scale — cheaper than retrofitting live orphan data later.

Acceptance criteria:
- Grep enumeration re-verified before building and included in the PR description: Workout (src/lib/workout-core.ts deleteWorkoutCore, already cored), Hike (inline delete in src/lib/mcp/tools.ts ~4109-4131), Measurement (inline delete in src/lib/mcp/tools.ts ~4071-4083), Nutrition (inline delete in src/lib/mcp/tools.ts ~3303-3316), Baseline (two paths: src/lib/workout-actions.ts deleteBaselineRow ~174-177, and MCP delete_baseline in src/lib/mcp/tools.ts ~4088-4105), LogEntry (two paths: src/lib/goal-actions.ts deleteMetricReading ~263-272, and MCP delete_metric in src/lib/mcp/tools/project-tools.ts ~648-673) — any newly discovered delete site not in this list is flagged and folded in
- New shared core functions created (matching the deleteWorkoutCore pattern) for Hike, Measurement, Nutrition, Baseline, and LogEntry so each activity type has exactly one delete code path; both the dashboard action and the MCP tool for Baseline and LogEntry call the same core
- deleteWorkoutCore and every new core delete matching ActivityGoalLink rows (by activityType + activityId) alongside the primary delete, best-effort (does not fail the primary delete if link cleanup errors, but logs/surfaces it)
- All existing tool descriptions, return messages, and error semantics are preserved exactly after the refactor: delete_metric's P2025-to-friendly-error mapping, delete_baseline's workout-sync side effect (removeBaselineFromDayWorkout), delete_hike's orphanedOverrideWarning, delete_measurement's response shape
- Full npm run test suite green, including all existing tests covering these six delete paths
- No user-visible or API-visible behavior change — pure internal consolidation; verified by re-running each delete tool/action's existing tests plus a manual smoke per docs/project-gotchas.md
- No schema change in this story — it only depends on the ActivityGoalLink table already existing to write cleanup deletes against

Depends on: ActivityGoalLink model + isolation coverage

Touches: src/lib/workout-core.ts, src/lib/mcp/tools.ts, src/lib/mcp/tools/project-tools.ts, src/lib/workout-actions.ts, src/lib/goal-actions.ts

### UX research pass for Program views (unified Today, /program dashboard, cross-goal calendar, /progress, SavedMeal quick-pick)
*P0 - Critical · Medium* — so that the five Sprint 6 stories that ship 'per approved UX mockups' actually have mockups to build against — the pass runs in parallel with Sprints 3-5 and gates Sprint 6's start

Acceptance criteria:
- Mockups (option sketches + one chosen direction) produced for: the unified Today timeline's per-item multi-goal chip treatment (no-repeat-shared-activity case); the /program dashboard's member-goal readiness card + sparkline + phase-progress layout; the cross-goal calendar's multi-pin-per-day treatment; the /progress per-goal arc layout; the SavedMeal quick-pick UI
- All mockups validated at 390px mobile width first (mobile-first per CLAUDE.md convention)
- Grounded in the existing legend/color/icon machinery — new UI does not invent a second color system for goals
- Explicitly resolves the 'shared activity must not repeat' hard constraint from RFC §7 sign-off with a concrete chip/badge design
- Owner sign-off recorded before any Sprint 6 implementation story starts
- Runs in parallel with Sprints 3-5 — does not block schema/seam work, only gates Sprint 6's start

Touches: docs/program-redesign/ux-mockups/ (new), src/lib/legend.ts (read-only reference)

### Nightly ActivityGoalLink orphan verifier script
*P1 - High · Small* — Safety net for the polymorphic, FK-less ActivityGoalLink table — catches drift the delete-hooks miss (rows removed outside the app, edge cases in the consolidation, future code that forgets the hook) before Sprint 4 turns the table into something read at scale.

Acceptance criteria:
- scripts/verify-activity-links.ts created following the existing verifier pattern (scripts/verify-tenant-isolation-full.ts, scripts/verify-no-null-userid.ts): read-only, prints the target DB host via the same db-guard convention, exits non-zero when it finds orphans
- For each ActivityGoalLink row, dispatches on activityType to check the referenced row still exists (workout/hike/measurement/nutritionLog/logEntry/baseline); reports orphans grouped by activityType with activityId, goalId, userId, activityDate
- Script wired as an npm script (e.g. db:verify-activity-links) documented alongside the other db:verify-* scripts in package.json
- Runs clean (zero orphans) against the dev DB immediately after the delete-hook-consolidation story lands, since every write path now covers cleanup and the table starts empty
- Script is strictly report-only — does not delete or mutate rows; actual nightly cron scheduling is out of scope for this story (Sprint 4+ concern), this story ships the verifier itself
- A test or dry-run smoke seeds one ActivityGoalLink row pointing at a nonexistent activityId and asserts the script flags it

Depends on: ActivityGoalLink model + isolation coverage

Touches: scripts/verify-activity-links.ts, package.json

### WriteReceipt model + idempotent requestId param on write tools
*P1 - High · Large* — Gives the coach (and retries from network hiccups on claude.ai's MCP transport) safe replay semantics on the highest-frequency write tools, without changing behavior for any caller that doesn't opt in by passing a requestId.

Acceptance criteria:
- New WriteReceipt model: userId, requestId, toolName, resultJson Json, createdAt; @@unique([userId, requestId]); @@index([userId, toolName, createdAt]) for future GC
- Migration additive only; prisma migrate diff shows no destructive ops
- WriteReceipt added to SCOPED_MODELS in src/lib/db.ts in the same commit; npm run db:verify-owned and db:verify-isolation pass
- Shared tool-helper (e.g. src/lib/mcp/write-receipt.ts) wraps a tool handler: given an optional requestId, first call executes normally and stores {userId, requestId, toolName, resultJson}; a repeat call with the same requestId returns the stored resultJson without re-executing the write
- Optional requestId Zod param threaded through log_workout, log_note, log_nutrition, workout_ops, batch_log_note, and batch_log_nutrition — param is optional; omitting it preserves today's non-idempotent behavior byte-for-byte
- New unit tests: calling one of the six tools twice with the same requestId produces exactly one underlying write and returns an identical result both times; a different or omitted requestId still produces two writes (regression guard)
- All existing tests for these six tools pass unmodified where they don't pass requestId
- Tool descriptions for the six tools updated to document the optional requestId replay behavior
- Release note: claude.ai connector must be reconnected after deploy (tool input schemas change)

Touches: prisma/schema.prisma, prisma/migrations/<new>/migration.sql, src/lib/db.ts, src/lib/mcp/write-receipt.ts, src/lib/mcp/tools.ts, src/lib/mcp/tools/project-tools.ts

### SavedMeal model + save_meal/list_saved_meals tools + log_nutrition(savedMealId, servings)
*P1 - High · Medium* — Lets the coach or user save a frequently-eaten meal once and re-log it by reference, cutting repeated macro entry. Also gives Sprint 6's SavedMeal quick-pick UI a schema and API to build against.

Acceptance criteria:
- New SavedMeal model: name String, items Json, macros Json?, defaultServings Float, userId, createdAt/updatedAt; migration additive only with no destructive ops
- SavedMeal added to SCOPED_MODELS in the same commit; npm run db:verify-owned and db:verify-isolation pass
- New MCP write tool save_meal{name, items, macros?, defaultServings} creates a SavedMeal scoped to the caller via getDb()
- New MCP read tool list_saved_meals{} returns the caller's saved meals (id, name, items, macros, defaultServings) scoped by tenant
- Leaky-reads coverage added in src/lib/mcp/leaky-reads.test.ts for list_saved_meals confirming it never returns another user's rows and carries no private note-type payloads
- log_nutrition gains optional savedMealId and servings params: when savedMealId is supplied, items/macros are derived by scaling the SavedMeal's stored items/macros by servings ÷ defaultServings; any items/macros explicitly passed in the same call take precedence over the derived values (documented in the tool description); omitting both params leaves existing log_nutrition behavior unchanged
- Zod/friendly-error validation: save_meal rejects an empty name; log_nutrition with an unknown savedMealId returns a friendly not-found error, not a raw Prisma exception
- Unit tests: save_meal then list_saved_meals round-trips correctly; log_nutrition with savedMealId+servings produces correctly scaled macros; log_nutrition without savedMealId is unaffected (regression)
- PR description includes the connector-reconnect note (tool-surface change — claude.ai MCP connector caches the tool list and needs reconnecting after deploy)
- Appends the new/changed tool signatures to docs/program-redesign/TOOL-DIFFS.md

Touches: prisma/schema.prisma, prisma/migrations/<new>/migration.sql, src/lib/db.ts, src/lib/mcp/tools.ts, src/lib/mcp/leaky-reads.test.ts

### Baseline.capped column + log_baseline/update_baseline param + display marker
*P2 - Medium · Small* — Flags a baseline test result as capped by equipment or test protocol (e.g. a rep counter maxing out) so records and chart displays can show it's a floor rather than the athlete's true max, without letting an artificially bounded number distort PR/records math.

Acceptance criteria:
- Baseline.capped Boolean @default(false) column added; migration additive only, default backfills existing rows to false, no destructive ops
- log_baseline gains an optional capped boolean param (default false); update_baseline gains an optional capped param to toggle it after the fact
- get_baseline_history and get_baseline_schedule (and any dashboard baseline display component, confirmed by grep before building) surface a capped marker wherever the raw value is shown
- readiness.ts and rarity-core.ts are untouched — capped is a display annotation only, never fed into PR/readiness math, preserving the repo's honesty-math purity convention
- records.ts EXERCISE_ALIAS_GROUPS / canonicalization logic is untouched
- Unit tests: logging with capped:true persists and round-trips through update_baseline and the read tools; omitting capped defaults to false and all existing baseline tests are unaffected

Touches: prisma/schema.prisma, prisma/migrations/<new>/migration.sql, src/lib/mcp/tools.ts

## Sprint 4 - Seam flip  →  board: **Sprint 17 - Seam flip**  (11 stories)

### Program-first getActiveProgram + getActiveProgramMembership
*P0 - Critical · Large* — Makes the active Program (when one exists) own the daily rotation while freezing the .id-means-Plan-id contract every downstream planId-keyed caller (PlanDayOverride lookups, calendar.ts, override-integrity.ts) relies on — this is the highest-risk seam in the whole initiative and must not reopen the cross-goal plan-leak bug the redesign exists to fix.

Acceptance criteria:
- getActiveProgram()'s return shape (ActiveProgramSnapshot) and .id semantics (a Plan id, never a Program id) are unchanged for every existing caller/test
- When the user has an active Program row: query becomes plan.findFirst({ where: { active: true, programId: <activeProgram.id> } }); if a matching Plan exists, return its snapshot exactly as today
- When the user has an active Program row but that Program owns no active Plan: getActiveProgram() returns null ('no rotation') — it must NOT fall through to an unscoped cross-goal plan.findFirst({active:true}) query
- The legacy isFocus-tiebreak query (plan.findFirst({active:true}, orderBy isFocus desc) with the Program-table fallback below it) fires ONLY when db.program.count({where:{status:'active'}}) === 0 for the user (zero Program rows) — this is the per-tenant rollout gate and the instant-rollback mechanism (archiving the Program row reactivates it)
- New regression test: user has an active Program with a plan-less member goal (attached, no Plan row) plus an unrelated active Plan on a goal NOT attached to that Program — getActiveProgram() returns null, the dormant unrelated Plan never surfaces
- New regression test mirrors the chewgether shape: active Program, zero Plans anywhere for the user — returns null, no error, no fallback to isFocus-tiebreak
- getMostRecentProgram() and the S3 time-aware layer (pickProgramForDate, getPlanWindowCandidates, getProgramForDate, coversDayKey) are untouched by this story — Program-awareness there is out of scope until a later sprint if ever
- New getActiveProgramMembership(): Promise<{ id, name, status, startedOn, endsOn, memberGoals: { id, objective, kind }[] } | null> — returns null when the user has no active Program row; the Program's own id lives ONLY here, never leaking into ActiveProgramSnapshot.id
- ActiveProgramSnapshot's shape does not grow a new field for the Program id or membership — game/engine.ts stays decoupled from Program concepts (per plan §4.2)
- All ~6 existing planId-keyed call sites (calendar.ts PlanDayOverride lookups, weekConflicts, override-integrity.ts) pass unmodified against the new getActiveProgram() with zero Program rows present (no regression for pre-Program tenants)

Depends on: Program model, programId columns, and isolation coverage; ActivityGoalLink model + isolation coverage

Touches: src/lib/program.ts, src/lib/program.test.ts

### set_active_goal Program-aware compat shim + COACH_INSTRUCTIONS/description sync
*P0 - Critical · Medium* — Prevents the coach from silently deactivating an entire multi-goal Program when it thinks it's doing an ordinary single-goal focus switch — the new blast radius introduced by the one-active-Program-per-user constraint has to be documented everywhere the old, narrower behavior was documented, in the same PR, or the coach will give the user wrong expectations.

Acceptance criteria:
- set_active_goal's implementation (project-tools.ts:764-802, setFocusGoalCore) is updated so that switching focus to a goal belonging to a DIFFERENT Program than the user's current active Program deactivates the whole current Program (not just clears isFocus on its member goals) — exact mechanism (e.g. flipping Program.status or clearing the 'active' designation) matches whatever set_program_status already implements, reused rather than duplicated
- Switching focus to a goal with no Program (or within the SAME currently-active Program) does not affect Program state at all — behavior is byte-identical to today for pre-Program tenants and for same-Program switches
- set_active_goal's tool description (project-tools.ts) is updated in this same PR to state the new blast radius in plain language, matching the verbatim-phrasing / explicit-do-not style used elsewhere in the tool surface
- COACH_INSTRUCTIONS (src/lib/mcp/instructions.ts) 'set_active_goal switches which goal is active/focus...' line is updated in this SAME PR to mention that switching across Programs deactivates the whole current Program — per the three-places-rule gotcha (docs/project-gotchas.md §B.6): change goaldmine-rules.md, COACH_INSTRUCTIONS, and the deployed connector-text reminder together
- docs/server-instructions/goaldmine-rules.md is updated in the same PR (three-places rule, second of three locations)
- In passing, per the plan's explicit scope note: set_plan_active's tool description (tools.ts:5656-5667) and create_goal's tool description are corrected where they contain stale claims (e.g. set_plan_active's description currently says '(focus-switching is app-UI only — no MCP tool exists)' which is false now that set_active_goal exists as an MCP tool) — fix identified stale text, do not do a broader audit
- Unit test: setFocusGoalCore switching within the same Program leaves Program.status untouched; switching to a goal in a different (or no) Program deactivates the prior Program; switching when the user has no Program at all is a no-op on Program state
- A reminder note (matching the existing 'connector cache' gotcha pattern) is added to the PR description or a docs file that claude.ai's connector must be reconnected after this deploy since tool descriptions changed
- Appends the set_active_goal semantic diff to docs/program-redesign/TOOL-DIFFS.md

Depends on: Program MCP tool pack — CRUD + status (create_program, update_program, set_program_status); Program-first getActiveProgram + getActiveProgramMembership

Touches: src/lib/mcp/tools/project-tools.ts, src/lib/mcp/tools.ts, src/lib/mcp/instructions.ts, docs/server-instructions/goaldmine-rules.md, src/lib/goal-core.ts

### Backend acceptance slice: Program-first seam output assertions
*P0 - Critical · Medium* — Pulls forward (from Sprint 5) a backend-only test proving the seam actually produces the right raw output for both the founder's real multi-goal shape and the pure-project no-Plan shape, so the riskiest sprint in the initiative ships with its own regression net instead of waiting for the payload-visibility work to expose bugs indirectly.

Acceptance criteria:
- New vitest suite (e.g. src/lib/program.acceptance.test.ts) asserts RAW getActiveProgram() and getActiveProgramMembership() output — not payload/UI-shaped output — for the Phase 2A three-goal fixture: handstand goal (owns rotation, has active Plan with programId set), cut goal (member, no own Plan), AWS SAA goal (member, no own Plan); asserts getActiveProgram() returns the handstand goal's Plan snapshot and getActiveProgramMembership() lists all three goals
- Second fixture/test: chewgether-style Program (status='active', one project-kind member goal, zero Plan rows anywhere for that Program) — asserts getActiveProgram() returns null ('no rotation') and getActiveProgramMembership() still returns the Program shape with its member goal listed
- Third fixture/test (regression from plan critique Critical #1): active Program + a plan-less member goal + an unrelated active Plan belonging to a goal NOT in the Program — asserts getActiveProgram() returns null and never surfaces the unrelated dormant Plan
- Fourth fixture/test: zero Program rows for the user — asserts getActiveProgram() falls through to the legacy isFocus-tiebreak path unchanged (proves the rollout gate)
- This suite explicitly does NOT assert on get_today_plan/get_day/get_week/get_session_brief payload shape — those merges are Sprint 5 scope; asserting payload-visibility here would violate the sprint boundary
- Suite runs against the same getDb()-scoped test harness pattern already used by db.scoped.test.ts / leaky-reads.test.ts (mocked or test-branch Prisma, matching existing conventions in the repo rather than inventing a new fixture style)
- All four scenarios are independently runnable and named clearly enough that a future Sprint 5 dev can extend them into the full §3 acceptance E2E without rewriting the fixtures

Depends on: Program-first getActiveProgram + getActiveProgramMembership; Founder Phase 2A Program backfill script

Touches: src/lib/program.acceptance.test.ts, src/lib/program.ts

### Auto-link engine v1a: workout exercise-hint matching (createWorkoutCore + baseline-mirror hooks)
*P0 - Critical · Medium* — so the highest-volume activity type gets append-only attribution links and the shared attribution contract (source=auto/explicit, idempotency) exists for v1b/v1c to reuse

Acceptance criteria:
- New src/lib/attribution.ts pure hint-matching function (canonicalExerciseName ∩ canonicalized attributionHints), unit-tested with no DB
- createWorkoutCore hooked: matching member goals get source='auto' links
- appendBaselineToDayWorkout hooked the same way (bypasses createWorkoutCore — gotcha §E.2)
- Idempotent via @@unique([activityType, activityId, goalId])
- Explicit-beats-auto: existing explicit links are never downgraded
- No hook fires with zero active Program
- readiness.ts/rarity-core.ts/goal-targets.ts confirmed uncalled by the new hooks
- Tests: match/no-match/baseline-mirror/duplicate-write

Depends on: Program model, programId columns, and isolation coverage; ActivityGoalLink model + isolation coverage; Consolidate un-cored delete call sites + hook ActivityGoalLink cleanup; Program-first getActiveProgram + getActiveProgramMembership

Touches: src/lib/attribution.ts, src/lib/attribution.test.ts, src/lib/workout-core.ts, src/lib/baseline-workout.ts

### Program MCP tool pack — CRUD + status (create_program, update_program, set_program_status)
*P0 - Critical · Medium* — so the coach can manage the Program lifecycle from claude.ai, with the one-active-Program invariant enforced with a friendly error

Acceptance criteria:
- src/lib/mcp/tools/program-tools.ts registers create_program, update_program, set_program_status; wired into tools.ts
- create_program{name, startedOn, endsOn?, notes?} — status defaults to draft
- update_program{id, name?, startedOn?, endsOn?, notes?} updates only supplied fields, tenant-scoped
- set_program_status{id, status} rejects a second concurrent 'active' with a clean, descriptive error naming the current active Program (not a raw Postgres unique-violation)
- Zod validates ids + status enum; dates go through parseDateInput (USER_TZ)
- Tool descriptions follow the list_planned_hikes pattern (mental-model hook, verbatim phrasings, explicit do-nots)
- Unit tests: one-active enforcement, create/update round trip
- Appends the new tool signatures to docs/program-redesign/TOOL-DIFFS.md
- Release note: claude.ai connector reconnect after deploy
- Appends the new tool signatures to docs/program-redesign/TOOL-DIFFS.md

Depends on: Program model, programId columns, and isolation coverage; ActivityGoalLink model + isolation coverage

Touches: src/lib/mcp/tools/program-tools.ts, src/lib/mcp/tools.ts, src/lib/program-core.ts

### Program MCP tool pack — membership + overview (attach/detach_goal, attach_plan_to_program, get_program_overview)
*P0 - Critical · Medium* — so membership management and the program overview read exist for the founder backfill and /program dashboard to consume

Acceptance criteria:
- attach_goal_to_program rejects achieved goals (R9) with the reason stated in the tool description itself
- attach_goal_to_program succeeds for active goals of either kind, sets Goal.programId
- detach_goal_from_program clears programId; no-op (not error) when already unset
- attach_plan_to_program sets Plan.programId
- get_program_overview{programId?} returns Program + member goals + hasActivePlan; omitted programId resolves the caller's active Program
- get_program_overview has leaky-reads.test.ts coverage
- Tool descriptions follow the list_planned_hikes pattern; Zod validates ids
- Appends the new tool signatures to docs/program-redesign/TOOL-DIFFS.md
- Release note: claude.ai connector reconnect after deploy
- Appends the new tool signatures to docs/program-redesign/TOOL-DIFFS.md

Depends on: Program MCP tool pack — CRUD + status (create_program, update_program, set_program_status)

Touches: src/lib/mcp/tools/program-tools.ts, src/lib/mcp/tools.ts, src/lib/mcp/leaky-reads.test.ts, src/lib/program-core.ts

### attribute_activity + list_activity_links MCP tools
*P1 - High · Medium* — Lets the coach explicitly attribute a logged activity to a goal (or remove a mislinked one) and inspect the link history for a goal — the manual override valve on top of the auto-link engine, and the only way to see what got auto-attributed.

Acceptance criteria:
- attribute_activity{activityType, activityId, goalId, action: 'add'|'remove', note?} is registered in the program-tools (or a dedicated attribution-tools) pack
- action='add' creates or upserts a source='explicit' ActivityGoalLink; if an auto link already exists for the same (activityType, activityId, goalId), it is overwritten/upgraded to source='explicit' (explicit-beats-auto) rather than duplicated
- action='remove' deletes the link for (activityType, activityId, goalId) regardless of its source (explicit or auto) — matches the plan's 'remove always wins' v1 semantics
- attribute_activity validates activityType against the known polymorphic set (workout|hike|logEntry|nutritionLog, matching whatever the schema's activityType enum/string values are) and returns a clear error for an unknown type or a non-existent activityId
- list_activity_links{goalId?, activityType?, from?, to?} filters on the link's activityDate column (yyyy-mm-dd bounds), NOT createdAt — this was plan critique finding #9: filtering on createdAt would break retroactive explicit attribution of an old activity
- list_activity_links has leaky-reads.test.ts coverage
- Both tool descriptions follow the list_planned_hikes pattern (mental-model hook, verbatim phrasings, explicit do-nots — e.g. attribute_activity's description states remove always wins over source, regardless of who/what created the link)
- Unit/integration test: explicit add on top of an existing auto link upgrades source without creating a second row (still satisfies the unique constraint); remove deletes an explicit link just as readily as an auto one
- Appends the new tool signatures to docs/program-redesign/TOOL-DIFFS.md

Depends on: Program model, programId columns, and isolation coverage; ActivityGoalLink model + isolation coverage; Auto-link engine v1a: workout exercise-hint matching (createWorkoutCore + baseline-mirror hooks); Program MCP tool pack — CRUD + status (create_program, update_program, set_program_status)

Touches: src/lib/mcp/tools/program-tools.ts, src/lib/mcp/tools.ts, src/lib/mcp/leaky-reads.test.ts, src/lib/attribution.ts

### Founder Phase 2A Program backfill script
*P1 - High · Medium* — Migrates the founder's real three-goal setup (handstand owning rotation, cut, AWS SAA) onto the new Program model without disrupting the live Today page, and gives every future dev an instantly reversible rollback if the seam misbehaves in production.

Acceptance criteria:
- scripts/founder-program-backfill.ts creates one Program row for the founder (status='active', startedOn matching the current rotation's start) via the guarded db access pattern used by other scripts/ (e.g. db-guard.ts --assert, refuses non-development DB_ENV without ALLOW_PROD_DB_WRITE)
- Script attaches the founder's three goals (handstand, cut, AWS SAA) to the new Program per the owner's explicit instruction/mapping (hardcoded or config-driven list of goalId→role, not inferred)
- Script sets Plan.programId on the rotation-owning goal's active Plan AND explicitly asserts afterward (re-read + throw if null) that it was persisted — plan critique / architecture doc calls out that forgetting this specific assertion is the exact failure mode that silently falls through while isFocus is still populated, masking the bug
- Script is idempotent or clearly fails loud on re-run against an already-backfilled state (no duplicate Program rows, no duplicate goal attachment)
- Script prints a summary of what it did (Program id, attached goal ids/objectives, Plan.programId set) for manual verification before/after
- Rollback path is documented and trivial: archiving the Program row (set_program_status to 'archived', or a direct script flag) causes getActiveProgram() to fall back to the pre-existing isFocus-tiebreak path with zero other changes needed — this must be true given the zero-Program-rows fallback gate is keyed on status='active' count, so archiving must actually flip that count to zero
- Running the script against a fresh dev-branch seed (matching the founder's current Goal/Plan state) leaves the Today page's resolved plan byte-identical to pre-backfill output (spot-checked via a script-level assertion or companion test, not just eyeballing)
- Script explicitly does NOT touch achieved goals or their snapshots (R9 non-goal)

Depends on: Program-first getActiveProgram + getActiveProgramMembership; Program MCP tool pack — membership + overview (attach/detach_goal, attach_plan_to_program, get_program_overview)

Touches: scripts/founder-program-backfill.ts, docs/roadmap/founder-cutover-runbook.md

### Attach Chewgether to a pure-project Program in dev seed + retire stale isFocus seed comments
*P1 - High · Small* — so that driving vertical #2 (a pure-project Program with no Plan) exists as a live, reachable dev-DB fixture instead of only a unit-test fixture — the DA's Critical #1 scenario becomes checkable by hand

Acceptance criteria:
- prisma/seed-chewgether.ts creates (or attaches, idempotently) a status='active' Program with zero Plan rows and attaches the Chewgether goal via Goal.programId
- The stale isFocus comment block is corrected: isFocus is legacy/display-only; non-interference is guaranteed by Program membership or the zero-Program-rows fallback
- Running against a dev DB that already has the founder's Phase 2A Program produces two independent active Programs (different userId) without violating the partial unique index
- After running, get_today_plan for the Chewgether-seeded user renders 'no rotation today' — not an error, not a leak of another goal's plan
- .claude/skills/seed-data/SKILL.md updated if provisioning steps change
- No schema change; script-only

Depends on: Program MCP tool pack — membership + overview (attach/detach_goal, attach_plan_to_program, get_program_overview); Program-first getActiveProgram + getActiveProgramMembership

Touches: prisma/seed-chewgether.ts, .claude/skills/seed-data/SKILL.md

### Auto-link engine v1b: Hike/LogEntry mirror-linking
*P1 - High · Small* — so hikes and project log entries appear in the same link table other activities use for badging, while Hike.goalId/LogEntry.goalId stay authoritative

Acceptance criteria:
- Hike creation writes a mirror link; Hike.goalId stays authoritative
- LogEntry creation writes a mirror link the same way
- Idempotent via the unique constraint
- No hook fires with zero active Program
- Tests: hike mirror, logEntry mirror, duplicate-write no-op

Depends on: Program model, programId columns, and isolation coverage; ActivityGoalLink model + isolation coverage; Auto-link engine v1a: workout exercise-hint matching (createWorkoutCore + baseline-mirror hooks)

Touches: src/lib/attribution.ts, src/lib/hike-core.ts, src/lib/mcp/tools/project-tools.ts

### Auto-link engine v1c: fitness-only NutritionLog auto-linking
*P1 - High · Small* — so a logged meal auto-links only to fitness-kind member goals and append-only v1 never permanently attaches meals to a project goal

Acceptance criteria:
- Nutrition write hook creates links only where Goal.kind === 'fitness'
- Never links to a project-kind member goal
- Idempotent via the unique constraint
- No hook fires with zero active Program
- Tests: fitness-kind links, project-kind doesn't, duplicate-write no-op

Depends on: Program model, programId columns, and isolation coverage; ActivityGoalLink model + isolation coverage; Auto-link engine v1a: workout exercise-hint matching (createWorkoutCore + baseline-mirror hooks)

Touches: src/lib/attribution.ts, src/lib/mcp/tools.ts (log_nutrition hook)

## Sprint 5 - Program-shaped day  →  board: **Sprint 18 - Program-shaped day**  (6 stories)

### resolveDay gains program + scheduledItemsToday (union across member goals)
*P0 - Critical · Medium* — The merged day is only real once resolveDay itself carries it. Today every read tool derives from resolveDay's ResolvedDay; adding program-shaped context here (once) is what lets get_today_plan/get_day/get_week/get_session_brief all merge for free in the next story instead of each re-deriving membership independently and drifting.

Acceptance criteria:
- ResolvedDay gains two NEW keys: `program: { id, name, memberGoals: [{ id, objective, kind, servesToday: string[] }] } | null` (from getActiveProgramMembership()) and `scheduledItemsToday: { id, type, title, status, completedAt, goalId }[]` (union of today's ScheduledItem rows across every memberGoals[].id, not just the rotation-owning goal)
- the existing `resolvedPlan` key (id/name/source) is untouched byte-for-byte — same shape, same population rules, same call sites reading it
- `program` is null when getActiveProgramMembership() returns null (no active Program row) — resolveDay does not synthesize a fake program from the legacy isFocus path
- scheduledItemsToday is [] (not omitted) when program is null or has zero member goals with items today, consistent with ResolvedDay's existing 'always-present, never omitted' convention (see workouts/loggedNutrition/baselinesDue)
- each scheduledItemsToday row carries its owning goalId so a badge can be rendered without a second lookup, per RFC D5 point 2
- the membership lookup (getActiveProgramMembership) is added to resolveDay's existing internal Promise.all rather than issued as a serial await, OR accepted via an optional ResolveDayCtx field for callers (get_week, the month view) that already batch-fetch context for a range and want to avoid N redundant Program queries — mirrors the existing ResolveDayCtx pattern used for otherGoalEvents/crossGoalConflicts
- unit tests in calendar.test.ts: program populated with correct memberGoals + servesToday for a Phase-2A-shaped fixture (rotation-owning goal + two non-rotation members); scheduledItemsToday unions items from a member goal that owns no Plan; program null + scheduledItemsToday [] for a user with zero Program rows (legacy-only path); resolvedPlan output byte-identical before/after for existing fixtures (regression guard)
- no readiness.ts / rarity-core.ts imports added to calendar.ts as part of this change (keeps the honesty math pure, per CLAUDE.md)

Depends on: Program-first getActiveProgram + getActiveProgramMembership; Founder Phase 2A Program backfill script

Touches: src/lib/calendar.ts, src/lib/calendar.test.ts, src/lib/program.ts (consumes getActiveProgramMembership from Sprint 4; no changes to its contract)

### get_today_plan: today-shapers.ts becomes a merger, project-branch nuller dies
*P0 - Critical · Large* — This is the payload the coach actually reads at session start. Today it's a fork — fitness XOR project, decided by focusGoal.kind — so a day where the rotation-owning goal is fitness but a project member goal (AWS) has work due is invisible. Merging fixes the founder's actual Monday (walk + AWS study) and removes the isInPlan/confidence leak the RFC calls out (a project-focus day was showing an unrelated fitness plan's window).

Acceptance criteria:
- today-shapers.ts's `shapeProjectTodayPayload` (the nuller that zeroes every fitness field when focusGoal.kind==='project') is replaced by a merge function that keeps resolveDay's rotation prescription (activeWorkout/nutrition/baselines/etc., possibly null if no Plan) AND adds the program-shaped fields (program, scheduledItemsToday, per-goal todayItems/feasibility sections) — the project/fitness dichotomy described in RFC D5 point 3 dissolves
- get_today_plan's handler no longer branches on `activeGoalRow?.kind === 'project'` to pick a payload shape; it calls the single merger for every case (program-with-plan, program-without-plan i.e. chewgether's 'no rotation today', and the pre-Program legacy fallback)
- isInPlan and confidence reflect the actual resolved plan window (or null/'past' when there is none) on every call — they no longer leak an unrelated plan's isInPlan/confidence on a day where the focus goal is project-kind and some other goal happens to have an active Plan (the RFC-cited leak)
- chewgether invariant preserved: an active Program with zero active Plans renders 'no rotation today' (activeWorkout/todayTask null, rotationDay/weekIndex null) and never falls through to an unscoped cross-goal Plan query — explicit regression test for this exact shape (DA #10 from plan-blueprint.md)
- todayItems/feasibility move from focus-goal-only to per-member-goal sections keyed by goalId, sourced from scheduledItemsToday + one feasibility computation per project-kind member goal
- existing today-shapers.test.ts fixtures for the fitness-only and project-only payload shapes are updated (not deleted wholesale) to assert against the new merged shape; new fixtures cover the Phase-2A three-goal merge
- get_today_plan's tool description is updated in the same PR to describe the merged shape instead of the 'project-shaped vs fitness-shaped' branching language (three-places-rule scope: tool description only here; COACH_INSTRUCTIONS update rides the TOOL-DIFFS story)

Depends on: resolveDay gains program + scheduledItemsToday (union across member goals); Program MCP tool pack — CRUD + status (create_program, update_program, set_program_status)

Touches: src/lib/mcp/today-shapers.ts, src/lib/mcp/today-shapers.test.ts, src/lib/mcp/tools.ts (get_today_plan registration + handler, ~lines 556-649)

### get_day, get_week, get_session_brief gain program fields + leaky-reads coverage
*P0 - Critical · Medium* — These three tools currently have NO project awareness at all (analysis §2.4) — get_day on a future date, get_week's 7-day scan, and get_session_brief's session-start context all silently drop member-goal work. They already consume resolveDay, so once ResolvedDay carries program/scheduledItemsToday this is exposing existing data, not inventing new queries.

Acceptance criteria:
- get_day's response includes resolveDay's new `program` and `scheduledItemsToday` fields verbatim (it already spreads most of ResolvedDay) for both past and future dates, consistent with its 'resolve a specific date the same way as get_today_plan' contract
- get_week's per-day array includes program/scheduledItemsToday for each of the 7 days; if get_week batches a shared ctx (candidates/events) across days for performance, the same batching is extended to the membership lookup added in the resolveDay story rather than issuing 7 redundant Program queries
- get_session_brief surfaces a program-membership summary section (member goals + today's cross-goal scheduled items) alongside its existing history/weight-trend/standing-rule/open-items/rarity sections — per its own description ('the rich second call... equivalent routing signal to get_today_plan for fitness session context'), it should not be blind to non-fitness member-goal work the way get_today_plan used to be
- all three tools' descriptions are updated to mention the new fields (feeds the TOOL-DIFFS story; do not skip the description update here waiting for that story)
- leaky-reads.test.ts gains coverage for every Prisma query newly added or newly touched by this story's changes (the membership/scheduledItem queries reached via resolveDay's extension, plus any new query added directly in get_session_brief) — each asserted to pass `omit: { userId: true }` per the existing test pattern in that file
- no change to get_week's existing isInPlan-based 'not covered by any plan' short-circuit (tools.ts ~line 784) beyond what's needed to also carry program context — that logic's existing behavior for plan-covered/uncovered weeks is regression-tested

Depends on: resolveDay gains program + scheduledItemsToday (union across member goals)

Touches: src/lib/mcp/tools.ts (get_day ~line 652, get_week ~line 670, get_session_brief ~line 1425), src/lib/mcp/leaky-reads.test.ts

### Full RFC §3 acceptance E2E: seed Phase 2A, simulate the Monday, assert merged payload + three readiness deltas
*P0 - Critical · Large* — This is the initiative's actual proof of concept, called out by name in both the plan (risk mitigation: 'the pulled-forward backend acceptance slice') and the RFC (§3, 'an end-to-end Vitest... asserts the merged payload + three readiness deltas from one day's logs'). Every other S5 story makes the pieces correct in isolation; this is the only test that proves they compose into the founder's actual use case.

Acceptance criteria:
- seeds a Phase 2A Program: handstand goal owns the rotation (Plan.goalId + Plan.programId set), cut and AWS attached as member goals (Goal.programId set, no Plan of their own)
- handstand and cut goals carry attributionHints that canonicalize to match the exercise name(s) used in the simulated workout log (e.g. a Z2/walk-type hint) — chosen deliberately so the auto-link engine's exercise-name-hint match (Sprint 4 deliverable) actually fires, not just a hint that happens to be present but never matched
- simulates 'the Monday': one Workout logged via the real createWorkoutCore path (zone2/walk), one log_metric call for study_hours attributed to AWS, and a nutrition log for the day — using the actual tool/core functions, not hand-inserted rows, so the auto-link hooks fire exactly as they would in production
- asserts the resulting ActivityGoalLink rows: the Workout auto-links to both cut and handstand (Z2 hint match on each), the LogEntry links natively to AWS (goal-scoped metric, not a hint match)
- calls get_today_plan for that Monday and asserts the merged payload: rotation prescription present (handstand's plan), scheduledItemsToday includes the AWS study block and any cut weigh-in ScheduledItem, program.memberGoals lists all three goals with correct servesToday
- asserts three independent readiness deltas move from that single day's logs with zero new scoring machinery: cut via global weightLb/body-fat inputs, handstand via global baseline:* inputs, AWS via goal-scoped cumulative log:study_hours — each computed through the existing computeReadiness path (byte-identical function, not a duplicate), per CLAUDE.md's readiness-purity rule
- test lives alongside the existing MCP/plan test suite (not a new ad hoc harness) and is added to the standard `npm run test` run; a failure here should read as 'the acceptance case broke', not require re-deriving what it's testing

Depends on: get_today_plan: today-shapers.ts becomes a merger, project-branch nuller dies; get_day, get_week, get_session_brief gain program fields + leaky-reads coverage; Founder Phase 2A Program backfill script; Auto-link engine v1a: workout exercise-hint matching (createWorkoutCore + baseline-mirror hooks); Auto-link engine v1b: Hike/LogEntry mirror-linking

Touches: src/lib/mcp/tools.test.ts or a new e2e-focused test file colocated with the MCP test suite, src/lib/readiness.ts (consumed, not modified — regression guard only), src/lib/records.ts (canonicalExerciseName / attributionHints matching, consumed from Sprint 4's auto-link engine)

### Delete getTodayContext after verifying its two call sites are a strict subset of resolveDay
*P1 - High · Small* — getTodayContext (program.ts:104-143) is a third, independent day-resolver that duplicates rotation-day/week-index/phase math already computed inside resolveDay. The RFC calls it out as one of 'three duplicate resolvers' and requires it deleted once ResolvedDay carries everything its callers need — leaving it live after this sprint would mean two sources of truth for the same rotation math.

Acceptance criteria:
- both getTodayContext call sites in src/app/page.tsx are enumerated and traced: the `ctx.day` summary/title fallback (page.tsx ~line 290/310) and the `ctx.weekIndex`/`ctx.phase` display (page.tsx ~lines 336-337, 385, 437)
- each traced field is shown to be already present on resolveDay's output (weekIndex is already a ResolvedDay field; phase/day-template equivalents are derived and documented as a strict subset before any deletion happens) — written up as a short before/after field-mapping table in the PR description, not just asserted
- page.tsx is rewritten to read the equivalent data from resolveDay's return value instead of calling getTodayContext, with zero visible change to the rendered Today page (same summary text, same week/phase header, same baseline block weekIndex)
- getTodayContext, its TodayContext type export, and the now-unused `getActiveProgram` import in page.tsx (if getActiveProgram itself is no longer needed directly by page.tsx after the rewrite) are deleted from src/lib/program.ts / src/app/page.tsx
- grep for `getTodayContext` and `TodayContext` across src/ returns zero remaining references after the deletion (the doc-comment cross-references in program.ts's other functions that mention it by name are updated, not left dangling)
- a manual or Playwright/vitest snapshot check confirms the Today page's summary text, week/phase header, and BaselineBlockCard weekIndex render identically before and after the swap for at least one in-plan fixture date

Depends on: resolveDay gains program + scheduledItemsToday (union across member goals)

Touches: src/lib/program.ts, src/app/page.tsx

### TOOL-DIFFS.md incremental entry + connector-reconnect release note for the S5 payload changes
*P1 - High · Small* — Every tool-touching sprint in this initiative is required (plan §4.3, §4.6) to document its MCP surface changes incrementally and remind whoever deploys to reconnect the claude.ai connector, because the connector caches the old tool list/schema after a deploy that changes tool descriptions or shapes — skipping this for four changed tools in one sprint is exactly the kind of silent-drift bug the initiative is trying to avoid elsewhere.

Acceptance criteria:
- docs/program-redesign/TOOL-DIFFS.md is created (first entry for this initiative; earlier sprints that touched tools — S1, S3, S4 per plan §4.3 — should already have appended their own entries by the time this lands, but if S5 is first to touch a tool, this story creates the file) documenting, for get_today_plan/get_day/get_week/get_session_brief: before/after field list, the removal of the project-vs-fitness branching description language, and the new program/scheduledItemsToday semantics
- the entry explicitly calls out the get_today_plan behavior change most likely to surprise an in-flight coaching session: isInPlan/confidence no longer reflect an unrelated plan's window on a project-focus day
- a release-note snippet (checklist item, e.g. in the PR description template or a short docs/program-redesign/RELEASE-NOTES.md line) reminds the deployer to reconnect the claude.ai MCP connector after this deploy, per CLAUDE.md's 'After a deploy that changes the tool set, the claude.ai connector caches the old list — reconnect it'
- COACH_INSTRUCTIONS / MCP server instructions text is checked for stale references to the old project-shaped/fitness-shaped get_today_plan split (per plan §4.6, the merged-payload description is an S5 deliverable) and updated in the same PR if found — three-places-rule: tool description (done in the merge story), TOOL-DIFFS.md (here), COACH_INSTRUCTIONS (here)

Depends on: get_today_plan: today-shapers.ts becomes a merger, project-branch nuller dies; get_day, get_week, get_session_brief gain program fields + leaky-reads coverage

Touches: docs/program-redesign/TOOL-DIFFS.md, COACH_INSTRUCTIONS / MCP server instructions source (wherever maintained in-repo)

## Sprint 6 - Views  →  board: **Sprint 19 - Views**  (6 stories)

### Unified Today timeline (server component, per-item goal chips)
*P0 - Critical · Large* — Founder's Monday walk+AWS session (and every multi-goal day) must render as one coherent timeline instead of duplicated per-goal blocks — the hard design constraint from RFC §7 sign-off (a shared activity must never repeat). This is the visible payoff of the whole seam-flip: Today finally shows what actually happened across the Program's member goals.

Acceptance criteria:
- Renders per approved UX mockups from the ux-research pass preceding this sprint
- One flat timeline of ScheduledItems/tasks — NEVER per-goal sections; an activity attributed to multiple goals (via ActivityGoalLink) appears exactly once with a multi-goal chip row, verified by a fixture where one workout links to 2+ member goals
- Consumes the new resolveDay `program` + `scheduledItemsToday` keys (S5) — no new day-resolution logic duplicated in the component
- Server component (no "use client"); Recharts/any client-only viz stays out of this component's tree
- Renders correctly at 390px width, no horizontal scroll, touch targets >=38px
- Hydration-clean — no hydration warnings in dev console (any hydration warning is a real regression per project history)
- Falls back gracefully (existing single-goal fitness/project rendering unchanged) for users with zero Program rows
- `npm run build` and `npx tsc --noEmit` green; new component has test coverage for the no-repeat-shared-activity invariant

Depends on: resolveDay gains program + scheduledItemsToday (union across member goals); get_day, get_week, get_session_brief gain program fields + leaky-reads coverage; get_today_plan: today-shapers.ts becomes a merger, project-branch nuller dies; UX research pass for Program views (unified Today, /program dashboard, cross-goal calendar, /progress, SavedMeal quick-pick)

Touches: src/app/page.tsx, src/components/TodayTimeline.tsx (new), src/lib/today-shapers.ts, src/lib/calendar.ts

### ProjectTodayView deletion (own PR, post-parity verification)
*P1 - High · Small* — Once the unified timeline covers project-kind goals, the separate ProjectTodayView component (src/components/ProjectTodayView.tsx) and its bespoke ScheduledItem query become dead weight that duplicates status-filter logic and risks drifting from the MCP project branch. Removing it in its own revertable PR closes out the last hand-rolled day-resolver surface named in the current-state analysis.

Acceptance criteria:
- Parity check documented BEFORE deletion: for project-kind users with no Program row, the unified Today timeline renders the same today-items, feasibility readout, milestone urgency, and MRR entry that ProjectTodayView produced — screenshot or snapshot-test comparison at 390px
- ProjectTodayView.tsx and its dedicated ScheduledItem query deleted; src/app/page.tsx routes project-kind goals through the unified timeline exclusively
- No remaining imports of ProjectTodayView anywhere in src/ (grep-clean)
- Shipped as its own PR, separate from the unified-timeline PR, so it can be reverted independently if parity regresses in prod
- `npm run test` and `npm run build` green; no orphaned test files referencing the deleted component
- Hydration-clean at 390px for project-kind Today

Depends on: Unified Today timeline (server component, per-item goal chips)

Touches: src/components/ProjectTodayView.tsx (deleted), src/app/page.tsx

### /program dashboard route (member-goal readiness cards + sparklines, phase progress)
*P1 - High · Large* — The Program is now a first-class entity with a window and member goals but has no dedicated surface — users can't see at a glance how handstand/cut/AWS are each tracking within the shared Program window, or how many days are elapsed/remaining. This gives the Program the same at-a-glance readiness view individual goals already get, without inventing new math.

Acceptance criteria:
- Renders per approved UX mockups from the ux-research pass
- New route /program (or /program/[id] if multi-program history is surfaced) as a server component
- One readiness card + sparkline per member goal, reusing computeReadinessSeriesSampled from src/lib/readiness.ts verbatim — no new readiness/series math introduced
- Recharts (or any client-side chart lib) is isolated to a client-only leaf component; the page shell itself stays server-rendered
- Shows phase/rotation progress and days elapsed / days remaining against the Program's startedOn/endsOn window
- Handles the pure-project Program (no active Plan) case: shows member-goal readiness without implying a rotation exists — never falls through to an unscoped plan query
- Renders at 390px, hydration-clean, no horizontal scroll on the sparkline row (own overflow-x container if needed)
- `npm run build` and `npx tsc --noEmit` green

Depends on: Program-first getActiveProgram + getActiveProgramMembership; Program MCP tool pack — membership + overview (attach/detach_goal, attach_plan_to_program, get_program_overview); UX research pass for Program views (unified Today, /program dashboard, cross-goal calendar, /progress, SavedMeal quick-pick)

Touches: src/app/program/page.tsx (new), src/components/program/ (new client leaf components), src/lib/readiness.ts (consumed, not modified), src/lib/program.ts

### Cross-goal calendar (generalize otherGoalEvents/buildCell to member goals)
*P2 - Medium · Medium* — The calendar today only shows the focus goal's plan plus advisory 'other goal events'; with Programs, every member goal's events should render on shared days with distinct color/icon, and a day where two member goals both have activity should show both pins rather than picking a winner.

Acceptance criteria:
- Renders per approved UX mockups
- buildCell (src/lib/calendar.ts) and its otherGoalEvents plumbing generalized to iterate all Program member goals, not just the single focus-goal + advisory-events split that exists today
- Per-goal color/icon comes from the existing legend machinery, promoted to be Program-scoped (each member goal keeps a stable, distinct swatch/icon across the month view)
- A day where 2+ member goals have events renders multiple pins/badges that coexist — no pin is dropped or overwritten by another goal's event on the same day
- Users with zero Program rows see unchanged single-goal calendar behavior (regression-free)
- Month view renders at 390px without horizontal scroll; day-cell tap targets remain usable
- Hydration-clean; `npm run test` (calendar unit tests) and `npm run build` green

Depends on: Program-first getActiveProgram + getActiveProgramMembership; UX research pass for Program views (unified Today, /program dashboard, cross-goal calendar, /progress, SavedMeal quick-pick)

Touches: src/lib/calendar.ts (buildCell, otherGoalEvents), src/app/calendar/, src/lib/goal-presentation.ts (legend/color/icon machinery)

### /progress extension: per-metric Program-window progress + live readiness arcs per member goal
*P2 - Medium · Large* — Today /progress shows one goal's readiness arc; Program users need to see each member goal's live readiness arc side by side across the shared Program window, while achieved goals must keep rendering their frozen R9 snapshot arc untouched — /progress must not become a second place that accidentally violates the freeze.

Acceptance criteria:
- Renders per approved UX mockups
- /progress extended to show one live readiness arc per active Program member goal, computed via the existing computeReadiness/computeReadinessSeriesSampled path — byte-identical readiness numbers to what /program and the goal's own page show for the same inputs
- Achieved (completed) member goals render their frozen completionSnapshot arc, never live-recomputed — R9 branch in goal-story.ts / goal-completion-core.ts is not modified by this story
- src/lib/compare.ts's existing R9 exemption comment/behavior ("NOT the trophy page") is left untouched; this story does not touch compare.ts or compare-core.ts
- Per-metric progress view scopes its date range to the Program's window (startedOn..endsOn or today, whichever is earlier) rather than each goal's own full history
- Renders at 390px, hydration-clean, chart/arc rendering isolated to client-only leaf components
- `npm run test` (readiness/goal-story/compare suites) and `npm run build` green — explicitly confirm compare.test.ts and goal-story.test.ts are unchanged/still passing

Depends on: Program-first getActiveProgram + getActiveProgramMembership; /program dashboard route (member-goal readiness cards + sparklines, phase progress); UX research pass for Program views (unified Today, /program dashboard, cross-goal calendar, /progress, SavedMeal quick-pick)

Touches: src/app/progress/page.tsx, src/lib/readiness.ts (consumed, not modified), src/lib/goal-story.ts (read-only reference for R9 pattern)

### SavedMeal composer quick-pick UI
*P2 - Medium · Medium* — Sprint 3 lands the SavedMeal model and its MCP tools, but nothing in the dashboard UI lets a human user pick a saved meal instead of re-entering the same breakfast from scratch every day. This story wires the composer to that new model so the time savings a coach gets via MCP is also available to the person tapping through the app.

Acceptance criteria:
- Renders per approved UX mockups
- MealComposer create mode offers a quick-pick list/search of the user's SavedMeal rows (name, defaultServings) that, when selected, prefills items+macros from the saved meal (same shape update_nutrition already keeps in sync)
- Selecting a saved meal still allows editing items before submit (quick-pick prefills, doesn't lock the form)
- Empty state (no saved meals yet) renders cleanly, no error, with a path to create one
- Uses the tenant-scoped getDb() for SavedMeal reads — no raw Prisma client access to an owned model
- Renders at 390px, hydration-clean
- `npm run test` and `npm run build` green

Depends on: SavedMeal model + save_meal/list_saved_meals tools + log_nutrition(savedMealId, servings); UX research pass for Program views (unified Today, /program dashboard, cross-goal calendar, /progress, SavedMeal quick-pick)

Touches: src/components/MealComposer.tsx, src/lib/nutrition.ts, src/lib/db.ts

## Sprint 7 - isFocus sweep  →  board: **Sprint 20 - isFocus sweep**  (8 stories)

### isFocus sweep, lib core batch: goal-focus, calendar (3 sites), plan-lint, override-integrity
*P2 - Medium · Medium* — so that the day-resolution and plan-linting core stops reading the deprecated isFocus tiebreak directly and instead reflects Program membership/rotation-ownership, the way every other post-M3 caller does — without waiting for the full ~20-site sweep to land as one risky change

Acceptance criteria:
- src/lib/goal-focus.ts:44 getFocusGoal() — either replaced by a rotation-owning-goal accessor built on getActiveProgram() (Plan.goalId of the active Program's active Plan) at each call site, or (if still exported for the zero-Program-rows compat path) its docstring/comment updated to say explicitly it is the legacy fallback only, never a general-purpose 'current goal' accessor; getActiveGoalsWithPlans()'s isFocus-desc ordering (~line 70) is re-justified as member-goal display ordering (Program membership first) or removed if S4/S5 already superseded it
- src/lib/calendar.ts:~185 (resolveMonth Phase-1 goal fetch, gates the ScheduledItem query) and src/lib/calendar.ts:~1002 (resolveDay's day-goal fetch) both resolve the rotation-owning goal via the active Program's Plan.goalId instead of `where: { isFocus: true }`; behavior for a user with an active Program is byte-identical (same goal resolves) and a Program-less tenant still resolves via the documented zero-Program-rows fallback
- src/lib/calendar.ts:~1396 getPendingNotesCount()'s `db.plan.findFirst({ where: { active: true, goal: { isFocus: true } } })` is replaced by calling getActiveProgram() (or a shared rotation-plan helper) instead of re-implementing the isFocus-desc query inline
- src/lib/plan-lint.ts:~223 lintActivePlan()'s plan lookup uses the same rotation-owning-plan resolution as calendar.ts (single source of truth, not a third re-implementation of the isFocus-desc query)
- src/lib/override-integrity.ts:~77 orphanedOverrideWarning() stops re-implementing `db.plan.findFirst({ orderBy: [{ goal: { isFocus: 'desc' } }, ...] })` and instead calls getActiveProgram() directly — the '~6 planId-keyed call sites keep the .id-means-Plan-id contract' invariant from the RFC is preserved (verified by reading getActiveProgram()'s current post-M3 signature before changing this file)
- grep -n 'isFocus' across goal-focus.ts, calendar.ts, plan-lint.ts, override-integrity.ts shows zero remaining direct Prisma `isFocus:` filters outside goal-focus.ts's documented zero-Program-rows compat path
- Behavior-parity: for the founder tenant (has an active Program per the S4 backfill), Today, calendar month view, lint_plan findings, and the orphaned-override warning are unchanged before/after this batch (manual smoke or existing test fixtures); for a Program-less (zero-Program-row) tenant, the same four surfaces are also unchanged, proving the fallback path still fires correctly
- npx tsc --noEmit succeeds; npm run test succeeds including src/lib/goal-focus.test.ts, src/lib/calendar.test.ts, src/lib/override-integrity.test.ts, and src/lib/program.test.ts
- This batch is independently revertable (single PR, no dependency on the other S7 batches)

Depends on: Program-first getActiveProgram + getActiveProgramMembership

Touches: src/lib/goal-focus.ts, src/lib/calendar.ts, src/lib/plan-lint.ts, src/lib/override-integrity.ts, src/lib/goal-focus.test.ts, src/lib/calendar.test.ts, src/lib/override-integrity.test.ts

### isFocus sweep, domain batch: records baseline schedule, hike-core attribution fallback, recap, render-actions, compare
*P2 - Medium · Medium* — so that baseline scheduling, hike attribution defaults, weekly recap's default goal, render-job goal resolution, and the compare-page goal ordering all key off Program semantics instead of the deprecated single isFocus flag, matching the lib-core batch's pattern

Acceptance criteria:
- src/lib/records.ts:406 getBaselineSchedule()'s 'Focus-strict' comment and `where: { active: true, goal: { isFocus: true } }` query are replaced with the rotation-owning goal's active plan (via getActiveProgram()); the empty-shape return for 'no active plan' behavior is preserved unchanged (comment updated to explain why baseline scheduling stays rotation-plan-scoped, not member-goal-wide, per DC-6/CRIT-2's original rationale)
- src/lib/hike-core.ts:~53 logHikeCore()'s `resolvedGoalId = input.goalId ?? focusGoalId` default is repointed at the rotation-owning goal instead of the isFocus goal; the 'null means focus goal at read time' comment is corrected to describe the new default, and legacy Hike rows with goalId=null are confirmed to still read consistently through this new default at read time (not just write time)
- src/lib/recap.ts:~312 computeWeeklyRecap()'s no-goalId-passed default goal fetch resolves the rotation-owning goal instead of `where: { isFocus: true }`; a code comment notes that multi-goal weekly recap (recapping all Program member goals in one card) is an explicit non-goal of this sprint, tracked separately
- src/lib/render-actions.ts:~45 queueRenderJob()'s focus-goal resolution (used as the (goalId, date) unique-constraint key for render jobs) resolves the rotation-owning goal; the 'Focus goal is resolved via isFocus=true' header comment is corrected
- src/lib/compare.ts:~58's `orderBy: [{ isFocus: 'desc' }, ...]` goal-list ordering is replaced with a Program-membership-first ordering (member goals of the active Program sort ahead of non-member goals), since this is a multi-goal list context, not a single-goal resolution — comment updated accordingly; the surrounding 'achieved-after-active' tiebreak logic and R9 exemption (compare.ts is 'NOT the trophy page') are left untouched
- grep -n 'isFocus' across records.ts, hike-core.ts, recap.ts, render-actions.ts, compare.ts shows zero remaining direct Prisma `isFocus:` filters or orderBy clauses
- Behavior-parity: for the founder tenant, /baselines/new's schedule, a fresh hike log with no goalId, the weekly recap card's default goal, a queued render job's resolved goalId, and /compare's goal ordering are all unchanged before/after; for a Program-less tenant the same five surfaces fall back correctly and don't throw
- npx tsc --noEmit succeeds; npm run test succeeds including src/lib/records.test.ts, src/lib/recap.test.ts, and src/lib/compare.test.ts
- This batch is independently revertable (single PR, no dependency on the lib-core batch beyond both consuming the already-shipped S4 getActiveProgram())

Depends on: Program-first getActiveProgram + getActiveProgramMembership

Touches: src/lib/records.ts, src/lib/hike-core.ts, src/lib/recap.ts, src/lib/render-actions.ts, src/lib/compare.ts, src/lib/records.test.ts, src/lib/recap.test.ts, src/lib/compare.test.ts

### isFocus sweep, MCP tools batch: 8 sites in tools.ts + render-tools.ts default-goal resolution
*P2 - Medium · Large* — so that every MCP tool that silently resolves 'the current goal' when a goalId is omitted does so via Program semantics instead of the deprecated isFocus flag, keeping tool behavior consistent with the Today/calendar payloads the same sprint's other batches already fixed

Acceptance criteria:
- src/lib/mcp/tools.ts:~594 (get_today_plan's activeGoalRow), ~1110 (compute_readiness's omitted-goalId default), ~1144 (get_pending_notes's active-plan lookup), ~1472 (get_session_brief's default goal), ~4280 (generate_recap_card's narrative-caption focus goal), ~4883 and ~4938 (acknowledge_lint_finding / clear_lint_acknowledgement's 'active plan for the focus goal' lookup), and ~5007 (grant_bonus_xp's attribute-pack goal resolution) each resolve the rotation-owning goal via the shared helper from the lib-core batch instead of `where: { isFocus: true }` or `goal: { isFocus: true }`
- src/lib/mcp/tools/render-tools.ts:~79 (queue_render_job's default-goalId-when-omitted resolution) is repointed the same way, matching the render-actions.ts fix from the domain batch (same semantic, two call sites — dashboard action and MCP tool — kept consistent)
- Each swapped tool's user-facing error message (e.g. 'No focus goal is set...' at render-tools.ts:~81 and tools.ts:~1108) is reworded to describe the new failure mode accurately (e.g. 'No active rotation found — pass goalId explicitly, or set up a Program first') rather than leaving stale 'focus goal' language now that the underlying resolution changed
- src/lib/mcp/leaky-reads.test.ts and src/lib/mcp/no-founder-leak.test.ts pass unchanged — no read tool starts leaking additional goal/plan fields as a side effect of the resolution change
- grep -n 'isFocus' src/lib/mcp/tools.ts src/lib/mcp/tools/render-tools.ts shows zero remaining direct Prisma `isFocus:` filters at the 8+1 sites above (list_goals's isFocus-desc ordering at ~922 and the isFocus display field itself are explicitly out of scope here — they belong to the stale-description story and are a legitimate display field, not a resolution bug)
- Behavior-parity: for the founder tenant, calling each of the 9 tools with no goalId/omitted params returns the same goal/plan as before the change; for a Program-less tenant, the same 9 calls either succeed via the documented fallback or fail with the new accurate error message (not a stale 'focus goal' message)
- Connector reconnect note added to this story's PR description per the repo convention (tool descriptions/error text changed, even though input/output schemas did not) — no new tools added, so no MCP tool-count change, but claude.ai's cached descriptions should still be refreshed
- npx tsc --noEmit succeeds; npm run test succeeds, including the full mcp/ test directory

Depends on: Program-first getActiveProgram + getActiveProgramMembership

Touches: src/lib/mcp/tools.ts, src/lib/mcp/tools/render-tools.ts, src/lib/mcp/leaky-reads.test.ts, src/lib/mcp/no-founder-leak.test.ts

### isFocus sweep, pages batch: goals, progress, and Today (root) page goal ordering
*P2 - Medium · Small* — so that the three dashboard pages that sort/highlight goals by isFocus instead reflect Program membership, and the 'focused' visual treatment on /goals means 'in the active Program' rather than the deprecated single-select flag

Acceptance criteria:
- src/app/goals/page.tsx:~47's `orderBy: [{ isFocus: 'desc' }, ...]` becomes a Program-membership-first ordering (member goals of the active Program sort ahead of non-member goals, then by the existing active/targetDate tiebreaks); `isFocused` (~line 64, used at ~121/145/149/151/229 for the highlighted-goal chip and dimming) is repointed at Program membership instead of `g.isFocus`, and the visual/copy implications of 'highlighted goal' now meaning 'any Program member' (not exactly one goal) are reviewed — if multiple goals can now be highlighted at once, the chip copy/design is adjusted so it doesn't misleadingly imply single-select
- src/app/progress/page.tsx:~23's `orderBy: [{ isFocus: 'desc' }, ...]` and ~58/~61's `focusProjectGoal`/`focusGoal` derivations are repointed at the rotation-owning goal (progress page shows one goal's readiness detail, so this is a single-goal resolution, not a member-goals list — matches the lib-core/domain batches' pattern, not the goals-page pattern)
- src/app/page.tsx (Today root):~86-87's `orderBy: [{ isFocus: 'desc' }, { updatedAt: 'desc' }]` and the `isFocus: true` select field are repointed consistently with whichever of the two patterns this query actually serves (read the surrounding usage before choosing — if it feeds a single 'today's goal' card, use rotation-owning goal; if it feeds a goal-chip list, use Program membership)
- Per memory constraint 'goal-progress-bars-are-goal-generic': confirm none of these three changes hardcode a specific goal (e.g. the founder's Elbert/handstand goals) — the ordering/highlighting logic must remain goal-generic
- All three pages render correctly at 390px width for both the founder tenant (active Program, 3 member goals) and a Program-less tenant (zero Program rows, isFocus-fallback still active)
- npx tsc --noEmit succeeds; npm run build succeeds; npm run test succeeds

Depends on: Program-first getActiveProgram + getActiveProgramMembership

Touches: src/app/goals/page.tsx, src/app/progress/page.tsx, src/app/page.tsx

### isFocus sweep, final verification: zero remaining reads outside the compat shim, and file the column-drop Backlog item
*P2 - Medium · Small* — so that the sweep has a hard, automatable stop condition instead of ending on vibes — proving every one of the ~20 inventoried sites (plus anything the inventory missed) is accounted for before this epic is called done

Acceptance criteria:
- A repo-wide `grep -rn 'isFocus' src/` audit is run and every remaining match is classified into exactly one bucket: (a) the Prisma schema field definition itself (prisma/schema.prisma, expected, untouched), (b) the documented zero-Program-rows compat-shim fallback in getActiveProgram()/goal-focus.ts (expected, must carry a comment saying so), (c) a deprecation/TODO comment explicitly pointing at the Backlog column-drop item, (d) a display-only field read (e.g. list_goals returning isFocus as informational output, goals/page.tsx showing the flag) that was consciously kept as-is because it's a data value, not a resolution mechanism, or (e) an UNEXPECTED live resolution site that slipped through all six prior S7 stories — any (e) match fails this story and must be fixed before it can close
- The audit output (bucketed list, one line per match with its bucket letter) is saved to docs/program-redesign/ (e.g. isfocus-sweep-verification.md) as the artifact proving the sweep is complete, referencing the original ~20-site inventory from docs/program-redesign/01-current-state-analysis.md §2.1 and confirming every inventoried site was visited by one of the five prior stories
- Confirm the isFocus column DROP itself (removing the Prisma field/migration) is explicitly NOT attempted in this story — it is filed as a new Backlog item (not a Sprint 7 story) per the epic's non-goal, and this story's AC includes verifying that Backlog item exists (or creating it) rather than assuming it
- npx tsc --noEmit, npm run build, and npm run test all succeed on the branch with all prior S7 batches merged
- Founder-tenant and Program-less-tenant smoke pass: Today, calendar, goals, progress, compare, lint_plan, get_today_plan/get_session_brief/get_pending_notes/compute_readiness/generate_recap_card/queue_render_job/grant_bonus_xp/acknowledge_lint_finding all behave identically to pre-sweep baseline for both tenant shapes
- This story depends on all five other S7 stories (lib core, domain, game engine, MCP tools, pages) being merged, plus the stale-description cleanup story, since it is the sweep's closing gate

Depends on: isFocus sweep, lib core batch: goal-focus, calendar (3 sites), plan-lint, override-integrity; isFocus sweep, domain batch: records baseline schedule, hike-core attribution fallback, recap, render-actions, compare; isFocus sweep, game engine site: prove equivalence or file a tracked exception (engine.ts:1036); isFocus sweep, MCP tools batch: 8 sites in tools.ts + render-tools.ts default-goal resolution; isFocus sweep, pages batch: goals, progress, and Today (root) page goal ordering; isFocus sweep: stale tool-description cleanup (set_plan_active, create_goal, and description-text grep sweep)

Touches: docs/program-redesign/isfocus-sweep-verification.md, docs/program-redesign/01-current-state-analysis.md

### Update docs/project-gotchas.md and CLAUDE.md for the Program model, ActivityGoalLink, and the retired isFocus seam
*P2 - Medium · Small* — so the next dev/agent touching plan writes, records, or the MCP tool surface reads the new gotchas BEFORE re-discovering them the hard way

Acceptance criteria:
- docs/project-gotchas.md gains entries for: getActiveProgram()'s .id-is-a-Plan-id contract + zero-Program-rows fallback/rollback lever; ActivityGoalLink's lack of FK integrity (delete-hooks + nightly verifier are the only guarantee); nutrition auto-link's fitness-kind-only gate; WriteReceipt's opt-in-per-tool idempotency; isFocus as legacy/display-only outside the compat path
- CLAUDE.md's Architecture section gets a one-line Program mention; Key directories gains the program tool pack + attribution module
- CLAUDE.md's connector-cache reminder left untouched (still accurate)
- Docs-only PR, no code change

Depends on: isFocus sweep, final verification: zero remaining reads outside the compat shim, and file the column-drop Backlog item

Touches: docs/project-gotchas.md, CLAUDE.md

### isFocus sweep, game engine site: prove equivalence or file a tracked exception (engine.ts:1036)
*P3 - Low · Small* — so that the XP ledger's focus-goal lookup either moves onto Program semantics like every other site, or — if the single-ledger v1 design makes that unsafe — the deviation is explicit and tracked instead of silently inconsistent with the rest of the sweep

Acceptance criteria:
- src/lib/game/engine.ts:~1034-1039's `db.goal.findFirst({ where: { isFocus: true }, ... })` (the 'Focus goal (isFocus=true drives the daily prescription + XP attribute pack)' lookup) is analyzed against getActiveProgram()'s post-M3 Plan.goalId resolution for every tenant shape in the founder-history coverage set (has active Program, zero-Program-rows, Program with no active Plan)
- IF the two lookups are provably equivalent for all three shapes (same goal.id and goal.kind returned in every case): the site is swapped to resolve the rotation-owning goal via the same shared helper the lib-core batch introduced, and engine.scenario.test.ts is extended with a case proving output (XP totals, attribute pack, ledger entries) is byte-identical before/after for the founder fixture
- IF NOT provably equivalent (e.g. a case exists where the Program's rotation goal and the isFocus goal diverge, such as mid-transition data or a Program with no active Plan): the site is left unchanged, a comment is added at engine.ts:~1034 stating explicitly this is a tracked exception per the M4c non-goal ('game-engine ledger semantics in v1'), and a Backlog entry is filed (not a new S7 story) for revisiting once single-ledger v1 gains multi-goal awareness
- Whichever branch is taken, src/lib/game/engine.scenario.test.ts and src/lib/game/classify.test.ts pass unchanged in assertions (no XP/ledger numbers shift) for the founder fixture — this is the one site in the sweep where 'behavior must not change' is the primary constraint, ahead of 'stop reading isFocus'
- npx tsc --noEmit and npm run test succeed
- This story is independently revertable and does not block or depend on any other S7 batch

Depends on: Program-first getActiveProgram + getActiveProgramMembership

Touches: src/lib/game/engine.ts, src/lib/game/engine.scenario.test.ts

### isFocus sweep: stale tool-description cleanup (set_plan_active, create_goal, and description-text grep sweep)
*P3 - Low · Small* — so that the coach reading tool descriptions in claude.ai isn't told a false story about the app's focus model — the current descriptions were already stale before Program even existed, and Program makes them more wrong, not less

Acceptance criteria:
- src/lib/mcp/tools.ts:~5665 set_plan_active's description (which per the current-state analysis still falsely claims no MCP focus-switching tool exists) is corrected to accurately describe both set_active_goal (compat shim, post-S4 blast radius: switching Programs deactivates the whole current one) and the Program-aware pack (create_program/attach_goal_to_program/etc.) added in earlier S7-preceding sprints
- src/lib/mcp/tools.ts:~4579 create_goal's description gets the same correction
- grep -n 'isFocus\|focus goal\|FOCUS goal' src/lib/mcp/tools.ts src/lib/mcp/tools/render-tools.ts src/lib/mcp/instructions.ts (and any COACH_INSTRUCTIONS source) is run to find every remaining description string that still teaches the old single-focus mental model — at minimum: tools.ts:~564 (get_today_plan's focusGoal/activeGoal description), ~907/~956 (list_goals's isFocus explanation), and render-tools.ts:~38 (recap card's 'FOCUS goal' description) — each is rewritten to describe Program/rotation-owning-goal semantics per the three-places rule (tool description + input schema description + COACH_INSTRUCTIONS, in the same PR, per gotcha §B.6)
- isFocus as a raw boolean field is NOT removed from any tool's output schema in this story (that's the separately-filed column-drop Backlog item) — only prose/description text and the resolution logic already fixed by the other S7 batches are in scope here
- A short diff is appended to docs/program-redesign/TOOL-DIFFS.md documenting every description string changed in this story (per the plan's 'written incrementally' convention)
- npx tsc --noEmit succeeds (description-only changes, but the type-check gate still runs); npm run test succeeds
- Connector reconnect note included in the PR description — tool description text changed, claude.ai's cached tool list should be refreshed even though no schemas changed

Depends on: Program MCP tool pack — CRUD + status (create_program, update_program, set_program_status); set_active_goal Program-aware compat shim + COACH_INSTRUCTIONS/description sync

Touches: src/lib/mcp/tools.ts, src/lib/mcp/tools/render-tools.ts, src/lib/mcp/instructions.ts, docs/program-redesign/TOOL-DIFFS.md
