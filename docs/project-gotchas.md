# Goaldmine — Tricky Scenarios & Gotchas (project brief)

**Purpose.** A fast orientation for a *fresh conversation* (coach in claude.ai, or a dev in Claude Code) on the non-obvious scenarios that have bitten us. This is the gotchas layer — it does **not** restate the operating rules. Those are canonical in [`server-instructions/goaldmine-rules.md`](server-instructions/goaldmine-rules.md) (kept in lockstep with the `COACH_INSTRUCTIONS` constant in `src/app/api/mcp/[token]/route.ts` and the deployed connector text). Read that first; then read this.

**How to use.** Paste/attach this into the claude.ai Project alongside the instructions from [`claude-ai-setup.md`](claude-ai-setup.md), or open it in a fresh Claude Code session. Keep it up to date: when a new gotcha turns into a fix, add an entry here and (if it's coaching-surface friction) to [`mcp-friction-log.md`](mcp-friction-log.md).

> Most-recent stable behavior reflected here: records canonicalization + `baseline_ops` (June 2026). When in doubt, trust the deployed tools over this doc and update this doc.

---

## A. Operating gotchas (coach / anyone driving the MCP tools)

### 1. `planJson` is a rotation template snapshot — NOT per-date truth
`get_goal(...).plans[0].planJson` is the weekly *rotation template*. It silently misses per-date overrides. For "what's prescribed on date X" or "what's exercise Y at on upcoming days," use the **override-aware** reads: `get_day(X)` and `find_exercise_in_plan(Y)`. (This burned us on 2026-05-19: Hollow Body Hold was prescribed at 55s via an override, but `planJson` still said 30s.) Never reason about a specific date from `planJson`.

### 2. Three-layer cascade — naming a future event means *three* possible writes
- `apply_plan_revision` rewrites the **template** (phases, weeklySplit, hikeSchedule, totalWeeks, baselineWeek). It anchors **nothing** on the calendar.
- `apply_day_override(date, …)` is what makes a **specific date** actually show a new thing (race, inserted hike, vacation, sick swap, missed-workout reschedule). Each affected date needs its own override.
- `update_plan_metadata(...)` syncs the plan **range / week counter / goal-date pin** (endsOn, weeks, name, goalTargetDate) when the timeline shifts.

The concrete tool list **is** the proposal. "I extended the plan and shifted Wk 3" is a summary, not a cascade — enumerate (a) the revision, (b) every `apply_day_override`, (c) `update_plan_metadata` if length/dates moved.

### 3. Editing baseline tests → use `baseline_ops`, NOT a full snapshot rewrite
A one-line baseline change (add a retest, fix a protocol, add a new test) does **not** require reconstructing the whole `ProgramTemplate`. Use `baseline_ops` (patch: `addTest` / `updateTest` / `removeTest` by day + testName). It's lint-gated and records a `PlanRevision`, same as `apply_plan_revision`, but only touches the tests you name. Hand-rewriting the full snapshot for a small edit is a corruption footgun — the lint catches missing *sections* but not a mangled string inside one. (This is exactly the friction that produced `baseline_ops`.)

### 4. Baselines are template-level — they take effect with NO calendar cascade
The baseline schedule derives checkpoints from each test's `initialWeek` + `retestWeeks`. So writing the patched template (via `baseline_ops` or `apply_plan_revision`) is sufficient — unlike dated events, baselines need no `apply_day_override`. Gotcha: a test introduced **mid-plan** must set `initialWeek` (else it's treated as a retest with no prior result to compare against, and the linter flags it `unanchored`).

### 5. Baseline-collection days: pair vs replace (see rule 9)
Short tests (speed/power, mobility checks) **pair** with the day's workout; long/heavy tests (1.5 mi run, 20 min row, max lifts) **replace** it. The app no longer auto-suppresses the workout — when `get_today_plan` shows `baselinesDue`, judge the test character and tell the user explicitly.

