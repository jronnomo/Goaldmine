# Requirements — Sprint 1: Generic Data Spine

Source: PRD `docs/prds/PRD-sprint-1-data-spine.md` + issues #20–23, #56.
Build order: **REQ-001 (gate) → [REQ-002 → REQ-003] ‖ REQ-004 → REQ-005 (QA)**.

## Amendments from Devil's Advocate review (2026-06-01)
- **A1 (REQ-005):** During QA, **never create a goal via the `/goals/new` browser form** — `goal-actions.ts:61` → `createGoalCore` deactivates Mt. Elbert just like the curl smoke does. The only goal-creation in this run is the Tech-Lead create_goal smoke, immediately reverted.
- **A2 (REQ-005):** Revert the create_goal smoke with a **plain `prisma.$transaction` script** that sets the Mt. Elbert goal + its active plan `active=true` and deactivates the test goal — do **NOT** call the `setActiveGoal` server action (it `redirect()`s → throws `NEXT_REDIRECT` after commit, which looks like a failure). Then `delete` the test goal.
- **A3 (REQ-001):** Hard gate — before spawning the parallel streams, Tech Lead runs `npx prisma generate` on main and confirms `grep -rl "LogEntry" src/generated/prisma` returns hits. No stream branches off a stale client.
- **A4 (REQ-004):** **Accept** the extra `prisma.goal.findFirst` in `get_today_plan` even though `resolveDay` already loads the active goal — it's one indexed single-row read. Do **NOT** widen `resolveDay`/touch `calendar.ts` (shared, out of scope). Cleanup follow-up logged in completion report.
- **A5 (REQ-001 + REQ-003):** Lock the `log:` storage convention. REQ-003 adds `export const LOG_METRIC_PREFIX = "log:" as const` in `goal-targets.ts` and strips via `metric.slice(LOG_METRIC_PREFIX.length)`. REQ-001 adds a comment on `LogEntry.metric` in the schema: `// bare metric key WITHOUT the "log:" registry prefix — e.g. "mrr", not "log:mrr"`.

---

## REQ-001 — Additive Prisma migration (#20) · S · GATE
**Stream:** Schema/Migration Agent (must merge to main + apply before any other REQ)

Add to `prisma/schema.prisma`:
- `Goal.kind String @default("fitness")` + `@@index([kind])`
- `Goal.githubRepo String?`, `Goal.githubProjectNumber Int?`
- `Goal` relations: `scheduledItems ScheduledItem[]`, `logEntries LogEntry[]`
- `ScheduledItem` model — fields/indexes per PRD §4.1 (`@@index([goalId,date])`, `@@index([goalId,status])`, `@@unique([goalId,externalRef])`, FK `onDelete: Cascade`)
- `LogEntry` model — per PRD §4.1 (`@@index([goalId,metric,date])`, `@@index([goalId,date])`, FK `onDelete: Cascade`). Add comment on `metric` field: `// bare metric key WITHOUT the "log:" registry prefix — e.g. "mrr", not "log:mrr"` (A5).

