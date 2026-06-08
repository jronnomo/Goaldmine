# Architecture Critique — Long-Effort (Hike) Reconciliation, Track 1

**Produced by:** Devil's Advocate Agent, 2026-06-08  
**Attacks:** `.feature-dev/2026-06-08-long-effort-reconciliation/agents/architecture-blueprint.md`  
**Ground-truth files read:** `src/lib/calendar.ts`, `src/lib/mcp/tools.ts`, `src/lib/plan-lint.ts`, `src/lib/records.ts`, `src/lib/program-template.ts`, `src/lib/program.ts`

---

## Verdict

**NEEDS REVISION**

The blueprint is well-structured and architecturally sound. The data-flow diagram, pure-function design, `WeekConflict` type, and override-awareness intent are all correct. Two real bugs will cause either a TypeScript compile error (guaranteed) or silent behavioral divergence between `resolveDay` and `weekConflicts`. A third inconsistency in Step 4+6 will confuse the Developer Agent and may produce duplicate initialization logic. Fix these three before handing to Dev.

---

## Critical Issues

### C-1 — Missing instruction to remove duplicate `let` declarations (will not compile)

**WHAT IS WRONG**

Blueprint §3 Step 1 inserts three new `let` declarations BEFORE the `Promise.all`:
```ts
let isInPlan = false;
let rotationDay: number | null = null;
let weekIndex: number | null = null;
let weekWindow: ...
```

The **real code at lines 310–312** already has:
```ts
let isInPlan = false;
let rotationDay: number | null = null;
let weekIndex: number | null = null;
```
These are between the `Promise.all` close (line 308) and the `if (program)` block (line 317). They are **not** inside the `if (program)` block. Step 3 says only to "Remove the existing `daysDelta`/`rotationDay`/`weekIndex` computation from inside the block (lines 318–323)." That removes the ASSIGNMENTS (lines 318–323) but leaves the DECLARATIONS at lines 310–312.

A Developer Agent following Steps 1 and 3 literally ends up with `let isInPlan`, `let rotationDay`, `let weekIndex` declared twice in the same function scope. TypeScript strict mode fails: `Cannot redeclare block-scoped variable 'isInPlan'`.

`workoutTemplate`, `isOverride`, and `const baselinesDue` at lines 313–315 are NOT in Step 1's hoisted block and must remain after the `Promise.all` (they depend on the post-`Promise.all` `override` value).

**WHY IT MATTERS**

`tsc --noEmit` fails before a single test runs. Gate 1 for REQ-001 is already broken.

**HOW TO FIX**

Step 1 (or Step 3) must explicitly add:
> "Also remove lines 310–312 (`let isInPlan = false; let rotationDay: number | null = null; let weekIndex: number | null = null;`) — these are now in the hoisted block. Lines 313–315 (`let workoutTemplate`, `let isOverride`, `const baselinesDue`) stay put — they depend on the post-`Promise.all` `override` value."

The comment in Step 1 ("it is NOT redeclared below") signals the intent but is not an instruction to delete the existing lines.

---

### C-2 — Override-awareness asymmetry between `reconcileLongEffort`, `weekConflicts`, and `buildCell`

**WHAT IS WRONG**

Three places suppress conflict flags when a day is "overridden." They use different definitions of that word.

| Location | "Overridden" means |
|---|---|
| `resolveDay` → `isOverride` | `override.workoutJson != null` (lines 325–328 in real code) |
| `weekConflicts` (blueprint §5) | ANY `planDayOverride` row exists for the date (only `select: { date: true }`) |
| `buildCell` (blueprint §6) | `args.overridesByKey.has(k)` — ANY row, regardless of content |

A `PlanDayOverride` row with **only** `nutritionText` set (common: coach adds a fueling note without touching the workout):

- `isOverride` in `resolveDay` → **false** (no `workoutJson`) → `reconcileLongEffort` emits `longEffortConflict`
- `weekConflicts` → **suppressed** (row exists) → `get_session_brief.currentWeekConflicts` shows no conflict
- `buildCell` → **suppressed** (row exists) → calendar cell shows no conflict

