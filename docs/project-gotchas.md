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

### 6. FoodLibrary rows snapshot OFF at first scan — manual edit path is deferred
`lookupBarcode` upserts OFF data on each new scan (re-normalizes on re-scan of the same barcode). But chip-tap re-adds do not refresh data. If a manufacturer reformulates, the library entry stays stale until the user re-scans the barcode. This is accepted for v1. Manual library edit (correct macros, delete entry) is deferred to a future feature. Workaround: re-scan the barcode to force a fresh OFF lookup.

### 5. Operating rules live in THREE places — change them together
`docs/server-instructions/goaldmine-rules.md` ↔ `COACH_INSTRUCTIONS` in `src/app/api/mcp/[token]/route.ts` ↔ the deployed connector text. Edit all in the same PR or they drift.

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
