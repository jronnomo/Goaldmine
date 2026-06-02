# Architecture Blueprint — Sprint 1: Generic Data Spine

**Author**: Architect Agent  
**Date**: 2026-06-01  
**Source-of-truth PRD**: `docs/prds/PRD-sprint-1-data-spine.md`  
**Requirements**: `.feature-dev/2026-06-01-sprint-1-data-spine/phases/requirements.md`  
**Issues**: #20, #21, #22, #23, #56

---

## Spec-Drift Report (code verified 2026-06-01)

Before the blueprint: the following PRD line-number citations were verified against actual code. **All confirmed accurate** with one correction:

| PRD Citation | Actual location | Status |
|---|---|---|
| `stats:39-40` — `computeReadiness`/`computeReadinessSeries` call | Confirmed: `stats/page.tsx` lines 39–40 | ✅ |
| `progress:37-38` — same calls | Confirmed: `progress/page.tsx` lines 37–38 | ✅ |
| `goals/[id]:80` — `computeReadiness` call | Confirmed: `goals/[id]/page.tsx` line 80 | ✅ |
| `Goal` model at `schema.prisma:163` | Confirmed: line 163 | ✅ |
| `create_goal` at `tools.ts:2420` | Confirmed: line 2420 (`server.registerTool("create_goal"`) | ✅ |
| `createGoalCore` at `goal-core.ts:32` | Confirmed: line 32 | ✅ |
| `createGoalCore-deactivates-goals` at `goal-core.ts:78-80` | Confirmed: `tx.goal.updateMany({ data: { active: false } })` at line 79 | ✅ (line 79 not 78) |
| `computeReadiness` at `readiness.ts:55` | Confirmed: line 55 | ✅ |
| `computeReadinessSeries` at `readiness.ts:85` | Confirmed: line 85 | ✅ |
| `resolveMetricValue` at `goal-targets.ts:231` | Confirmed: line 231 | ✅ |
| `resolveMetricStart` at `goal-targets.ts:298` | Confirmed: line 298 | ✅ |
| `progressFor` build-from-zero guard at `readiness.ts:35` | Confirmed: `if (target.metric.startsWith("hike:") || target.metric === "workout:count")` | ✅ |
| `list_goals` at `tools.ts:619` | Confirmed: line 619 | ✅ |

**Additional grep finding**: No callers of `computeReadiness`, `computeReadinessSeries`, `resolveMetricValue`, or `resolveMetricStart` exist beyond the **5 known call sites**:
- `stats/page.tsx:39` — `computeReadiness(targets)` 
- `stats/page.tsx:40` — `computeReadinessSeries(g.createdAt, targets)`
- `progress/page.tsx:37` — `computeReadiness(targets)`
- `progress/page.tsx:38` — `computeReadinessSeries(g.createdAt, targets)`
- `goals/[id]/page.tsx:80` — `computeReadiness(targets)`

The TypeScript strict-mode required-argument change will catch all 5 immediately. No hidden call sites.

**`createGoalCore` callers**: exactly 2 — `src/lib/goal-actions.ts:61` and `src/lib/mcp/tools.ts:2442`. Both confirmed below (see Section 5).

---

## 1. File Plan

| Action | Path | Purpose | Key Changes | Stream |
|--------|------|---------|-------------|--------|
| MODIFY | `prisma/schema.prisma` | Add `Goal.kind`, `Goal.githubRepo`, `Goal.githubProjectNumber`, two new relations, `@@index([kind])`, new `ScheduledItem` model, new `LogEntry` model | ~50 lines added, zero drops | REQ-001 (gate) |
| CREATE | `prisma/migrations/<ts>_multi_domain_spine/migration.sql` | Auto-generated migration SQL — additive only | Agent writes schema, generates diff, commits SQL; Tech Lead reviews + applies to Neon | REQ-001 (gate) |
| MODIFY | `src/lib/readiness.ts` | Add `goalId` param to `computeReadiness` and `computeReadinessSeries`; pass it to inner calls | Signatures + 3 internal call sites | REQ-002 |
| MODIFY | `src/lib/goal-targets.ts` | Add `goalId` param to `resolveMetricValue` and `resolveMetricStart`; add `log:*` branch; update `METRICS` array | Signatures + new branch + 2 METRICS entries | REQ-002 + REQ-003 |
| MODIFY | `src/app/stats/page.tsx` | Pass `g.id` as third arg to `computeReadiness`, fourth arg to `computeReadinessSeries` | 2 call sites — lines 39–40 | REQ-002 |
| MODIFY | `src/app/progress/page.tsx` | Same as stats | 2 call sites — lines 37–38 | REQ-002 |
| MODIFY | `src/app/goals/[id]/page.tsx` | Pass `goal.id` as second arg to `computeReadiness` | 1 call site — line 80 | REQ-002 |
| MODIFY | `src/lib/goal-core.ts` | Add `kind?: "fitness" \| "project"` to `CreateGoalCoreInput`; persist `kind: input.kind ?? "fitness"` in `tx.goal.create` | 2 targeted edits | REQ-004 |
| MODIFY | `src/lib/mcp/tools.ts` | `create_goal`: add `kind` to inputSchema + pass to `createGoalCore`; `list_goals`: add `kind: g.kind` to map; `get_today_plan`: add `activeGoal` query + merge | 3 targeted edits in one file | REQ-004 |

