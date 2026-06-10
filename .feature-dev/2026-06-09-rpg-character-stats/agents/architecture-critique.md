# Architecture Critique — RPG Character Stats

**Reviewer**: Devil's Advocate Agent
**Date**: 2026-06-09
**Blueprint under review**: `agents/architecture-blueprint.md`
**Ground truth**: `agents/research-output.md` > `docs/prds/PRD-rpg-character-stats.md`
**Status**: NEEDS REVISION

---

## STOP BEFORE READING

Three findings (CRIT-1, CRIT-2, CRIT-3) mean the engine as blueprinted cannot compile and violates a core product promise. They must be fixed in the blueprint before developers touch the keyboard. The rest are correctness bugs or under-specifications that will produce wrong behavior or leave developers guessing.

---

## Critical Issues

### CRIT-1 — Promise.all chicken-and-egg: `program` used before it is resolved

**Location**: Blueprint §4.2 "The ~10-Query Promise.all"

**What's wrong**: The exact code shown destructures `program` from the Promise.all result, then references `program` inside the same Promise.all array:

```typescript
const [
  program,         // ← not resolved yet at construction time
  goal,
  workoutsRaw,
  ...
] = await Promise.all([
  getActiveProgram(),
  ...
  program ? prisma.workout.findMany({...}) : Promise.resolve([]),
  // ↑ TypeScript error: `program` undefined here
```

D-12 contradicts the code example and correctly states `getActiveProgram()` must run as a standalone await before the fan-out. But the code developers will copy-paste fails to reflect D-12.

**Why it matters**: Code won't compile. TypeScript errors at build. Developers who copy the code example verbatim ship nothing.

**Fix**: Delete `getActiveProgram()` from the Promise.all. Call it first as a standalone await. Only then construct planStart/planEnd and fan out the remaining 9 queries:

```typescript
const program = await getActiveProgram();
if (!program) return { goalKind: null, ... };

const planStart = startOfDay(program.startedOn);
const planEnd   = endOfDay(addDays(program.startedOn, program.template.totalWeeks * 7 - 1));

const [goal, workoutsRaw, hikesRaw, ...] = await Promise.all([...]);
```

**Severity**: Critical — prevents compilation.

---

### CRIT-2 — Prisma select + include conflict on workout query

**Location**: Blueprint §4.2, workout findMany call

**What's wrong**: The blueprint code uses `include` and `select` at the same Prisma level, which is a Prisma type error:

```typescript
prisma.workout.findMany({
  include: {              // ← can't use alongside top-level select
    exercises: {
      include: { sets: { select: {...} } },  // ← same problem on WorkoutExercise
      select: { name: true },
    },
  },
  select: { id: true, startedAt: true, status: true, source: true },  // ← conflicts with include
})
```

Prisma does not allow `select` and `include` at the same level. This produces a compile-time type error. The WorkoutExercise level has the same problem: `include: { sets: {...} }` and `select: { name: true }` are mutually exclusive.

**Why it matters**: `npx tsc --noEmit` fails. Acceptance criterion §8.1 is immediately broken.

**Fix**: Use pure `select` nested all the way down:

```typescript
prisma.workout.findMany({
  where: { startedAt: { gte: planStart, lte: planEnd } },
  select: {
    id: true,
    startedAt: true,
    status: true,
    source: true,
    exercises: {
      select: {
        name: true,
        sets: {
          select: { weightLb: true, reps: true, durationSec: true },
        },
      },
    },
  },
})
```

**Severity**: Critical — prevents compilation.

---

### CRIT-3 — Pre-plan PR history excluded; "no cold start" promise broken

**Location**: Blueprint §4.2 (query bounds), §4.5 (PR replay), PRD §1.3 success criteria

**What's wrong**: The engine bounds ALL queries to `[planStart, planEnd]`. Workouts logged before `program.startedOn` are never fetched. The PR replay therefore only sees in-plan history. 

