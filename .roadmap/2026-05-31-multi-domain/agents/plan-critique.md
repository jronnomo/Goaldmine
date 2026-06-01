# Plan Critique — Multi-Domain Goal Engine

**Author**: Plan Devil's Advocate (Claude) · **Date**: 2026-05-31 · **Input**: plan-blueprint.md + real codebase  
**Verdict**: **APPROVE-WITH-FIXES** — three Critical issues must be resolved before decomposition; the rest are concerns worth tracking.

---

## Critical (must fix before decompose)

---

### C1 — `resolveMetricValue` goalId cascade is incomplete: 4 call sites pass no goalId and will silently cross-contaminate goals

**Blueprint claim** (§2a): "All callers of `resolveMetricValue` for a `Goal` already have the `goalId`." and "No existing call sites break."

**Reality from code**:

- `src/lib/readiness.ts:63` — `computeReadiness(targets, asOf)` calls `resolveMetricValue(prisma, t.metric, asOf)` with no goalId. It takes no goalId param today.
- `src/lib/readiness.ts:94` — `computeReadinessSeries` calls `computeReadiness(targets, cursor)` — same, no goalId.
- `src/app/stats/page.tsx:39-40` — calls `computeReadiness(targets)` and `computeReadinessSeries(g.createdAt, targets)` with only the targets array. No goalId passed.
- `src/app/progress/page.tsx:37-38` — same pattern.
- `src/app/goals/[id]/page.tsx:80` — calls `computeReadiness(targets)` directly.

The blueprint's own fix (§2a) makes `goalId` required for `log:*` metrics and says to throw if it's absent. But **all five call sites** (3 pages + `computeReadinessSeries` + `computeReadiness`) pass only `targets`, not `goalId`. The signature change propagates into:

1. `computeReadiness(targets, asOf, goalId?)` — blueprint says add `goalId` param
2. `computeReadinessSeries(createdAt, targets, now, goalId?)` — blueprint says add `goalId` param
3. `src/app/stats/page.tsx` — iterates `activeGoals.map(async (g) => { computeReadiness(targets) ... })` — has `g.id` but doesn't pass it
4. `src/app/progress/page.tsx` — same
5. `src/app/goals/[id]/page.tsx` — has `goal.id` from `params`, doesn't pass it

**The fitness path is NOT byte-identical.** Every call site must be updated to pass `goalId` or the `log:*` metrics will either throw (if you make it required) or silently query all LogEntries across all goals (if you make it truly optional with a fallback to no-filter). Either way, existing fitness pages break or produce wrong data the moment a second goal (the chewgether project goal) has any `LogEntry` rows — because the `resolveMetricValue` `log:*` case would return the first matching LogEntry across ALL goals.

**Fix**: In Epic A, explicitly enumerate all 5 call sites as required edits. The TypeScript signature change will surface 3 type errors in the page files; the compiler is your ally here — do not suppress them.

---

### C2 — `page.tsx` today-gate uses `getActiveProgram()`, not `goal.kind`, and an active project goal breaks the fitness path silently

**Blueprint claim** (§4a): Add a gate `if (goal?.kind === "project") return <ProjectTodayView />` immediately after data-fetching, with the fitness path "byte-identical."

**Reality from code** (`src/app/page.tsx:14-15`):

```typescript
const program = await getActiveProgram();
if (!program) { ... return <NoActiveProgram /> ... }
```

The page then calls `getTodayContext(program)`, `resolveDay(now)`, and renders the full fitness body. **`goal` is never fetched in this file.** There is no `goal.kind` in scope.

This means the blueprint's proposed gate cannot be inserted as described — it would require an additional DB call for the active goal. More critically: when a user activates a project goal via `create_goal` (which calls `tx.goal.updateMany({ data: { active: false } })` + creates the new goal with `active: true`), `getActiveProgram()` still returns the _old_ fitness `Program` record, because `Program` is a separate table from `Goal`/`Plan` entirely (`src/lib/program.ts` queries `prisma.program.findFirst({ where: { active: true } })`). The fitness Today page will continue to render correctly (it has a program), but it will be rendering **the fitness view for a user who has switched their active goal to a project**.

