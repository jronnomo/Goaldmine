# Program Redesign — MCP Tool Shape Diffs

A running, append-only log of MCP tool **input/output shape changes** made
during the program-redesign effort (epic #256 and friends). Each entry exists
so that:

- reviewers/QA know exactly what changed on the wire without re-diffing `tools.ts`,
- anyone deploying is reminded that **the claude.ai connector caches the old
  tool list/shape and needs a manual reconnect after a deploy that changes
  it** (see root `CLAUDE.md` → MCP server), and
- future stories touching the same tool have one place to check prior shape
  history instead of archaeology through git blame.

Newest entries at the top.

---

## 2026-08-09 — #276: `log_baseline`/`update_baseline` gain `capped`; baseline read payloads carry it

**Issue:** #276 (Sprint 16 — Additive schema, epic #258)

**Connector reconnect REQUIRED after deploy** — `log_baseline` and
`update_baseline` input shapes changed and three read payloads gained a field;
the claude.ai connector caches the old shapes until reconnected.

**Changed inputs:**

- `log_baseline` — new optional `capped: boolean` (default `false`): the value
  hit an equipment ceiling (e.g. a 65 lb dumbbell max), so a plateau at this
  value is expected, not a stall. Persisted on create AND on the same-day
  idempotent re-log (full re-log semantics — omitting `capped` on a repeat
  log resets it to `false`, mirroring `notes`).
- `update_baseline` — new optional `capped: boolean` with patch semantics
  (omit = leave unchanged) to toggle the marker after the fact.

**Changed outputs (additive field, display-only):**

- `get_baseline_history` — rows now include `capped` (full-row read; came
  along with the column).
- `get_records_summary` — `baselines[].latest` gains `capped`.
- `get_baseline_schedule` — `scheduled[].latestResult` and
  `unscheduledExtras[].latest` gain `capped`.

**Dashboard:** `/baselines` (scheduled rows + other-logged-tests rows) and
`/baselines/test/[testName]` (all-results rows) render a compact muted
`▲cap` marker (`src/components/CappedMarker.tsx`) next to capped values.
Full chart treatment is deferred to Sprint 19.

**Explicitly NOT changed (honesty-math purity):** `readiness.ts`,
`rarity-core.ts`, and records PR/canonicalization
(`EXERCISE_ALIAS_GROUPS`) are untouched — `capped` never feeds scoring,
PR detection, or goal targets. It is an annotation, not an input.

---

## 2026-08-09 — #275: `save_meal` / `list_saved_meals` / `delete_saved_meal` NEW + `log_nutrition` gains `savedMealId`/`servings`

**Issue:** #275 (Sprint 16 — Additive schema, epic #258)

**Connector reconnect REQUIRED after deploy** — three new tools + a changed
`log_nutrition`/`batch_log_nutrition` input shape; the claude.ai connector
caches the old tool list and will neither see the new tools nor accept the new
params until reconnected.

**New tools:**

- `save_meal { name, items[], macros?, defaultServings? }` — **upsert-by-name
  per user** (case-insensitive match; re-saving an existing name replaces its
  items/macros/defaultServings in place, latest casing wins, omitted macros
  clear stored ones — no duplicates). `items`/`macros` describe
  `defaultServings` worth of the meal (default 1). Returns
  `{ id, name, updated, message }`.
- `list_saved_meals {}` — READ tool; the caller's saved meals
  (`id, name, items, macros, defaultServings, createdAt, updatedAt`), sorted
  by name, `omit: { userId: true }`. Leaky-reads coverage added in
  `src/lib/mcp/leaky-reads.test.ts`.
- `delete_saved_meal { id }` — removes the template; past NutritionLog rows
  are untouched.

**Changed inputs:**

- `log_nutrition` — `items` is now OPTIONAL (still `min(1)` when present);
  new optional `savedMealId` + `servings` (default 1). With `savedMealId`,
  items+macros are derived from the SavedMeal: macros scaled by
  `servings ÷ defaultServings` (rounded to 1 decimal), item `qty` annotated
  (e.g. `"1 brookie ×2"`) when the factor ≠ 1. **Precedence:** explicit
  `items`/`macros` passed in the same call replace the derived values
  wholesale. Unknown/foreign `savedMealId` → friendly not-found error.
  Omitting both `items` and `savedMealId` → friendly items-required error.
  The write still lands via the single `logNutritionCore` create (items +
  macros in one row — the update_nutrition coherence invariant holds).
- `batch_log_nutrition` — operations inherit the same shape; saved-meal
  references resolve inside the transaction (scaling/precedence identical).

**Scaling/parse helpers:** pure, in new `src/lib/saved-meal.ts`
(`deriveSavedMealLog`, `savedMealScaleFactor`, `scaleSavedMealMacros`,
`annotateItemsForFactor`) — unit-tested in `src/lib/saved-meal.test.ts`.

**Seed note (no prisma/seed.ts change):** the Phase 2A import creates the
founder's two starter meals — **Protein Brookie** (310 cal / 6.5 F / 31 P /
42.5 C per brookie) and **Chipotle Protein Bowl** (670 cal / 20 F / 71 P /
60 C per full bowl), both `defaultServings: 1`.

**Out of scope here:** dashboard composer quick-pick UI (Sprint 19 wires it);
this story is MCP-only.

---

## 2026-08-09 — M1 deploy note (no tool-shape change): `Program` → `LegacyProgram` rename + fallback deletion

