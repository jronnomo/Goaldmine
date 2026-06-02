# QA Report — Sprint 1: Generic Data Spine
**QA Agent**: Static review (no server, no DB calls)  
**Date**: 2026-06-01  
**Scope**: REQ-001..005 + PRD §8 acceptance criteria + byte-identical reasoning + cross-cutting checks

---

## Requirements Status Table

| Req | Title | Status | Notes |
|-----|-------|--------|-------|
| REQ-001 | Additive Prisma migration | **PASS** | All fields/models/indexes present; migration SQL is additive-only; LogEntry metric comment present per A5 |
| REQ-002 | Goal-scope the readiness engine | **PASS** | goalId required on all 4 functions; all 5 call sites updated; no goalId leaks into fitness WHERE clauses |
| REQ-003 | log:* metric namespace | **PASS** | LOG_METRIC_PREFIX constant exported; resolveMetricValue log:* branch correct; resolveMetricStart returns 0; progressFor guard updated; METRICS has both entries with exact spec |
| REQ-004 | Expose Goal.kind over MCP | **PASS** | create_goal inputSchema + handler; createGoalCore persists kind; list_goals returns kind; get_today_plan returns activeGoal{id,kind,objective,githubRepo}|null; all in safe() |
| REQ-005 | Sprint 1 QA gate | **PARTIAL** | Static checks pass; tsc/lint/build not runnable here (Tech Lead gate); Mt. Elbert active state unverifiable statically |

---

## REQ-001 Detail: Schema & Migration

**Goal.kind, githubRepo, githubProjectNumber**: Present at `schema.prisma:180-182`. `kind String @default("fitness")` with inline comment `// fitness | project — determines which MCP tool pack Claude uses`. `@@index([kind])` at line 192. Correct.

**ScheduledItem model** (lines 195-213):
- All required fields present: id, goalId, goal(FK onDelete:Cascade), date, type, title, detail?, payload?, status (default "planned"), completedAt?, externalRef?, createdAt, updatedAt
- `@@unique([goalId, externalRef])` ✓ (line 210)
- `@@index([goalId, date])` ✓ (line 211)
- `@@index([goalId, status])` ✓ (line 212)

**LogEntry model** (lines 215-228):
- All required fields present: id, goalId, goal(FK onDelete:Cascade), date, metric, value?, text?, payload?, source?, createdAt
- `metric` field comment present: `// bare metric key WITHOUT the "log:" registry prefix — e.g. "mrr", not "log:mrr"` ✓ (per A5)
- `@@index([goalId, metric, date])` ✓ (line 227)
- `@@index([goalId, date])` ✓ (line 228)
- **No @@unique on LogEntry** — correct per spec (multiple log entries per goalId+metric are expected)

**Goal relations**: `scheduledItems ScheduledItem[]` and `logEntries LogEntry[]` present at lines 187-188 ✓

**migration.sql analysis**:
- 1× ALTER TABLE Goal (with 3 ADD COLUMN clauses): `githubProjectNumber INTEGER`, `githubRepo TEXT`, `kind TEXT NOT NULL DEFAULT 'fitness'` ✓
- 2× CREATE TABLE: ScheduledItem, LogEntry ✓
- 6× CREATE INDEX (including 1 UNIQUE INDEX): ScheduledItem_goalId_date_idx, ScheduledItem_goalId_status_idx, ScheduledItem_goalId_externalRef_key (UNIQUE), LogEntry_goalId_metric_date_idx, LogEntry_goalId_date_idx, Goal_kind_idx ✓
- 2× ADD CONSTRAINT (FK): ScheduledItem_goalId_fkey (CASCADE), LogEntry_goalId_fkey (CASCADE) ✓
- **grep for DROP, ALTER TYPE, ALTER COLUMN**: NO results — migration is purely additive ✓

**PRD spec calls for CREATE INDEX ×6**: The 6 indexes are: 2 on ScheduledItem (regular) + 1 UNIQUE on ScheduledItem + 2 on LogEntry + 1 on Goal = 6 total ✓

**Postgres NULL-distinct note**: `@@unique([goalId, externalRef])` with nullable externalRef allows multiple rows with externalRef=NULL per goal. Standard Postgres unique index behavior — each NULL is considered distinct. Correct and intentional per PRD §4.1.

---

## REQ-002 Detail: Goal-scoped Readiness Engine

**Function signatures** (`readiness.ts`):
- `computeReadiness(targets, asOf = new Date(), goalId: string)` — required, position 3 ✓
- `computeReadinessSeries(goalCreatedAt, targets, now = new Date(), goalId: string)` — required, position 4 ✓

**Function signatures** (`goal-targets.ts`):
- `resolveMetricValue(prisma, metric, asOf = new Date(), goalId: string)` — required, position 4 ✓
- `resolveMetricStart(prisma, metric, goalId: string)` — required, position 3 ✓

