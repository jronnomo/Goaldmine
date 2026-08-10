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

## 2026-08-10 — SavedMeal food-linked bundles: `save_meal` items gain `foodId`/`amount`/`unit`/`itemMacros`; `log_nutrition(savedMealId)` expands with per-item fidelity + FoodUsage bumps

**What:** SavedMeal graduates from a text-item lump into a true food-linked
bundle (owner request: "bundle foods into a meal + quick add, but I still
want the individual items logged with each of their macros as usual").

- **`save_meal` input** — `items[]` rows accept four NEW optional fields:
  `foodId` (FoodLibrary link), `amount` + `unit` (structured portion),
  `itemMacros` (explicit per-item macro override; normally computed).
  At save time the server resolves each `foodId` against the SHARED
  FoodLibrary catalog (raw prisma read — deliberately non-scoped) and stores
  the food's full `source` snapshot (`ItemFoodSnapshot`) + computed
  `itemMacros`/`qty` INSIDE the item row — §B.5 snapshot-off-at-save: later
  FoodLibrary edits never rewrite a bundle; re-save to refresh. Unknown
  foodIds degrade to text-only items and are flagged in the response
  message. Legacy text-only items unchanged and forever valid. Json column —
  NO migration.
- **`log_nutrition(savedMealId)` output rows** — linked bundle items now
  expand to FULL structured NutritionLog items: scaled `amount`, re-rendered
  `qty`, recomputed `itemMacros` (from the save-time snapshot), and the
  `source` snapshot itself — deep-equal to the user hand-picking the same
  food in the web composer (unit-proven: bundle-log ⇄ hand-log row
  equality in `saved-meal.test.ts`). Row macro totals for linked bundles use
  the composer's own recompose math (all six keys, house rounding) instead
  of the lump scaler; text-only meals keep byte-identical legacy lump
  scaling. Each linked food's **FoodUsage** is bumped (usageCount +
  lastUsedAt + last portion at the scaled amount) exactly like a chip pick —
  skipped when explicit `items` override the derived expansion.
- **`list_saved_meals`** — no shape change; stored items may now carry the
  richer bundle fields (documented in the description).
- **Read tools** (`recent_history` etc. via `stripItemSource`) — items now
  pass `itemMacros` through (~60 bytes/item); `source` stays stripped.
- **Web parity** (same seam, not a tool): composer "Save as meal" affordance
  writes through `createSavedMealFromComposition` (scoped, upsert-by-name —
  the exact `save_meal` contract); the #296 quick-pick sheet gained a
  two-tap "Remove saved meal" (same delete core as `delete_saved_meal`).

**Connector reconnect: YES** — `save_meal` input schema changed (new item
fields) and `log_nutrition`/`save_meal`/`list_saved_meals` descriptions
changed. Reconnect the claude.ai MCP connector after deploy or the coach
keeps the cached schema and can't author food-linked bundles.

---

## 2026-08-10 — `rolling:*` metric family: `GoalTargetSchema` gains optional `rolling` params (create_goal / update_goal_targets / promote_note_to_goal / preview_goal_feasibility)

