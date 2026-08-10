# Program Redesign — Deliverable 1: Current-State Analysis

*Verifies/corrects the hypotheses in `examples/goaldmine-program-redesign-brief.md` §2 and §6 against the actual code. Every claim below carries a file:line reference from the working tree as of 2026-08-09 (branch `feature/phase1-auth`).*

---

## 1. Verdicts on the §2 hypotheses

| # | Brief hypothesis | Verdict |
|---|---|---|
| H1 | `Goal.isFocus` is effectively single-select | **CONFIRMED** — enforced in code only, no DB constraint |
| H2 | A Plan belongs to one Goal; only the focus goal's plan drives calendar/Today | **CONFIRMED, with a sharper mechanism** — focus is a *tiebreak*, not a filter (see §2.2) |
| H3 | The day is single-plan; no object represents the day independently | **CONFIRMED** — no day object exists anywhere |
| H4 | Baselines are user-global | **CONFIRMED** — and `baseline:*` metrics already serve multiple goals without duplication |
| H5 | Readiness is per-goal and solid | **CONFIRMED** — pure, unit-tested, extendable without rewriting scoring |

Two things the brief does not know that materially change the design space:

- **A legacy `Program` model already exists** (`prisma/schema.prisma:442-459`) — the pre-Plan 12-week template (no `goalId`, no overrides, no `confirmedThroughDate`), written only by `prisma/seed.ts:22-31`, still live as a fallback in `getActiveProgram()`. The new entity must either reclaim the name via migration or pick another. (RFC §2 decision D1.)
- **The app is no longer single-user** (brief §7 is stale). Multi-tenant Phase 0/1 shipped: 17 models are tenant-scoped through `getDb()` (`src/lib/db.ts:40-58`). Every new model must join `SCOPED_MODELS`, pass `npm run db:verify-isolation`, and new MCP read tools need `mcp/leaky-reads.test.ts` coverage.

---

## 2. How the 1:1:1 assumption is actually encoded

### 2.1 Focus: single-select by convention, not constraint

- `Goal.isFocus Boolean @default(false)` with only plain indexes — nothing at the DB level prevents two `true` rows (`prisma/schema.prisma:268,304,306`). The code openly plans for the bad state: readers use `findFirst(orderBy: { updatedAt: "desc" })` as a "deterministic winner" (`src/lib/goal-focus.ts:6-8`).
- The single writer is `setFocusGoalCore` (`src/lib/goal-core.ts:420-465`): in one transaction it clears `isFocus` on **all** goals, sets it on the target (also forcing `active: true`), reactivates the target's latest plan, and deactivates that goal's sibling plans. **Other goals' plans are deliberately left active** (`goal-core.ts:447`).
- Completion releases focus entirely — `completeGoalCore` writes `isFocus: false, active: false`, leaving the system with *zero* focus goals (`src/lib/goal-completion.ts:263-273`); `reopenGoalCore` deliberately does not restore it.
- **~20 read sites** query `isFocus: true` directly (goal-focus, calendar ×3, program, records — baseline schedule is focus-strict at `records.ts:406` —, plan-lint, hike-core, recap, render-actions, override-integrity, game engine, mcp/tools ×8, three pages, compare). A single `get_today_plan` call performs the focus lookup **twice** (`tools.ts:593-597` and again inside `resolveDay` at `calendar.ts:1001-1005`). These are the sites a focus-replacement must sweep.
- Stale docs: `set_plan_active` and `create_goal` tool descriptions still claim no MCP focus-switching tool exists (`mcp/tools.ts:5665`, `:4579`) — `set_active_goal` does (`mcp/tools/project-tools.ts:766-801`).

### 2.2 Plan selection: `active` is the filter, focus is only a tiebreak

There is **no `activePlanId` column**. `list_goals` derives it as `g.plans[0]?.id ?? null` over `plans(where: { active: true })` (`mcp/tools.ts:926,938`). `activePlanId: null` therefore conflates four states: someday goal (never scaffolded), project goal (never scaffolded, `goal-core.ts:194-198`), paused plan, and achieved goal (plans deactivated at completion).

The load-bearing selector is `getActiveProgram()` (`src/lib/program.ts:24-57`):