The `getCalendarMonth` code in `src/lib/calendar.ts:37-61` already fetches the active `Goal` in its parallel query block — but `page.tsx` does not. The fix in Epic D must also add the active-goal fetch to `page.tsx` before inserting the kind-branch, or it will crash when `goal` is accessed.

**Fix**: In Epic D's page.tsx change, add `const goal = await prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" }, select: { id: true, kind: true, ... } })` before the kind-branch — or parallel it with the program fetch. The blueprint's pseudocode for §4a is missing this fetch and will not compile as written.

---

### C3 — `LegendSchema` `kind` enum is closed; adding `"scheduled-item"` is a code-breaking change to an existing Zod validator, not just a field addition

**Blueprint claim** (§4, Epic D): "Calendar legend supports a new `'scheduled-item'` kind entry (add to `LegendSchema` + calendar render)."

**Reality from code** (`src/lib/legend.ts:22-29`):

```typescript
export const LegendKindSchema = z.enum([
  "trained",
  "hike-completed",
  "hike-planned",
  "override",
  "goal-date",
  "baseline",
]);
```

The comment on line 7 is explicit: "Adding new kinds requires both schema-level value + a render branch in `src/components/CalendarMonth.tsx`." The `update_goal_legend` MCP tool description (tools.ts:2196) tells Claude: "Closed enum; passing a `kind` outside this set fails Zod validation and returns an error envelope — new render conditions need a code change."

This is not a data-model change; it requires:
1. Adding `"scheduled-item"` to `LegendKindSchema` in `legend.ts`
2. A render branch in `CalendarMonth.tsx` for `kind === "scheduled-item"`
3. A `MarkerIcon` variant for it

None of these are mentioned in Epic D's deliverable list. The blueprint says "add to `LegendSchema` + calendar render" in a single bullet but it is actually a 3-file code change that touches the validated-enum boundary that the MCP instructions explicitly warn about. If a build agent treats this as a trivial schema extension and adds `"scheduled-item"` to goal.legend without the render branch, the calendar will silently show nothing for those cells (the `findLegendEntry` call returns `undefined` and the cell renders no marker).

**Fix**: Make this a named, explicit deliverable in Epic D with the 3 concrete file changes listed. Flag that existing goals with `legend = null` must NOT be affected (they use `DEFAULT_LEGEND` which does not contain the new kind — correct, no change needed). New project goals need to set a legend that includes the `"scheduled-item"` kind explicitly.

---

## Concerns (should be resolved before build, not necessarily before decompose)

---

### W1 — `getCalendarMonth` fetches the active goal WITHOUT `kind` in its `select`, so the Epic D guard fails at compile time

`src/lib/calendar.ts:53-60`: the goal query selects `{ id: true, targetDate: true, objective: true, legend: true }`. `kind` is not selected. When Epic D adds `goal?.kind === "project"` to `getCalendarMonth`, TypeScript strict mode will error because `kind` is not on the returned type. The blueprint's snippet (§4b) uses `goal?.kind === "project"` directly on this query result.

**Fix**: Add `kind: true` to the `getCalendarMonth` goal select in Epic D. Minor, but it's a compile error that will block the Sprint 4 QA gate.

---

### W2 — GitHub UTC timestamps bypass the USER_TZ bucketing contract when synced to ScheduledItem.date

**Blueprint claim** (§1b, §3b): ScheduledItem.date follows "midnight USER_TZ (same convention as PlanDayOverride.date)," and all writes go through `startOfDay(parseDateKey(...))` from `@/lib/calendar`.