**Files NOT touched in any stream**: `src/lib/goal-actions.ts`, `src/lib/plan.ts`, `src/app/api/mcp/route.ts`, `prisma/seed.ts`, any component, any migration other than the new one.

---

## 2. Prisma Schema Changes

### 2.1 Goal model additions (insert after existing fields, before relations)

Insert these three field lines **after `updatedAt DateTime @updatedAt`** (currently line 181) and **before `plans Plan[]`** (currently line 183):

```prisma
  kind                 String   @default("fitness") // fitness | project
  githubRepo           String?  // e.g. "owner/repo"
  githubProjectNumber  Int?
```

Insert these two relation lines **after `plans Plan[]`** (currently line 183):

```prisma
  scheduledItems       ScheduledItem[]
  logEntries           LogEntry[]
```

Insert this index line in the `@@index` block **after `@@index([targetDate])`** (currently line 186):

```prisma
  @@index([kind])
```

**Post-edit Goal model (complete, for reference):**

```prisma
model Goal {
  id         String   @id @default(cuid())
  objective  String
  targetDate DateTime
  notes      String?
  status     String   @default("active") // active | achieved | abandoned
  active     Boolean  @default(true)
  // Optional readiness targets — array of { metric, label, target, start?, weight, units, direction }
  targets    Json?
  // Optional references — array of { id, kind: 'url' | 'doc', value, label?, addedAt, claudeSummary? }
  // The app stores these; Claude reads them via MCP and uses them to refine targets.
  references Json?
  // Optional calendar legend — array of { icon, label, kind } where kind ∈
  // {"trained", "hike-completed", "hike-planned", "override", "goal-date"}.
  // Drives both the calendar legend AND which icons render in cells. Null
  // = use the default Mt. Elbert-flavored legend in src/lib/legend.ts.
  legend     Json?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  kind                 String   @default("fitness") // fitness | project
  githubRepo           String?  // e.g. "owner/repo"
  githubProjectNumber  Int?

  plans          Plan[]
  scheduledItems ScheduledItem[]
  logEntries     LogEntry[]

  @@index([active])
  @@index([targetDate])
  @@index([kind])
}
```

### 2.2 New ScheduledItem model

Append **after the `Goal` model block** (after the closing `}` at current line 187), before the `Plan` model:

```prisma
model ScheduledItem {
  id          String    @id @default(cuid())
  goalId      String
  goal        Goal      @relation(fields: [goalId], references: [id], onDelete: Cascade)
  date        DateTime  // USER_TZ midnight, written via parseDateInput by future tools
  type        String    // e.g. "milestone" | "task" | "review"
  title       String
  detail      String?
  payload     Json?
  status      String    @default("planned") // planned | done | skipped
  completedAt DateTime?
  externalRef String?   // e.g. GitHub milestone node id, for idempotent sync
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([goalId, date])
  @@index([goalId, status])
  @@unique([goalId, externalRef])
}
```

### 2.3 New LogEntry model

Append **after the `ScheduledItem` model block**, before the `Plan` model:

```prisma
model LogEntry {
  id        String   @id @default(cuid())
  goalId    String
  goal      Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  date      DateTime // USER_TZ midnight
  metric    String   // e.g. "mrr", "milestones_done" (NO "log:" prefix in storage)
  value     Float?
  text      String?
  payload   Json?
  source    String?
  createdAt DateTime @default(now())

  @@index([goalId, metric, date])
  @@index([goalId, date])
}
```

### 2.4 Migration instructions