**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_multi_domain_spine/migration.sql`
**Acceptance:** migration additive-only (CREATE TABLE ×2, ADD COLUMN ×3, CREATE INDEX); `prisma generate` exports `ScheduledItem`+`LogEntry`; `tsc` + `build` green; existing rows get `kind='fitness'`.
**Deps:** none.
**Note:** Agent generates schema + migration SQL in worktree but does **NOT** run `migrate dev` against Neon — Tech Lead reviews the SQL diff with the user, then applies on main.

---

## REQ-002 — Goal-scope the readiness engine (#21) · S
**Stream:** Backend-readiness (Agent A), runs after REQ-001 merged. Sequential before REQ-003.

- `computeReadiness(targets, asOf = new Date(), goalId)` — `goalId` **required**.
- `computeReadinessSeries(goalCreatedAt, targets, now = new Date(), goalId)` — required; passes `goalId` on every recursive `computeReadiness` call.
- `resolveMetricValue(prisma, metric, asOf, goalId)` — required; existing fitness branches accept but **ignore** `goalId` (queries unchanged).
- `resolveMetricStart(prisma, metric, goalId)` — required; existing branches ignore it.
- `computeReadiness` passes `goalId` to `resolveMetricValue` and `resolveMetricStart` inside the targets loop.
- Update 5 call sites: `stats/page.tsx:39-40`, `progress/page.tsx:37-38`, `goals/[id]/page.tsx:80` — pass `g.id`/`goal.id` (series gets `undefined` for the `now` default slot, then the id, per #21).

**Files:** `src/lib/readiness.ts`, `src/lib/goal-targets.ts`, `src/app/stats/page.tsx`, `src/app/progress/page.tsx`, `src/app/goals/[id]/page.tsx`
**Acceptance:** `tsc` 0 errors (missing-arg errors are the safety net); `build` green; `/stats` + `/progress` readiness identical to before.
**Deps:** REQ-001.

---

## REQ-003 — `log:*` metric namespace (#22) · S
**Stream:** Backend-readiness (Agent A), **same agent as REQ-002, after it** (shares `readiness.ts`+`goal-targets.ts`).

- Add `export const LOG_METRIC_PREFIX = "log:" as const` in `goal-targets.ts` (A5).
- `resolveMetricValue`: branch `metric.startsWith(LOG_METRIC_PREFIX)` → strip prefix (`const key = metric.slice(LOG_METRIC_PREFIX.length)`) → `prisma.logEntry.findFirst({ where:{ goalId, metric: key, date:{lte:asOf}, value:{not:null} }, orderBy:{date:"desc"} })` → return `entry?.value ?? null`.
- `resolveMetricStart`: `log:*` → return `0`.
- `progressFor`: build-from-zero guard becomes `hike:* || workout:count || log:*`.
- `METRICS`: add exactly `log:mrr` (`{id:"log:mrr",label:"Monthly recurring revenue",units:"$",direction:"increase",description:"Latest MRR snapshot from a LogEntry."}`) and `log:milestones_done` (`{id:"log:milestones_done",label:"Milestones completed",units:"milestones",direction:"increase",description:"Count of completed milestones, logged via log_metric."}`).

**Files:** `src/lib/goal-targets.ts`, `src/lib/readiness.ts`
**Acceptance:** fitness `computeReadiness` byte-identical (no LogEntry query for fitness branches); `log:mrr` with no rows → null; with `LogEntry(metric="mrr",value=500)` vs target 1000 → progress 0.5; `tsc`+`build` green.
**Deps:** REQ-001, REQ-002.

---

## REQ-004 — Expose `Goal.kind` over MCP (#23) · S
**Stream:** MCP (Agent B), runs after REQ-001 merged. **Parallel to REQ-002/003** (disjoint files).

- `create_goal` inputSchema gains `kind: z.enum(["fitness","project"]).default("fitness").describe(...)` (exact describe text per PRD §4.2); handler passes `kind` into `createGoalCore`.
- `createGoalCore` (`goal-core.ts`): add `kind?: "fitness"|"project"` to `CreateGoalCoreInput`; persist `kind: input.kind ?? "fitness"` in `tx.goal.create`.
- `list_goals`: add `kind: g.kind` to each mapped goal object.
- `get_today_plan`: add `activeGoal` via `prisma.goal.findFirst({ where:{active:true}, orderBy:{updatedAt:"desc"} })` mapped to `{id,kind,objective,githubRepo}` or `null`; merge into the returned object alongside `standingRules`.

**Files:** `src/lib/mcp/tools.ts`, `src/lib/goal-core.ts`
**Acceptance:** `tsc`+`build` green; curl `get_today_plan.activeGoal.kind==="fitness"`; `list_goals[*].kind` present. **create_goal kind="project" live smoke is Tech-Lead-handled with revert (PRD §7) — agent does NOT run it against Neon.**
**Deps:** REQ-001.

---

## REQ-005 — Sprint 1 QA gate (#56) · S · QA PHASE
**Stream:** QA Agent + Tech Lead (Phase 5).

- `prisma migrate diff` additive-only.
- Fitness readiness score byte-identical on `/stats` + `/goals/[id]`.
- `tsc` + `lint` + `build` green.
- **No browser goal creation during QA** (A1) — `/goals/new` deactivates Mt. Elbert.
- create_goal kind=project smoke reverted via plain `prisma.$transaction` script (A2), NOT `setActiveGoal`.
- **Mt. Elbert `active=true` (and its plan active) at end** — Tech Lead verifies via `SELECT id,objective,active FROM "Goal"`.
- No raw `setHours/getDate/getMonth/getFullYear` introduced in app code.

**Deps:** REQ-001..004.