**Reality**: GitHub milestone `due_on` field returns a date in the format `"2026-06-15T07:00:00Z"` (always midnight UTC, not midnight USER_TZ). `parseDateKey("2026-06-15")` correctly converts to MT midnight. But the blueprint's `sync_github_milestones` implementation sketch calls `startOfDay(parseDateKey(...))` — which is correct — but `get_project_overview` returns `dueOn: string | null` as a raw ISO string from the GitHub API. If `log_metric` or any downstream code calls `new Date(ghMilestone.due_on)` and stores it directly without `startOfDay(parseDateKey(...))`, the date will be off by 6-7 hours in USER_TZ.

The `safe()` wrapper and tool handlers in `tools.ts` already use `parseDateInput` (tools.ts:231-233) for any `date: string` MCP input, which correctly handles bare `yyyy-mm-dd`. But `sync_github_milestones` internally extracts `due_on` from the GitHub API response and must explicitly pass it through `startOfDay(parseDateKey(ghDueOn.slice(0,10)))`, not `new Date(ghDueOn)`. This is not specified in the blueprint beyond the general statement "same TZ discipline."

**Fix**: The `sync_github_milestones` implementation spec must explicitly document: extract the date portion (`due_on.slice(0, 10)`) before passing through `parseDateKey()`. Add a line to the Epic C acceptance criteria.

---

### W3 — The `safe()` wrapper leaks the GITHUB_TOKEN if the token string appears in a Prisma error message or URL

**Blueprint** (§3b) specifies: "any catch block that re-throws or returns an error must sanitize with `message.replace(process.env.GITHUB_TOKEN ?? 'REDACTED', '[REDACTED]')`."

But `GITHUB_TOKEN` is only needed inside the GitHub fetch calls, not in Prisma writes. The sanitization is only added to GitHub tool handlers. The generic `safe()` wrapper at `tools.ts:220-226` catches ALL errors and passes `e.message` directly to `errorResult()`. If GitHub tool code calls a Prisma write (e.g., `sync_github_milestones` upserts to ScheduledItem) AND Prisma somehow includes the GitHub API URL or a string containing the token in its error, that would leak through `safe()`.

This is low probability but not zero: Prisma connection errors can include the full connection string, and if the GITHUB_TOKEN is also used in some context where it ends up in a URL or Prisma metadata, `safe()` bypasses the sanitization guard.

More concretely: the blueprint says to sanitize in "catch blocks" of GitHub tools. But `safe()` is the catch block for all tools. GitHub tools that use `safe()` (which they should, per §3a: "All use the `safe()` wrapper") will not run the sanitization unless they sanitize inside their own try before `safe()` catches it. There's a structural tension: you can't sanitize after `safe()` wraps because `safe()` catches first.

**Fix**: Either (a) GitHub tools do NOT use `safe()` and manage their own try/catch with sanitization, then call `jsonResult`/`errorResult` directly; or (b) add a `safeGitHub()` variant that wraps the sanitization: `safe(() => fn().catch(e => { throw sanitizeGitHubError(e) }))`. Option (a) is simpler and the pattern already exists conceptually in the codebase (some tools have pre-flight checks before `safe()`).

---

### W4 — Abstraction-from-one-example: `ScheduledItem` cannot represent a "hike" without fitness assumptions leaking back in

**Scope brief** (§"Driving verticals"): "ScheduledItem must fit both a 'hike' and 'submit to App Store'."

A hike has: distance, elevation, pack weight, duration, RPE. These are `payload Json?` on ScheduledItem — fine. But the existing `Hike` table has a `status` field with `"completed" | "planned" | "skipped"` and the calendar reads from `Hike.status` for the hike icons (`hike-completed`, `hike-planned` legend kinds). `ScheduledItem` has `status: "planned" | "done" | "skipped"` — "done" vs "completed" is a semantic mismatch that will confuse Claude (which tool do I call to "complete" a hike vs. "complete" a task?).