The consequence: the first time the user logs any exercise inside the plan window, the engine treats it as "first ever record — NOT a PR" (blueprint §4.5 explicit rule). If the user has been lifting for 2 years with PRs pre-plan, those PRs are invisible. The second in-plan lift (if heavier) generates a PR, but only because the in-plan "first" became the prior. All pre-plan PRs generate zero XP. Badge #2 "On Record" and badge #3 "PR Machine" counts are similarly depressed.

PRD §1.3: "Whole history counts retroactively on day one — no cold start." The engine violates this. The PRD §3.3 also says the XP ledger is derived — but "derived from existing history" implicitly includes pre-plan history for PR baseline purposes.

**Why it matters**: Cold-start experience is exactly what the PRD promises to avoid. Users with long lifting history get fewer PRs and slower progression to "PR Machine" badge.

**Fix options** (pick one; document the chosen approach):

Option A (narrow fix): For PR baseline purposes only, extend the workout query to `[epoch, planEnd]` — fetch ALL workouts for PR history but only award XP for PRs achieved within the plan window. Split into two queries: one for plan-window workouts (XP awards), one for all workouts (PR prior baseline).

Option B (scoped fix, simpler): Accept the plan-window limit; document that XP accrues from plan start. Add a gotchas entry. Rename success criterion to "plan history counts retroactively."

Option C (full fix, complex): Export the pre-plan workout history as a "cold start" scan that builds the initial `prBestByExercise` map without generating XP events, then run the plan-window PR replay on top. This is the truest "no cold start" implementation.

**Severity**: Critical — violates explicit product promise and acceptance criterion §8.6.

---

## Design Concerns

### HIGH-1 — Double-grant risk in `grant_bonus_xp` — no idempotency guard

**Location**: Blueprint §5 (grant_bonus_xp handler), PRD §4.1 (GameBonusXp schema)

**What's wrong**: `prisma.gameBonusXp.create` has no uniqueness constraint. If the coach retries a failed `grant_bonus_xp` call (network timeout, MCP error), a second row is written. The user sees double XP with duplicate reason strings in the XP log.

The schema has `@@index([date])` but no `@@unique`. No retry idempotency key is threaded through.

**Why it matters**: The coach workflow is conversational; retries happen. A 50-XP bonus becomes 100. There's no deduplication from the engine because it sums all `GameBonusXp` rows unconditionally.

**Fix**: Add an idempotency option:
- Either: Add `@@unique([date, reason, amount, source])` to the schema (prevents exact duplicates)
- Or: Add an optional `idempotencyKey String?` field with `@@unique([idempotencyKey])`, passed as MCP input; coach omits it when intentional repeated grants are desired.

**Severity**: High — silent data corruption under retry, user-visible as double XP.

---

### HIGH-2 — `EngineContext.baselineLogDates` insufficient for Baseline Scholar badge