**Argument-transposition check**: No transposition found.
- `computeReadiness(targets, new Date(), g.id)` — correct: targets→GoalTarget[], asOf→Date, goalId→string ✓
- `computeReadinessSeries(g.createdAt, targets, new Date(), g.id)` — correct: goalCreatedAt→Date, targets→GoalTarget[], now→Date, goalId→string ✓
- `computeReadiness(targets, new Date(), goal.id)` — correct ✓
- Inner calls in readiness.ts: `resolveMetricValue(prisma, t.metric, asOf, goalId)` — correct ✓
- Inner calls: `resolveMetricStart(prisma, t.metric, goalId)` — correct ✓
- `computeReadinessSeries` → `computeReadiness(targets, cursor, goalId)` and `computeReadiness(targets, now, goalId)` — correct ✓

**5 call sites** (all confirmed):
1. `stats/page.tsx:39` — `computeReadiness(targets, new Date(), g.id)` ✓
2. `stats/page.tsx:40` — `computeReadinessSeries(g.createdAt, targets, new Date(), g.id)` ✓
3. `progress/page.tsx:37` — `computeReadiness(targets, new Date(), g.id)` ✓
4. `progress/page.tsx:38` — `computeReadinessSeries(g.createdAt, targets, new Date(), g.id)` ✓
5. `goals/[id]/page.tsx:80` — `computeReadiness(targets, new Date(), goal.id)` ✓

**No additional call sites** exist in src/ (confirmed by grep).

**Fitness branch isolation**: goalId is accepted as a parameter but does NOT appear in any WHERE clause for fitness metric branches (weightLb, baseline:*, hike:*, workout:count). The `void goalId;` at line 335 of goal-targets.ts explicitly discards the goalId in resolveMetricStart to satisfy TypeScript's no-unused-variables rule while documenting it as intentionally reserved. In resolveMetricValue, goalId is received but only referenced in the final `log:*` branch. ✓

---

## REQ-003 Detail: log:* Metric Namespace

**LOG_METRIC_PREFIX constant**: `export const LOG_METRIC_PREFIX = "log:" as const` at goal-targets.ts:36 ✓

**resolveMetricValue log:* branch** (goal-targets.ts:312-324):
```typescript
if (metric.startsWith(LOG_METRIC_PREFIX)) {
  const key = metric.slice(LOG_METRIC_PREFIX.length);
  const entry = await prisma.logEntry.findFirst({
    where: { goalId, metric: key, date: { lte: asOf }, value: { not: null } },
    orderBy: { date: "desc" },
  });
  return entry?.value ?? null;
}
```
- Uses LOG_METRIC_PREFIX (not hardcoded "log:") ✓
- Strips prefix via slice ✓
- WHERE: goalId ✓, metric: key (bare key, not prefixed) ✓, date:{lte:asOf} ✓, value:{not:null} ✓
- orderBy: date desc ✓
- Returns entry?.value ?? null ✓ (returns null if no row, consistent with spec)

**resolveMetricStart log:* branch** (goal-targets.ts:357):
`if (metric.startsWith(LOG_METRIC_PREFIX)) return 0;` ✓

**progressFor build-from-zero guard** (readiness.ts:36-40):
```typescript
if (
  target.metric.startsWith("hike:") ||
  target.metric === "workout:count" ||
  target.metric.startsWith(LOG_METRIC_PREFIX)
) {
```
Uses LOG_METRIC_PREFIX constant, not hardcoded ✓. All three cases covered ✓.

**METRICS entries** — exact spec match:
- `log:mrr`: id="log:mrr", label="Monthly recurring revenue", units="$", direction="increase", description="Latest MRR snapshot from a LogEntry." ✓
- `log:milestones_done`: id="log:milestones_done", label="Milestones completed", units="milestones", direction="increase", description="Count of completed milestones, logged via log_metric." ✓

Both entries match REQ-003 spec and PRD §3.1 exactly.

---

## REQ-004 Detail: Expose Goal.kind over MCP

**create_goal inputSchema** (tools.ts:2444-2446):
```typescript
kind: z.enum(["fitness", "project"]).default("fitness").describe(
  "Goal domain; determines which tool pack Claude uses. fitness = workout/hike/baseline tools; project = schedule_item/log_metric/GitHub tools.",
),
```
Enum ✓, default("fitness") ✓, describe text matches PRD §4.2 exactly ✓.

**create_goal handler** (tools.ts:2456):
`async ({ objective, targetDate, notes, kind, copyFromGoalId, legend })` — kind destructured ✓

**createGoalCore call** (tools.ts:2459-2466):
`kind` passed to `createGoalCore({..., kind, ...})` ✓

