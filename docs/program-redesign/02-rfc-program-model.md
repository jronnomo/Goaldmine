# RFC: The Program Model — multi-goal days for Goaldmine

*Deliverable 2 of the redesign brief. Status: **APPROVED by owner 2026-08-09** — core design signed off (name reclaim, Plan-under-Program, ActivityGoalLink, five-stage migration). Open-question resolutions recorded in §7.*

*Prereq reading: `01-current-state-analysis.md` (all design choices below cite its findings).*

---

## 0. Design goals, restated against the verified code

1. One **Program** owns the calendar window, the rotation, and the day. Goals become outcomes a Program advances.
2. One logged activity can visibly serve many goals (the Monday walk+AWS case).
3. Readiness scoring is untouched (analysis §2.6 proves the acceptance case needs no rewrite).
4. Achieved goals stay byte-stable (R9); all migrations lossless and reversible.
5. Multi-tenant safe: new models join `SCOPED_MODELS`, isolation-verified, leaky-reads-covered.
6. Minimize blast radius across the three independent day-resolvers (analysis §4.2) — the design must be **adoptable behind a seam**, not a big-bang rewrite.

---

## 1. The shape in one picture

```
User ──1:N── Program (status: draft|active|completed|archived; ONE active per user, DB-enforced)
               │  owns: window (startedOn/endsOn), day overrides (via its Plan), membership
               ├──1:N── Goal.programId?     ← membership ("in play"); replaces isFocus
               │          (someday goals: programId = null → dormant, as today)
               └──1:N── Plan.programId?     ← the Program's rotation document(s)
                          Plan.goalId KEPT  ← "the goal whose training rotation this is"
                          (PlanRevision, PlanDayOverride: UNCHANGED, still keyed to Plan)

ActivityGoalLink (NEW) ── activity (Workout|Hike|NutritionLog|LogEntry|Measurement…) ×N→N× Goal
```

Key insight that keeps this small: **the brief's "Program owns the rotation" and the existing "Plan is the rotation" compose instead of colliding.** The Program is the membership + window + activation object; the Plan stays the rotation *document*, reparented under the Program. `PlanDayOverride`/`PlanRevision` FKs never move — the riskiest data in the system doesn't migrate at all.

This also answers "who owns the rotation" in the acceptance case for free: the handstand goal keeps `Plan.goalId` on the Program's plan; the cut and AWS goals are members with no plan — exactly the brief's scenario.

## 2. Decisions

### D1 — Reclaim the name `Program` (recommended) 

The legacy `Program` table (analysis §2.2.3) is renamed `LegacyProgram` in a lossless `ALTER TABLE … RENAME`, its fallback branch in `getActiveProgram()` is deleted, and the seed stops writing it. Prereq script verifies the founder's past dates all resolve via Plan candidates under SMOKE-1 before the fallback is removed (if any date regresses, we backfill a covering archived Plan first). This retires a live bug class (override-invisibility shadowing) independently of everything else — it ships as its own PR.

*Alternative rejected:* naming the new entity `Season`/`Block`/`Campaign`. "Program" is the product word the founder and coach already use; carrying a synonym forever to avoid a one-line rename migration is a bad trade.

### D2 — New `Program` model

```prisma
model Program {
  id          String    @id @default(cuid())
  name        String                       // "Phase 2A"
  status      String    @default("active") // draft | active | completed | archived
  startedOn   DateTime
  endsOn      DateTime?
  notes       String?
  userId      String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  goals  Goal[]
  plans  Plan[]
  user   User? @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, status])
}
```

Plus, in raw SQL in the same migration — the constraint `isFocus` never had:

```sql
CREATE UNIQUE INDEX program_one_active_per_user
  ON "Program" ("userId") WHERE status = 'active';
```

Additive columns elsewhere (all nullable → zero-risk migration):
- `Goal.programId String?` (SetNull on program delete)
- `Plan.programId String?` (SetNull)

`Program` joins `SCOPED_MODELS`. Writes use sequential top-level tx calls (gotcha §B-9).