**Issues:** #267 / #268 / #269 (Sprint 15 — Legacy retirement, epic #257)

**Not a wire change** — no MCP tool input/output shape changed; recorded here
as the deploy runbook for the M1 schema rename.

**Deploy order (binding):** apply the rename migration
(`prisma/migrations/20260810022840_legacy_program_rename`) to **prod BEFORE
merging the code deploy** (plan-critique #13's warm-lambda race, resolved in
this direction because the build-time migration-status gate from #263 is live:
`npm run build` fails while the migration is pending, so a code-first deploy
cannot ship at all):

1. `neonctl`/`psql` against prod → `npx prisma migrate deploy` (prod
   migrations are manual; Vercel never runs them).
2. Merge/deploy the code immediately after. **Warm-lambda window:** between
   the migration landing and the new deploy rolling over, old lambdas still
   querying `"Program"` will error if they hit the legacy fallback
   (`getActiveProgram` with zero active Plans) or the settings data-export.
   With an active Plan present (the normal state) the fallback path never
   fires; keep the window short regardless.
3. No connector reconnect needed for this change (no tool-list/shape delta).

**Pre-deletion gate (permanent):** `npx tsx
scripts/verify-legacy-program-coverage.ts` must report PASS (exit 0)
immediately before #269-style fallback removals — and stays as the
no-legacy-dependence invariant check. Ran clean pre- and post-deletion
(100/100 founder dates via Plan candidates, zero legacy hits).

**Remaining `db.legacyProgram` readers (intentional):**
`src/lib/export-data.ts` (user data export includes the user's own legacy
rows; payload key stays `program` for `goaldmine-export-v1` stability) and
audit/archaeology scripts (`founder-cutover.ts`, `verify-no-null-userid.ts`,
`verify-tenant-isolation-full.ts`). Nothing else in the app reads the table;
`getActiveProgram`/`getMostRecentProgram` now return `null` when no Plan rows
match — the stale-active-legacy-row shadowing bug class (analysis §2.2.3) is
dead.

---

## 2026-08-09 — `export_workout`: exercise/set `id`s (+ set `rpe`/`notes`) added to the export shape

**Issue:** #265 (B2, Sprint 14 — Deploy safety & fixes)

**Why:** `update_workout_exercise`, `update_workout_set`, and `workout_ops`
all instruct the coach to "look up IDs via export_workout" to get the
`WorkoutExercise`/`Set` id needed for a PATCH-style edit — but `export_workout`
never actually included those ids (or `Set.rpe` / `Set.notes`, both real
columns) in its projection. The coach had no way to follow that instruction
and fell back to raw-row workarounds via `recent_history`/`weekly_summary_data`.

**What changed:**

- `FormattableSet` (`src/lib/formatters/types.ts`) gained `id: string`,
  `rpe: number | null`, `notes: string | null`.
- `FormattableExercise` (`src/lib/formatters/types.ts`) gained `id: string`.
- The Prisma-row → formatter-shape projection used by `export_workout`
  (`src/lib/mcp/tools.ts`) was pulled out into a pure, unit-tested helper,
  `toFormattableWorkout()` (`src/lib/formatters/types.ts`, re-exported from
  `src/lib/formatters/index.ts`), which now passes `ex.id` / `s.id` / `s.rpe`
  / `s.notes` through instead of dropping them. The dashboard's `/workouts/[id]`
  "Share" panel (`src/app/workouts/[id]/page.tsx`) was switched to the same
  helper, so it picks up the same fields for free.
- Per output format:
  - **`json`** — surfaces `id`/`rpe`/`notes` verbatim (it's a direct
    `JSON.stringify` of the shape above); no formatter code change needed.
  - **`markdown` / `plain`** — print an inline `` `[id: <id>]` `` marker
    after the exercise header and after each set line, plus `RPE <n>` and a
    `Note:`/blockquote line for set-level notes when present. These fields
    were previously visible in **no** format at all.
  - **`strong`** — intentionally **unchanged** and does **not** surface
    id/rpe/set-notes. This format must stay byte-identical to the real
    Strong-app txt export so it keeps round-tripping through
    `parseStrongWorkout` (`src/lib/parsers/strong.ts`), whose line grammar
    treats any unrecognized non-blank line as a new exercise header — an
    inline id/RPE line would corrupt re-import. See the file-header note
    added to `src/lib/formatters/strong.ts`.
- `export_workout`'s tool description now says which formats carry ids and
  which don't. `update_workout_exercise` / `update_workout_set` / `workout_ops`
  descriptions were tightened to say *"look it up via export_workout with
  format:'json' or 'markdown'"* — the previous wording was ambiguous given
  `export_workout`'s default format (`'strong'`) omits ids.

**Tests:** `src/lib/formatters/formatters.test.ts` (new) — covers
`toFormattableWorkout` id/rpe/notes pass-through, per-format surfacing
(including a strong-format byte-stability round-trip regression against
`examples/sample-completed-workout.txt`). Manually verified end-to-end
against the dev DB: `export_workout` (format:'json') → extracted `sets[].id`
→ `update_workout_set` with that id → row confirmed changed.

**Connector reconnect:** YES — `export_workout`'s output shape changed
(new `id`/`rpe`/`notes` fields on exercises/sets). Reconnect the claude.ai
MCP connector after this deploys.
