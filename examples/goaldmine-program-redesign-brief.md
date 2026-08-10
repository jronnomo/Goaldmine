# Goaldmine — Program Model Redesign
### Engineering brief for Claude Code
*Author: Jerry (product owner) · drafted with coaching-agent context · v0.1 — REVIEW DRAFT*

---

## 0. How to use this brief

This is a **problem + intent** spec, not an implementation plan. Do not start writing migrations from it. The internal details below are described from *observed behavior* by an agent that used the MCP tools heavily but never read the source — treat every claim about current schema/logic as a **hypothesis to verify against the actual code**, not ground truth.

**Required first step before proposing any design:**
1. Read `schema.prisma` (or equivalent) and map the real `Goal`, `Plan`, `Baseline`, `LogEntry`, `Workout`, `Hike`, `DayOverride`, `Measurement`, and `ScheduledItem` models and their relations.
2. Read the resolvers behind these MCP tools: `get_today_plan`, `get_week`/`get_day`, `compute_readiness`, `list_goals`, `set_active_goal`, `apply_plan_revision`, `apply_day_override`.
3. Produce a written summary of *how the current 1:1:1 assumption is actually encoded* (see §2), and confirm or correct this brief's hypotheses, BEFORE proposing the new model.

Then propose the design as an RFC for review. Build only after sign-off.

---

## 1. The problem in one sentence

Goaldmine was built for **one focus goal that owns one plan that drives the calendar and Today page.** The owner now runs **multiple complementary goals advanced simultaneously by the same daily activities**, and the single-focus model can't represent, schedule, or visualize that.

## 2. The current model (HYPOTHESES — verify)

Observed constraints that all appear to stem from a hidden **one-focus-goal → one-plan → one-day** assumption:

- **`Goal.isFocus` is effectively single-select.** `set_active_goal` talks about "switching" focus; `get_today_plan` seems to resolve off *the* focus goal's plan.
- **A Plan belongs to one Goal**, and only the focus goal's plan drives the calendar rotation and Today. A goal with `activePlanId: null` (e.g. project goals) is invisible on Today — it contributes no daily presence.
- **The day is single-plan.** `get_today_plan` / `get_day` resolve one workout from one plan + one `DayOverride`. There's no notion of a day serving multiple goals.
- **Baselines are user-global** (no `goalId`) — a baseline arc "reflects ALL of the user's logged tests for that test name," per the `get_goal_story` tool docs. Good for shared lifts, ambiguous when a metric means different things to different goals.
- **Readiness is per-goal** and already solid — weighted targets, gates, per-target progress. This part likely stays; it's the best-designed piece.

**The core mismatch:** the owner's day (one 3:30 AM walk + AWS study, one skill block, one lift, one cut) advances 3 goals at once. The model has no object that represents "the day" independently of "the one plan."

## 3. Target model — the Program

Introduce a **Program**: the thing that owns the calendar, the rotation, and the day. Goals become **outcomes** a Program advances. One activity fans out to every goal it serves.

Proposed shape (verify names/relations against real schema; adapt freely):

- **`Program`** — owns the weekly rotation/`weeklySplit`, phases, `startedOn`/`endsOn`, day overrides. Replaces the plan-as-goal-property idea. A Program has many Goals; the *active Program* defines what's live (replacing `Goal.isFocus` — see §4).
- **`Goal`** — an outcome with readiness targets. No longer owns a plan. Has status/completion/snapshot/retrospective (keep all of this — it works). Belongs to zero-or-one Program (someday-goals belong to none).
- **Activity attribution (the crux):** a logged thing (Workout, Hike, walk, study block, Measurement, LogEntry) attributes to **one or many Goals**. Example: one incline-walk-with-AWS session advances *body-comp cut* (calorie burn/Z2), *AWS cert* (study hours), and *handstand program* (Z2 base) simultaneously. Decide the mechanism — a join table (`ActivityGoalLink`), a `goalIds[]` on log rows, or attribution rules resolved at read time — and justify the choice. This is the single most important design decision in the redesign.
- **Baselines:** keep user-global, but allow a metric to be *referenced* by multiple goals' targets (already works via `baseline:*` target metrics). Confirm a metric can serve two goals' readiness without duplication.

**Concrete acceptance case — build to this exact scenario:**
Three concurrent goals under one "Phase 2A" Program:
1. **Freestanding Handstand** (fitness; skill targets + gates; owns the training rotation)
2. **Reach 10% body fat** (fitness; body-fat% + weight + a pull-up "lean-mass canary" target; no separate rotation)
3. **AWS Solutions Architect Associate** (project; cumulative study-hours + sections-complete + practice-exam-score gate; readiness-gated, no hard date)