More critically: the fitness vertical is **not using ScheduledItem at all** (non-goal v1, by design). But if the user switches to a fitness goal and back, the calendar cell builder's `goal?.kind === "project"` guard would suppress the ScheduledItem query correctly. The real risk is that a future "fitness convergence" sprint (listed as Backlog) will need to rename `ScheduledItem.status="done"` to `"completed"` to match the Hike convention, or add a mapping layer — a hidden migration debt being accrued now.

For the chewgether vertical, `ScheduledItem` fits perfectly: "submit to App Store" is a task with a date, a title, optional detail, status. No fitness assumptions leak in.

**Fix**: Document in Epic A that `status="done"` is intentionally different from Hike's `status="completed"` and will require a mapping layer if fitness tables ever converge. Low urgency, but capture it explicitly so the Backlog item doesn't re-discover it.

---

### W5 — MCP discoverability: `log_metric` collides semantically with `log_measurement`, `log_baseline`, `log_note`, `log_workout`, `log_hike`

The existing tool pack has 6 `log_*` tools for fitness. Adding `log_metric` for the project pack creates a 7th. Claude, when asked "log my MRR update," must pick `log_metric` and not `log_measurement` (which is for body weight/resting HR). The descriptions differentiate them but the name prefix is identical.

The `list_planned_hikes` lesson (mentioned in scope-brief) was about using keyword-rich names. `log_metric` is actually the **least** keyword-rich name in the whole pack — it's more generic than `log_measurement`. A better name for discoverability: `log_project_metric` or `log_goal_metric` (both require `goalId`; neither confuses with body measurements).

Same issue for `list_scheduled_items` vs. the fitness world's implicit "list planned hikes" concept (currently via `list_planned_hikes`-style reads). With a project goal active, Claude now has both `list_scheduled_items` and `get_today_plan` returning ScheduledItems — potential for confusion about canonical source.

**Fix**: Rename `log_metric` to `log_goal_metric` in the Zod schema, tool registration, and MCP instructions. Add to the `log_goal_metric` description: "NOT for body weight or baseline tests — use log_measurement / log_baseline for fitness metrics." Minor, but applying the `list_planned_hikes` lesson before launch is cheaper than an MCP friction-log entry after.

---

### W6 — Epic D is 3 sprints worth of work, not 1

Epic D deliverables include:
1. `page.tsx` kind-branch + `ProjectTodayView` server component (new, non-trivial: queries ScheduledItems + LogEntries + next milestone)
2. `getCalendarMonth` + `buildCell` ScheduledItem source + `CalendarDayCell` type extension
3. New `/goals/[goalId]/plan` route (new page)
4. `LegendSchema` + `LegendKindSchema` + `CalendarMonth.tsx` render branch for `scheduled-item`
5. Calendar legend `"scheduled-item"` kind entry (requires W1/C3 fix)

Items 1, 2+4, and 3 are independently shippable. Shipping them in a single sprint risks a half-baked merge where the calendar shows ScheduledItem markers but the Today view doesn't (or vice versa). The "Sprint 4 QA gate" browser smoke requires ALL of these to work together, making the gate very late in the sprint.

**Fix**: Split Epic D into D1 (Today page kind-branch + ProjectTodayView) and D2 (Calendar ScheduledItem source + LegendSchema + new plan route). D1 ships first to validate the kind-routing contract; D2 adds calendar visibility. Both are independently `main`-deployable. Each QA gate is smaller and faster to verify.

---

### W7 — `createGoalCore` deactivates all other goals in a transaction (`tx.goal.updateMany({ data: { active: false } })`), so creating the chewgether project goal will silently deactivate the Mt. Elbert fitness goal

`src/lib/goal-core.ts:79`: `await tx.goal.updateMany({ data: { active: false } })` — every existing goal becomes inactive when a new goal is created.

This is existing behavior, not a new bug from this plan. But Epic E ("Seed or manually create chewgether goal") will trigger it. The moment the user calls `create_goal(kind="project", ...)` in claude.ai, the Mt. Elbert fitness goal goes inactive, Today stops showing the fitness workout hero, and the calendar switches to a project goal view (once Epic D is deployed). If the user is mid-fitness-program, this is a jarring context switch.