### 6. PRs/records now fold in baselines — via a hand-curated alias map
Records & PR detection group by **canonical movement name**, not raw `name|equipment`. So baseline retests (mirrored into workouts as e.g. `Plank Max Hold`), Strong spelling drift (`Pull Up` vs `Pull-Up`), and equipment variants all collapse into one movement. `log_workout` returns `recordsSet[]` for PRs hit.
- **Deliberately separate** (different metric — do not expect them merged): `Pull-Up Total Across 5 Sets` (a 5-set sum), `2-Min Bodyweight Squat` (timed AMRAP), `Box Step-Up` (distinct variant).
- **Maintenance gotcha:** a brand-new baseline test or a new Strong spelling will **re-fragment** PRs until its variant is added to the alias map (dev task — see §B).

### 7. `recent_history` truncates and drops note plumbing
`recent_history` now **excludes** `standing_rule` / `review` / `open_item` notes, and it truncates (can silently drop trailing data as logs grow). For anything you need completely, use the scoped read tools (`get_exercise_history`, `get_nutrition_history`, `get_baseline_history`, `list_open_items`, `get_latest_review`, `get_session_brief`).

### 8. Propose before applying; capture the why (rules 2 & 4)
Never call a write tool silently. Show summary + reasoning + cascade, wait for explicit approval. Every revision/override carries reasoning/notes — the audit trail matters more than speed.

### 9. Nutrition logs are food *items*, not macros (rule 10)
No calorie/protein fields — estimate from item names + qty, compare against the phase's `NutritionGuidance`. One-off day → `apply_day_override(nutritionText=…)`; systemic → `apply_plan_revision` editing `Phase.nutrition.habits`.