Result: `get_today_plan` surfaces a `longEffortConflict` on Day 6, but `get_session_brief` (the load-bearing cold-start tool) and the calendar cell say no conflict. The two surfaces contradict each other, which is exactly the kind of inconsistency that makes the coach miss the mismatch.

This directly violates the spec's §2/§10 invariant: the app must surface the conflict reliably so the coach can resolve it.

**WHY IT MATTERS**

The whole point of the feature is that the coach catches the phantom every session via `get_session_brief`. If a nutrition-only override silently swallows the conflict from `weekConflicts` but not from `resolveDay`, the cold-start brief goes silent while `get_today_plan` still screams. The user is back to square one.

**HOW TO FIX**

For `weekConflicts`: change the `planDayOverride` query to `select: { date: true, workoutJson: true }` and filter with `o.workoutJson != null` before adding to `overrideKeys`. One definition: overridden iff `workoutJson` is set.

For `buildCell`: change `args.overridesByKey.has(k)` to `args.overridesByKey.get(k)?.workoutJson != null`. The `overridesByKey` values already carry the full row (the month query uses no `select` restriction), so `workoutJson` is available.

The single definition should be extracted as a type predicate or documented constant: `isWorkoutOverride(override) = override?.workoutJson != null`. All three sites should call it.

---

## Design Concerns

### D-1 — Step 4 and Step 6 give contradictory implementation patterns (will confuse Developer Agent)

**WHAT IS WRONG**

Step 4 places the `reconcileLongEffort` call as `const { ... } = reconcileLongEffort(...)` AFTER `workoutDeferredForBaseline` (~line 408), which is OUTSIDE the `if (isInPlan && ...)` block. This means the function is **always called** for every date, including out-of-plan dates, with `rotationDay ?? 0` and `weekIndex ?? 0` as magic-number fallbacks.

Step 6 then says:
> "In `resolveDay`, the early 'no active program' path implicitly returns via the block structure. Add the three fields to the return value in all paths."

This is wrong on two counts:
1. The real code has **no early return**. There is a single return at line 409. The "fall-through" it references is the `if (program)` block being skipped, not a separate return path.
2. It implies the three fields are NOT set for the no-program path — but Step 4's unconditional `const` call DOES set them (to null/false from an empty `plannedHikesThisWeek`).

The two steps contradict each other, and neither matches the **existing pattern** the codebase uses for `workoutTemplate` and `isOverride` — both are `let`-declared before the `if` block (lines 313–314) and assigned inside it.

**WHY IT MATTERS**