A single Monday must: show one merged Today (walk+AWS block, skill block, lift, nutrition tier), and simultaneously move the handstand rotation, the cut's weigh-in cadence, and the AWS study-hour counter — with each goal's readiness updating from the one day's logs.

## 4. Replace single "focus" with the active Program

Drop `Goal.isFocus` single-select. **The active Program defines what's live.** All goals attached to the active Program are "in play" together — no ranking, no bottleneck. Today and the calendar render the union of the active Program's goals. (Someday-goals with no Program stay dormant, as now.)

Migration concern: preserve historical focus for the completed Elbert goal so its snapshot/retrospective/story stay intact. **The redesign must not mutate achieved goals** — the tool docs state an achieved goal's story is frozen (rule "R9"). Verify and honor that.

## 5. The four visualizations (all required)

1. **Program dashboard** — all active goals' readiness scores + trend sparklines side by side; overall Program "phase" progress; days-elapsed / days-remaining.
2. **Unified Today** — every active goal's asks for the day in one view: the training session, nutrition tier, study block, any scheduled items (weigh-in, DEXA), baselines due. Each item badged with which goal(s) it serves.
3. **Cross-goal calendar** — one calendar, per-goal color/icon coding, multiple goal-date pins coexisting, rotation days from the Program. (Today the calendar shows one plan's rotation; it must show the Program's rotation with multi-goal attribution visible.)
4. **Per-metric progress charts** — progress-over-time for any tracked metric across the whole Program window; compare metrics; see the readiness arc per goal (the frozen `readinessSeries` already exists for completed goals — extend to live multi-goal).

## 6. Known bugs to fix in the same pass (verify each)

These surfaced during the Elbert program; fold them into the redesign rather than leaving them:

- **`get_day` false-positive:** legit completed-hike days return `plannedHikeToday: null` + `orphanedOverride: true`. Resolver mismatch between Hike rows and summit-day overrides.
- **`export_workout` omits exercise/set IDs** — makes set-level corrections impossible; forces delete-and-relog. Expose stable IDs.
- **Silent write failures / non-idempotent writes:** at least 4 observed cases where a write landed but the response never returned, causing duplicate workouts/notes on retry. Add idempotency keys on writes.
- **Nutrition has no date picker on manual entry** (workaround caused an accidental meal overwrite) and **no edit-vs-append affordance.**
- **No SavedMeal/Recipe model** — repeat meals (brookie, Chipotle bowl, daily breakfast) are stored as standing-rule notes and hand-logged. Add `SavedMeal { name, macros, defaultServing }` + `log_nutrition(savedMealId, servings)`.
- **Baseline "capped" flag:** when a tested value equals a known equipment ceiling (e.g. 65 lb DB), it reads as a plateau. Add a "capped" marker so fixed-load-rep redefinitions are legible.
- **Completion/recap card renderer:** confirm the glyph-fallback fix held (status checks were rendering as tofu boxes); apply the same fix anywhere else unicode marks render.
- **`completedAt` migration:** a recent deploy shipped Prisma client ahead of the DB column, breaking all `goal.findMany()` reads until migrated. Add a migration-safety check to the deploy process.

## 7. Explicit non-goals / guardrails

- **Do not touch achieved goals' frozen snapshots, XP, or retrospectives.** Elbert is done and must stay byte-stable.
- **Preserve all historical data** — 106 workouts, 15 hikes, ~29 baselines, months of nutrition/measurements. Migration must be lossless and reversible.
- **Readiness math is good** — extend it to multi-goal, don't rewrite the scoring.
- Keep the MCP tool surface working throughout (the coaching agent drives everything through it) — if tool signatures change, update them in lockstep and document the diffs.
- Single user, single timezone (USER_TZ). No auth/multi-tenant work needed.

## 8. Deliverables

1. A written **"current state" analysis** confirming/correcting §2.
2. An **RFC** proposing the Program model, the attribution mechanism (§3), and the migration path — for owner review before any code.
3. Migrations (lossless, reversible, with the safety check from §6).
4. Updated resolvers + MCP tools.
5. The four visualizations (§5).
6. The bug fixes (§6).
7. A test that asserts the §3 acceptance case end-to-end.

---

*Build order and priority are the owner's call — see the scope decision. Default: analysis → RFC → sign-off → schema/migrations → resolvers/tools → UI → bugfixes folded in where they touch the same code.*
