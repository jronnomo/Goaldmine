# Goaldmine — Integration Blockers
### Companion doc to the Program Model Redesign brief + RFC
*Author: Jerry (product owner) · drafted with coaching-agent context · v1.0*

---

## 0. What this document is (and isn't)

The brief (`00-program-redesign-brief.md`) said **what to build**. The RFC (`02-rfc-program-model.md`) said **how**. This doc says **what has to be true before we can use it** — a blocker register with a hard gate at the end.

Companion reading: `phase2a-goals-import-spec.md`. That file is the payload — three concurrent goals, their targets, baselines, checkpoints, and nutrition tiers, authored to drop into the new model. **Read it to understand the root issue, not as a task list.** It is the concrete thing that cannot currently be represented, and every blocker below is a reason why. If you want a one-line statement of the problem: *that spec describes a real program the owner is running today, and the current data model can hold maybe 40% of it.*

**Definition of done for this document:** when every P0 and P1 below is closed, the owner imports the Phase 2A spec in one pass, runs the §1 gate checks through the MCP surface, and every check returns green — at which point UI work on the four surfaces (§3) starts against a model that can actually feed them.

### Evidence tiers — do not flatten these

Every claim below is tagged. Treat them differently:

- **`[VERIFIED]`** — confirmed against real code in `01-current-state-analysis.md` with file:line evidence. Trust this over anything the coaching agent or the original brief said.
- **`[OBSERVED]`** — a reproducible symptom seen through the MCP tool surface during the Elbert program. Real behavior, unverified mechanism. **Diagnose before fixing.**
- **`[ASSUMED]`** — inference. Verify or discard. If it's wrong, say so in your response and move on; a corrected assumption is a good outcome, not a failure.

The coaching agent that drafted this has never read the source. Where your reading and this document disagree, **back yourself** — that has already happened once this project (the focus-is-a-tiebreak finding) and the verification was right both times.

---

## 1. The integration gate

These are the checks the owner will run through the MCP surface after the build, before importing Phase 2A. They are the acceptance criteria for the whole effort. Nothing here is a stretch goal.

| # | Check | Passes when |
|---|---|---|
| G1 | Create a Program, attach three goals, activate it | One active Program; a second activation attempt is rejected by a DB constraint, not app logic |
| G2 | `get_today_plan` with three goals attached | Returns one merged day: rotation session, nutrition tier, study block, scheduled items, baselines due — each item carrying the goal(s) it serves |
| G3 | Two of the three goals have no plan | Both still appear on Today with their asks; neither is invisible |
| G4 | Log one morning incline walk | It credits body-comp *and* AWS study *and* Zone 2 base, from a single log call, with three attribution links written |
| G5 | `compute_readiness` on each of the three goals | Three independent scores, each moved by the same day's logs where relevant |
| G6 | `apply_day_override` on today and on a future date | Both land and read back identical on Today, day detail, and the calendar month view |
| G7 | Create a non-hike dated goal | No Elbert-flavored baseline battery is auto-stamped; either a flavor-appropriate scaffold or nothing |
| G8 | `get_goal_story` on Elbert | Byte-identical to a pre-migration capture. Frozen snapshot, XP, retrospective, readinessSeries all unchanged |
| G9 | Full historical read | 106 workouts, 15 hikes, ~29 baselines, all nutrition and measurements present and attributed |
| G10 | Rerun the same write twice with the same idempotency key | One row, not two |

**If a gate check can't pass, the import doesn't happen.** The owner has been running a manual chat-based program precisely to avoid writing into a broken path; a partial cutover is worse than continuing that.

---

## 2. Blocker register

### P0 — Blocks everything. Fix before any other work.