- **Migration name**: `multi-domain-spine` (CLI flag: `--name multi-domain-spine`; Prisma converts to `multi_domain_spine` in the directory name)
- **Agent action**: Edit `prisma/schema.prisma` as above. Run `npx prisma migrate dev --name multi-domain-spine` **locally** to generate the migration SQL file in `prisma/migrations/`. Commit the updated `schema.prisma` and the generated `migration.sql`. Do **NOT** apply to Neon — only the local dev DB is hit during `migrate dev` in a worktree with a local connection string, or the agent generates only the SQL via `prisma migrate diff` for review.
- **Tech Lead action**: Review `migration.sql` for additive-only content (expected: `CREATE TABLE "ScheduledItem" ...`, `CREATE TABLE "LogEntry" ...`, `ALTER TABLE "Goal" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'fitness'`, `ALTER TABLE "Goal" ADD COLUMN "githubRepo" TEXT`, `ALTER TABLE "Goal" ADD COLUMN "githubProjectNumber" INTEGER`, `CREATE INDEX ...`). Confirm zero `DROP`/`ALTER TYPE`/`RENAME`. Then run `npx prisma generate` to regenerate the client.
- **Postgres NULL-distinct note**: `@@unique([goalId, externalRef])` — standard Postgres treats NULLs as distinct in unique indexes. Multiple `ScheduledItem` rows per `goalId` with `externalRef = NULL` are allowed. QA must verify this is acceptable (it is for planned items without a GitHub ref yet).
- After `prisma generate`, `src/generated/prisma` exports `ScheduledItem` and `LogEntry` types. The client in worktrees for #21/#22/#23 must be regenerated from updated `main` — see Section 7.

---

## 3. `readiness.ts` / `goal-targets.ts` Changes

### 3.1 New signatures

**`readiness.ts` — `computeReadiness`** (current: line 55–83):

```typescript
// OLD
export async function computeReadiness(
  targets: GoalTarget[],
  asOf: Date = new Date(),
): Promise<ReadinessSnapshot>

// NEW
export async function computeReadiness(
  targets: GoalTarget[],
  asOf: Date = new Date(),
  goalId: string,
): Promise<ReadinessSnapshot>
```

**`readiness.ts` — `computeReadinessSeries`** (current: line 85–104):

```typescript
// OLD
export async function computeReadinessSeries(
  goalCreatedAt: Date,
  targets: GoalTarget[],
  now: Date = new Date(),
): Promise<ReadinessSeriesPoint[]>

// NEW
export async function computeReadinessSeries(
  goalCreatedAt: Date,
  targets: GoalTarget[],
  now: Date = new Date(),
  goalId: string,
): Promise<ReadinessSeriesPoint[]>
```

**`goal-targets.ts` — `resolveMetricValue`** (current: line 231–295):

```typescript
// OLD
export async function resolveMetricValue(
  prisma: PrismaClient,
  metric: string,
  asOf: Date = new Date(),
): Promise<number | null>

// NEW
export async function resolveMetricValue(
  prisma: PrismaClient,
  metric: string,
  asOf: Date = new Date(),
  goalId: string,
): Promise<number | null>
```

**`goal-targets.ts` — `resolveMetricStart`** (current: line 298–323):

```typescript
// OLD
export async function resolveMetricStart(
  prisma: PrismaClient,
  metric: string,
): Promise<number | null>

// NEW
export async function resolveMetricStart(
  prisma: PrismaClient,
  metric: string,
  goalId: string,
): Promise<number | null>
```

### 3.2 Internal call forwarding inside readiness.ts

Inside `computeReadiness`, the loop body currently calls (lines 63, 66):

```typescript
// CURRENT (lines 63, 66)
const current = await resolveMetricValue(prisma, t.metric, asOf);
const start = t.start !== undefined && t.start !== null
  ? t.start
  : await resolveMetricStart(prisma, t.metric);
```

**After change** — add `goalId` as fourth / third arg:

```typescript
// NEW (lines 63, 66)
const current = await resolveMetricValue(prisma, t.metric, asOf, goalId);
const start = t.start !== undefined && t.start !== null
  ? t.start
  : await resolveMetricStart(prisma, t.metric, goalId);
```

Inside `computeReadinessSeries`, the two `computeReadiness` calls (currently lines 94, 100):

```typescript
// CURRENT (line 94)
const snap = await computeReadiness(targets, cursor);
// CURRENT (line 100)
const snap = await computeReadiness(targets, now);

// NEW (line 94)
const snap = await computeReadiness(targets, cursor, goalId);
// NEW (line 100)
const snap = await computeReadiness(targets, now, goalId);
```

### 3.3 `log:*` branch in `resolveMetricValue`

Insert this block **before the final `return null`** at the end of `resolveMetricValue` (currently line 294):

