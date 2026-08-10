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