**B1 · Stale legacy `Program` row silently shadows day resolution** `[VERIFIED]`
A row in the legacy `Program` table can shadow the resolver and break **all day overrides for today and future dates**, silently. No error, no warning — the write appears to succeed and the day resolves wrong.
*Why it blocks:* day overrides are the mechanism the coaching agent uses to write daily sessions. This is not a migration concern; it's affecting the live app right now, and it is the reason Phase 2A is currently being run off chat checklists instead of the app. **This is the single highest-priority item in the project.**
*Done when:* the legacy table is renamed (`LegacyProgram`) and no longer participates in resolution; a regression test asserts an override on a future date survives the presence of a legacy row; G6 passes.

**B2 · Migration-safety check missing from deploy** `[VERIFIED]`
A prior deploy shipped the Prisma client ahead of the DB column, breaking every `goal.findMany()` read until the migration ran.
*Why it blocks:* the migration sequence is five PRs against live data with months of history. Without this check, one mistimed deploy takes the whole app down mid-migration.
*Done when:* the build fails on client/DB schema drift. **Ships before the first migration PR, per the RFC's M0.**

**B3 · Focus is a tiebreak, not a filter** `[VERIFIED]`
The day is owned by whichever `Plan.active=true` row wins a focus-first sort. If the focus goal has no active plan, **another goal's plan silently becomes "the day."**
*Why it blocks:* the moment the cut or the AWS goal carries a plan, Phase 2A's day resolution becomes nondeterministic. `isFocus` never had a constraint enforcing what it implied.
*Done when:* `isFocus` is retired in favor of explicit Program membership; a partial unique index enforces one active Program per user at the DB level; G1 passes.

**B4 · Day resolution is re-implemented in multiple places** `[VERIFIED]`
The calendar month builder and the XP engine each rebuild day resolution without calling `resolveDay`; rotation math is copy-pasted in roughly six more locations.
*Why it blocks:* this is the mechanical cause of the recurring "surfaces disagree" failure class — the deferral-flag bug in June was exactly this (Today and calendar showed rotation default, day detail showed the logged workout). Multi-goal attribution makes every divergence three times as visible. Fixing the model without collapsing these paths ships the same bug with more surface area.
*Done when:* one resolver, one rotation implementation, all surfaces call it; G6 asserts agreement across Today, day detail, and calendar.

---

### P1 — Blocks the import or the visualizations.

**B5 · No attribution mechanism: one activity cannot credit multiple goals** `[VERIFIED as absent]`
The model has no way to express "this incline walk advanced the cut, the AWS hours, and Zone 2 base." Related `[OBSERVED]`: hikes scaffolded into a plan carry `null` goalId while ad-hoc `log_hike` entries carry one — two attribution paths, inconsistent results, and an audit the owner had to run by hand.
*Why it blocks:* this is the redesign's core premise and the precondition for **every** badge, filter, and per-goal chart in §3. Without it there is no multi-goal anything.
*Done when:* materialized `ActivityGoalLink` rows are written at log time by rules, coach-overridable per the RFC; both hike paths write links identically; G4 passes.
*Note:* the RFC correctly rejects arrays and read-time-only rules. Materialized links mean history doesn't silently rewrite when rules change — consistent with the frozen-history principle in B10.

**B6 · Plan-less goals are invisible on Today** `[VERIFIED]`
A goal with `activePlanId: null` contributes no daily presence. The body-comp goal was invisible six days a week during the Elbert program; project goals are permanently invisible.
*Why it blocks:* two of three Phase 2A goals are plan-less by design. The cut rides weigh-in cadence and nutrition tier; AWS rides a study-hour counter. If they don't reach Today, the import produces two ghost goals.
*Done when:* Today renders the union of the active Program's goals regardless of plan ownership; G3 passes.

**B7 · Goal creation auto-scaffolds a generic Elbert-flavored plan** `[OBSERVED, reproduced 2026-08-09]`
Creating the handstand goal stamped a default week-1 baseline battery (Pull-Up / Push-Up / Plank / Dead Hang) plus an Upper Body session — none of it relevant. The plan had to be set inactive to stop Today showing the wrong session.
*Why it blocks:* the import creates three goals of three different flavors. If each one stamps an irrelevant battery, the import's first act is generating garbage the owner then hand-cleans through the path B1 says is broken.
*Done when:* scaffolding is flavor-aware or opt-in; creating a skill goal, a body-comp goal, and a project goal produces no wrong baselines; G7 passes.