```typescript
  if (metric.startsWith("log:")) {
    const key = metric.slice("log:".length); // strip prefix; storage is bare key ("mrr", not "log:mrr")
    const entry = await prisma.logEntry.findFirst({
      where: {
        goalId,
        metric: key,
        date: { lte: asOf },
        value: { not: null },
      },
      orderBy: { date: "desc" },
    });
    return entry?.value ?? null;
  }
```

**`resolveMetricStart` — `log:*` branch**: Insert before the final `return null` (currently line 322):

```typescript
  // log:* entries build from zero; no historical start needed.
  if (metric.startsWith("log:")) return 0;
```

### 3.4 `progressFor` build-from-zero guard update

Current guard (line 35 in `readiness.ts`):

```typescript
// CURRENT (line 35)
if (target.metric.startsWith("hike:") || target.metric === "workout:count") {
```

**New guard**:

```typescript
// NEW (line 35)
if (target.metric.startsWith("hike:") || target.metric === "workout:count" || target.metric.startsWith("log:")) {
```

### 3.5 The 5 call-site edits (exact before → after)

**`stats/page.tsx:39`**
```typescript
// BEFORE (line 39)
        computeReadiness(targets),
// AFTER
        computeReadiness(targets, new Date(), g.id),
```

**`stats/page.tsx:40`**
```typescript
// BEFORE (line 40)
        computeReadinessSeries(g.createdAt, targets),
// AFTER
        computeReadinessSeries(g.createdAt, targets, new Date(), g.id),
```

**`progress/page.tsx:37`**
```typescript
// BEFORE (line 37)
        computeReadiness(targets),
// AFTER
        computeReadiness(targets, new Date(), g.id),
```

**`progress/page.tsx:38`**
```typescript
// BEFORE (line 38)
        computeReadinessSeries(g.createdAt, targets),
// AFTER
        computeReadinessSeries(g.createdAt, targets, new Date(), g.id),
```

**`goals/[id]/page.tsx:80`**
```typescript
// BEFORE (line 80)
  const readiness = targets.length > 0 ? await computeReadiness(targets) : null;
// AFTER
  const readiness = targets.length > 0 ? await computeReadiness(targets, new Date(), goal.id) : null;
```

