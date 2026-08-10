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

## 2026-08-10 — #280: `set_active_goal` Program-aware shim + `confirmProgramSwitch` — cross-Program blast radius

**Issue:** #280 (Sprint 17 — Seam flip, epic #259; depends on #277/#310)

**Connector reconnect REQUIRED after deploy** — `set_active_goal`'s input
shape changed (new optional `confirmProgramSwitch`) and FOUR tool
descriptions changed (`set_active_goal`, `set_goal_tracked`,
`set_plan_active`, `create_goal`); the claude.ai connector caches the old
schemas/descriptions until reconnected (Settings → Connectors → Goaldmine →
reconnect). `COACH_INSTRUCTIONS` also changed — re-paste
`docs/server-instructions/goaldmine-rules.md`'s covenant into the deployed
connector text (three-places rule, gotcha §B.6).

**Input-shape change:**

- `set_active_goal { goalId }` → `set_active_goal { goalId,
  confirmProgramSwitch? }`. The new boolean is required (`true`) ONLY for a
  cross-Program switch; all other calls are unchanged.

**Semantic change** (core: `setFocusGoalProgramAwareCore` in
`src/lib/goal-core.ts`, wrapping the untouched `setFocusGoalCore`):

- **No Program rows / no ACTIVE Program** (pre-Program tenants, retired
  Programs) → legacy focus switch, byte-identical; Program state never
  touched.
- **Target inside the active Program** → focus switches; Program untouched
  (the normal in-season move).
- **Target in a DIFFERENT Program** → REFUSED without
  `confirmProgramSwitch:true` (friendly error naming BOTH Programs). With
  it: the current Program is **archived** and the target's Program
  **activated** — both via `setProgramStatusCore` (set_program_status's
  mechanism, reused not duplicated; archive-before-activate because of the
  one-active-per-user index) — then focus switches.
- **Target in NO Program while a Program is active** → focus switches,
  Program untouched, and the result carries a `warning`: the Program still
  owns the day's rotation (Program-first resolution ignores isFocus), so the
  focus change alone does not hand Today to this goal.
- Achieved targets are pre-checked BEFORE any Program write (a cross-Program
  call can never archive the current Program and then discover the target is
  un-focusable).

**Output-shape change (additive):** result gains `program {action:
'none'|'switched', previousProgram?, activatedProgram?, warning?}`, and
`message` narrates the archive/activate when it happened.

**Stale-description fixes (in passing, per the plan's scope note):**
`set_goal_tracked` + `set_plan_active` no longer claim "(focus-switching is
app-UI only — no MCP tool exists)"; `create_goal` no longer points at "use
setFocusGoal from the app UI" — all three now point at the `set_active_goal`
MCP tool and its cross-Program blast radius.

**Three-places rule (§B.6):** the set_active_goal covenant in
`src/lib/mcp/instructions.ts` gained the PROGRAM BLAST RADIUS clause, and
`docs/server-instructions/goaldmine-rules.md` gained the mirrored
"set_active_goal covenant" section (drift-repair: the covenant had never
been mirrored there) — both in this same commit. The deployed connector text
is the third copy — update it at deploy time.

**Tests:** `src/lib/goal-core.test.ts` — no-active-Program legacy path
(Program state untouched, `setProgramStatusCore` never called),
same-Program switch leaves Program.status alone, Program-less target warns,
cross-Program refusal without confirm (error names both Programs, zero
writes), confirmed cross-Program switch calls `setProgramStatusCore`
archive-then-activate in order, achieved-target pre-check, unknown-goal
error.

---

## 2026-08-09 — #278: `attribute_activity` / `list_activity_links` NEW — the manual attribution valve

**Issue:** #278 (Sprint 17 — Seam flip, epic #259; depends on #270/#271/#307/#310)

**Connector reconnect REQUIRED after deploy** — two brand-new tools; the
claude.ai connector caches the old tool list until reconnected (Settings →
Connectors → Goaldmine → reconnect).

**New tools** (pack file `src/lib/mcp/tools/program-tools.ts`, cores in
`src/lib/attribution.ts`):