*Alternative rejected:* absorbing `planJson`/overrides/revisions into Program directly (the brief's literal shape). It forces migrating `PlanDayOverride` + `PlanRevision` FKs and rewriting every `planId`-keyed call site in one motion — maximal blast radius for zero user-visible gain. If we later want one table, that consolidation can be its own boring migration after the seam has settled.

### D3 — Focus is replaced by the active Program (brief §4, confirmed feasible)

New selector, one function, one seam:

```
getActiveProgram():  active Program → its active Plan (rotation) + member goals
                     └─ no Program rows for this user? → legacy path (isFocus tiebreak, exactly today's behavior)
```

The fallback makes rollout per-tenant and reversible: users without a Program row (all other tenants) see zero behavior change. The founder gets a backfill (M3 below); `isFocus` stays populated-but-deprecated for one release, then the ~20 read sites (analysis §2.1) are swept in mechanical batches: "the focus goal" → "the Program's rotation-owning goal" (`plan.goalId`) where the code means *the prescription*, and → "member goals" where it means *what's in play*. `set_active_goal` survives as a compatibility shim (sets the rotation-owning goal / activates that goal's program) with a deprecation note in its description; new tools land alongside (§5).

Guard rails: `setFocusGoalCore`'s achieved-goal guard carries over — an achieved goal can never be attached to a Program (R9). `completeGoalCore` gains one line: detach the completed goal from its Program (`programId = null`) — snapshot/retrospective/XP untouched.

### D4 — Attribution: a materialized join table, auto-populated by rules (the crux)

```prisma
model ActivityGoalLink {
  id           String   @id @default(cuid())
  activityType String   // "workout" | "hike" | "nutrition" | "log_entry" | "measurement" | "mobility" | "baseline"
  activityId   String   // id in that table (polymorphic — no FK; integrity via nightly verifier + delete hooks)
  goalId       String
  goal         Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  source       String   @default("auto") // auto (rule-derived at write time) | explicit (coach/user set)
  note         String?  // optional "why" — e.g. "Z2 base for handstand"
  userId       String?
  createdAt    DateTime @default(now())
  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([activityType, activityId, goalId])
  @@index([userId, goalId, createdAt])
  @@index([activityType, activityId])
}
```

**Why this over the two alternatives the brief names:**

- *`goalIds[]` array columns* — rejected. Scattered across 7+ models, no referential integrity, weak indexing ergonomics in Prisma, and every model grows the same denormalized field. The join table is one place, one unique constraint, one verifier.
- *Read-time attribution rules only* — rejected as the primary mechanism. Rules change; if attribution is recomputed at read time, **history silently rewrites** when the founder tunes a rule ("Z2 no longer counts toward handstand"), which is exactly the class of surprise this app's frozen-snapshot philosophy (R9) exists to prevent. Materialized links are historical truth: what this activity counted for *when it was logged*.

Rules still exist — as the **writer** of `source: "auto"` links, at log time. v1 rule inputs (deliberately boring): `Goal.attributionHints` (canonical exercise names — finally promoted from display-only to load-bearing), workout `category` → goal tags (e.g. `zone2-mobility` → goals that declare a Z2 hint), Hike → its existing `goalId`, LogEntry → its existing `goalId`, NutritionLog → member goals with nutrition-relevant targets. The coach can add/remove links explicitly (`attribute_activity` tool) — explicit links are never touched by rule re-runs.