**B8 · Baseline scoping is ambiguous across goals** `[VERIFIED as user-global]`
Baselines carry no `goalId`; a baseline arc reflects all logged tests for that test name.
*Why it blocks:* mostly this is **correct and should stay** — the analysis confirmed global metrics already serve multiple goals' readiness, which is why scoring needs no rewrite. But the import references the same metric from more than one goal's targets (pull-ups appear in both the handstand goal and the cut, as a lean-mass canary), and "same metric, two goals, two meanings" needs an explicit answer.
*Done when:* a single baseline metric provably feeds two goals' readiness without duplication, and the per-goal charts in §3 can show one metric against two goals' target lines; G5 passes.
*Sub-issue* `[OBSERVED]`: when a tested value hits an equipment ceiling (65 lb DB cap at the gym), it reads as a plateau. A `capped` marker makes fixed-load rep redefinitions legible instead of looking like stalled progress.

**B9 · Silent write failures / non-idempotent writes** `[OBSERVED — at least 4 cases]`
A write lands, the response never returns, the retry duplicates the row. Produced duplicate workouts and notes.
*Why it blocks:* the coaching agent drives every write through MCP, and the migration may backfill attribution across 106 historical workouts. Non-idempotent writes plus a backfill is how history gets silently corrupted.
*Done when:* writes accept idempotency keys; G10 passes.

**B10 · Frozen history must survive migration** `[VERIFIED as required]`
Elbert is achieved. Its snapshot, XP, retrospective, and `readinessSeries` are frozen by rule R9.
*Why it blocks:* it doesn't block the import — it's the thing the import must not destroy. Every migration PR is reversible; this is what "lossless" is measured against.
*Done when:* G8 and G9 pass, verified by diffing a pre-migration capture.

**B11 · Every new model must be tenant-scoped** `[VERIFIED — brief §7 is stale]`
The brief said single-user, no auth work. The app is now multi-tenant. That section is wrong.
*Done when:* Program, ActivityGoalLink, and every new model carry tenant scope; no cross-tenant read is possible.

---

### P2 — Fold in where the code is already open. Not gating.

| ID | Issue | Tier | Done when |
|---|---|---|---|
| B12 | `get_day` returns `orphanedOverride: true` on legitimate completed-hike days — **fires on every summit-day override**, worse than originally reported | `[VERIFIED]` | Summit days resolve clean; flag means something |
| B13 | `export_workout` omits exercise/set IDs, making set-level corrections impossible (forces delete-and-relog) | `[OBSERVED]` | Stable IDs exposed |
| B14 | `/days/[dateKey]` has no way to log a meal for that day (the original "no date picker" report was wrong — a hidden picker exists elsewhere) | `[VERIFIED, corrected]` | Meal logging works from the day view |
| B15 | No `SavedMeal` model — repeat meals live as standing-rule notes and get hand-logged every time | `[OBSERVED]` | `SavedMeal { name, macros, defaultServing }` + `log_nutrition(savedMealId, servings)` |
| B16 | Recap card emoji and `/recap/completion` font bundling — same glyph-fallback failure class as the fix that held | `[VERIFIED unfixed]` | Unicode renders everywhere, not just where it was patched |
| B17 | No partial-update path for plan structure; `apply_plan_revision` demands the full ~20KB snapshot | `[OBSERVED]` | A patch op exists, or the Program model makes it moot |

---

## 3. What "clear to proceed" means for the visuals

These are the four surfaces from brief §5, restated as **interaction requirements**. Don't build them until the gate passes — but do design the model so these are cheap rather than heroic. Each one names the blockers it sits on; if those are open, the surface can't be built honestly.