**createGoalCore** (goal-core.ts):
- `CreateGoalCoreInput.kind?: "fitness" | "project"` at line 22 ✓
- `kind: input.kind ?? "fitness"` in tx.goal.create data block at line 88 ✓

**list_goals** (tools.ts:647-656):
`kind: g.kind` in the map ✓

**get_today_plan** (tools.ts:530-559):
- `prisma.goal.findFirst({ where:{active:true}, orderBy:{updatedAt:"desc"}, select:{id:true, kind:true, objective:true, githubRepo:true} })` ✓
- Null-safe mapping to `activeGoal = activeGoalRow ? {...} : null` ✓
- Returned as `{ ...r, standingRules, activeGoal }` ✓

**safe() wrapping**: All three tools (get_today_plan, list_goals, create_goal) remain inside `safe(async () => {...})` ✓

---

## Byte-Identical Fitness Readiness (REQ-007 / Criterion 7)

**Trace for a fitness goal with NO log:* targets:**

Given a fitness goal (e.g., Mt. Elbert) with targets like `hike:prep_completion`, `baseline:1.5 Mile Run`, `weightLb`, etc.:

1. `computeReadiness(targets, asOf, goalId)` is called.
2. For each target `t`, it calls `resolveMetricValue(prisma, t.metric, asOf, goalId)`.
3. `resolveMetricValue` evaluates the metric string against a chain of `if` branches in order:
   - `t.metric === "weightLb"` → queries `prisma.measurement` with WHERE `{date:{lte:asOf}, weightLb:{not:null}}`. **goalId not in WHERE.** Returns identically to pre-change. ✓
   - `t.metric.startsWith("baseline:")` → queries `prisma.baseline` with WHERE `{testName, date:{lte:asOf}}`. **goalId not in WHERE.** Returns identically. ✓
   - `t.metric === "hike:prep_completion"` → queries `prisma.hike.count` with WHERE `{date:{lte:asOf}, status:"completed", distanceMi:{gte:5}, elevationFt:{gte:2000}}`. **goalId not in WHERE.** ✓
   - Other hike:* and `workout:count` branches: same pattern — no goalId in WHERE. ✓
   - `t.metric.startsWith(LOG_METRIC_PREFIX)` → **only entered if metric starts with "log:"**. Fitness targets never have this prefix, so this branch is never reached for fitness metrics. **No LogEntry query executed for any fitness metric.** ✓
4. `resolveMetricStart(prisma, t.metric, goalId)` similarly: fitness branches ignore goalId (via `void goalId;`), queries are identical to pre-change. ✓
5. `progressFor` guard: the new `|| target.metric.startsWith(LOG_METRIC_PREFIX)` clause is only true when metric starts with "log:". Fitness targets don't, so the guard evaluates identically to pre-change for all fitness metric types. ✓

**Conclusion**: For a fitness goal with no `log:*` targets, the execution path through `computeReadiness` is structurally identical to pre-change — no new DB queries are issued, no query WHERE clauses are modified, and all returned values are byte-identical. The extra `goalId` parameter flows through silently.

---

## Cross-Cutting Checks

### grep: raw date methods in changed files

```
grep -nE "setHours|setDate|getHours|getDate\(|getMonth|getFullYear" \
  src/lib/readiness.ts src/lib/goal-targets.ts src/lib/mcp/tools.ts \
  src/lib/goal-core.ts src/app/stats/page.tsx src/app/progress/page.tsx \
  "src/app/goals/[id]/page.tsx"
```

**Result: NO OUTPUT (zero matches)** ✓

No raw date manipulation methods introduced in any of the changed files. The only date operations in new code are:
- `new Date()` (fine — just instantiates current time)
- `.getTime()` in progress/page.tsx (fine — just millisecond comparison)
- `date: { lte: asOf }` in Prisma WHERE clauses (comparing Date objects, no TZ manipulation)

All date math stays in `@/lib/calendar` as required.

### `any` / `@ts-ignore` / unsafe casts

No new `any` types or `@ts-ignore` directives introduced in the changed files. The `as unknown as` casts found in goal-core.ts (lines 52, 74, 97, 103) are all pre-existing (JSON↔typed boundary), not introduced by this sprint. ✓

### Consumer backward-compatibility check

**list_goals**: MCP tools are consumed by claude.ai, not internally. No internal src/ code reads the `kind` field off the list_goals response. The `kind` field is an additive property on the mapped object — consumers that don't know about it can safely ignore it. No breaking change. ✓

**get_today_plan**: `activeGoal` is a new property added to the return object via spread (`{ ...r, standingRules, activeGoal }`). Existing consumers (claude.ai) that don't reference `activeGoal` are unaffected. No existing src/ code programmatically reads `activeGoal`. No breaking change. ✓

**Goal.kind field on DB model**: All existing Goal rows will have `kind='fitness'` via the column DEFAULT. No existing app code reads `Goal.kind` outside of tools.ts and goal-core.ts. No breaking change. ✓