**What:** first readiness-engine metric-family extension since the redesign
froze scoring. `rolling:<opaque slug>` targets are ENGINE-COMPUTED
session-consistency windows (Phase 2A repeatability merge — "≥20s hold hit
in 4 of last 6 sessions", "3× ≥20s within ≤5 attempts in one block"): the
value is derived from logged workout sets, never from LogEntry rows.

**Input-shape change (all four tools that accept `GoalTargetSchema`):** each
target gains an optional `rolling` object —
`{ exercise, minSeconds, hitsPerSession? (default 1), attemptCap?, window? (default 6) }`
— REQUIRED when `metric` starts with `rolling:`, REJECTED on any other
family (cross-field refinement, both directions). `attemptCap` must be
≥ `hitsPerSession`. `rolling.exercise` is canonicalized on write
(`canonicalExerciseName`, the attributionHints doctrine).

**Semantics (resolver, `src/lib/goal-targets.ts` + pure math in
`src/lib/rolling-metrics.ts`):** sessions = completed workouts (startedAt ≤
end-of-day cutoff) with ≥1 set of the canonical exercise carrying a non-null
`durationSec`; one workout = one session; attempts = those sets in
(exercise orderIndex, setIndex) order; qualifying hold = `durationSec ≥
minSeconds`; with `attemptCap`, the hits must land within some consecutive
span of ≤ cap attempts. Value = hit-sessions among the trailing `window`
sessions — 0..window, regresses as old hits roll out. Zero sessions ever →
null (untested; readiness coverage shows the gap). Auto-captured start = 0
(never current). Feasibility/Reach: `rolling` family is conservative
no-rate (verdict `unknown`; gating rolling targets floor the tier).

**Output shapes:** unchanged — rolling values flow through
`compute_readiness` / `compare_dates` / `get_goal` breakdowns as plain
numerics like any other target.

**Coach doctrine:** docs/project-gotchas.md §F-8 — the coach controls the
denominator by what gets logged under the canonical exercise name in a
completed workout; log every deliberate attempt as its own set; incidental
holds must NOT be logged as the tracker's exercise; never re-log rolling
values via `log_metric`.

**Connector reconnect:** YES — `GoalTargetSchema` (nested input schema of
create_goal / update_goal_targets / promote_note_to_goal /
preview_goal_feasibility) and two tool descriptions changed. Reconnect the
claude.ai connector after deploy so the cached schemas refresh.

---

## 2026-08-10 — B7/G7: `create_goal` scaffolding is Program-aware + opt-in (`scaffoldPlan` input, `scaffolded` output)

**Issue:** integration-gate check G7 + blocker B7
(`examples/goaldmine-integration-blockers.md` §1/§2) — creating ANY dated
fitness goal auto-stamped the generic Elbert-flavored `PROGRAM_TEMPLATE`
plan (week-1 Pull-Up/Push-Up/Plank/Dead-Hang baseline battery + Upper Body
session). Reproduced by the owner 2026-08-09 on the handstand goal; the
plan had to be manually set inactive to stop Today showing the wrong
session.

**Why:** the Phase 2A import creates three goals of three different
flavors. If each create stamps an irrelevant battery, the import's first
act is generating garbage. Under the one-active-Program model, rotations
come from the Program pack / import — a fresh goal must never bring its
own generic plan along.

**What changed:**

- `createGoalCore` (`src/lib/goal-core.ts`) scaffold default is now
  **tenant-shaped**: user has an ACTIVE Program
  (`db.program.findFirst({ status: "active" })`, scoped client) → **NO
  auto-scaffold** (`planId: null`); zero-Program or retired-Program tenant
  → legacy auto-scaffold **byte-identical** (still the zero-Program
  onboarding path; regression-pinned by template name/weeks in
  `goal-core.test.ts`). New input `scaffoldPlan?: boolean` overrides the
  default in either direction and skips the Program lookup. The hard gates
  are NOT overridable: someday (`targetDate: null`) and non-fitness goals
  never scaffold, even with `scaffoldPlan: true`.
- `create_goal` **input**: new optional `scaffoldPlan: boolean`
  (`true` = force the scaffold even under an active Program; `false` =
  suppress it even with no Program). Description's scaffolding sentence
  rewritten to teach the Program-aware default.
- `create_goal` **output**: new `scaffolded: boolean` (+ `planId` non-null
  exactly when `true`) — G7 is assertable from the tool result alone.
  `message` names the suppression on a dated fitness goal ("no plan
  auto-scaffolded — an active Program owns the rotation…" / "suppressed by
  scaffoldPlan:false"); someday + project messages unchanged.
- **Inherited by the other `createGoalCore` callers** (no schema change
  there): `promote_note_to_goal` and the /goals + onboarding UI forms get
  the same Program-aware default — under an active Program
  `promote_note_to_goal`'s `planId` output is now `null` for a dated
  fitness promotion.
- `ensurePlanForGoalCore` / `update_goal`'s dated-upgrade path **UNTOUCHED**
  — setting a `targetDate` on a plan-less goal still deliberately
  scaffolds for all tenants; that remains the explicit opt-in path.

**Tests:** `src/lib/goal-core.test.ts` — new B7/G7 matrix (active-Program
suppression; zero-Program legacy scaffold pinned to
`"<objective> — N-week plan"` / `weeks` / `planJson.name: "Mt. Elbert +
Shred 90-Day"` / initial-revision summary; `scaffoldPlan:true` under a
Program scaffolds without consulting Program state; `scaffoldPlan:false`
suppresses for legacy tenants; hard gates beat `scaffoldPlan:true` for
project/someday; retired-Program tenant = legacy path) + `scaffolded`
pinned on the pre-existing kind-gate tests.

**Connector reconnect:** YES — `create_goal` input schema (`scaffoldPlan`),
output shape (`scaffolded`), and description all changed. Reconnect the
claude.ai MCP connector after this deploys.

---

## 2026-08-10 — UXR-PV-89: `attribute_activity` remove = TOMBSTONE (durable) + `list_activity_links` hides removed links by default

**Issue:** #290 wave (Sprint 19 / M4b) — ledger sign-off `UXR-PV-89` from
`docs/ux-research/program-views.md` §4.2.

**Why:** "remove always wins" was not durable. `ActivityGoalLink.source` was
`"auto" | "explicit"` only, and the auto-link engine writes with
`createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING) against
`@@unique([activityType, activityId, goalId])` — so hard-deleting a link on
remove freed the unique key, and any rules re-run over that activity (log-time
hook retry, `scripts/backfill-attribution.ts`) silently resurrected the link
the coach had just removed.

**What changed:**

- `attribute_activity` `action:'remove'` now **updates the row to
  `source:'removed'` and keeps it** (a tombstone) instead of deleting. The
  occupied unique key is what makes removal durable: the auto-engine's
  insert-or-skip can never touch an existing row, so nothing short of an
  explicit re-add brings the link back. Removing a non-existent OR
  already-removed link stays an idempotent no-op (`changed:false`,
  `removedSource:null`). The `removedSource` output field still reports the
  pre-tombstone source on a real removal.
- `attribute_activity` `action:'add'` over a tombstone **revives** it to
  `source:'explicit'` in place (same row, no duplicate). New output field
  `revived: boolean` on the add path; `upgraded` now strictly means
  auto→explicit (it is `false` on a revival).
- `list_activity_links` **excludes `source:'removed'` rows by default** — a
  removed link reads as removed everywhere. New optional input
  `includeRemoved: boolean` (default false) returns tombstones for audit
  ("what did I remove?").
- Delete-hooks are UNCHANGED and deliberately tombstone-blind: deleting an
  activity hard-deletes ALL of its link rows including tombstones (once the
  activity is gone there is nothing left to block). The orphan verifier
  (`scripts/verify-activity-links.ts`) likewise still flags a tombstone whose
  activity row is gone — such a row is drift, not policy — and its report now
  prints each finding's `source`.
- Schema: comment-only (`source` is a plain `String`; `// auto | explicit |
  removed`). **No migration.**

**Tests:** `src/lib/attribution-manual.test.ts` (remove→update-to-removed for
auto and explicit alike, no delete call; already-removed no-op; revive
add-path with `revived:true`/`upgraded:false`; an in-memory
ON-CONFLICT-DO-NOTHING simulation proving `writeAutoLinks` skips a tombstoned
key and never mutates the row; list default filter + `includeRemoved`),
`src/lib/activity-delete-cores.test.ts` (delete-hook cleanup filters on
(type, id) only — tombstones hard-deleted with their activity),
`src/lib/activity-links.test.ts` (orphan classification stays source-blind —
a tombstone whose activity is gone is still flagged).

**Connector reconnect:** YES — `attribute_activity` gained the `revived`
output field + changed remove semantics/messages, and `list_activity_links`
gained the `includeRemoved` input. Reconnect the claude.ai MCP connector
after this deploys.

---

## 2026-08-10 — #282/#283/#284: the program-shaped day — `get_today_plan` merger + program context on `get_day` / `get_week` / `get_session_brief`

**Issues:** #282 (ResolvedDay keys) · #283 (merger) · #284 (three read tools) — Sprint 18 "Program-shaped day", epic #260. Documented per #286.

**Connector reconnect REQUIRED after deploy** — FOUR read-tool descriptions
changed (`get_today_plan`, `get_day`, `get_week`, `get_session_brief`) and
`get_today_plan`'s output shape changed for Program users; the claude.ai
connector caches the old schemas/descriptions until reconnected (Settings →
Connectors → Goaldmine → reconnect). `COACH_INSTRUCTIONS` also changed
(goal-kind routing block) — re-paste `docs/server-instructions/goaldmine-rules.md`
into the deployed connector text (three-places rule, gotcha §B.6).

### ⚠️ The behavior change most likely to surprise an in-flight session

**`isInPlan` / `confidence` no longer reflect an unrelated plan's window on a
project-focus day.** Pre-#283, `get_today_plan` with a project-kind focus goal
CARRIED `resolveDay`'s `isInPlan`/`confidence` — which, pre-seam, could come
from a *different* goal's active Plan (the RFC-cited leak: a project day
showing a fitness plan's window). For Program users these now describe ONLY
the Program's plan — or `isInPlan:false` / `confidence:null` when the Program
has no rotation plan. A saved prompt that read `isInPlan:true` as "there is a
plan somewhere" will now see `false` on plan-less Program days.

Also surprising: for a Program user with a project-kind focus goal, the
payload is **no longer the nulled project shape** — `todayTask` is a real
TodayTask again (the rotation lives alongside project work). An active
Program with zero active Plans yields `todayTask:'out_of_plan'` with null/[]
fitness fields — that is the normal "no rotation today" state (chewgether),
NOT an error, and never a fall-through to another goal's plan.

### `get_today_plan` — before → after

- **Before:** payload shape forked on `focusGoal.kind` — fitness-shaped
  (full rotation fields, `todayItems: []`, no `feasibility`) XOR
  project-shaped (`shapeProjectTodayPayload` nulled every fitness field;
  `todayItems`/`feasibility` for the focus goal only). Cross-goal work on a
  fitness day was invisible.
- **After (user has an active Program):** ONE merged shape
  (`shapeProgramTodayPayload`) for every case — program-with-plan,
  program-without-plan, any focus kind:
  - full ResolvedDay passes through untouched (rotation fields reflect the
    Program's plan only), PLUS
  - `program {id, name, status, startedOn, endsOn, memberGoals[{id, objective,
    kind, status}]}`,
  - `scheduledItemsToday [{id, goalId, goalObjective, type, title, detail,
    status, completedAt}]` — today's ScheduledItems unioned across ALL member
    goals,
  - `goalMarks [{goalId, objective, kind, claims[]}]` — per-goal day-service
    claims: `rotation` / `scheduled_item` / `baseline:<testName>` /
    `nutrition` (plan-side only; logged-side fill state lands with the Today
    UI story),
  - `todayItems` — same union in the saved-prompt-compatible shape, each row
    + `goalId`/`goalObjective`,
  - `goalSections` — Record keyed by goalId: `{goalId, objective, kind,
    status, todayItems, feasibility}` with ONE feasibility computation per
    ACTIVE project-kind member goal.
- **After (zero-Program legacy tenant):** byte-identical to before — the old
  kind fork survives as `shapeLegacyProjectTodayPayload` / the fitness spread
  — plus the three additive keys as `program:null`,
  `scheduledItemsToday:[]`, `goalMarks:[]`.
- Description rewritten: the "project-shaped vs fitness-shaped" branching
  language is gone, replaced by the merged-shape description.

### `get_day` — before → after

- **Before:** raw ResolvedDay; no Program awareness.
- **After:** ResolvedDay's new `program` / `scheduledItemsToday` / `goalMarks`
  pass through verbatim, for past AND future dates (additive; null/[] for
  zero-Program tenants). Description updated.

### `get_week` — before → after

- **Before:** days[] had no Program context; an anchorless call always said
  "No active program yet — create a goal with a target date…".
- **After:** each days[] entry carries `program`/`scheduledItemsToday`/
  `goalMarks` (membership fetched ONCE per call and threaded via
  `ResolveDayCtx.membership` — not 7 lookups). Anchorless call for a
  pure-project Program (active Program, no rotation plan) now returns an
  honest message + compact `program` block instead of "create a goal";
  the zero-Program empty-state message is byte-identical. The
  isInPlan-based "Date is outside any plan window" short-circuit is
  unchanged. Description updated.

### `get_session_brief` — before → after

- **Before:** no Program awareness (blind to non-fitness member-goal work).
- **After:** new `program` block — `{name, status, memberGoalCount,
  memberGoals[], rotationOwnerObjective, scheduledItemsToday[{goalId,
  goalObjective, type, title, status}]}` — derived entirely from resolveDay's
  fields (zero extra queries); `null` for zero-Program tenants. Existing
  `plan` (week/phase) block unchanged. Description updated.

**Three-places rule (§B.6):** tool descriptions (this sprint's #283/#284
commits) · this TOOL-DIFFS entry · `COACH_INSTRUCTIONS` goal-kind routing
block + `docs/server-instructions/goaldmine-rules.md` mirror (#286 commit).
Deployed connector text is the fourth copy — update at deploy time.

**Tests:** `calendar.test.ts` (#282 keys, Phase-2A fixture, zero-Program
regression, ctx.membership short-circuit) · `today-shapers.test.ts` (merger
+ chewgether invariant DA#10 + legacy byte-compat) · `leaky-reads.test.ts`
(feasibility query projection, membership batched once, no-userId payloads,
zero-Program legacy paths).

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

---

## 2026-08-10 — isFocus sweep S20 batches (#297/#299/#300/#302) + cross-goal calendar windows contract (#291)

**Issues:** #297 (lib-core), #299 (engine site), #300 (MCP tools batch),
#302 (stale descriptions), #291 (cross-goal calendar).

### Resolution changes (behavior)

`getRotationOwnerGoal()` (`src/lib/goal-focus.ts`) is now THE shared
"current goal" accessor: the active Program's rotation-owning goal
(Plan.goalId of `getActiveProgram()`'s plan); the byte-identical legacy
`isFocus: true` query for zero-Program-rows tenants; `null` for
rotation-less/retired-Program tenants. Swapped onto it:

- lib-core (#297): `getCalendarMonth` Phase-1 goal read, `resolveDay`'s
  day-goal read (new `ResolveDayCtx.dayGoal` batches it in `get_week`),
  `getPendingNotesCount`, `lintActivePlan` (now lints `getActiveProgram()`'s
  own plan row), `orphanedOverrideWarning`.
- engine (#299): `_computeGameState`'s pack-gating goal = rotation owner
  **?? legacy focus** — the fallback is the TRACKED EXCEPTION per the M4c
  non-goal (single-ledger v1): a rotation-less Program must not re-gate
  attributes to the "fitness" default. Equivalence proven: new
  `scripts/diff-engine-goal-context.ts` pre/post full-state snapshot on dev
  (founder = zero-Program) — zero bytes changed; `diff-xp-ledger.ts` stays
  XP-NEUTRAL.
- MCP (#300), 8 sites in `tools.ts`: `get_today_plan` (activeGoalRow),
  `compute_readiness` (omitted-goalId default), `get_pending_notes` (planId
  via `getActiveProgram()`), `get_session_brief` (default goal),
  `get_day_footage` (caption goal), `acknowledge_lint_finding` +
  `clear_lint_acknowledgement` (the linted plan = `getActiveProgram()`'s
  plan, matching `lintActivePlan`), `grant_bonus_xp` (rotation owner ??
  legacy focus — deliberately the SAME composition as the engine's #299
  tracked exception, so grant-time attribute validation can never disagree
  with the pack the ledger renders). Error text reworded to the new failure
  modes (e.g. "No current goal to default to — the active Program has no
  rotation (or no goal is focused). Pass goalId explicitly…"; "No active
  rotation plan found…"). `get_day_footage` also drops the old query's
  `active: true` belt (invariant-covered: the focus goal cannot be
  untracked; a rotation owner's plan is active).
- NOT swapped (deliberate): `list_goals`' isFocus-desc ordering + `isFocus`
  output field (display/compat, per the AC); hike **read-time attribution**
  (`hike.goalId ?? focusGoalId`, goal-events) — unchanged machinery, so the
  "attributed to the focus goal at read time" prose in `log_hike` /
  `update_hike` / `list_planned_hikes` / `delete_goal` remains TRUE and was
  left alone; `render-tools.ts:79` + its descriptions are SIBLING-OWNED
  (#301 batch) and untouched here.

### #291 — the calendar windows contract (writer: Phase 2A import)

`src/lib/calendar-windows.ts` derives deload/observance windows from the
ACTIVE plan's day-swap override **titles** — no schema change:
`workoutJson.title` prefix `"Deload"` → `deload` (second-grid-row span
bar), prefix `"Mirror Lake"` → `observance` (the covered cell renders ONE
em dash — no band, no wash, no marker, zero motion; UXR-PV-88/39). The
writer side is `buildPhase2aOverrides()` (`src/lib/phase2a-spec.ts`) —
"Deload #1 — Virginia", "Deload #2 — Thanksgiving", "Mirror Lake — Matt".
If the import's titles ever change, the classifier and spec must move
together. Note-only overrides (the Virginia soft break) are NOT windows.
`get_day`/`get_today_plan` payloads are untouched by #291 (calendar cells
gained `memberGoalMarks`/`memberGoalEvents`/`window` — dashboard-only).

### #302 — description strings changed (`src/lib/mcp/tools.ts`)

Canonical phrasing used throughout: *"the focus goal (or the Program's
rotation-owning goal when a Program is active)"* — truthful for both
tenant shapes.

| Tool | What changed |
|---|---|
| `get_today_plan` | "focusGoal is the isFocus=true goal" → "the goal driving the day — the focus goal (or the Program's rotation-owning goal when a Program is active)" |
| `list_goals` | isFocus now described as the LEGACY single-focus flag: drives the prescription only for tenants without a Program; display/compat field under one |
| `get_goal` | same isFocus=true correction (legacy-only day-driver) |
| `compute_readiness` | goalId input: "Omit to default to the focus goal (or the Program's rotation-owning goal…)" |
| `lint_plan` | empty-shape condition now names both shapes (focus goal without a plan / Program without a rotation) |
| `get_session_brief` | "focus goal + days-to-go" → "the current goal (the focus goal, or the Program's rotation-owning goal when a Program is active)" |
| `confirm_week` | "operates on the active rotation plan (the Program's plan when a Program is active; the focus goal's plan otherwise)" |
| `create_goal` | now teaches the REAL day-driver model: new goals join no Program; attach via `attach_goal_to_program` (or `create_program`/`update_program`/`set_program_status`); `set_active_goal` described as the compat shim with its cross-Program blast radius |
| `set_goal_tracked` | focus-switch parenthetical → compat-shim + Program-pack routing |
| `set_plan_active` | same + "which goal's plan drives the day is a Program concern — manage via the Program pack rather than focus flips" |
| `grant_bonus_xp` | attribute input: "for the current goal's kind — the Program's rotation-owning goal when a Program is active, else the focus goal" |
| `generate_recap_card` | default-goal + input `goalId` descriptions → canonical phrasing |

`instructions.ts` (COACH_INSTRUCTIONS) audited: the set_active_goal
covenant + ACTIVE PROGRAM payload block were already synced by #280/#283 —
no stale "focus-switching is app-UI only"-era text remains; no changes.
`program-tools.ts` audited: no focus-goal phrasing. `render-tools.ts`'s
"FOCUS goal" strings ride with the sibling #301 batch (file ownership).

**Tests:** full `src/lib/mcp/` suite green (leaky-reads +
no-founder-leak assertions unchanged); `engine.scenario.test.ts` gained
the #299 equivalence trio; `calendar.test.ts` gained the #291 Program
month suite + zero-Program inertness assert; new
`calendar-windows.test.ts` (incl. the research-required synthetic
boundary-crossing segment fixture).

**Connector reconnect:** YES — tool descriptions + error text changed
(no schema/tool-count change). Reconnect the claude.ai MCP connector
after this deploys so cached descriptions refresh.