**Scope guard:** links drive *display, badging, per-goal history, and future accounting* — **not readiness**. `hike:*` and `log:*` keep their existing single-`goalId` scoping (analysis §2.6); global metrics stay global. Zero changes to `readiness.ts` / `goal-targets.ts` in this phase. (If we ever want link-scoped metrics — e.g. `linked:zone2_minutes` — that's a new metric family, additive, later.)

Existing `Hike.goalId` stays authoritative for hikes (links are additive alongside it) — no rewrite of hike semantics.

### D5 — Day resolution: extend `ResolvedDay`, don't fork it

`resolveDay` keeps its shape and callers. Changes:

1. It resolves the plan via the new `getActiveProgram()` (D3 seam) — internally almost identical.
2. New additive fields: `program { id, name, memberGoals: [{id, objective, kind, servesToday: string[] }] }`, `scheduledItemsToday` (union across **all** member goals, each row carrying `goalId` — this is what makes AWS blocks appear on a fitness day), and `goalBadges` per prescription element (from links + rules).
3. The project/fitness dichotomy in `get_today_plan` dissolves: the payload becomes **program-shaped** — rotation prescription (if the Program has a plan) *plus* per-goal sections. `today-shapers.ts` becomes the merger instead of the nuller. `get_day`/`get_week`/`get_session_brief` gain the same fields (fixing their current project-blindness, analysis §2.4).
4. The three duplicate resolvers are handled in order of risk: calendar `buildCell` gets member-goal items via the existing `otherGoalEvents` machinery generalized to member goals (small); the game engine keeps single-ledger-per-day semantics **unchanged** in this phase (open question Q3); `getTodayContext` is deleted and its two call sites read `resolveDay`'s output (it's a strict subset).

### D6 — Migration path (lossless, reversible, five PRs)

| # | Ships | Reversal |
|---|---|---|
| M0 | **Deploy-safety first** (bug B8): `scripts/check-migration-status.ts` run as `prebuild` — fails the Vercel build if `prisma migrate status` reports pending migrations against the target DB. Nothing else in this RFC merges before M0 is live. | delete script |
| M1 | Legacy retirement (D1): rename `Program`→`LegacyProgram`, drop fallback code, coverage-verify script for founder history. | rename back, restore branch |
| M2 | Additive schema (D2, D4): `Program`, `ActivityGoalLink`, `Goal.programId`, `Plan.programId`, partial unique index. No behavior change — nothing reads the new tables yet. | drop tables/columns (nothing depends on them) |
| M3 | Founder backfill + seam flip (D3): script creates the Program from the current active Plan + focus goal, attaches member goals per owner instruction; `getActiveProgram()` reads Program-first with legacy fallback. Auto-linking starts for new logs. **No historical backfill of links in v1** (open question Q2). | set founder's Program `status:'archived'` → instant fallback to isFocus path |
| M4 | isFocus sweep + UI (D5, §4, §5): read-site batches, unified Today, calendar, dashboard, new tools. `isFocus` column dropped only after a full release of silence. | per-batch git revert; column still present |

Every migration validated by SQL diff review (existing CLAUDE.md rule) + `db:verify-isolation` + the launch-gate skill; prod applies remain manual (`neonctl` + `migrate deploy`) — now enforced by M0 rather than by memory.

## 3. The acceptance case, traced through the design

Phase 2A Program: handstand (owns the Plan via `Plan.goalId`), cut (member, no plan), AWS (member, `kind: project`, no plan).

**Monday:** `get_today_plan` → rotation slot from the Program's plan (skill block + lift from `weeklySplit`), `scheduledItemsToday` unions the AWS study block and the cut's weigh-in `ScheduledItem`s, nutrition tier as today. Walk+AWS logged as one Workout (`zone2`) + one `log_metric` LogEntry (study_hours → AWS): auto-links stamp the Workout → cut (Z2 hint) + handstand (Z2 base hint); LogEntry → AWS natively. Readiness moves with **zero new machinery**: cut via global `weightLb`/body-fat, handstand via global `baseline:*`, AWS via goal-scoped cumulative `log:study_hours`. An end-to-end Vitest (deliverable 7) seeds exactly this and asserts the merged payload + three readiness deltas from one day's logs.

## 4. The four visualizations (brief §5)

1. **Program dashboard** (`/program`): member-goal readiness cards + sparklines (existing `computeReadinessSeriesSampled` per goal — no new math), phase progress, days elapsed/remaining from the Program window.
2. **Unified Today**: `/` renders the program-shaped `ResolvedDay` — prescription + per-goal sections, each item badged with the goal(s) it serves (links). `ProjectTodayView`'s separate query path dies.
3. **Cross-goal calendar**: per-goal color/icon via the existing `legend` machinery promoted from per-goal to per-program; member goals' pins/items coexist (generalized `otherGoalEvents`); rotation days from the Program's plan.
4. **Per-metric progress** (`/progress` extended): metric-over-time for any target metric across the Program window; readiness arc per member goal, live alongside frozen arcs of completed goals (R9 branch untouched).