**Note on `now` slot**: The `computeReadinessSeries` signature is `(goalCreatedAt, targets, now = new Date(), goalId)`. At the call sites, `now` was previously defaulting. The fix explicitly passes `new Date()` to fill the `now` slot before `goalId` — do not leave a gap with `undefined` (TypeScript strict mode won't accept a missing positional parameter before a required one).

### 3.6 METRICS entries (append to `METRICS` array in `goal-targets.ts`)

Append these two entries to the `METRICS` array (currently ending at the `workout:count` entry, line 128):

```typescript
  {
    id: "log:mrr",
    label: "Monthly recurring revenue",
    units: "$",
    direction: "increase",
    description: "Latest MRR snapshot from a LogEntry.",
  },
  {
    id: "log:milestones_done",
    label: "Milestones completed",
    units: "milestones",
    direction: "increase",
    description: "Count of completed milestones, logged via log_metric.",
  },
```

---

## 4. MCP Changes

### 4.1 `create_goal` inputSchema addition (tools.ts ~line 2427)

Current `inputSchema` block (lines 2427–2437):
```typescript
      inputSchema: {
        objective: z.string().min(1).max(200),
        targetDate: DateKeyShape,
        notes: z.string().optional(),
        copyFromGoalId: z
          .string()
          .optional()
          .describe("Copy targets array from this existing goal (any status)"),
        legend: LegendSchema.optional().describe(
          "Calendar legend; see update_goal_legend description for preset examples by goal flavor",
        ),
      },
```

**New `inputSchema` block** — add `kind` field after `notes`:
```typescript
      inputSchema: {
        objective: z.string().min(1).max(200),
        targetDate: DateKeyShape,
        notes: z.string().optional(),
        kind: z.enum(["fitness", "project"]).default("fitness").describe(
          "Goal domain; determines which tool pack Claude uses. fitness = workout/hike/baseline tools; project = schedule_item/log_metric/GitHub tools.",
        ),
        copyFromGoalId: z
          .string()
          .optional()
          .describe("Copy targets array from this existing goal (any status)"),
        legend: LegendSchema.optional().describe(
          "Calendar legend; see update_goal_legend description for preset examples by goal flavor",
        ),
      },
```

### 4.2 `create_goal` handler update (tools.ts ~line 2439)

Current handler destructure and `createGoalCore` call (lines 2439–2448):
```typescript
    async ({ objective, targetDate, notes, copyFromGoalId, legend }) =>
      safe(async () => {
        const parsedDate = parseDateInput(targetDate);
        const { goal, planId } = await createGoalCore({
          objective,
          targetDate: parsedDate,
          notes,
          copyFromGoalId,
          legend,
        });
```

**New handler** — add `kind` to destructure and pass to `createGoalCore`:
```typescript
    async ({ objective, targetDate, notes, kind, copyFromGoalId, legend }) =>
      safe(async () => {
        const parsedDate = parseDateInput(targetDate);
        const { goal, planId } = await createGoalCore({
          objective,
          targetDate: parsedDate,
          notes,
          kind,
          copyFromGoalId,
          legend,
        });
```

### 4.3 `list_goals` map addition (tools.ts ~line 634)

Current map object (lines 634–641):
```typescript
        return goals.map((g) => ({
          id: g.id,
          objective: g.objective,
          targetDate: g.targetDate,
          status: g.status,
          active: g.active,
          targetCount: Array.isArray(g.targets) ? (g.targets as unknown[]).length : 0,
          activePlanId: g.plans[0]?.id ?? null,
        }));
```

**New map object** — add `kind` after `active`:
```typescript
        return goals.map((g) => ({
          id: g.id,
          objective: g.objective,
          targetDate: g.targetDate,
          status: g.status,
          active: g.active,
          kind: g.kind,
          targetCount: Array.isArray(g.targets) ? (g.targets as unknown[]).length : 0,
          activePlanId: g.plans[0]?.id ?? null,
        }));
```

### 4.4 `get_today_plan` `activeGoal` addition (tools.ts ~line 529)

**Current handler body** (lines 529–547):
```typescript
    async () =>
      safe(async () => {
        const [r, standingRules] = await Promise.all([
          resolveDay(new Date()),
          prisma.note.findMany({
            where: { type: "standing_rule", resolvedAt: null },
            orderBy: [{ lastAcknowledgedAt: { sort: "desc", nulls: "last" } }, { date: "desc" }],
            select: {
              id: true,
              body: true,
              date: true,
              lastAcknowledgedAt: true,
            },
          }),
        ]);
        return { ...r, standingRules };
      }),
```

**New handler body** — add `activeGoal` query to the `Promise.all`:
```typescript
    async () =>
      safe(async () => {
        const [r, standingRules, activeGoalRow] = await Promise.all([
          resolveDay(new Date()),
          prisma.note.findMany({
            where: { type: "standing_rule", resolvedAt: null },
            orderBy: [{ lastAcknowledgedAt: { sort: "desc", nulls: "last" } }, { date: "desc" }],
            select: {
              id: true,
              body: true,
              date: true,
              lastAcknowledgedAt: true,
            },
          }),
          prisma.goal.findFirst({
            where: { active: true },
            orderBy: { updatedAt: "desc" },
            select: { id: true, kind: true, objective: true, githubRepo: true },
          }),
        ]);
        const activeGoal = activeGoalRow
          ? {
              id: activeGoalRow.id,
              kind: activeGoalRow.kind,
              objective: activeGoalRow.objective,
              githubRepo: activeGoalRow.githubRepo,
            }
          : null;
        return { ...r, standingRules, activeGoal };
      }),
```

**`activeGoal` return shape**: `{ id: string, kind: string, objective: string, githubRepo: string | null } | null`

### 4.5 Sample curl smoke tests

```sh
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"

# 1. get_today_plan → expect activeGoal.kind === "fitness"
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_today_plan","arguments":{}}}' \
  | python3 -m json.tool | grep -A5 "activeGoal"

# 2. list_goals → expect each goal has "kind" field
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_goals","arguments":{}}}' \
  | python3 -m json.tool | grep "kind"

# 3. create_goal with kind="project" — TECH LEAD ONLY, requires manual revert
# DO NOT run against Neon without a cleanup plan. See Section 7c.
# curl -s -X POST http://localhost:3000/api/mcp \
#   -H "Authorization: Bearer $TOKEN" \
#   -H "Content-Type: application/json" \
#   -H "Accept: application/json, text/event-stream" \
#   -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_goal","arguments":{"objective":"Chewgether MVP","targetDate":"2026-09-01","kind":"project"}}}'
```

---

## 5. Type Definitions

### 5.1 `CreateGoalCoreInput` (goal-core.ts)

Current interface (lines 18–25):
```typescript
export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date;
  notes?: string | null;
  copyFromGoalId?: string | null;
  targets?: GoalTarget[] | null;
  legend?: Legend;
}
```

**New interface** — add optional `kind`:
```typescript
export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date;
  notes?: string | null;
  kind?: "fitness" | "project";
  copyFromGoalId?: string | null;
  targets?: GoalTarget[] | null;
  legend?: Legend;
}
```

### 5.2 `goal-core.ts` — `tx.goal.create` data block

Add `kind: input.kind ?? "fitness"` to the data object in `tx.goal.create` (currently at line 82–106). The existing data block starts:
```typescript
        data: {
          objective,
          targetDate,
          notes: normalizedNotes,
          targets: targets ?? undefined,
          ...(legendForCreate === undefined ? {} : { legend: legendForCreate }),
```

**Add after `targets: targets ?? undefined,`**:
```typescript
          kind: input.kind ?? "fitness",
```

### 5.3 `goal-actions.ts` — impact analysis

`goal-actions.ts:61` calls `createGoalCore({objective, targetDate, notes, copyFromGoalId, targets, legend})`. **No `kind` is passed**. Since `kind` is optional (`kind?: ...`) in `CreateGoalCoreInput` and the persist expression is `input.kind ?? "fitness"`, omitting `kind` produces `kind: "fitness"` — identical to the current column default. **No breaking change. No edit required.**

### 5.4 Types that do NOT change

- `GoalTarget` — unchanged (no `goalId` field; metric string is the discriminator)
- `ReadinessSnapshot` — unchanged (`score`, `breakdown`, `missing` — `goalId` is not surfaced in the snapshot)
- `ReadinessSeriesPoint` — unchanged
- `TargetProgress` — unchanged

---

## 6. Work Streams and Implementation Order

### 6.1 Dependency graph

```
REQ-001 (gate — schema + migration)
    ├── REQ-002 (readiness.ts + goal-targets.ts signatures) → REQ-003 (log:* metric + METRICS)
    └── REQ-004 (tools.ts + goal-core.ts)
            (REQ-002/003 and REQ-004 are PARALLEL after REQ-001 merges to main)
REQ-005 (QA — after all three merge)
```

### 6.2 Work streams table

| Stream | Agent | Issues | Files | Blocks |
|--------|-------|--------|-------|--------|
| Schema/Migration | Schema Agent | #20 | `prisma/schema.prisma`, `prisma/migrations/<ts>_multi_domain_spine/migration.sql` | Gate — all other streams wait for this to merge to `main` |
| Backend-readiness | Agent A | #21, #22 | `src/lib/readiness.ts`, `src/lib/goal-targets.ts`, `src/app/stats/page.tsx`, `src/app/progress/page.tsx`, `src/app/goals/[id]/page.tsx` | Runs after #20 merges; #21 then #22 sequentially (same agent, shared files) |
| MCP | Agent B | #23 | `src/lib/mcp/tools.ts`, `src/lib/goal-core.ts` | Runs after #20 merges; parallel to Agent A |
| QA | QA Agent | #56 | None (read + verify only) | Runs after #21, #22, #23 all merge |

### 6.3 File-disjointness confirmation

| File | Agent A (readiness stream) | Agent B (MCP stream) |
|------|---------------------------|----------------------|
| `prisma/schema.prisma` | READ only (for LogEntry type after client regen) | READ only |
| `src/lib/readiness.ts` | WRITES | does not touch |
| `src/lib/goal-targets.ts` | WRITES | does not touch |
| `src/app/stats/page.tsx` | WRITES | does not touch |
| `src/app/progress/page.tsx` | WRITES | does not touch |
| `src/app/goals/[id]/page.tsx` | WRITES | does not touch |
| `src/lib/mcp/tools.ts` | does not touch | WRITES |
| `src/lib/goal-core.ts` | does not touch | WRITES |

**Zero file overlap between Agent A and Agent B. No merge conflicts possible between the two parallel streams.**

**Shared import risk**: both streams import from `@/generated/prisma/client` (Agent A for `PrismaClient` type in goal-targets.ts; Agent B for `Prisma` namespace in tools.ts). This is a read-only import — no conflict possible. The only requirement is that both worktrees have run `npx prisma generate` after branching from the post-#20 `main`.

### 6.4 Implementation order (per-agent steps)

**Schema Agent (#20 — must complete first)**
1. Edit `prisma/schema.prisma` exactly per Section 2.
2. Run `npx prisma migrate dev --name multi-domain-spine` to generate migration SQL locally.
3. Run `npx prisma generate` to verify client regenerates cleanly.
4. Run `npx tsc --noEmit` and `npm run build` — must be green.
5. Commit `schema.prisma` + `migration.sql`. Do NOT apply to Neon.
6. Open PR / merge to `main`. Tech Lead reviews `migration.sql` for additive-only content before applying to Neon and running `prisma generate` on `main`.

**Agent A (#21 then #22 — sequential, same agent)**
1. Branch off updated `main` (post #20 merge).
2. Run `npx prisma generate` to get `LogEntry` type in scope.
3. Edit `src/lib/readiness.ts` per Section 3.1–3.2 (add `goalId` params, forward to inner calls).
4. Edit `src/lib/goal-targets.ts` per Section 3.1, 3.3 (add `goalId` params, existing branches accept but ignore it — no query changes).
5. Edit the 5 call-site pages per Section 3.5.
6. Run `npx tsc --noEmit` — must be 0 errors (the required `goalId` arg is the safety net).
7. **#22 continues in same agent**: Add `log:*` branch to `resolveMetricValue` per Section 3.3.
8. Add `log:*` branch to `resolveMetricStart` per Section 3.3.
9. Update `progressFor` guard per Section 3.4.
10. Append METRICS entries per Section 3.6.
11. Run `npx tsc --noEmit`, `npm run lint`, `npm run build` — all green.
12. Commit and merge #21 then #22 to `main`.

**Agent B (#23 — parallel to Agent A, after #20)**
1. Branch off updated `main` (post #20 merge).
2. Run `npx prisma generate`.
3. Edit `src/lib/goal-core.ts` per Sections 5.1–5.2 (add `kind` to interface, persist in create).
4. Edit `src/lib/mcp/tools.ts` per Sections 4.1–4.4 (create_goal schema + handler, list_goals map, get_today_plan activeGoal).
5. Run `npx tsc --noEmit`, `npm run lint`, `npm run build` — all green.
6. Run MCP curl smokes 1 and 2 from Section 4.5 with `npm run dev` running.
7. Commit and merge #23 to `main`.

---

## 7. Critical Decisions

### 7a. `log:` prefix storage convention (DECIDED — must be honored)

- **Registry / target side**: uses the `log:` prefix. Example: `METRICS` entry `id: "log:mrr"`, goal target `metric: "log:mrr"`.
- **Storage side** (`LogEntry.metric` column): stores the **bare key without prefix**. Example: `metric = "mrr"`.
- **Stripping**: `resolveMetricValue` does `const key = metric.slice("log:".length)` (= `metric.slice(4)`). The query is `where: { goalId, metric: key, ... }`.
- **Rationale**: keeps the DB column clean for direct SQL queries; the prefix is a routing namespace only.
- **Verification for QA**: create a `LogEntry` row with `metric="mrr"`, `value=500`; set a goal target `log:mrr` with `target: 1000`; assert `resolveMetricValue` returns `500` and `progressFor` returns `0.5`.

### 7b. `createGoalCore` deactivates-goals hazard

`goal-core.ts:79` runs `tx.goal.updateMany({ data: { active: false } })` inside its transaction. Creating **any** goal deactivates **all** existing goals including the live Mt. Elbert goal.

**Why this is critical**: The Neon DB is shared with prod. `set_active_goal` (the MCP reactivation tool) does not exist until Sprint 2. There is no MCP path to reactivate Mt. Elbert after a test `create_goal` call.

**Protocol**:
- The #23 smoke test that calls `create_goal kind="project"` is **Tech-Lead-only**.
- Tech Lead executes manually: (1) call `create_goal` with `kind="project"` and a clearly test-named objective; (2) verify `kind="project"` via `get_goal`; (3) delete the test goal and re-activate Mt. Elbert using a direct Prisma script or the existing `setActiveGoal` server action (it exists in `goal-actions.ts:115` and can be called from a temporary script); (4) verify `get_today_plan` returns the Mt. Elbert goal active again.
- **Agent B must NOT run this smoke test.** Agents run only curl smokes 1 and 2 (get_today_plan, list_goals).
- **QA Agent must verify `active=true` on the Mt. Elbert goal at the end of the run** and halt + alert if not.

**Note on `setActiveGoal`**: `src/lib/goal-actions.ts:115` already has a working `setActiveGoal(id: string)` function that correctly reactivates a goal and deactivates all others. Tech Lead can call this directly via a one-off script (`tsx -e "import {setActiveGoal} from './src/lib/goal-actions'; ..."`) or via a temporary API route — no need to write new Prisma logic.

### 7c. Worktree client-regeneration sequencing

`src/generated/prisma` is gitignored. The generated client is never committed. This means:

1. **#20 must merge to `main` first.** The schema changes must be on `main` before any other worktree starts.
2. **After #20 merges**, Tech Lead applies the migration to Neon and runs `npx prisma generate` on `main`. Now the generated client on `main` includes `ScheduledItem`, `LogEntry`, and the `kind`/`githubRepo`/`githubProjectNumber` fields on `Goal`.
3. **Worktrees for #21, #22, #23 branch off the updated `main`** — not off the pre-#20 state.
4. Each worktree runs `npx prisma generate` immediately after checkout. This is step 2 in both Agent A and Agent B's per-agent steps above.
5. If a worktree branches off `main` before step 2 completes, `prisma.logEntry` won't exist in the client and Agent A's `log:*` branch will fail to compile. This is a hard sequencing dependency — Tech Lead must confirm client regeneration on `main` is complete before signaling agents to start.

---

## 8. Edge Case and QA Notes for Agents

| Scenario | Expected behavior | How to verify |
|----------|------------------|---------------|
| Existing `Goal` rows after migration | All get `kind='fitness'` via column default | `SELECT id, kind FROM "Goal"` — all rows show `fitness` |
| `log:mrr` target, zero `LogEntry` rows | `resolveMetricValue` → `null`; `progressFor` → `null`; target in `missing` list, excluded from score | curl `computeReadiness` with a project goal that has no log entries |
| `log:mrr` with `LogEntry(metric="mrr", value=500)` vs target 1000 | `progressFor` returns `0.5`; build-from-zero path (no `start` lookup) | Unit-verify manually |
| Fitness goal — no `log:*` targets | `resolveMetricValue` never enters the `log:*` branch; zero `LogEntry` queries | Confirm via code inspection: branch only entered when `metric.startsWith("log:")` |
| `get_today_plan` — no active goal | `activeGoal: null` | Delete/deactivate all goals (test env only), curl `get_today_plan` |
| `create_goal` omitting `kind` | Stored row has `kind='fitness'` | `SELECT kind FROM "Goal" ORDER BY "createdAt" DESC LIMIT 1` |
| Two `ScheduledItem` rows with `externalRef=NULL` for same goal | Both allowed (Postgres NULL-distinct unique) | Direct DB insert test (Sprint 2, but document now) |
| `@@unique([goalId, externalRef])` with same non-null `externalRef` | Second insert fails with unique constraint | Direct DB insert test (Sprint 2) |
| Fitness readiness score byte-identical | `/stats` and `/progress` render the same readiness score and breakdown as current `main` | Screenshot comparison or manual numeric check before/after |
| `npx tsc --noEmit` missing `goalId` arg | TypeScript error at each un-updated call site | This is the safety net — any missed call site fails to compile |

---

## 9. QA Gate (REQ-005 / #56) Checklist

QA Agent runs these checks after all of #20, #21, #22, #23 merge to `main`:

- [ ] `prisma migrate diff` shows additive-only (CREATE TABLE ×2, ADD COLUMN ×3, CREATE INDEX — no DROP, no ALTER TYPE).
- [ ] `src/generated/prisma` exports `ScheduledItem` and `LogEntry` (verify with `grep -r "ScheduledItem" src/generated/prisma`).
- [ ] `npx tsc --noEmit` — 0 errors.
- [ ] `npm run lint` — no new errors.
- [ ] `npm run build` — succeeds.
- [ ] Browser smoke: `/stats`, `/progress`, `/goals/[id]` at 390 px — readiness score and breakdown numerically identical to pre-sprint `main`.
- [ ] MCP curl: `get_today_plan` returns `activeGoal.kind === "fitness"`.
- [ ] MCP curl: `list_goals` — every goal object has a `kind` field.
- [ ] `SELECT kind FROM "Goal"` — all existing rows show `fitness`.
- [ ] **Mt. Elbert goal has `active=true`** — verify via `SELECT active FROM "Goal" WHERE objective LIKE '%Elbert%'` or `get_today_plan.activeGoal.id` matches the Mt. Elbert goal id. If not active, halt and alert Tech Lead immediately.
- [ ] No raw `setHours`/`getDate`/`getMonth`/`getFullYear` introduced in any app file (grep: `grep -rn "setHours\|\.getDate()\|\.getMonth()\|\.getFullYear()" src --include="*.ts" --include="*.tsx"`).
- [ ] `prisma.logEntry` is accessible from `@/generated/prisma/client` (compile-time check via `tsc`).