```
plan = db.plan.findFirst({ where: { active: true },
        orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }] })
→ fallback: db.program.findFirst({ where: { active: true } })   // legacy table
```

Consequences, all verified:

1. `Goal.status/active/kind` are **never consulted**. Multiple `Plan.active = true` rows across goals is the *normal steady state*; the `isFocus desc` sort is the only thing keeping the focus goal's plan in front.
2. If the focus goal has no active plan (project-kind focus, or paused) while another goal does, **that other goal's plan silently becomes "the day"** — `resolvedPlan.source` still reads `"active"`, no signal anywhere in the payload.
3. When zero active Plans exist, the **legacy `Program` row wins**. Its id then flows into every `PlanDayOverride` lookup as `planId` — which can never match (FK targets Plan) — so all overrides go invisible, override *writes* fail the FK, and `confirmedThroughDate` is hardcoded null so no day can ever be "confirmed" (`program.ts:54-55`, `calendar.ts:987-990`). The SMOKE-1 mitigation (`program.ts:308-313`) protects **past dates only**; `get_today_plan`, Today, `apply_day_override`, `clear_day_override`, plan-lint, rarity, recap, and the game engine are all unprotected for today/future.

### 2.3 The day is a function return, not an object

`resolveDay` (`src/lib/calendar.ts:945-1311`) picks **exactly one** `ProgramForDate` up front, then derives everything — rotation slot, `todayTask`/`activeWorkout`/`deferredWorkout` (collapsed in `deriveTodayTask`, `calendar.ts:866-884`, baseline-deferral outranks hike), `baselinesDue`, override merge, confidence. The only multi-goal aspects are additive and advisory: `otherGoalEvents` and `crossGoalConflicts` — neither influences the prescription. `PlanDayOverride` is keyed `@@unique([planId, date])` — an override literally cannot exist without a plan, which is exactly why plan-less goals have no daily presence.

**Rotation math is duplicated, not shared.** The `daysDelta → rotationDay/weekIndex` formula is written out in at least 6 places (`resolveDay`, `buildCell`, `templateForRotationDay`, `isDateWithinActivePlanWindow`, `rotationBaselineNamesForDate`, `coversDayKey`), and two subsystems **re-implement day resolution wholesale without calling `resolveDay`**: the calendar month builder (`buildCell`, `calendar.ts:410-629`) and the XP ledger (`game/engine.ts:146+`, whose header says "Never calls resolveDay — replicates its override/rotation logic in memory"). A third, divergent mini-resolver (`getTodayContext`, `program.ts:104-143`) uses `Math.round` instead of `floor`, clamps `weekIndex`, and ignores overrides. Any change to "what governs a day" must sweep all of these — this is the single biggest hidden cost in the redesign.

### 2.4 Project goals: one shaped branch, three unshaped surfaces

Only `get_today_plan` has a project branch (`mcp/tools.ts:614-637`); it gates on the **focus goal's** `kind`. Even then, `resolveDay` has already run against whatever plan `getActiveProgram()` returned — so `isInPlan`/`confidence` on a project payload can describe an unrelated fitness plan's window (`today-shapers.ts:94-100` carries them through). `get_day`, `get_week`, and `get_session_brief` have **no** project branch and return fitness-shaped payloads regardless. The dashboard project path (`ProjectTodayView.tsx:27-70`) and the MCP project branch run **separate ScheduledItem queries with different status filters**.

### 2.5 Attribution today: one real column, one display heuristic

`goalId` columns on logged-activity rows, complete inventory:

| Carries goalId | No goal link at all |
|---|---|
| `Hike` (optional, SetNull), `LogEntry` (required), `ScheduledItem` (required) | `Workout`, `Measurement`, `Baseline`, `NutritionLog`, `BodyMetric`, `MobilityCheckin`, `Note`, `FootageMarker` |

- **Hike is the only logged activity with real attribution**, with focus-fallback semantics: `resolvedGoalId = input.goalId ?? focusGoalId`; a null on legacy rows means "focus goal at read time" (`src/lib/hike-core.ts:44-72,186-187`).
- `Goal.attributionHints` (canonical exercise names) is **display-only** — it drives "trained 3d ago" labels via one non-goal-scoped query (`src/lib/goal-attribution.ts:38-80`), never readiness or scoring.
- `log_metric` refuses fitness goals (`project-tools.ts:507-515`), so LogEntry attribution is project-only.