### 3.1 Program dashboard
*Depends on: B3, B5, B6*
All active goals' readiness side by side, each with a trend sparkline. Program-level phase progress and days elapsed/remaining. Clicking a goal's score opens its target breakdown — which targets are pulling the score down, which are gated. **Gates must be legible as gates:** an armed ceiling (readiness capped at 80) has to read as "capped by an unmet gate," not as a mysterious plateau. That distinction has cost real interpretation time.

### 3.2 Unified Today
*Depends on: B1, B4, B5, B6*
Every active goal's asks in one view: training session, nutrition tier, study block, scheduled items, baselines due. **Every item badged with the goal(s) it serves** — that badge is the visible payoff of B5 and the fastest way to spot a broken attribution. Logging happens from here, and a log written here fans out to every linked goal without a second action.

### 3.3 Cross-goal calendar
*Depends on: B4, B5, B7*
One calendar, per-goal color and icon coding, multiple goal-date pins coexisting on one month, rotation days from the Program. A day showing three goals' marks must open to a day detail that agrees with Today and with the month cell — that agreement is the B4 regression test in visual form.

### 3.4 Per-metric progress charts
*Depends on: B5, B8*
Progress-over-time for any tracked metric across the Program window. Overlay two metrics. Per-goal readiness arcs — the frozen `readinessSeries` already exists for completed goals; extend the same shape to live multi-goal. One metric feeding two goals shows both target lines (see B8).

---

## 4. Regression guardrails

Things that were working and must still work when this lands:

- **The MCP surface stays functional throughout.** The coaching agent drives 100% of writes through it. If a tool signature changes, change it in lockstep and **document every diff** — the agent has no way to discover a silent signature change except by failing a write.
- **Readiness scoring is not rewritten.** The analysis confirmed it's sound: global metrics already serve multiple goals, `log:*` is already goal-scoped. Attribution is a presentation and accounting problem, not a scoring one. Extend, don't touch the math.
- **`lint_plan` keeps working**, including content-fingerprinted acknowledgements with self-expiry.
- **Deferral flags stay enforced payload transformations**, not advisory metadata — that was fixed in June and is exactly the kind of thing a resolver consolidation quietly reverts.
- **Achieved goals stay frozen** (B10).

---

## 5. Sequencing

```
B2 (migration safety)          ← first, protects everything after
  └─ B1 (legacy row)           ← unblocks daily use of the current app immediately
       └─ B3, B4               ← the model fix proper
            └─ B5, B6, B7, B8  ← makes the import representable
                 └─ B9, B10, B11 tested continuously
                      └─ §1 GATE
                           └─ IMPORT phase2a-goals-import-spec.md
                                └─ §3 visuals
                                     └─ P2 bugs folded in where code is open
```

**B1 is worth shipping on its own, ahead of the rest.** It restores the ability to write daily overrides in the current app. Every day it stays open is a day the program runs on chat checklists instead of in the product.

---

## 6. Open questions for the owner

The RFC's §7 questions are answered — Program creation is coach/MCP-only for v1, backfill attribution over the 106 historical workouts, XP stays single-ledger. Those stand.

What's still open, and should be resolved before the import rather than during:

1. **Does the import run against a fresh Program, or migrate the existing three goals in place?** They were created under the old model, one carries a bad auto-scaffolded plan (B7), and one has been set inactive. Cleanest may be to delete and re-import from the spec — but that's the owner's call, and it touches goal history.
2. **What happens to a Program when its window closes?** Phase 2A runs Aug 10 – Dec 31. Does the Program complete like a goal does, freeze a snapshot, and hand off to Phase 2B — or just deactivate?
3. **Attribution rules: where do they live and who edits them?** "Incline walk → cut + AWS + Zone 2" is a rule. Config, code, or coach-authored per Program?

---

*Nothing in this document changes the RFC's design. If following it requires a design change, raise it as an amendment rather than absorbing it silently — the owner is reviewing this through the MCP surface and can't see the code.*