The blueprint acknowledges "coexist / strangler" but doesn't address how to **switch between active goals** once both exist. The existing `setActiveGoal` action exists in `src/lib/goal-actions.ts` and is exposed as an MCP-addressable pattern, but there is no `set_active_goal` MCP tool — Claude cannot programmatically switch without calling `update_goal` or a similar write.

**Fix**: Add `set_active_goal(goalId)` to Epic E's deliverable list, or at minimum add a note that creating the chewgether goal will deactivate Mt. Elbert and the user will need to manually reactivate it. This is a coaching UX landmine if unaddressed.

---

## Suggestions (low-priority, non-blocking)

**S1 — `computeReadinessSeries` for `log:*` metrics will produce flat zeroes for all historical points** until LogEntry rows exist. The series chart will show a boring flat line. Consider starting the series at the `goal.createdAt` of the project goal (not `goalCreatedAt` from `computeReadinessSeries`'s first param, which could predate any log entries) or documenting that the chart "activates" once 2 weekly log entries exist. This is not a bug, just a UX gotcha for Epic E validation.

**S2 — `@@unique([goalId, externalRef])` confirms Postgres NULL semantics, but Prisma's generated upsert `where: { goalId_externalRef: { goalId, externalRef } }` will throw if `externalRef` is `null`** because Prisma does not generate a composite-unique finder for nullable unique columns in all versions. Verify with Prisma 7.8.0 that `prisma.scheduledItem.upsert({ where: { goalId_externalRef: ... } })` compiles and works with a non-null `externalRef` before relying on it for `sync_github_milestones`. If not, the upsert must use `findFirst + create/update` logic.

**S3 — Token sanitization uses `String.replace()` (replaces first occurrence only)**. `message.replace(token, "[REDACTED]")` will only replace the first occurrence. Use `message.replaceAll(token, "[REDACTED]")` or a regex with the `g` flag. Pedantic but worth fixing before shipping.

**S4 — GitHub rate limit**: The GitHub REST API has a 5,000 req/hour limit for PATs. `get_project_overview` potentially makes 3-4 API calls (repo stats, issues, milestones, commits, optional Projects v2 GraphQL). Over a long coaching session with repeated `get_project_overview` calls, this could hit limits. Add a brief note in the Epic C deliverables that the handler should return the `X-RateLimit-Remaining` header value in the tool response so Claude can self-moderate.

**S5 — `safe()` swallows error stacks in production.** The current `safe()` implementation passes only `e.message` to `errorResult`. For GitHub API errors (which return structured JSON bodies), `e.message` from a `fetch` failure is often just "fetch failed" with no HTTP status. Consider including the HTTP status code in GitHub tool error messages: `throw new Error(`GitHub API ${res.status}: ${body.message}`)` inside the fetch wrapper before `safe()` catches it.

---

## Verdict

**APPROVE-WITH-FIXES**

The data model and phasing are sound. The `log:*` metric namespace, ScheduledItem/LogEntry split, and tool-pack-per-kind approach are the right calls. The temporal stability argument for `log:milestones_done` (§2c) is correct and well-reasoned.

Three issues must be resolved before `/roadmap` decomposes this into sprint stories:

1. **C1 — goalId cascade is incomplete.** The blueprint knows it's needed but does not enumerate the 5 affected call sites. A build agent will miss 3 of them and produce silent goal-data cross-contamination. List them explicitly.

2. **C2 — `page.tsx` kind-branch is missing the active-goal DB fetch.** The file doesn't fetch `goal` at all today. The blueprint's pseudocode cannot be pasted in without a compile error and a logic gap (project goal activates but fitness page still renders). Specify the fetch.

3. **C3 — `LegendKindSchema` is a closed Zod enum with 3 required file changes.** The blueprint understates it as a "field addition." Enumerate the 3 files and the `DEFAULT_LEGEND` non-impact explicitly in Epic D.