**The brief's crux is confirmed: there is no mechanism to extend — multi-goal attribution is a genuinely new object.**

### 2.6 Readiness: confirmed solid, and already half-shareable

- Targets schema: `GoalTarget { metric, label, units, direction, target, start?, weight, rationale?, gating?, cumulative? }` (`src/lib/metrics-registry.ts:12-39`, Zod mirror at `:66-87`).
- Scoring (`src/lib/readiness.ts:164-237`): untested targets count 0 with full weight in the denominator; open gates cap the score at 80; one compound gate exists (`hike:prep_completion` sub-conditions).
- **Metric families split cleanly by scope** (`src/lib/goal-targets.ts:33-206`): `baseline:*`, `weightLb`, `workout:count`, `exercise:*` are **user-global** — two goals targeting `baseline:Pull-Up Max Reps` already share one logged retest with zero duplication (documented in `get_goal_story`'s own description, `mcp/tools.ts:1063`). `hike:*` and `log:*` are **goal-scoped by design** (deliberately, to stop cross-counting — comment at `goal-targets.ts:64-67`).
- The brief's acceptance case needs **no readiness rewrite**: the cut goal reads global `weightLb`/body-fat, the handstand goal reads global `baseline:*` skills, and AWS reads goal-scoped `log:study_hours`. Attribution is a presentation/accounting problem, not a scoring problem. (RFC §3 leans on this heavily.)
- `readinessSeries` lives in three places: live (progress page), live-sampled (goal story / completion freeze), and frozen in `Goal.completionSnapshot` (`goal-completion-core.ts:23-83`).

### 2.7 R9 (frozen achieved-goal story): honored, but only in code branches

R9 is enforced in three read paths — `goal-story.ts:86-90` (never live-recomputes for achieved, even on snapshot parse failure), `goals/[id]/page.tsx:155-165`, and the isolate-drop parsing in `goal-completion-core.ts:41-60`. `compare.ts:123-128` deliberately exempts itself ("NOT the trophy page"). There is **no DB-level immutability** — the redesign must simply never route achieved goals through new write paths. Elbert's row additionally: focus already released at completion, `retrospective` survives reopen (R10), and its snapshot is a legacy pre-ceremony capture (`goal-completion-core.ts:53-56`).

---

## 3. Verdicts on the §6 bugs

| # | Bug | Verdict | Evidence |
|---|---|---|---|
| B1 | `get_day` orphaned-override false positive | **CONFIRMED — two stacked defects** | Hike query filters `status: "planned"` only (`calendar.ts:1010-1017`), and `reconcileLongEffort` returns `plannedHikeToday: null` unconditionally on ANY override day (`calendar.ts:1452-1456`). The flag therefore reduces algebraically to `isOverride && isMirrorOverride(template)` — every summit-day override reads orphaned regardless of Hike rows. The *correct* no-status-filter check already exists in `override-integrity.ts:44-49` (used by `lint_plan`); only the hot-path flag is wrong. No test covers it. |
| B2 | `export_workout` omits exercise/set IDs | **CONFIRMED** | Query selects IDs, projection drops them (`mcp/tools.ts:2149-2160`); `FormattableExercise`/`FormattableSet` have no `id` field (`formatters/types.ts:3-17`), so even `format:"json"` can't carry them. Yet `update_workout_exercise` / `update_workout_set` / `workout_ops` all say "look up IDs via export_workout" (`tools.ts:4395,4432,4473`) — unfollowable. (`recent_history` and `weekly_summary_data` do leak raw rows with IDs, which is the current workaround.) Bonus: export also drops set `rpe` and `notes`. |
| B3 | Non-idempotent writes | **CONFIRMED for the hot tools** | No idempotency infra anywhere in schema or src/lib. `log_workout`, `log_note`, `log_nutrition` are unconditional creates; `workout_ops`/`batch_*` are atomic per batch but replayable. Good patterns to model on already exist: `logHikeCore` dedupe-by-planned-row, `log_baseline` one-per-testName-per-day, `apply_day_override`'s DB unique + upsert. |
| B4 | Nutrition: no date picker / no edit-vs-append | **PARTIALLY CONFIRMED — corrected** | A real `datetime-local` picker exists but hides behind an "exact time" disclosure that reads as time-only (`MealComposer.tsx:1019-1058`); per-meal edit exists (`MealEditButton` → composer `mode="edit"`). The genuine gaps: create mode always seeds *now* and no entry point passes a date; **`/days/[dateKey]` has no manual nutrition entry at all** (`showLogForm={false}`, `days/[dateKey]/page.tsx:365-373`); and there is no append-to-existing-meal affordance. |
| B5 | No SavedMeal/Recipe model | **CONFIRMED** | Absent from all 30 models. Nearest neighbors are per-*food*, not per-meal: `FoodLibrary` (shared catalog) + `FoodUsage` (per-user favorites/portions). |
| B6 | No baseline "capped" marker | **CONFIRMED** | `Baseline` has no such field (`schema.prisma:145-160`); `log_baseline`'s only escape hatch is `allowZero` (the opposite end); `update_baseline` takes `id,value,units,date,notes`. Only free-text notes can carry it today, and nothing parses them. |
| B7 | Glyph/tofu fix held? | **LANDED for the completion card; two adjacent risks remain** | `✓`/`·` → inline SVG shipped in `97cb64e`→`ab63315` (completion-card.tsx:144-166). Remaining: recap highlight **emoji** (🏆🎖️⛰️📏⭐, `recap-card.tsx:214` ← `recap.ts:64-649`) render as text with no loaded font coverage — they depend entirely on next/og's runtime twemoji CDN fetch, same failure class, unfixed. And `next.config.ts:4-8` traces fonts for `/recap/card`, `/recap/story/[slide]`, `/api/mcp` but **not** the new `/recap/completion` route — on Vercel that lambda may bundle no fonts at all (`getFont` swallows the failure and returns null). |
| B8 | No migration-safety check in deploy | **CONFIRMED** | No CI (`.github/` doesn't exist), no vercel.json, build is bare `next build`, and `postinstall` runs `prisma generate` — so every Vercel deploy regenerates a client from the merged schema regardless of prod's actual columns. That is precisely the `completedAt` incident's path. `db-guard.ts` protects the opposite direction (dev writes), and the only migration review is the manual `/launch-gate` skill. |

---

## 4. Additional findings the redesign must account for (not in the brief)

1. **Legacy `Program` shadowing is live and unprotected for today/future** (§2.2.3). Retiring the legacy model is a prerequisite for reclaiming the name — and independently fixes a real bug class.
2. **Nine-ish rotation-math sites, three independent day-resolvers** (§2.3). The redesign should consolidate before extending, or every new day-semantics change triples in cost.
3. **`PlanDayOverride` and `PlanRevision` are non-scoped models** (tenancy inherited transitively via `planId`) — any re-keying of overrides must preserve that reasoning or explicitly scope them.
4. **Nested relation writes bypass the tenant extension** (gotcha §B-9/§B.10) — new Program/link models must use sequential top-level writes in transactions, like `createGoalCore` does.
5. **The XP/game engine reads the focus goal and replicates rotation logic** (`engine.ts:1012,1033-1038,1101-1107`) — "what earns XP on a multi-goal day" is a design question the brief doesn't raise; RFC flags it as an open question rather than silently changing ledger semantics.
6. **`get_session_brief` and `get_week` have no project awareness** — the unified-Today work will either extend them or supersede them; the connector caches the old tool list after deploys (reconnect required).

## 5. Bottom line

The brief's mental model survives contact with the code almost intact — but the *mechanism* is subtler than "one focus goal owns the day": the day is owned by whichever `Plan.active=true` row wins a focus-first sort, with a broken legacy fallback underneath. The good news is bigger than the brief hoped: readiness needs no rewrite for the acceptance case, `baseline:*` sharing already works, and Hike already demonstrates the attribution pattern. The bad news is also bigger: day resolution is *not one code path* — it's three-plus, and the redesign's real cost center is consolidating them safely.