### 10. Readiness credits off-schedule PRs immediately — call `compute_readiness` to see it
Readiness resolves each baseline/measurement target to the **latest value as of end-of-(user-tz)-day**, and an `increase` target reads as met once `current ≥ target` (`decrease` once `≤`). So an off-schedule PR counts toward readiness right away — you do **not** wait for the formal week-N retest checkpoint (that's only for the baseline *schedule* display). Use `compute_readiness` (omit `goalId` → active goal) to see the overall score + per-target breakdown (current/start/progress) + `missing` targets; it's the read tool to reach for when "did my PR move the needle?" comes up. (A June 2026 bug excluded same-day evening-stamped results via an exact-timestamp compare — fixed by the end-of-day cutoff.)

Retest checkpoints credit early results the same way: a baseline logged anywhere in the checkpoint's window — [previous checkpoint target, next target or +28d), including *before* the target date — reads as done in `get_baseline_schedule` **and** (since June 2026, friction log #12) on the scheduled day itself in Today / `get_day` / `get_today_plan`. Before that fix the day view matched logs only on the exact scheduled date, so an early, off-schedule retest battery showed as still due; no override is needed to "hide" a checkpoint that's already been satisfied early.

---

## B. Architecture & maintenance gotchas (dev)

### 1. Next.js 16 + Prisma 7 are NOT the versions in your training data
Breaking changes vs older docs. Prisma generator is `prisma-client` (not `-js`); datasource URL lives in `prisma.config.ts`, not the schema block; generated client at `src/generated/prisma`. Read `node_modules/next/dist/docs/` and `AGENTS.md` before writing framework code.

### 2. The exercise alias map is hand-curated (`src/lib/records.ts`)
`canonicalExerciseName()` + `EXERCISE_ALIAS_GROUPS` map variant spellings → a canonical movement, used by `recordsSetInWorkout`, `getExerciseSummaries`, `getExerciseHistory`. It's curated **on purpose** (pattern-stripping would wrongly merge metric-incompatible tests). When PRs re-fragment for a movement, add the new variant to `EXERCISE_ALIAS_GROUPS` — and before merging a baseline test into a working movement, confirm it's the **same metric** (single-set max), not a sum/AMRAP/different-effort test. Baselines mirror into workouts via `src/lib/baseline-workout.ts` under their `testName`.

### 3. Adding/changing MCP tools
One file per tool under `src/lib/mcp/tools/*` conceptually, all registered in `src/lib/mcp/tools.ts` via `registerTool`. Patch-style tools follow the established ops pattern (`nutrition_log_ops`, `workout_ops`, `update_note` bodyOps, `apply_day_override` workoutJsonOps, `baseline_ops`): a pure transform (sequential ops, abort-on-first-bad-op) + a thin handler doing fetch/validate/lint/persist. Validate inputs with `zod`; wrap handlers in `safe()`.

### 4. Plan edits are lint-gated
`lintTemplate()` runs on any proposed template before write (structural errors reject — phase weeks not tiling 1..totalWeeks, retest past totalWeeks, initialWeek out of range, retest at/before initial; warnings ride along). `lintActivePlan()` adds DB-backed checks (phantom baseline values, unanchored retests, calendar conflicts). Reuse this tail for any new plan-writing tool.

### 5. FoodLibrary rows snapshot OFF at first scan — manual edit path is deferred
`lookupBarcode` upserts OFF data on each new scan (re-normalizes on re-scan of the same barcode). But chip-tap re-adds do not refresh data. If a manufacturer reformulates, the library entry stays stale until the user re-scans the barcode. This is accepted for v1. Manual library edit (correct macros, delete entry) is deferred to a future feature. Workaround: re-scan the barcode to force a fresh OFF lookup.

**Barcode column namespacing for estimate-sourced rows.**
The `barcode` column in `FoodLibrary` now holds two distinct key types:

| Pattern | Meaning |
|---|---|
| `\d{8,14}` (digits only) | Real product barcode (EAN-8 / UPC-A / EAN-13). Used by `lookupBarcode`. |
| `builtin:<slug>` | Cached entry from the curated builtin reference table (`src/lib/food-builtins.ts`). |
| `usda:<fdcId>` | Cached entry from USDA FoodData Central. |

`lookupBarcode` validates with `/^\d{8,14}$/` before any DB query, so namespaced keys are **never** accidentally matched by the barcode-scan path. The estimate path (`estimateFood` in `food-actions.ts`) uses exact `barcode` equality for upserts and name-based `findFirst` for lookups — the two code paths are fully disjoint.

**Estimate rows are reference snapshots, not gospel.**
Builtin macros come from USDA FoodData Central reference data (curated in `src/lib/food-builtins.ts`). USDA-sourced rows are fetched fresh on first lookup, then cached. Both sources reflect nutritional data at the time of first use and are not automatically refreshed. Treat them as good-faith estimates — small discrepancies vs. a specific product brand are expected.

**FoodLibrary `source` column values (extended):**
- `"openfoodfacts"` — real barcode scan via OFF API (original path)
- `"builtin"` — resolved from the curated builtin table
- `"usda"` — resolved from USDA FoodData Central

### 6. Operating rules live in THREE places — change them together
`docs/server-instructions/goaldmine-rules.md` ↔ `COACH_INSTRUCTIONS` in `src/app/api/mcp/[token]/route.ts` ↔ the deployed connector text. Edit all in the same PR or they drift.

### 7. A running `next dev` bundles the OLD Prisma client — restart after a migration
`prisma migrate dev` / `prisma generate` rewrites `src/generated/prisma`, but a dev server that was already running keeps serving the **previously bundled** client. Symptom: a brand-new column reads/writes fail at runtime with `Unknown argument "<col>". Available options are marked with ?` — listing every field **except** the one you just added — while `npx tsc --noEmit` passes clean (tsc reads the fresh types off disk; the Turbopack chunk is stale). This bit us adding `Hike.summitFt` (2026-06-19): `update_hike` rejected `summitFt` until the server was bounced. Fix: after any `migrate dev`/`generate`, **kill and restart `npm run dev`** (HMR does not re-bundle the generated client). The production analog is the connector cache (§C) — different cache, same "schema changed, consumer didn't notice" shape.

### 8. Local `.env` now points at a Neon DEV BRANCH — prod is Vercel-only (E0-1)
As of E0-1, the workflow is: local `.env` → Neon **dev branch**; Vercel env vars → prod. `dotenv/config` loads `.env` only (not `.env.local`), so `.env` is the canonical local DB config.

- **Confirm the target**: `npm run db:which` — prints the host and `DB_ENV` label before you touch anything.
- **Guarded commands**: use `npm run db:migrate` / `npm run db:seed` / `npm run db:push` instead of bare `prisma` commands. They run `scripts/db-guard.ts --assert` first and refuse (exit non-zero) unless `DB_ENV=development`.
- **Escape hatch**: `ALLOW_PROD_DB_WRITE=1` bypasses the guard with a loud `stderr` warning — for intentional prod schema operations only.

_Before E0-1, local `.env` was prod — that's why older sessions and memory files warned about mutating real data with scripts or dev-server runs._

### 9. `getDb()` vs raw `prisma` — when to use which (E4a+)

Since **E4a**, `src/lib/db.ts` exports two Prisma client surfaces:

| Surface | Use when |
|---|---|
| `prisma` (raw, unscoped) | Seeds, scripts, migrations, system-scoped queries (auth lookups, FoodLibrary, plan structural reads), existing tests not yet migrated in E4b |
| `await getDb()` (scoped) | All MCP tool handlers (after E4b) and RSC/server-actions — `userId` is injected automatically into every read and write on the 16 scoped models |

**Rules:**
- Never use `getDb()` in `prisma/seed.ts` or `scripts/*` — these run outside a user context and need the raw client.
- Never use `getDb()` for `User`, `FoodLibrary`, `WorkoutExercise`, `Set`, `PlanDayOverride`, or `PlanRevision` — these are non-scoped models (no `userId` column); `getDb()` passes them through untouched, but raw `prisma` is clearer intent.
- The `getDb()` scope in the MCP route (E4a) is **forward-setup** — tools still use raw `prisma` until E4b migrates them. Don't expect scoped behavior from tools until E4b lands.
- `$queryRaw`, `$executeRaw`, and `*Unsafe` variants **bypass the `$extends` extension entirely** — they are never scoped. E4b/E5 must hand-scope any raw queries. E4b's audit must `grep '\$queryRaw|\$executeRaw'` across `src/lib/mcp/` and hand-scope each hit.

### 10. CRITICAL: Nested writes bypass the `$extends` injection (E4a–E4b)

`getDb()` scoping fires only at the **top-level JS call** to a model method.
Nested relation writes in the `data` object are resolved inside Prisma's query
engine and do NOT re-enter the extension:

```typescript
// WRONG — Plan gets null userId:
const goal = await db.goal.create({
  data: { ..., plans: { create: { name: "Phase 1" } } }
  //                    ^^^^ extension does NOT fire for this Plan
});

// CORRECT — both rows go through the extension:
const goal = await db.goal.create({ data: { ... } });
const plan = await db.plan.create({ data: { goalId: goal.id, name: "Phase 1" } });
```

**This applies to all 16 scoped models.** E4b MUST audit every nested create
and split into two sequential top-level calls. The highest-priority site is
`src/lib/goal-core.ts` → `createGoalCore` which nests `plans: { create: {...} }`
inside a `$transaction`.

### 11. SYSTEM-scoped writes — render-job worker ops bypass user-scoping BY DESIGN

Two files use raw `prisma` (not `getDb()`) intentionally, because a background
worker processes **any** user's render job — cross-user access is the correct
behavior for a queue consumer:

| File | Ops |
|---|---|
| `src/app/api/render-jobs/peek/route.ts` | 6 ops: list pending, claim, list claimed, start, submit-draft, complete/fail |
| `src/lib/mcp/tools/render-tools.ts` | Same set of worker ops (MCP surface for the worker agent) |

Each call-site is marked `// SYSTEM: raw prisma — cross-user render worker (Phase 1: multi-tenant worker pattern)`.

**Rule:** everything else in `src/lib/mcp/` and `src/lib/` MUST use `getDb()`.
Use the `// SYSTEM:` comment convention to annotate any future intentional
cross-user raw-prisma call so audits don't flag it as missing scoping.

### 12. userId ownership (Phase 0) — two paths, two rules

The 16 scoped models all carry a nullable `userId` column (intentionally `String?` — hard NOT NULL is deferred to Phase 1 because the 29 `getDb()`-injected create sites omit it and rely on the `$extends` runtime injection).

**Two create paths — two different rules:**

| Path | Who injects userId | Rule |
|---|---|---|
| `await getDb()` call in an MCP tool or RSC (`db.<model>.create`) | `$extends` query extension in `src/lib/db.ts` — injected at runtime | No change needed — extension guarantees it |
| Raw `prisma.<model>.create` in `prisma/seed*.ts` or `scripts/*` | Nobody — you must set it explicitly | MUST pass `userId: FOUNDER_USER_ID` in the data payload |

**Guard:** `npm run db:verify-owned` (`scripts/verify-no-null-userid.ts`) counts `WHERE userId IS NULL` across all 16 scoped models and exits non-zero if any row is unowned. Run it after seeding and as a pre-deploy check before `prisma migrate deploy` to prod (Phase 1).

**Why NOT NULL is deferred:** promoting `userId String?` → `String` in the schema would make the 29 `getDb()` injected create sites fail TypeScript type-checking (they intentionally omit `userId` from the data object). Phase 1 will introduce a typed-create-input approach that handles this cleanly alongside real multi-user identity.

### 13. Historical dashboard-form date-shift bug (2026-05-03 → 2026-07-10, fixed in #234)

`src/lib/day-actions.ts` (`upsertDayOverrideFromForm`, `clearDayOverride`, `logNoteForDate`) shadowed the real USER_TZ-aware `parseDateKey` from `@/lib/calendar` with a local naive `new Date(y, m-1, d)` (runtime-local-TZ midnight, not Denver midnight). On the Vercel/UTC runtime this unconditionally rolled every dashboard-form-written `PlanDayOverride`/`Note.targetDate` **back one calendar day** vs. the `dateKey` shown in the UI — silent, no error, every single write. The MCP path (`applyDayOverrideCore` and everything else touching `PlanDayOverride.date`) was never affected; it always used the correct `calendar-core.ts` primitives.

**Verified clean before the fix shipped:** a read-only prod query on all `PlanDayOverride` rows (53 rows, `db:which` confirmed prod) found every row's `date` at exact Denver-midnight-in-UTC with none of them exhibiting the naive-parse fingerprint — i.e., no evidence any dashboard-form write ever actually landed on prod during the exposure window. No repair script was needed; the swap to the real `parseDateKey` (#234) was a clean forward-fix.

**If a future investigation turns up an override or note that looks off by exactly one day** (same content, wrong date) from a row `updatedAt` between 2026-05-03 and 2026-07-10, this is the mechanism — cross-reference against the founder's memory of dashboard-vs-MCP usage rather than assuming corruption elsewhere.

---

## E. RPG game engine gotchas (dev)

### 1. XP is fully derived and retroactive — rule changes shift ALL historical XP
`computeGameState()` recomputes from scratch on every call — no persisted XP counters. This means editing a constant in `rules.ts` (e.g. `WORKOUT_COMPLETED`, `PR_SET`) shifts every user's XP and level retroactively. Milestone thresholds, badge unlock dateKeys, and streak counts all recompute from full history. This is intentional ("no cold start" invariant) but means: (a) don't change constants casually without understanding the retroactive impact; (b) never use "current XP" as a decision gate in code — it will change; (c) the `/character` page shows a retroactivity footnote for user transparency. Coach bonuses (`GameBonusXp` rows) are the only persistent XP source — everything else is derived.

### 2. Baseline mirror workouts: `source="baseline"` prevents double-count for workout.completed but PR replay still fires
When `log_baseline` is called and a baseline test beats a prior best, `appendBaselineToDayWorkout` creates a mirror `Workout` row with `source: "baseline"`, `status: "completed"`. The engine includes these mirrors in PR replay (via `canonicalExerciseName` — e.g. "Plank Max Hold" → "Plank"), so a new baseline max CAN generate a `pr.set` XP event in addition to `baseline.logged` XP. Both XP types are intentional and coexist. The 1/day `workout.completed` cap prevents the mirror from also earning a second `workout.completed` event on a day with a regular workout. The guard to remember: `workout.completed` 1/day cap is the only double-count guard for baseline mirrors — PR replay sees ALL completed workouts including mirrors.

### 3. Adding new exercises or spelling variants to the alias map re-fragments PRs AND XP retroactively
The alias map in `src/lib/records.ts` → `EXERCISE_ALIAS_GROUPS` canonicalizes exercise names for `recordsSetInWorkout`, `getExerciseSummaries`, and the engine's PR replay. When a new baseline test or Strong-app spelling variant is added to `EXERCISE_ALIAS_GROUPS`, the engine's historical PR replay re-walks all workouts with the new canonical grouping. This means: a previously separate "Plank Max Hold" bucket and "Plank" bucket now merge → the PR count may change, XP amounts shift, and badge unlock dateKeys can move. Similarly, if a test is intentionally kept separate (e.g. "Pull-Up Total Across 5 Sets" is a different metric from "Pull-Up Max Reps"), adding it to the alias map would wrongly suppress single-set PRs. Always verify the metric is the same type (single-set max vs sum/AMRAP) before merging.

---

## C. Deploy & the claude.ai connector cache

- **Deploy** = push to `main` on `github.com/jronnomo/goaldmine`; Vercel auto-builds (no `vercel.json`, no CLI). Run `npm run build` locally first. Prod endpoint: `https://workout-planner-gold-three.vercel.app/api/mcp`.
- **Connector cache gotcha:** claude.ai caches `tools/list` keyed by the server's `(name, version)` from the initialize handshake — **not** the URL. `MCP_SERVER_VERSION` stamps off `VERCEL_GIT_COMMIT_SHA`, so every deploy advertises a new version and the connector re-fetches. If a newly shipped tool or changed arg still doesn't appear in claude.ai, toggle the connector off/on (or start a fresh chat) to force the re-handshake. URL cache-busting and remove+re-add do **not** help; the version bump does.
- **Verify a deploy is live:** `initialize` and check `serverInfo.version` shows the new commit SHA; then `tools/list` for the new tool.

---

## D. Where things live (quick map)

| Thing | Location |
|---|---|
| Canonical coach rules | `docs/server-instructions/goaldmine-rules.md` (+ `COACH_INSTRUCTIONS` constant) |
| Paste-into-Project setup | `docs/claude-ai-setup.md` |
| Coaching friction → fixes log | `docs/mcp-friction-log.md` |
| MCP tools | `src/lib/mcp/tools.ts` |
| Records / PRs / alias map | `src/lib/records.ts` |
| Baseline ↔ workout mirroring | `src/lib/baseline-workout.ts` |
| Baseline patch ops | `src/lib/baseline-ops.ts` |
| Plan lint | `src/lib/plan-lint.ts` |
| Program template (source) | `src/lib/program-template.ts` (but live behavior reads `plan.planJson`) |
| Dev/framework warnings | `AGENTS.md`, `CLAUDE.md` |

**Nav note:** the Goals list + create form is reachable in-app via **More → Goals** (`/goals`).