- `attribute_activity { activityType, activityId, goalId, action: 'add'|'remove',
  note?, requestId? }` — the manual override valve on top of the auto-link
  engine. `activityType ∈ workout | hike | nutrition | measurement | baseline
  | log_entry` (the canonical `ACTIVITY_LINK_TYPES` set from
  `src/lib/activity-links.ts`); unknown type or non-existent `activityId` is
  a clean error.
  - `add` → creates a `source='explicit'` ActivityGoalLink; an existing
    `'auto'` row for the same (activityType, activityId, goalId) is
    **upgraded to `'explicit'` in place** (explicit-beats-auto — never a
    duplicate row against the unique constraint; `upgraded:true` reported).
    `activityDate` is denormalized from the ACTIVITY row's own date column
    (workout → `startedAt`, everything else → `date`), normalized to USER_TZ
    midnight — never "now", so retroactive attribution lands on the day the
    activity happened. Re-adding an identical explicit link is an idempotent
    no-op (`changed:false`). `note` provided ⇒ replaces the stored note;
    omitted ⇒ an upgraded auto link keeps its rule note.
  - `remove` → deletes the link **regardless of source** ('remove always
    wins', v1 semantics — stated verbatim in the tool description). Removing
    a non-existent link is a no-op success; remove does NOT require the
    underlying activity to still exist (doubles as the orphan-cleanup valve).
  - Takes the optional `requestId` idempotency key (#274 `withWriteReceipt`).
- `list_activity_links { goalId?, activityType?, from?, to?, limit? }` — READ
  tool. `from`/`to` (yyyy-mm-dd, inclusive) filter on the link's
  **`activityDate`** column, NOT `createdAt` (plan critique #9: a createdAt
  filter would hide retroactive explicit attribution of an old activity).
  Omitted `goalId` scopes to ALL member goals of the caller's ACTIVE Program
  (friendly error when none is active; empty member list ⇒ empty result).
  `limit` default 100, cap 500; `truncated:true` signals more rows exist
  (limit+1 probe). Returns `scope {resolvedFrom, goalIds, programId?,
  programName?}`, `count`, `truncated`, `links [{id, activityType,
  activityId, goalId, goalObjective, source, note, activityDate
  (yyyy-mm-dd), createdAt (ISO)}]` — explicit selects, never `userId`.
  Leaky-reads coverage added in `src/lib/mcp/leaky-reads.test.ts`.

Both descriptions follow the `list_planned_hikes` pattern (mental-model hook,
verbatim phrasings, explicit do-nots — notably: **do NOT call
attribute_activity after every log; auto-linking already runs at write time —
use it to correct/add what the rules missed**).

**Tests:** `src/lib/attribution.test.ts` (explicit-add upgrades an auto link
in place without a second row; remove deletes explicit as readily as auto;
no-op paths; unknown goal/activity errors; activityDate-not-createdAt
filtering; active-Program scope resolution; truncation) and
`src/lib/mcp/leaky-reads.test.ts` (`list_activity_links` select projections,
zero Note reads, payload shape).

---

## 2026-08-09 — #311: Program MCP pack part 2 — membership + overview NEW (`attach_goal_to_program` / `detach_goal_from_program` / `attach_plan_to_program` / `get_program_overview`)

**Issue:** #311 (Sprint 17 — Seam flip, epic #259; depends on #310)

**Connector reconnect REQUIRED after deploy** — four brand-new tools (seven
counting #310's, which ships in the same deploy); the claude.ai connector
caches the old tool list until reconnected (Settings → Connectors → Goaldmine
→ reconnect).

**New tools** (same pack file `src/lib/mcp/tools/program-tools.ts`, cores in
`src/lib/program-core.ts`):

- `attach_goal_to_program { goalId, programId, requestId? }` — sets
  `Goal.programId`. Works for goals of ANY kind (fitness + project share one
  Program). **Membership ≠ tracking** (documented decision): the write
  touches `programId` ONLY — never `Goal.active`/`isFocus` (deliberately
  unlike `set_active_goal`, which force-activates); a member goal can be
  paused. **R9:** a `status='achieved'` goal is rejected with the reopen hint
  (`reopen_goal`) — the reason is stated in the tool description itself. A
  goal already in another Program is MOVED (single membership) with
  `previousProgramId` reported; same-Program re-attach is a no-op
  (`changed:false`).
- `detach_goal_from_program { goalId, requestId? }` — clears
  `Goal.programId`. **Idempotent:** detaching a goal that is in no Program is
  a no-op success (`changed:false`), NOT an error. Takes only `goalId` (a
  goal has at most one Program).
- `attach_plan_to_program { planId, programId, requestId? }` — sets
  `Plan.programId` (the Program's rotation plan). **Documented decision:**
  the plan's goal MUST already be a member of that Program — a plan whose
  goal is outside it is rejected with a clean error pointing at
  `attach_goal_to_program` (membership before content; no warn-but-allow).
  Same-Program re-attach is a no-op; cross-Program move reports
  `previousProgramId`.
- `get_program_overview { programId? }` — READ tool. Omitted `programId`
  resolves the caller's ACTIVE Program (friendly error when none). Returns
  `program {id, name, status, startedOn, endsOn, notes, createdAt,
  updatedAt}` (calendar dates as yyyy-mm-dd USER_TZ, instants as ISO),
  `memberGoals [{id, objective, kind, status, hasActivePlan}]`,
  `rotationPlan {id, name, active} | null` (active preferred, else newest
  plan attached to the Program), and `attributionRules`. Every query uses an
  explicit select — no `userId` anywhere, and no Note reads at all.
  Leaky-reads coverage added in `src/lib/mcp/leaky-reads.test.ts`.

The three writes take the optional `requestId` idempotency key (#274
`withWriteReceipt`).

**Tests:** `src/lib/program-core.test.ts` (R9 rejection, membership-only
write shape, idempotent detach, plan-not-member rejection, overview shape +
active-resolution) and `src/lib/mcp/leaky-reads.test.ts`
(`get_program_overview` select projections, zero Note reads, payload shape).

---

## 2026-08-09 — #310: Program MCP pack part 1 — `create_program` / `update_program` / `set_program_status` NEW

**Issue:** #310 (Sprint 17 — Seam flip, epic #259)

**Connector reconnect REQUIRED after deploy** — three brand-new tools; the
claude.ai connector caches the old tool list and will not see them until
reconnected (Settings → Connectors → Goaldmine → reconnect).

**New tools** (pack file `src/lib/mcp/tools/program-tools.ts`, cores in
`src/lib/program-core.ts`, wired via `registerProgramTools` in `tools.ts`):

- `create_program { name, startedOn, endsOn?, notes?, requestId? }` — creates
  the multi-domain Program container. **Status always starts `draft`** (the
  tool takes no status input); activation is `set_program_status`'s job, so
  create can never trip the one-active constraint. `startedOn`/`endsOn` are
  yyyy-mm-dd USER_TZ calendar dates via `parseDateInput`; `endsOn` before
  `startedOn` is a friendly error. Returns the row (`id, name, status,
  startedOn, endsOn, notes, createdAt, updatedAt`) — dates as yyyy-mm-dd,
  instants as ISO, never `userId`.
- `update_program { programId, name?, startedOn?, endsOn?, notes?,
  attributionRules?, requestId? }` — true PATCH: only supplied fields change;
  `null` clears `endsOn`/`notes`/`attributionRules`; `{programId}` alone is a
  friendly no-op. **Does NOT accept `status`** (lifecycle lives in
  `set_program_status`). `attributionRules` validated as
  `Array<{ match: { titleContains?: string[], exerciseContains?: string[],
  source?: string }, goalIds: string[], note?: string }>` with ≥1 match
  criterion and ≥1 goalId per rule (local schema in `program-core.ts`; TODO
  marked to consolidate with `src/lib/attribution-rules.ts` when the
  auto-link engine lands it). Merged-window guard: the patched
  startedOn/endsOn pair must stay ordered.
- `set_program_status { programId, status, requestId? }` — `status ∈ draft |
  active | completed | archived`. Second-activate returns a clean error
  **naming the currently active Program** (app-level pre-check AND a P2002
  catch for the `program_one_active_per_user` race — never a raw Postgres
  unique-violation). Same-status call is an idempotent no-op
  (`changed:false`).

All three take the optional `requestId` idempotency key (#274
`withWriteReceipt` semantics: same key ⇒ original result replayed with
`replayed:true`).

**Tests:** `src/lib/program-core.test.ts` — draft-only create, PATCH round
trip, attributionRules validation, one-active enforcement on both the
pre-check and P2002-race paths, same-status no-op.

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

## 2026-08-09 — optional `requestId` idempotency key added to 13 write tools (#274)

**Issue:** #274 (Sprint 16 — Additive schema, epic #258)

**Why:** the MCP transport is stateless streamable HTTP; when a write's
*response* is lost on the wire, the coach retries the call and lands a
duplicate row. `requestId` gives every high-frequency write tool safe replay
semantics: mint one UUID per logical write, reuse it on retry, and the retry
gets the original stored result back instead of re-running the mutation.

**Input-shape change (all 13 tools):** new **optional** param

```
requestId?: string (max 128)
  "Idempotency key: same key ⇒ the original result is replayed, the write
   runs once. Mint one UUID per logical write and REUSE it on retry."
```

Tools touched:

- `log_workout`, `log_measurement`, `log_baseline`, `log_hike`, `log_note`,
  `log_nutrition` (single-row writes)
- `log_metric` (project pack, `src/lib/mcp/tools/project-tools.ts`)
- `workout_ops`, `baseline_ops`, `nutrition_log_ops` (surgical-edit packs)
- `batch_log_nutrition`, `batch_log_note` (batch writers — ONE requestId
  covers the whole batch; the per-operation shapes are unchanged)
- `apply_plan_revision`

Omitting `requestId` preserves the previous non-idempotent behavior
byte-for-byte.

**Output-shape change:** none on first execution. A **replayed** call returns
the stored original payload with one added field, `replayed: true`. Handled by
`withWriteReceipt` in `src/lib/mcp/idempotency.ts`, backed by the `WriteReceipt`
model (`@@unique([userId, requestId])`, per-user via the scoped client).
For the transaction-shaped tools (`apply_plan_revision`, `baseline_ops`,
`batch_log_nutrition`, `batch_log_note`) the receipt commits atomically with
the mutation; the single-row tools store it immediately after the write (a
crash in that window costs at most one legitimate-retry duplicate — the
pre-#274 status quo).

**Ops note:** receipts are pruned by `npx tsx scripts/gc-write-receipts.ts`
(manual/cron; default 30-day cutoff, `--days N`, `--dry-run`).

**Connector reconnect: YES** — 13 tool input schemas changed. Reconnect the
claude.ai MCP connector after this deploys (Settings → Connectors → Goaldmine
→ remove/re-add or "reconnect"), or the cached tool list keeps the old
schemas and the coach can't pass `requestId`.

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