### Extra prisma.goal.findFirst in get_today_plan (A4)

The `prisma.goal.findFirst({ where:{active:true}, orderBy:{updatedAt:"desc"} })` runs inside `Promise.all` alongside the existing `resolveDay` and `standingRules` queries. It is a single indexed read on the `active` column (which has `@@index([active])` at schema line 190). A4 explicitly accepts this extra query. The read is correctly parallelized and will not be a performance concern. ✓

---

## Code Quality Issues

**None introduced by this sprint.** The `as unknown as` casts in goal-core.ts are pre-existing JSON boundary casts, not new. The `void goalId;` in resolveMetricStart is an intentional TypeScript lint-suppressor documenting that the parameter is reserved — this is the correct idiomatic pattern and not a smell.

One minor observation (not a defect, not blocking):
- The `log:*` prefix check in `progressFor` uses `LOG_METRIC_PREFIX` constant (imported from goal-targets.ts), but the same check in `resolveMetricValue` and `resolveMetricStart` also correctly uses the constant. Consistent. ✓

---

## PRD §8 Acceptance Criteria Status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | schema.prisma adds Goal.kind/githubRepo/githubProjectNumber, ScheduledItem, LogEntry, relations, @@index([kind]) per §4.1 | **PASS** |
| 2 | migration.sql additive-only (CREATE TABLE ×2, ADD COLUMN ×3, CREATE INDEX) — no DROP/ALTER TYPE | **PASS** |
| 3 | prisma migrate dev applies cleanly; prisma generate succeeds; src/generated/prisma exports ScheduledItem+LogEntry | **DEFERRED TO TECH LEAD** (requires running DB + generate) |
| 4 | computeReadiness/computeReadinessSeries/resolveMetricValue/resolveMetricStart require goalId; all 5 call sites pass goal id | **PASS** |
| 5 | log:* branch reads LogEntry filtered by goalId+key (prefix stripped); resolveMetricStart returns 0; progressFor build-from-zero includes log:* | **PASS** |
| 6 | METRICS contains log:mrr and log:milestones_done with exact specs | **PASS** |
| 7 | Fitness readiness score+breakdown byte-identical — no LogEntry query for any fitness metric | **PASS** (static trace, see above) |
| 8 | create_goal accepts kind (default fitness); list_goals returns kind; get_today_plan returns activeGoal{id,kind,objective,githubRepo}|null | **PASS** |
| 9 | npx tsc --noEmit 0 errors; npm run lint no new errors; npm run build succeeds | **DEFERRED TO TECH LEAD** (requires build env) |
| 10 | MCP curl: get_today_plan.activeGoal.kind==="fitness"; list_goals[*].kind present | **DEFERRED TO TECH LEAD** (requires running server + DB) |
| 11 | Mt. Elbert goal is active=true at end of run | **DEFERRED TO TECH LEAD** (create_goal smoke not yet run; static check confirms hazard is documented) |
| 12 | All Date math stays in @/lib/calendar; no raw setHours/getDate/getMonth/getFullYear | **PASS** (grep returned zero matches) |

---

## Overall Verdict

**SHIP IT** — pending Tech Lead's live gates (tsc/build, MCP curl smoke, Mt. Elbert active-state verify after create_goal smoke + revert).

All statically verifiable requirements pass cleanly. No bugs, no unsafe casts, no date-math violations, no arg transpositions, no goalId leakage into fitness WHERE clauses, exact METRICS spec match, migration SQL is additive-only with zero DROP/ALTER TYPE.

---

## Fix Priority List

No fixes required. The following items are deferred to Tech Lead for live validation (not code defects):

1. **(TECH LEAD — required before merge)** Run `npx tsc --noEmit` on main — should be 0 errors (the required goalId arg is the TypeScript safety net).
2. **(TECH LEAD — required before merge)** Run `npm run build` — confirm clean.
3. **(TECH LEAD — required before merge)** Apply migration to Neon and run `npx prisma generate`; confirm `src/generated/prisma` exports `ScheduledItem` and `LogEntry`.
4. **(TECH LEAD — required before merge)** MCP curl smoke: `get_today_plan` → verify `activeGoal.kind === "fitness"`; `list_goals` → verify `kind` present on all goals.
5. **(TECH LEAD — required, with hazard protocol)** Run `create_goal kind="project"` smoke → verify `kind` in `get_goal` response → immediately revert (delete test goal + re-activate Mt. Elbert via plain `prisma.$transaction` script per A2, NOT `setActiveGoal` server action) → verify `get_today_plan.activeGoal` shows Mt. Elbert → run `SELECT id,objective,active FROM "Goal"` to confirm.
6. **(TECH LEAD — verification)** Confirm `SELECT kind FROM "Goal"` shows `fitness` for all existing rows.