**Location**: Blueprint §3 (`EngineContext` type), §2 (badge #4 predicate), research-output §2.11

**What's wrong**: `EngineContext.baselineLogDates: string[]` stores the dateKey of every Baseline row — dates, not test names. Badge #4 "Baseline Scholar" requires knowing WHICH tests were logged against the initial-week schedule. Checking whether all initial-week tests were logged requires comparing logged testNames against the baseline schedule's `initialWeek` tests. A list of dates cannot distinguish "Plank logged on 2026-03-05" from "any test logged on 2026-03-05."

If the developer implements the predicate using only `baselineLogDates`, they'll check "were any baselines logged during initial week?" not "were all required initial-week tests logged?" — a subtly wrong predicate that unlocks the badge prematurely.

**Why it matters**: Baseline Scholar unlocks too easily (first day any baseline is logged) and is impossible to correctly implement from the declared `EngineContext` field.

**Fix**: Change `baselineLogDates: string[]` to `baselineLogged: { dateKey: string; testName: string }[]` in `EngineContext`. The badge predicate then checks:
```
const loggedNames = new Set(ctx.baselineLogged.map(b => b.testName));
const initialTests = program.template.baselineWeek
  .flatMap(d => d.tests.filter(t => (t.initialWeek ?? 1) === 1))
  .map(t => t.testName);
return initialTests.length > 0 && initialTests.every(n => loggedNames.has(n));
```

Note: `EngineContext` is declared as Prisma-free in `types.ts`, so the program template data cannot be accessed from ctx directly. The badge predicate must receive program data, or the engine must pre-compute `requiredInitialTestNames` and add it to `EngineContext`.

**Severity**: High — badge predicate is unimplementable from declared types; wrong behavior ships.

---

### HIGH-3 — Streak milestone XP algorithm unspecified

**Location**: PRD §4.8 (`streak.milestone` rule), Blueprint §4.6 (streak algorithm)

**What's wrong**: The XP economy table lists `streak.milestone` at 7/14/30/60/90 days crossing with 50/75/100/150/200 CON XP. Blueprint §4.6 specifies how to compute `streak.current` and `streak.longest` but contains zero specification of when and how milestone XP events are emitted.

Missing decisions:
- Does a milestone fire once ever (first time the streak crosses 7) or every time a run crosses 7?
- If the user reaches 30 days, resets, then reaches 30 again — does Iron Month fire a second time?
- What dateKey gets the milestone event (the day the run crossed the threshold)?
- How does the engine identify the threshold-crossing day from the ledger without O(n) per-milestone scans?

The "milestones are derived — fine — but verify no path double-counts" note in the PRD attack list was not addressed in the blueprint.

**Why it matters**: Without an algorithm, two developers implement this differently. The most naive approach (check if current streak >= 7) would fire the milestone every request, generating unbounded CON XP. The streak XP economy completely breaks.

**Fix**: Add to §4.6 an explicit algorithm. Suggested:

```
Walk ledger in chronological order tracking runLength (same as "longest" pass).
Maintain milestone thresholds = [7, 14, 30, 60, 90] sorted ascending.
milesonesAwarded: Set<number> = new Set()  // per run, reset on break

For each entry in ledger (asc):
  if !entry.isInPlan: continue
  if entry.streakSuccess:
    runLength++
    for threshold in milestones:
      if runLength === threshold AND !milestonesAwarded.has(threshold):
        emit { dateKey: entry.dateKey, ruleId: "streak.milestone", ... }
        milestonesAwarded.add(threshold)
  else:
    runLength = 0
    milestonesAwarded.clear()  // run reset; milestones re-earnable on next run
```

Decide whether `milestonesAwarded.clear()` is called on reset (milestones re-earnable) or if they use a global Set (one-time). Document it in rules.ts.

**Severity**: High — unimplemented rule, catastrophic XP inflation if naive implementation ships.

---

### HIGH-4 — PR replay generates spurious within-workout PRs (diverges from `recordsSetInWorkout`)

**Location**: Blueprint §4.5 (PR replay algorithm)

**What's wrong**: The blueprint's PR replay iterates exercises within each workout sequentially, updating `prBestByExercise` as it goes. If a workout has two exercises that canonicalize to the same name (e.g., "Pull-Up" and "Pull-Up Max Reps" in a baseline mirror — both → "Pull-Up"), the algorithm processes exercise A first (sets as first-ever record), then exercise B (compares against A, if B's best > A's best → PR event emitted).

This means a single workout can generate a PR for an exercise by comparing two exercises within itself — which never happens in `recordsSetInWorkout` (which explicitly excludes the current workout's sets from the prior baseline: `where: { workout: { id: { not: workoutId } } }`).

The confirmed behavior from records.ts lines 487-497: prior sets are from OTHER workouts only. The engine must replicate this, not introduce a looser definition that would generate more PRs than the app actually records.

**Practical impact**: Baseline mirror workouts frequently contain multiple exercises that canonicalize to the same movement (e.g., "Plank Max Hold" → "Plank" alongside a regular "Plank" set in a paired workout day). These would generate false within-workout PRs.

**Why it matters**: `get_game_state` PR count would diverge from `get_records_summary`, violating acceptance criterion §8.6 ("PR-event count consistent with `get_records_summary` canonicalization").

**Fix**: After grouping all workout exercises by canonical name and computing each workout's bestSetSummary, compare against the PRIOR best seen in PREVIOUS workouts only. Process workouts in chronological order; for each workout, group its exercises first, compare group-best against priorBest, update priorBest with the workout's best (not per-exercise). This matches `recordsSetInWorkout` merge semantics:

```
Sort workouts chronologically.
prBestByExercise: Map<canon, { primary, value }>

For each workout (in order):
  // Merge this workout's exercises by canonical name (same as recordsSetInWorkout step 2)
  workoutBestByExercise: Map<canon, { primary, value }>
  for each exercise in workout:
    canon = canonicalExerciseName(exercise.name)
    summary = bestSetSummary(exercise.sets)
    existing = workoutBestByExercise.get(canon)
    if !existing OR summary.value > existing.value:
      workoutBestByExercise.set(canon, summary)

  // Compare against priors (from previous workouts)
  for each [canon, workoutBest] in workoutBestByExercise:
    prior = prBestByExercise.get(canon)
    if !prior:
      prBestByExercise.set(canon, workoutBest)   // first-ever, NOT a PR
      continue
    if workoutBest.primary === prior.primary AND workoutBest.value > prior.value:
      // PR!
      ...emit event...
    prBestByExercise.set(canon, workoutBest)   // update prior with this workout's best
```

**Severity**: High — inflates PR count vs existing system; breaks AC §8.6.

---

### HIGH-5 — `LevelUpCelebration` ring positioning requires medallion-scoped relative wrapper

**Location**: Blueprint §6.1 (component tree), D-10

**What's wrong**: D-10 correctly states: "The `CharacterHeader` is responsible for providing `<div className="relative">` around the medallion + `<LevelUpCelebration>`." The CSS rule is `position: absolute; inset: 0` so rings fill the relative ancestor.

But the component tree in §6.1 places `<LevelUpCelebration level={...} />` as a sibling of the entire [Row 1] and [Row 2] layout, outside the `<Link>` block, at the level of the full-width `CharacterHeader`:

```
├─ <Link href="/character">   ← 100% wide
│   ├─ [Row 1]                ← contains LevelMedallion
│   │   ├─ <LevelMedallion>
│   └─ [Row 2]
└─ <LevelUpCelebration />     ← sibling of Link, NOT inside medallion's relative div
```

If the `relative` wrapper is on the header, rings with `inset: 0` would cover the entire ~72px × 390px header strip, not the 36px medallion. The visual effect would be wrong.

**Why it matters**: Level-up burst appears as a full-width overlay covering the streak count and attribute bars, not a medallion-focused ring expansion. Acceptance criterion §8.12 tests the animation.

**Fix**: The `relative` wrapper must scope to the medallion size. Place it inside `LevelMedallion` (the component itself creates the relative wrapper), and `LevelUpCelebration` renders two `position: absolute; inset: 0` divs INSIDE `LevelMedallion` via a prop or slot. Alternatively, `CharacterHeader` wraps the medallion and `LevelUpCelebration` together in a `<div className="relative" style={{ width: 36, height: 36 }}>`. The blueprint's component tree must be corrected to reflect whichever approach is chosen.

**Severity**: High — visual defect in the level-up celebration, the feature's most memorable moment.

---

## Suggestions

### MED-1 — `WorkoutRow.category` field: implicit computation not flagged

**Location**: Blueprint §3 (`WorkoutRow` type comment: "resolved from DayTemplate on that date")

`WorkoutRow.category` is a computed field — it does not exist in the Prisma query result. The developer must populate it from the ledger's day template resolution during `buildDayLedger`. The type definition's comment is the only hint. No developer instruction in the algorithm pseudocode (§4.3) explicitly assigns `category` to the WorkoutRow being added to `completedWorkouts`.

Without this, the developer might try to `select { category: true }` from Prisma (runtime error), or leave `category: null` on all WorkoutRow instances, causing all `workout.completed` XP to fall through to the STR fallback regardless of day type.

**Fix**: Add a step in §4.3 after step 7: "Construct each `WorkoutRow` with `category: workoutTemplate?.category ?? null`." The engine assigns the ledger day's resolved category to every workout collected from that day.

**Severity**: Medium — silent wrong-attribute XP bucketing for MOB and END workout days.

---

### MED-2 — Volume and cardio XP are per-workout, not per-day; farmable

**Location**: PRD §4.8 (`workout.volume`, `workout.cardio` rules)

The `workout.completed` XP has an explicit 1/day cap. Volume and cardio XP do not. Two workouts on the same day generate 2×15 = 30 volume XP and 2×10 = 20 cardio XP. Three workouts: 3×15 = 45 and 3×10 = 30.

For a single user this is an acceptable known property (nobody is gaming themselves). But if the user logs a re-import of a prior workout by mistake, XP gets double-counted silently.

**Fix**: Either document the per-workout semantics explicitly in rules.ts (`// Cap is per workout; no per-day limit`) or add a per-day cap. The design is acceptable without a fix if documented.

**Severity**: Medium — acknowledged XP farming vector, acceptable for single-user app if documented.

---

### MED-3 — `baseline.onTime` window math diverges from `records.ts` by up to 24h

**Location**: Blueprint §4.7, research-output §2.9, records.ts line 307

In `records.ts`, the local `addDays` is `endOfDay(addDaysCal(d, n))` — it returns the END of the target day. The "due" window start is `endOfDay(target - 7 days)`. The engine's §4.7 uses `@/lib/calendar`'s `addDays` (start-of-day), making the engine's due window start `startOfDay(target - 7 days)` — up to 23:59:59 earlier. Baselines logged in the first 23:59:59 of the window-open day would earn `baseline.onTime` XP from the engine but NOT show as "due" in the `getBaselineSchedule` display.

This won't cause a crash and the +10 CON is minor, but it creates an inconsistency between what the app's baseline schedule shows as "due" and what the engine awards as "on time."

**Fix**: Match records.ts semantics. For target T computed via `endOfDay(addDays(...))` from calendar, use the same `endOfDay` wrapper on the window edges, or cross-reference with the actual `statusFor` function logic.

**Severity**: Medium — minor inconsistency; on-time XP fires slightly earlier than baseline "due" display.

---

### MED-4 — FIXTURE_GAME_STATE level values do not match the level curve

**Location**: Blueprint §8 (Stream C fixture), §4.9 (`levelFromXp`)

The fixture shows `STR: { xp: 1800, level: 9 }`. Running `levelFromXp(1800, 60)` through the blueprinted algorithm yields Level 8 (total XP to reach Level 9 = 60×(1+2+3+4+5+6+7+8) = 2160 > 1800). The fixture's Level 9 is off by one.

The blueprint footer acknowledges "fixture values are illustrative" — but misleading values here will produce UI that looks wrong during Stream C development (bars show progress at the wrong level), and developers may spend time debugging the engine thinking the curve is wrong.

**Fix**: Either correct the fixture to match the level curve exactly, or add a bold WARNING in the fixture comment that the XP/level pairs are deliberately approximate and Stream C should not unit-test level accuracy against them.

**Severity**: Medium — misleads Stream C developers; false bug reports against the engine.

---

### MED-5 — `clean-week` and `retest-ritualist` badge predicates unspecified

**Location**: Blueprint §2 (badge catalog descriptions), §4.10 (badge evaluation)

Badge #5 "Retest Ritualist" requires: "full retest checkpoint week done." The blueprint doesn't define what "full" means — all tests scheduled for a retest week? The first retest checkpoint where every due test was logged? A specific retest week number?

Badge #15 "Clean Week" requires: "7 consecutive days of 2+ nutrition entries." The engine must track runs of qualifying days, which requires a consecutive-day scan over the plan window's nutrition count map — more complex than a simple aggregate.

Neither predicate has pseudocode in the badge evaluation section or elsewhere.

**Why it matters**: The badge catalog section (§4.9) is a name list, not a specification. Developers building `badges.ts` must infer predicate logic from 3-word badge descriptions. Two developers would implement these differently.

**Fix**: Add a `predicatePseudocode` sub-section to §4.10 for every badge whose logic is non-trivial (at minimum: Baseline Scholar, Retest Ritualist, Set Centurion, Hundred-Ton Hauler, Clean Week). One-liner predicates (First Blood: `ctx.workoutsAll.some(w => w.status === "completed")`) don't need prose.

**Severity**: Medium (aggregates) / Low (consecutive-day) — missing spec, inconsistent implementations.

---

### MED-6 — React `cache()` + `opts.now` argument: deduplication won't fire if callers disagree

**Location**: Blueprint §4.12, D-2

React's `cache()` keys on argument identity. `computeGameState({ now })` in `page.tsx` (where `now = new Date()`) creates a new object on every call. If any nested component later calls `computeGameState()` (no args), the two calls have different argument shapes and won't deduplicate.

For v1 this doesn't matter (only page.tsx and character/page.tsx call it; they're different requests). But the architecture should document the invariant: **all consumers in the same request must call `computeGameState()` with no arguments** to benefit from deduplication. If `page.tsx` passes `{ now }`, the cache() wrapper provides zero benefit.

**Fix**: Change page.tsx call to `computeGameState()` (no args) and have the engine use `new Date()` internally. Only use `opts.now` for test isolation (pure core's `computeGameStateFromData`). Update §4.12 to state this invariant explicitly.

**Severity**: Medium — no correctness bug, but the stated benefit (request deduplication) doesn't apply to the architecture as written.

---

## Missing Requirements

### MR-1 — Baseline Scholar needs program template access in badge context

The `EngineContext` type is declared to be Prisma-free and passed to all badge predicates. But Baseline Scholar requires knowing which test names are in `initialWeek`. That information lives in `program.template.baselineWeek`, which is not included in `EngineContext`.

**Options**: (a) Add `requiredInitialTestNames: string[]` to `EngineContext` (pre-computed in engine before badge pass). (b) Pass `program` as a second argument to badge predicates. (c) Change `baselineLogged` in ctx to `{ dateKey, testName }[]` and compute required names inside the badge predicate by accessing ctx's own data — but ctx has no access to the template.

**Recommendation**: Pre-compute `requiredInitialTestNames: string[]` in the engine before the badge pass and add it to `EngineContext`. This is the only option that stays Prisma-free in the badge predicate while maintaining testability.

---

### MR-2 — `nutrition.day` per-day cap not explicit in algorithm pseudocode

The XP economy says ≥2 NutritionLog rows → 5 CON, 1 award per day. The algorithm must bucket nutrition logs by `dateKey(log.date)`, count per day, and emit at most one event per day where count ≥ 2. This bucketing is implied but not stated anywhere in the engine algorithm sections.

---

### MR-3 — `mobility.session` deduplication rule (D-11) belongs in the algorithm, not just decisions

D-11 specifies: "bucket both by dateKey and award at most one `mobility.session` event per day; check MobilityCheckin rows first; if present, skip the workout-based check for that day." This is correctness-critical logic that belongs in the §4.3 engine algorithm pseudocode, not buried in §10.

---

### MR-4 — Workout.source = "baseline" missing from schema comment

`prisma/schema.prisma` Workout.source comment lists `// manual | strong.app | claude | imported` — "baseline" is absent. Any developer reading the schema to understand the source field will not know that mirror workouts use this value. The engine's guard (`workout.source === "baseline"`) relies on this undocumented value.

**Fix**: Add "baseline" to the schema comment on Workout.source. Also add a gotchas-doc entry.

---

## Risk Assessment

| Risk | Likelihood | Impact | Notes |
|------|-----------|--------|-------|
| CRIT-1: Promise.all compile failure | Certain (as written) | Build blocker | Developer must not copy code verbatim |
| CRIT-2: Prisma select+include failure | Certain (as written) | Build blocker | Same — must rewrite query |
| CRIT-3: Pre-plan PR gap | High | Core promise broken | No query for pre-plan workouts |
| HIGH-1: grant_bonus_xp double grant | Medium (on retry) | Data corruption | No uniqueness constraint |
| HIGH-2: Baseline Scholar wrong | Certain (as typed) | Badge fires wrong | Types can't support predicate |
| HIGH-3: Milestone algorithm missing | High (naive impl) | Unbounded XP inflation | Developers will guess |
| HIGH-4: Within-workout spurious PRs | High (baseline mirrors) | AC §8.6 fails | Diverges from records.ts |
| HIGH-5: Ring positioning | Certain (as drawn) | Visual defect in hero moment | Component tree is wrong |
| MED-1: WorkoutRow.category implicit | Medium | Wrong XP attribute for MOB/END days | Comment only, no algorithm step |
| MED-2: Volume/cardio farm | Low (single user) | Minor | Acceptable; document it |
| MED-3: onTime window 24h drift | Low | Minor CON XP discrepancy | Only affects +10 XP |
| MED-4: Fixture wrong levels | Medium | Stream C confusion | "Illustrative" disclaimer present but insufficient |
| MED-5: Badge predicates unspecified | High | Two devs implement differently | Need pseudocode |
| MED-6: cache() opts coupling | Low | No dedup benefit | Not a bug; document invariant |
| MR-1: Missing program context in badges | High | Baseline Scholar unimplementable | Type gap |

---

## Verdict

**NEEDS REVISION**

Must-fix before Stream A begins:

1. **CRIT-1**: Rewrite §4.2 to call `getActiveProgram()` standalone before the Promise.all. Remove it from the array. The current code does not compile.

2. **CRIT-2**: Rewrite the workout `findMany` in §4.2 to use pure nested `select`, removing all `include`+`select` conflicts. The current code does not compile.

3. **CRIT-3**: Decide and document the PR baseline scope policy. If the "no cold start" promise is a real commitment, the engine must fetch pre-plan workout history for PR baseline purposes. If not, update PRD §1.3.

4. **HIGH-4**: Rewrite §4.5 PR replay to merge all exercises within a single workout into per-canonical buckets (matching `recordsSetInWorkout`) before comparing against priors, not per-exercise sequentially.

5. **HIGH-3**: Add a concrete streak milestone emission algorithm to §4.6.

6. **HIGH-2 + MR-1**: Change `EngineContext.baselineLogDates: string[]` to `baselineLogged: { dateKey: string; testName: string }[]`, and pre-compute `requiredInitialTestNames: string[]` in the engine pass before badge evaluation.

Should-fix before developer review (can be resolved in a blueprint patch, not a PRD change):

7. **HIGH-5**: Correct the §6.1 component tree to place `LevelUpCelebration`'s ring divs inside a medallion-scoped relative wrapper (36×36px), not at the header level.

8. **HIGH-1**: Add an idempotency strategy to `GameBonusXp` — at minimum document the retry risk; ideally add a `@@unique` constraint or optional idempotency key to the schema.

9. **MED-1**: Add an explicit step in §4.3 assigning `category: workoutTemplate?.category ?? null` to each WorkoutRow built during the ledger pass.

10. **MED-5**: Add predicate pseudocode for Baseline Scholar, Retest Ritualist, Set Centurion, Hundred-Ton Hauler, and Clean Week in §4.10.

Items 1–3 are compiler-blockers or core-promise violations. Items 4–6 are correctness bugs that would ship wrong behavior. Items 7–10 are implementation ambiguities that will surface as bugs during Stream A/C development if not resolved.

Once items 1–6 are addressed in the blueprint, the overall architecture is sound: the derived-engine pattern is correct, the override-aware ledger replication logic is accurate (matches resolveDay precedence), the `types.ts` Prisma-free invariant is a good decision, the fixture/stub strategy is practical, and the MCP tool shapes are consistent with existing patterns.