A Developer Agent following this blueprint will either:
- Place the `reconcileLongEffort` call outside the block (Step 4's pattern) and add confusing redundant initialization in a "no-program path" that doesn't exist (Step 6 misread), or  
- Move the call inside the `if` block (matching Step 6's intent) but use `const` destructure, which DOES produce a real TypeScript scoping error (the `const`s are inside the block, the return is outside it).

The `?? 0` magic-number fallbacks are a code smell that signals the function is being called with invalid inputs, even though it produces correct output in that case.

**HOW TO FIX**

Use the existing pattern. Declare three `let` variables with defaults alongside the other flag variables (at lines 313–315, or in the hoisted block), call `reconcileLongEffort` **inside** the `if (isInPlan && ...)` block (after `workoutDeferredForBaseline`), and assign via destructuring assignment (not `const` destructuring):

```ts
// At lines 313–314 zone (with workoutTemplate, isOverride):
let plannedHikeToday: ResolvedDay["plannedHikeToday"] = null;
let workoutDeferredForHike = false;
let longEffortConflict: ResolvedDay["longEffortConflict"] = null;

// INSIDE if (isInPlan && program && ...) block, after workoutDeferredForBaseline:
({ plannedHikeToday, workoutDeferredForHike, longEffortConflict } = reconcileLongEffort({
  rotationDay,     // non-null here — TypeScript knows it from the condition
  weekIndex,       // same
  thisDateKey: dateKey(date),
  plannedHikesThisWeek,
  isOverride,
  workoutTemplate,
}));
```

This eliminates the `?? 0` magic numbers, matches the existing code style, has the single return at line 409 always seeing the `let` variables (initialized to null/false for out-of-plan), and drops Step 6 entirely.

---

### D-2 — `lint_plan` severity count silently breaks when "info" is added

**WHAT IS WRONG**

The `lint_plan` tool in `tools.ts` (lines 1488–1489) uses hard string equality:
```ts
const errors  = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");
return { warningCount: warnings.length, message: `${errors.length} errors, ${warnings.length} warnings.` ... }
```

Adding `"info"` to `LintSeverity` means `multiple-hikes-one-week` findings (severity `"info"`) fall into neither bucket. `warningCount` under-reports. The message string says "0 errors, 0 warnings" even when there are info-level findings in the `findings` array. The tool description says `'error' … or 'warning'` — now stale.

The same pattern appears at lines 2182–2190 (`apply_plan_revision` lint pre-check), though there info findings being silently ignored is acceptable behavior.

The blueprint's §12 Decision #2 says to "search for any exhaustive `switch (severity)` and update them." There are NO exhaustive switches. The relevant consumers use string equality. The blueprint's guidance targets the wrong pattern.

**WHY IT MATTERS**

A coach running `lint_plan` after seeing an `"info"` multi-hike week gets a misleadingly clean report: "Plan is clean — no lint findings" (if no errors/warnings exist), while the `findings` array has items. Or the `message` says "0 errors, 0 warnings" but `warningCount` is 0 despite real advisory findings. This undermines the lint tool's value.

**HOW TO FIX**

In `lint_plan`:
- Add `const infos = findings.filter((f) => f.severity === "info");`
- Add `infoCount: infos.length` to the return object
- Update the message: `${infos.length} info${...}`
- Update the tool description to mention `'info'` severity

In `apply_plan_revision`, no change needed (info findings should not block revisions), but add a comment documenting that info findings are intentionally excluded.

---

### D-3 — `reconcileLongEffort` unnecessarily called for out-of-plan dates (code smell, addressed by D-1)

**WHAT IS WRONG**

As a consequence of the Step 4 unconditional placement: when `isInPlan === false`, `reconcileLongEffort` is called with `rotationDay: 0, weekIndex: 0, workoutTemplate: null, plannedHikesThisWeek: []`. The function produces null/false correctly because the hike array is empty (the query was gated by `weekWindow`). But:

- `rotationDay: 0` is outside the valid 1–7 range; any future reader of this call will be confused about why rotation day 0 is legal
- The correctness depends on the query gating producing an empty array — a coupling that isn't obvious from the call site
- The `?? 0` fallbacks are defensive against null pointers but they mask the fact that this entire call is a no-op

This is resolved by D-1's fix (move call inside the `if` block).

---

### D-4 — `retest-on-hike` `withDates` is self-referential; type shape is semantically inconsistent

**WHAT IS WRONG**

In `weekConflicts`, for a `retest-on-hike` conflict:
```ts
conflicts.push({ dateKey: calKey, kind: "retest-on-hike", withDates: [dateKey(hikeOnThisDay.date)] });
```

`hikeOnThisDay.date` IS `calDate`, the same date as `calKey`. So `withDates: [calKey]` where `withDates[0] === dateKey`. The field is self-referential.

For `long-effort` conflicts, `withDates` means "dates of the hikes elsewhere displacing the Day-6 slot" — a genuinely distinct set of dates. For `retest-on-hike`, it means "the date the hike and retest co-occur" — which equals `dateKey` by definition. The field carries different semantic meaning per kind.

The `CalendarDayCell.conflict` type's `withDates` field will have the same circularity for `retest-on-hike` cells.

**WHY IT MATTERS**

Track-2 consumers of `WeekConflict` (the `confirm_week` guard, the conflict overlay) will need a per-kind interpretation of `withDates`. This should be documented clearly now before Track 2 builds on it, or the type should use discriminated unions that make the semantic clear.

**HOW TO FIX**

Option A (minimal): Document in the `WeekConflict` type comment: "For `long-effort`, `withDates` are the dates of hikes elsewhere in the week. For `retest-on-hike`, `withDates[0] === dateKey` — the hike and conflict are on the same day; consumers should display this as a same-day collision, not a separate date."

Option B (cleaner, deferred to Track 2): Make `WeekConflict` a discriminated union:
```ts
| { kind: "long-effort";    dateKey: string; hikeDates: string[] }
| { kind: "retest-on-hike"; dateKey: string }
```

Option A is appropriate for Track 1.

---

### D-5 — `get_week` query count is underestimated and `getActiveProgram` is called 8 times

**WHAT IS WRONG**

Blueprint §7a and §12 Decision #3 claim "~35 DB queries for the week." After adding the planned-hike query in Step 2, each `resolveDay` call makes 6 queries (not 5): workouts, override, notes, goal, nutrition, **+ planned hikes**. Seven days × 6 queries = 42 queries minimum, plus up to 7 additional baseline queries on weeks with tests due = up to 49.

Additionally, `get_week` calls `getActiveProgram()` once to compute `wi`, then each `resolveDay` call ALSO calls `getActiveProgram()` internally (it always does on its first line). That is 1 + 7 = 8 `getActiveProgram()` round-trips for one `get_week` invocation.

**WHY IT MATTERS**

The estimate is used in the decision rationale to justify v1. It is already stale before code is written. If 49 queries produces noticeable latency at runtime, the v2 batch optimization will be needed sooner than "when profiling says it matters." The developer should at minimum be told the real number.

**HOW TO FIX**

Update the comment: "v1 loops `resolveDay` × 7 → ~42–49 DB queries per call (6+ per day after the planned-hike query addition); `getActiveProgram` is called 8 times per invocation." No code change needed for v1 — just accurate documentation.

---

## Missing Requirements Coverage Check

### REQ-003 alignment with spec

REQ-003 says `retest-on-hike` derives "cross-referenced with `getBaselineSchedule`/the rotation default in `records.ts`/`calendar.ts`." The blueprint uses pure template math and explicitly rejects `getBaselineSchedule`. The blueprint's rationale is correct (conflict detection needs "could a test be scheduled" not "is it done"), but the implementation DOES diverge from what REQ-003's wording implies. The Developer Agent may be confused by the mismatch.

Resolution: the blueprint's pure-math approach is BETTER than REQ-003's suggested approach. Recommend the architect update REQ-003's wording to say "via rotation template math (same as `countBaselinesDueForCell` in `calendar.ts`) — NOT `getBaselineSchedule` from `records.ts`, which adds unnecessary DB overhead and completed-test awareness."

### REQ-006 partial implementation detail

The blueprint describes `retest-on-hike-day` in detail (thin caller of `weekConflicts`). The other three rules (`pre-hike-leg-load`, `multiple-hikes-one-week`, `hike-outside-plan`) are described at spec level only — no implementation code. This is acceptable for an architecture doc, but the Developer Agent will need to infer:

- `multiple-hikes-one-week` requires grouping the already-fetched `plannedHikes` (in `lintActivePlan`) by rotation week index — the same `Math.floor(daysDelta / 7) + 1` math used elsewhere. Must use `program.startedOn` as anchor, not calendar Monday.
- `pre-hike-leg-load` requires checking if the rotation day BEFORE the hike's date is Day 2 (`lower`) or Day 5 (`lower-power`). The category names are confirmed in `program-template.ts` as `"lower"` and `"lower-power"`. Requires computing `dayOfWeek` of `hike.date - 1 day` against the rotation, which means `(((daysDelta - 1) % 7) + 7) % 7 + 1`.
- `hike-outside-plan` requires checking `daysDelta < 0 || daysDelta >= totalWeeks * 7` — same math already in the file's `override-out-of-range` rule.

Flag this as a gap in implementation specificity for REQ-006.

---

## Verification of Specific Attack Targets

### Attack 1: Scoping bug (Step 4 const inside vs outside if block)

**Status: NOT a scoping bug as described, but D-1 is the real danger.**

Step 4 correctly places the `reconcileLongEffort` call AFTER `workoutDeferredForBaseline` (line 403), which IS outside the `if (isInPlan && ...)` block. The single return at line 409 IS in the same scope. So `const { ... } = reconcileLongEffort(...)` at line ~408 is in scope for the return. No scoping error from Step 4 itself.

However: D-1 above is the REAL compile blocker (duplicate `let` declarations). And D-1's fix (move call inside the if block with `let` declarations) is strictly better architecture regardless.

The blueprint's Step 6 falsely claims there is "an early 'no active program' path that implicitly returns via the block structure." There is no early return in the real code. This misdescription doesn't produce a bug per se (since Step 4's unconditional `const` covers the single return path), but it is actively misleading and will cause a Developer Agent to add unnecessary initialization logic.

**Correct characterization:** The scoping concern is not "const inside vs outside the block" — it is "Step 4's unconditional call with ?? 0 fallbacks vs Step 6's implied conditional call." Both steps would work independently; together they contradict and confuse.

### Attack 2: Out-of-plan / no-program path

**Status: No runtime bug with Step 4's unconditional pattern.**

When `isInPlan === false`: `weekWindow = null` → hike query resolves `[]` → `reconcileLongEffort` returns null/false from an empty array. Single return always sees the `const` variables. Correct output.

Bug only if developer follows D-1's misdirection and adds an early return — that would cause the fields to be missing from the single return. Addressed by D-1.

### Attack 3: `weekConflicts` vs real baseline schedule math

**Status: CONFIRMED CONSISTENT. No divergence.**

The blueprint's `weekConflicts` uses:
```ts
weekIndex === initialWeek || (weekIndex > initialWeek && retestWeeks?.includes(weekIndex))
```
The real `countBaselinesDueForCell` (lines 197–206 in `calendar.ts`) uses:
```ts
if (weekIndex === initialWeek) { count += 1; continue; }
if (weekIndex > initialWeek && t.retestWeeks?.includes(weekIndex)) count += 1;
```
These are identical. ✓

`getBaselineSchedule` in `records.ts` uses `.filter((w) => w > initialWeek)` on retestWeeks, which is equivalent (same guard, different form). ✓

The concern about `initialWeek` defaulting to 1 is already handled: both use `t.initialWeek ?? 1`. ✓

The `targetDate: addDays(startedOn, initialWeek * 7)` in `getBaselineSchedule` looks like an off-by-one (for `initialWeek = 1`, it returns `startedOn + 7 days` = start of week 2, not week 1). But this only affects `getBaselineSchedule`'s display/status computation — `weekConflicts` does NOT use `getBaselineSchedule`, so this existing quirk does not affect the new code. ✓

### Attack 4: `get_today_plan` / `get_day` "no return change needed" claim

**Status: VERIFIED CORRECT.**

`get_today_plan` (line 595): `return { ...r, standingRules, activeGoal }` — spread of `r` includes all `ResolvedDay` fields. ✓  
`get_day` (line 610): `return r` — direct return. ✓  

Three new fields on `ResolvedDay` flow automatically to both. No return-statement changes needed. ✓

### Attack 5: `get_session_brief` `resolved.weekIndex`

**Status: VERIFIED CORRECT, with one nuance.**

Real code at lines 1134–1135:
```ts
if (resolved.isInPlan && program && resolved.weekIndex !== null) {
  const weekIndex = resolved.weekIndex;
```

`resolved` is the return from `resolveDay(now)` (line 1056). `resolved.weekIndex` is non-null when `isInPlan`. `program` is fetched separately and confirmed non-null in the condition. This is exactly the access pattern the blueprint assumes for adding `await weekConflicts(program, resolved.weekIndex)`. ✓

`parseDateInput` is a local function at line 237 — in scope for `get_week`. ✓

### Attack 6: Override-awareness symmetry

**Status: CONFIRMED BUG. See C-2 above.**

`isOverride` in `resolveDay` requires `workoutJson`. `weekConflicts` and `buildCell` treat ANY override row as resolved. This IS the asymmetry flagged in the attack target.

The specific scenario: override with only `nutritionText` (no `workoutJson`) causes `resolveDay` and `weekConflicts` to disagree. `get_today_plan` shows `longEffortConflict`; `get_session_brief.currentWeekConflicts` is empty.

### Attack 7: DST / USER_TZ safety

**Status: SAFE. Consistent with existing code.**

Both `rotationWeekWindow` and `getCalendarMonth`'s `plannedHikesByWeek` grouping use `startOfDay(program.startedOn)` (USER_TZ-aware via `userTzWallClockToUTC`) and `addDays` (USER_TZ-aware). The `(Date.getTime() - Date.getTime()) / (24 * 3600 * 1000)` division is safe because both operands go through `startOfDay`, placing them at USER_TZ midnight. DST transitions can't produce a fractional day between two USER_TZ midnights. ✓

The existing code at line 319 (`calendar.ts`) already uses this same raw-ms pattern. Consistency confirmed. ✓

---

## Risk Table

| Risk | Severity | Certainty | Impact |
|------|----------|-----------|--------|
| Duplicate `let` declarations (C-1) | Critical | Certain | TypeScript compile error — nothing ships |
| Override asymmetry: nutrition-only overrides silence `weekConflicts`/`buildCell` (C-2) | High | Certain | Cold-start brief misses conflict the feature exists to surface |
| Step 4+6 contradictory pattern misleads Developer Agent (D-1) | Medium | High | Likely produces confused impl; real scoping error if call ends up inside if block with `const` |
| `lint_plan` severity counting broken for `"info"` (D-2) | Medium | Certain | Advisory findings invisible in lint output |
| `retest-on-hike` `withDates` self-referential (D-4) | Low | Certain | Minor semantic confusion for Track-2 consumers |
| `get_week` query count underestimated (D-5) | Low | Certain | Bad documentation; v2 optimization may be needed sooner |
| REQ-006 implementation specifics missing for 3 of 4 lint rules | Low | Certain | Developer Agent must infer; risk of incorrect rotation-week grouping for `multiple-hikes-one-week` |

---

## Must-Fix Before Development

1. **C-1 (Critical):** Add explicit instruction: "Remove lines 310–312 (`let isInPlan`, `let rotationDay`, `let weekIndex`) when performing Step 1 — these names are now declared in the hoisted block."

2. **C-2 (High):** Fix override definition consistently:
   - `weekConflicts`: add `workoutJson: true` to the `planDayOverride` select; skip only when `o.workoutJson != null`
   - `buildCell`: use `args.overridesByKey.get(k)?.workoutJson != null`, not `has(k)`
   - Add a single isWorkoutOverride guard or comment that all three sites must share the same definition

3. **D-1 (Medium):** Replace Step 4's `const` + Step 6's "no-program path" with the correct `let`-declare-outside/assign-inside pattern, matching `workoutTemplate`/`isOverride`. Drop the `?? 0` fallbacks. Delete the incorrect "early return" description in Step 6.

4. **D-2 (Medium):** Before adding `"info"` to `LintSeverity`, update `lint_plan` handler in `tools.ts` to add `infoCount`, update message string, and update tool description. The exhaustive-switch hunt mentioned in Decision #2 is a red herring — the codebase uses string-equality filters, not switches.
