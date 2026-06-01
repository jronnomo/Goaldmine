# Plan Blueprint — Multi-Domain Goal Engine

**Author**: Plan Architect (Claude) · **Date**: 2026-05-31 · **Status**: Hardened · **Input**: scope-brief.md + multi-domain-plan.md + ground-truth code  
**Output consumers**: `/roadmap` story-decomposition agent; `/feature-dev` build agents per epic.

---

## 1. Exact Prisma Deltas

### Decision

Three changes to `prisma/schema.prisma`, all additive. No existing rows or columns are touched; existing fitness goals gain behavior-identical defaults.

---

#### 1a. `Goal.kind`

```prisma
model Goal {
  // ... existing fields unchanged ...
  kind String @default("fitness")   // "fitness" | "project"; extensible open enum

  @@index([kind])                   // cheap filter for tool packs that branch on kind
}
```

- **Type**: `String` (not a Prisma-level enum). A TypeScript union `"fitness" | "project"` is enforced in application code and Zod schemas. Open-string at the DB level keeps migrations trivial when a third vertical is added.
- **Default**: `"fitness"` — every existing `Goal` row automatically behaves identically; no migration that touches data is needed.
- **Index**: `@@index([kind])` — `list_goals` and readiness queries may filter by kind; cheap to add now, hard to retrofit.
- **Rejected**: Prisma `enum GoalKind`. Would require a data migration to add a new member (Postgres `ALTER TYPE ADD VALUE` can't run inside a transaction; Neon-hostile). String default is safer.

---

#### 1b. `ScheduledItem`

```prisma
model ScheduledItem {
  id          String    @id @default(cuid())
  goalId      String
  goal        Goal      @relation(fields: [goalId], references: [id], onDelete: Cascade)
  date        DateTime  // midnight USER_TZ (same convention as PlanDayOverride.date)
  type        String    // "task" | "milestone" | "launch-step" | "review" — open enum
  title       String
  detail      String?
  payload     Json?     // arbitrary domain data (e.g. GitHub milestone fields)
  status      String    @default("planned")  // "planned" | "done" | "skipped"
  completedAt DateTime?
  externalRef String?   // stable external id: "gh:milestone:<number>" (idempotent sync key)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([goalId, date])
  @@index([goalId, status])
  @@unique([goalId, externalRef])   // null values do NOT participate in the unique constraint
                                    // (Postgres UNIQUE ignores NULLs) — safe for rows w/o externalRef
}
```

- **`@@unique([goalId, externalRef])`**: Postgres treats NULLs as distinct in unique constraints, so rows without `externalRef` never collide. This uniqueness constraint is precisely what makes `sync_github_milestones` idempotent: upsert on `{ goalId, externalRef }` never double-inserts.
- **`date` as midnight**: Mirrors `PlanDayOverride.date` (USER_TZ midnight). All writes go through `startOfDay(parseDateKey(...))` from `@/lib/calendar` — same TZ discipline as the rest of the app.
- **`type` as open String**: "task", "milestone", "launch-step", "review" are documented values; the field is not a DB enum for the same reason as `kind`.
- **Fitness tables untouched**: `Workout`, `Hike`, `Baseline` remain separate. `ScheduledItem` is the new-vertical primitive only.
- **Rejected**: A single `PlannedActivity` model shared with fitness. That would require migrating existing Hike/Workout planned rows into the new table and making the fitness calendar read from a new source — violates the coexist/strangler constraint.

---

#### 1c. `LogEntry`

```prisma
model LogEntry {
  id        String   @id @default(cuid())
  goalId    String
  goal      Goal     @relation(fields: [goalId], references: [id], onDelete: Cascade)
  date      DateTime // point-in-time observation; UTC instant, not necessarily midnight
  metric    String   // e.g. "mrr", "downloads", "milestones_done"
  value     Float?   // numeric observation (MRR in dollars, download count, etc.)
  text      String?  // qualitative annotation ("Shipped payment flow")
  payload   Json?    // raw source data if useful (GitHub milestone JSON, etc.)
  source    String?  // "manual" | "github" | "claude"
  createdAt DateTime @default(now())

  @@index([goalId, metric, date])   // covers resolveMetricValue's "latest as-of" query
  @@index([goalId, date])           // covers recent_history / list_log_entries range scans
}
```

- **`value Float?` + `text String?` both nullable**: A `LogEntry` can be pure-qualitative (`text` only, `value` null) for milestone notes, or pure-numeric (`value` only, `text` null) for MRR snapshots, or both.
- **`date` as a full timestamp** (not midnight-only): MRR snapshots, GitHub sync events, and manual logs have meaningful timestamps. Unlike `ScheduledItem`, this is not rounded to midnight.
- **Rejected**: Separate `MetricLog` and `MilestoneLog` tables. Two tables for essentially the same shape adds joins without adding capability.

---

#### 1d. Goal↔GitHub link fields

```prisma
model Goal {
  // ... existing + kind above ...
  githubRepo          String?   // "owner/repo" e.g. "jronnomo/Chewgether"
  githubProjectNumber Int?      // optional GitHub Projects v2 number on that repo
}
```

- **No `GoalIntegration` table in v1**: A separate integration table is the right call at multi-tenancy time. For a single-user app with one GitHub token in `GITHUB_TOKEN` env, two nullable columns on `Goal` are the minimum viable shape. The token itself never enters the DB.
- **Rejected**: A `GoalIntegration` model keyed on `(goalId, provider)`. Premature for single-user v1; creates a join on every GitHub tool call for no benefit.
- **Confirmed additive + Neon-safe**: All four changes are `ALTER TABLE ... ADD COLUMN` with defaults or `CREATE TABLE` — no column drops, no enum mutations, no multi-statement DDL that can't run in a transaction. `prisma migrate diff` before `migrate dev` is still required (quality-tools.md gotcha #9).

**Migration guard**: After `prisma migrate dev`, run `npx prisma generate` immediately. The `Prisma` namespace types from `@/generated/prisma/client` must be regenerated before any tool code referencing `ScheduledItem` or `LogEntry` compiles.

---

## 2. The Generic-Metric Seam

### Decision: `log:<key>` namespace, milestone-completion as `log:milestones_done` (a LogEntry, not a computed resolver)

---

### 2a. New `log:<key>` case in `resolveMetricValue`

Add the following case to `src/lib/goal-targets.ts` `resolveMetricValue`, immediately before the terminal `return null`:

```typescript
if (metric.startsWith("log:")) {
  const key = metric.slice("log:".length);
  const entry = await prisma.logEntry.findFirst({
    where: {
      metric: key,
      date: { lte: asOf },
      value: { not: null },
      // goalId is NOT filtered here — resolveMetricValue doesn't take goalId.
      // See note below on the goalId gap.
    },
    orderBy: { date: "desc" },
  });
  return entry?.value ?? null;
}
```

**The goalId gap**: `resolveMetricValue` currently takes `(prisma, metric, asOf)` with no `goalId`. This works for all existing metrics because each is backed by a global table (Measurement, Baseline, Hike, Workout) that the single user owns completely. `LogEntry` is goal-scoped — a `log:mrr` entry for one goal must not bleed into another. The signature must be extended:

```typescript
export async function resolveMetricValue(
  prisma: PrismaClient,
  metric: string,
  asOf: Date = new Date(),
  goalId?: string,    // ← NEW optional param; required for log:* metrics
): Promise<number | null>
```

For `log:*` metrics, if `goalId` is absent, throw an error with a clear message. All callers of `resolveMetricValue` for a `Goal` already have the `goalId` (it comes from `Goal.targets[].metric`). `computeReadiness` in `readiness.ts` takes `targets: GoalTarget[]` — add a `goalId: string` param to `computeReadiness` (and `computeReadinessSeries`) so it can pass through. No existing call sites break: fitness goals never have `log:*` metrics, so the new `goalId` param is never used for them.

---

### 2b. New `log:<key>` case in `resolveMetricStart`

```typescript
// log:* metrics start at 0 (same as hike:* and workout:count — these are
// "build from zero" accumulators in the common case, e.g. MRR starts at $0).
if (metric.startsWith("log:")) return 0;
```

This means `progressFor` will use the build-from-zero branch (`current / target`) for all `log:*` metrics — correct for MRR (`$0 → $1000`), downloads (`0 → N`), and milestone count.

---

### 2c. Milestone-completion: `log:milestones_done` (LogEntry), NOT a computed `items:done_ratio` resolver

**Decision**: Use `log:milestones_done` as a manually-logged `LogEntry` metric (Claude calls `log_metric(metric="milestones_done", value=N)` when milestones are completed or synced), rather than a second generic resolver `items:done_ratio` that dynamically counts `ScheduledItem.status="done"`.

**Why**:
1. **`progressFor` compatibility**: The existing build-from-zero branch in `progressFor` handles `log:milestones_done` with zero new code. A computed `items:done_ratio` returning 0..1 would need a separate `direction:"build-from-zero"` case or a special ratio metric, adding branching that only serves one use-case.
2. **Temporal stability**: A `LogEntry` is an immutable observation stamped at a point in time. `computeReadinessSeries` reconstructs the readiness curve by calling `resolveMetricValue(asOf=pastDate)` for each weekly point. A live-computed `items:done_ratio` from the current `ScheduledItem` table would return today's ratio for every past week — the readiness series would be historically wrong. A `LogEntry` correctly returns the value that existed on that date.
3. **Simplicity**: No second resolver, no new `items:done_ratio` branch in the switch, no `ScheduledItem` query inside `resolveMetricValue`. One unified `log:*` case handles all generic metrics.

**Rejected**: A computed `items:done_ratio` resolver. Fails the temporal stability test (breaks readiness history); adds a DB query and switch branch for a metric that a simple LogEntry covers equally well.

---

### 2d. `progressFor` is unchanged

`progressFor` in `readiness.ts` already handles:
- Build-from-zero (checks `metric.startsWith("hike:") || metric === "workout:count"`)
- Increase/decrease with a start value

The `log:*` namespace must be added to the build-from-zero guard:

```typescript
if (
  target.metric.startsWith("hike:") ||
  target.metric === "workout:count" ||
  target.metric.startsWith("log:")   // ← new
) {
  if (target.target === 0) return null;
  return clamp01(current / target.target);
}
```

This is the only change to `progressFor`. Fitness goals are byte-identical: `hike:*` and `workout:count` are unaffected.

---

### 2e. METRICS registry

Add `log:*` entries to the METRICS array only for the concrete metrics the chewgether goal uses. Do not add a wildcard entry — the registry is for UI discoverability, not for resolution logic.

```typescript
{ id: "log:mrr",              label: "Monthly recurring revenue", units: "$",          direction: "increase", description: "Latest MRR snapshot from a LogEntry." },
{ id: "log:milestones_done",  label: "Milestones completed",      units: "milestones", direction: "increase", description: "Count of completed milestones, logged via log_metric." },
```

---

## 3. MCP Tool Pack

### Decision

Two new tool families, registered in `registerAll` via the existing monolithic `registerReadTools` / `registerWriteTools` pattern. All tools apply `decodeArgsDeep` via the existing monkey-patch on `server.registerTool` at the top of `registerAll`. No structural change to registration.

---

### 3a. Project Pack (Epic B)

**All use the `safe()` wrapper and `jsonResult` / `errorResult` shapes.**

#### Read tools

| Tool name | Description | Key inputs |
|---|---|---|
| `list_scheduled_items` | List planned/done/skipped items for a goal with optional date range and status filter | `goalId: string`, `from?: DateKey`, `to?: DateKey`, `status?: "planned"\|"done"\|"skipped"`, `type?: string` |
| `list_log_entries` | List logged metric observations for a goal | `goalId: string`, `metric?: string`, `from?: DateKey`, `to?: DateKey`, `limit?: number default 50` |

#### Write tools

| Tool name | Description | Key inputs |
|---|---|---|
| `schedule_item` | Create a ScheduledItem for a goal | `goalId: string`, `date: DateKey`, `type: string`, `title: string`, `detail?: string`, `payload?: unknown`, `externalRef?: string` |
| `complete_item` | Mark a ScheduledItem done | `id: string`, `completedAt?: DateKey` |
| `update_scheduled_item` | PATCH-style edit of a ScheduledItem | `id: string`, `title?: string`, `detail?: string`, `date?: DateKey`, `status?: string`, `type?: string` |
| `delete_scheduled_item` | Delete a ScheduledItem | `id: string` |
| `log_metric` | Log a LogEntry for a goal metric | `goalId: string`, `metric: string`, `value?: number`, `text?: string`, `date?: DateKey`, `source?: string` |

#### Zod inputSchema examples (concrete — build agents follow these exactly)

```typescript
// schedule_item
{
  goalId:      z.string(),
  date:        DateKeyShape,
  type:        z.string().min(1).describe("'task' | 'milestone' | 'launch-step' | 'review' (open enum)"),
  title:       z.string().min(1).max(500),
  detail:      z.string().optional(),
  payload:     z.unknown().optional(),
  externalRef: z.string().optional().describe("Stable external id for idempotent sync, e.g. 'gh:milestone:12'"),
}

// complete_item
{
  id:          z.string(),
  completedAt: DateKeyShape.optional().describe("Defaults to today in USER_TZ"),
}

// log_metric
{
  goalId: z.string(),
  metric: z.string().min(1).describe("Short key, e.g. 'mrr', 'downloads', 'milestones_done'"),
  value:  z.number().optional(),
  text:   z.string().optional(),
  date:   z.string().optional().describe("ISO datetime; default = now"),
  source: z.enum(["manual", "github", "claude"]).default("manual"),
}
```

#### Return shapes

```typescript
// schedule_item → { id: string, message: string }
// complete_item → { id: string, completedAt: Date, message: string }
// log_metric    → { id: string, goalId: string, metric: string, value: number|null, message: string }
// list_scheduled_items → { count: number, items: ScheduledItem[] }
// list_log_entries     → { count: number, entries: LogEntry[] }
```

---

### 3b. GitHub Pack (Epic C)

**GitHub auth**: Server-side `process.env.GITHUB_TOKEN` (Personal Access Token, `repo`-scoped, read + write for issues/milestones). Loaded in the tool handler; never returned in any tool response. The token must be absent from all `jsonResult` payloads — handlers must not leak `process.env.GITHUB_TOKEN` through error messages or debug fields.

**Transport**: GitHub REST API v3 (`https://api.github.com`). GraphQL v4 only for `get_project_overview` which needs the Projects v2 board columns — REST Projects v2 API is limited. All REST calls use `fetch` with `Authorization: Bearer ${process.env.GITHUB_TOKEN}` and `Accept: application/vnd.github+json`. No new npm dependency needed in v1.

**GraphQL for Projects v2**: `get_project_overview` uses a single GraphQL query via `POST https://api.github.com/graphql` to retrieve project columns and card counts. This is the minimal footprint — no GraphQL client library, just `fetch` + a template literal query.

#### Read tools

| Tool name | Description | Key inputs |
|---|---|---|
| `get_project_overview` | Repo stats, open issues, milestone summary, recent commits, open PRs, optional Projects v2 board columns | `goalId: string` |
| `list_project_issues` | Paginated issue list | `goalId: string`, `state?: "open"\|"closed"\|"all" default "open"`, `label?: string`, `milestone?: string`, `limit?: number default 30` |

#### Write tools

| Tool name | Description | Key inputs |
|---|---|---|
| `link_github_project` | Set `Goal.githubRepo` + `Goal.githubProjectNumber` | `goalId: string`, `repo: string` ("owner/name"), `projectNumber?: number` |
| `sync_github_milestones` | Mirror open GitHub milestones → ScheduledItems via externalRef; idempotent upsert | `goalId: string`, `closeCompleted?: boolean default false` |
| `set_github_issue_status` | Open or close a GitHub issue | `goalId: string`, `issueNumber: number`, `state: "open"\|"closed"` |

#### `sync_github_milestones` idempotency contract

```
externalRef = "gh:milestone:<milestone_number>"
```

Upsert logic: `prisma.scheduledItem.upsert({ where: { goalId_externalRef: { goalId, externalRef } }, update: { title, detail, date, payload }, create: { ... } })`. The `@@unique([goalId, externalRef])` constraint enforces this at the DB level. On repeat calls, existing items are updated (title/date from GitHub), not duplicated.

#### Return shapes

`get_project_overview` returns:
```typescript
{
  repo: string,
  defaultBranch: string,
  openIssues: number,
  openPRs: number,
  milestones: { number, title, dueOn: string|null, openIssues, closedIssues, state }[],
  recentCommits: { sha: string, message: string, date: string, author: string }[],  // last 5
  projectBoard?: { columns: { name: string, cardCount: number }[] } | null,
}
```

Token leak guard: any catch block that re-throws or returns an error must sanitize with:
```typescript
const safeMsg = message.replace(process.env.GITHUB_TOKEN ?? "REDACTED", "[REDACTED]");
```

---

### 3c. Registration

Both packs are registered inside `registerWriteTools` / a new `registerProjectTools(server)` and `registerGitHubTools(server)` helper — analogous to the existing functional split. `registerAll` calls all four helpers:

```typescript
export function registerAll(server: McpServer) {
  // ... existing decodeArgsDeep monkey-patch ...
  registerReadTools(server);
  registerWriteTools(server);
  registerProjectTools(server);    // Epic B
  registerGitHubTools(server);     // Epic C
}
```

This keeps each tool family in its own function for reviewability without changing the single-registration-point pattern.

---

## 4. UI Seams

### Decision: Branch on `goal.kind` in the page/component layer; leave calendar cell builder source-aware but additive.

---

### 4a. Today (`src/app/page.tsx`)

The current page already gates on `if (!program)`. Add a second gate on `goal.kind` after data-fetching:

```typescript
const goal = await prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } });
if (goal?.kind === "project") {
  return <ProjectTodayView goal={goal} />;
}
// existing fitness body unchanged below
```

`ProjectTodayView` is a new Server Component (same file or extracted to `@/components/ProjectTodayView`). It renders:
1. Today's `ScheduledItem`s for the goal (query `scheduledItem.findMany({ where: { goalId, date: { gte: todayStart, lte: todayEnd } } })`).
2. Latest `LogEntry` values for the goal's targets (e.g., latest MRR).
3. Next upcoming milestone (nearest future `ScheduledItem` with `type="milestone"` and `status="planned"`).
4. Recent `LogEntry` text observations (qualitative notes).

The fitness path (`if (goal?.kind !== "project")`) is **byte-identical** to the current implementation — no changes to the existing return block, no refactoring of `BlockCard`, `ExerciseRow`, etc.

---

### 4b. Calendar — `getCalendarMonth` and `buildCell`

**The override-baseline bug lesson**: The existing `baselinesDue` count is wrong if the cell builder uses the rotation default when an override has already suppressed baselines. The fix (`cellOverride?.baselineTestNames` check) is already in place. The new `ScheduledItem` source must follow the same rule: it is a **separate data source**, not layered on top of the override/program data path.

**Change to `getCalendarMonth`**:

1. Add `ScheduledItem` to the parallel query block:
```typescript
const [workouts, hikes, overrides, goal, scheduledItems] = await Promise.all([
  // ... existing queries ...
  goal?.kind === "project"
    ? prisma.scheduledItem.findMany({
        where: { goalId: goal.id, date: { gte: gridStart, lte: gridEnd } },
        select: { id: true, date: true, type: true, status: true, title: true },
      })
    : Promise.resolve([] as never[]),
]);
```

The fitness branch returns `[]` — the `goal?.kind === "project"` guard ensures zero regression. If `goal` is null, `[]` is returned. No `ScheduledItem` query runs for fitness goals.

2. Add `ScheduledItem` bucketing (analogous to hike bucketing):
```typescript
const scheduledItemsByKey = new Map<string, typeof scheduledItems>();
for (const si of scheduledItems) {
  const k = dateKey(si.date);
  const arr = scheduledItemsByKey.get(k) ?? [];
  arr.push(si);
  scheduledItemsByKey.set(k, arr);
}
```

3. Pass `scheduledItemsByKey` into `buildCell`; add to `CalendarDayCell`:
```typescript
scheduledItemCount: number;   // total ScheduledItems on this date
scheduledItemsDone: number;   // status="done"
scheduledItemsPlanned: number; // status="planned"
```

4. In `buildCell`, compute from the map — a pure Map.get() with no interaction with `program`, `overridesByKey`, or `hikesByKey`. The fitness fields (`workoutCount`, `hikeCount`, `plannedHikeCount`, `hasOverride`, `baselinesDue`) are **untouched**.

**Critically**: `baselinesDue` logic must NOT be changed. The guard that gates on `isInPlan` already prevents `countBaselinesDueForCell` from running outside the plan range. The new `scheduledItemCount` fields add to the cell shape without touching the `isInPlan` / `overridesByKey` path.

---

### 4c. Plan page (new, Epic D)

A project goal's Plan page at `/goals/[goalId]/plan` renders phases (from `Plan.planJson` if present, otherwise a milestone timeline from `ScheduledItem`s). This is a **new route** — the fitness plan page at `/plan` or equivalent is untouched.

---

### 4d. Progress / readiness hub

The existing readiness UI reads `computeReadiness` output. For a project goal, the same hub works once `computeReadiness` gets the `goalId` param (section 2a). The only UI delta is showing `log:*` metric labels correctly — already handled by the METRICS registry.

---

## 5. Coaching / Prompt

### Decision: Surface `Goal.kind` + pack guidance in `get_today_plan` and MCP server instructions.

---

### 5a. `get_today_plan` response

Extend the `get_today_plan` tool's return shape to include active goal metadata:

```typescript
return {
  ...r,                   // existing resolveDay output
  standingRules,          // existing
  activeGoal: {           // NEW — always present if a goal exists
    id: goal.id,
    kind: goal.kind,      // "fitness" | "project"
    objective: goal.objective,
    githubRepo: goal.githubRepo ?? null,
  },
};
```

Claude reads `activeGoal.kind` on every session start and routes to the correct tool pack without additional instructions. This is the minimal change — one field addition to an existing return object.

---

### 5b. MCP server `instructions` string (in `route.ts`)

Update the `instructions` field to include kind-aware routing:

```
Workout + project coaching MCP for one user.

Goal kinds:
- kind="fitness": use workout/hike/baseline/nutrition tools. apply_plan_revision for template changes; apply_day_override for single-day swaps.
- kind="project": use schedule_item/complete_item/log_metric for daily tracking; get_project_overview/list_project_issues/sync_github_milestones for GitHub context. Weekly review = MRR trend (list_log_entries metric=mrr) + milestone burn (list_scheduled_items status=planned) + open PRs/issues.

Rules: call read tools (get_today_plan, recent_history, get_goal) before proposing changes. Propose before applying any write. Never leak GITHUB_TOKEN.
```

The routing instruction is short and authoritative. Claude reads `activeGoal.kind` from `get_today_plan` and applies the matching tool set.

---

### 5c. `get_goal` surface

`get_goal` already returns the full `Goal` row. Once `kind`, `githubRepo`, `githubProjectNumber` are added to the schema (Epic A), they appear in `get_goal` output automatically — no tool change needed. Claude can read them to understand the goal's integration state.

---

## 6. Phasing / Ownership

### Decision: 5 epics confirmed; dependency order and deployability contract hardened.

---

### Epic A — Generic data spine (Sprint 1)
**Blocks everything.**

Deliverables:
- Prisma deltas: `Goal.kind`, `ScheduledItem`, `LogEntry`, `Goal.githubRepo/githubProjectNumber`
- `npx prisma migrate dev --name multi-domain-spine`
- `resolveMetricValue` / `resolveMetricStart` / `progressFor` changes for `log:*` namespace
- `computeReadiness` / `computeReadinessSeries` gain `goalId` param (non-breaking: fitness callers pass their goalId, behavior unchanged)
- METRICS registry updated with `log:mrr`, `log:milestones_done`
- `create_goal` tool gets a `kind` input field (`z.enum(["fitness","project"]).default("fitness")`)
- `list_goals` return shape includes `kind`
- `get_today_plan` return shape includes `activeGoal.kind`
- `main` deployable: additive DB changes + backcompat logic changes; fitness path untouched

**Sprint 1 QA gate**: `npx tsc --noEmit` + `npm run build` + `get_today_plan` curl returns `activeGoal.kind="fitness"` for the existing goal.

---

### Epic B — Project MCP tool pack (Sprint 2)
**Requires Epic A (ScheduledItem + LogEntry tables, goalId in resolveMetricValue).**

Deliverables:
- `registerProjectTools(server)` in `src/lib/mcp/tools.ts`
- 7 new tools: `schedule_item`, `complete_item`, `update_scheduled_item`, `delete_scheduled_item`, `list_scheduled_items`, `log_metric`, `list_log_entries`
- Zod schemas per section 3a
- `get_today_plan` for a project goal includes today's ScheduledItems (add to resolveDay or a parallel query)
- `main` deployable: new tools only; no UI change; fitness tools unaffected
- Connector reload required in claude.ai after merge

**Sprint 2 QA gate**: curl `tools/list` shows 7 new tools. Create a test chewgether goal (`kind="project"`), call `schedule_item`, `log_metric`, `list_log_entries`.

---

### Epic C — GitHub-tracking integration (Sprint 3)
**Requires Epic B (ScheduledItem write path for `sync_github_milestones`).**

Deliverables:
- `registerGitHubTools(server)` in `src/lib/mcp/tools.ts`
- 5 new tools: `link_github_project`, `get_project_overview`, `list_project_issues`, `sync_github_milestones`, `set_github_issue_status`
- `GITHUB_TOKEN` in `.env.local` and Vercel env
- Token never in any response (sanitization guard per section 3b)
- `main` deployable; new tools only; connector reload required

**Sprint 3 QA gate**: `link_github_project` for chewgether → `get_project_overview` returns repo data → `sync_github_milestones` creates ScheduledItems with `externalRef="gh:milestone:N"` → calling again produces no duplicates.

---

### Epic D — Goal-type-aware UI (Sprint 4)
**Requires Epic A (Goal.kind) + Epic B (ScheduledItem queries). Can run partially in parallel with Epic C if Epic A + B are done.**

Deliverables:
- `page.tsx` kind-branch (section 4a): fitness path unchanged, project Today view added
- `getCalendarMonth` / `buildCell` ScheduledItem source (section 4b): additive, fitness cells unchanged
- New `/goals/[goalId]/plan` route for project goal plan view
- `CalendarDayCell` gets `scheduledItemCount`, `scheduledItemsDone`, `scheduledItemsPlanned`
- Calendar legend supports a new `"scheduled-item"` kind entry (add to `LegendSchema` + calendar render)
- `main` deployable: fitness UI byte-identical; project UI gated on `goal.kind==="project"`

**Sprint 4 QA gate**: Browser smoke at phone width. Navigate Today with fitness goal → identical to pre-change. Create/activate a project goal → Today shows ProjectTodayView. Calendar shows ScheduledItem markers for project goal dates.

---

### Epic E — Chewgether goal MVP + coaching (Sprint 5)
**Requires all previous epics.**

Deliverables:
- Seed or manually create chewgether goal: `kind="project"`, `objective="Ship Chewgether to App Store + reach $1,000/mo MRR"`, targets `[{metric:"log:mrr", target:1000, ...}, {metric:"log:milestones_done", target:<N>, ...}]`
- `link_github_project` → `jronnomo/Chewgether`
- `sync_github_milestones` → initial ScheduledItem set
- MCP server `instructions` string updated (section 5b)
- Coaching validation session: confirm Claude routes to project pack, reads GitHub overview, proposes MRR tracking
- `main` deployable and production-connected

**Sprint 5 QA gate**: End-to-end coaching turn in claude.ai: "What's blocking chewgether this week?" → Claude calls `get_today_plan`, reads `activeGoal.kind="project"`, calls `get_project_overview`, returns a grounded answer using GitHub data + scheduled milestones.

---

### Backlog (explicitly not in v1)

- Self-serve/Option-B planner
- Fitness convergence onto ScheduledItem/LogEntry spine
- Standalone finance vertical
- Multi-tenancy / GitHub OAuth
- Autonomous code-generation

---

## Draft Plan Corrections

The draft plan (`docs/roadmap/multi-domain-plan.md`) was largely correct in architecture and phasing. Specific points where this blueprint diverges or hardens:

1. **`resolveMetricValue` needs a `goalId` param** — the draft did not call this out. The existing signature `(prisma, metric, asOf)` is insufficient for `log:*` because LogEntry is goal-scoped. This is a non-trivial signature change that ripples into `computeReadiness` and `computeReadinessSeries`. All callers must be audited.

2. **Milestone-completion metric is `log:milestones_done` (LogEntry), not `items:done_ratio`** — the draft left this open. The blueprint chooses `log:milestones_done` specifically because of the temporal stability requirement in `computeReadinessSeries` (section 2c). A live-computed ratio would corrupt the readiness history chart.

3. **`@@unique([goalId, externalRef])` is safe with NULLs** — the draft mentioned the unique but didn't confirm Postgres NULL semantics. Confirmed: Postgres UNIQUE does not conflict on NULL values; multiple rows with `externalRef=NULL` on the same goal are allowed.

4. **Calendar ScheduledItem query is gated on `goal?.kind === "project"`** — the draft said "cell builder gains a ScheduledItem source" without specifying the guard. Without this gate, the query runs (and returns empty) for every fitness calendar view — wasted round-trips plus risk of future regression if fitness goals ever get ScheduledItems. The guard is explicit.

5. **`registerProjectTools` + `registerGitHubTools` as separate helper functions** — the draft said "registered in tools.ts" without specifying how. Given the file is already 2400 lines, extracting into named helpers (rather than dumping into `registerWriteTools`) is the right call for reviewability. The `registerAll` call site stays the same.

6. **GitHub token sanitization in error messages** — the draft mentioned "don't leak the token" but didn't specify the mechanism. The blueprint specifies explicit `replace(process.env.GITHUB_TOKEN)` in catch blocks. This is a concrete implementation requirement, not optional.