## 5. MCP tool surface (lockstep, documented diffs)

- **New:** `create_program`, `update_program`, `set_program_status`, `attach_goal_to_program` / `detach_goal_from_program`, `get_program_overview`, `attribute_activity` (add/remove explicit links), `list_activity_links`.
- **Changed (documented in a `TOOL-DIFFS.md`):** `get_today_plan` / `get_day` / `get_week` / `get_session_brief` gain program fields (project-kind nulling replaced by merging); `list_goals` gains `programId`/membership; `set_active_goal` becomes a documented compat shim; stale descriptions from analysis §2.1 fixed in passing.
- Every new read tool gets `leaky-reads.test.ts` coverage; connector reconnect after deploy noted in the release checklist.

## 6. Bug fixes folded in (verified scope from analysis §3)

| Bug | Fix | Rides with |
|---|---|---|
| B1 orphanedOverride | Drop the `status:"planned"` filter for this check and stop short-circuiting on `isOverride` before the hike lookup — reuse `override-integrity.ts`'s no-filter query; add the missing true/false-positive tests | D5 (same function) |
| B2 export IDs | Add `id` to `FormattableExercise`/`FormattableSet` + projection (+ restore `rpe`/`notes` on sets) | standalone, anytime |
| B3 idempotency | Optional `requestId` param on `log_workout`/`log_note`/`log_nutrition`/`workout_ops`/`batch_*`; one `WriteReceipt { userId, requestId, toolName, resultJson }` table with `@@unique([userId, requestId])` — replay returns the stored result | M2 (schema) |
| B4 nutrition dates | Surface the date control in create mode; pass `dateKey` from `/days/[dateKey]` (add the missing log-form there); "add to this meal vs new meal" choice when a same-slot log exists | M4 UI pass |
| B5 SavedMeal | `SavedMeal { name, items Json, macros, defaultServings }` (scoped) + `log_nutrition(savedMealId, servings)` + composer quick-pick | M2 (schema) |
| B6 capped flag | `Baseline.capped Boolean @default(false)` + tool params + chart/records marker (distinct from plateau) | M2 (schema) |
| B7 glyphs | Replace recap highlight emoji with bundled inline SVG (same treatment as `ab63315`); add `/recap/completion` to `outputFileTracingIncludes` | standalone, urgent-ish |
| B8 migration safety | M0 — ships **first** | M0 |

## 7. Open questions — RESOLVED (owner sign-off, 2026-08-09)

1. **Q1 — Program creation UX:** ✅ coach-driven via MCP only for v1 (default accepted; app UI wizard deferred).
2. **Q2 — Historical link backfill:** ✅ **start at cutover** — the 106 workouts/15 hikes stay unlinked; links accumulate from Phase 2A day one. A rules backfill remains possible later as its own decision.
3. **Q3 — XP on multi-goal days:** ✅ **single day-ledger unchanged in v1**; per-goal XP attribution via links is a later story.
4. **Q4 — `endsOn` semantics:** ✅ nullable `endsOn`; when set, out-of-plan behavior matches today's plan-window semantics (default accepted).
5. **Q5 — M4 delivery:** ✅ split across multiple PRs/sessions with the compat seam live in between (default accepted).

Additionally resolved: **UX-research pass runs before the M4 view build** (unified Today, program dashboard, cross-goal calendar), in parallel with Track 2 (M1–M3). View-design stance for complementary goals: Today renders as one timeline with per-item goal chips — never per-goal sections (a shared activity must not repeat); goals separate on the program dashboard.

## 8. Explicitly out of scope (guardrails restated)

Achieved-goal snapshots/XP/retrospectives untouched (R9/R10); no readiness scoring changes; no auth/tenancy redesign (only compliance with it — a correction to brief §7); no game-engine ledger semantics change in v1 (Q3); `recent_history` truncation and other MCP ergonomics not named in the brief.
