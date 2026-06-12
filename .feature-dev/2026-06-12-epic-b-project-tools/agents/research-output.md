# Research Output — Epic B: Project MCP Tool Pack

**Date**: 2026-06-12  
**Researcher**: Research Agent  
**Scope**: All codebase facts needed before writing `tool-helpers.ts`, `tools/project-tools.ts`, and the `get_today_plan` todayItems branch.

---

## Existing Patterns (registration shape, safe/error pattern, date conventions)

### Tool registration shape

All tools are registered as `server.registerTool(name, config, handler)` where:
- `config` = `{ title: string, description: string, inputSchema?: { [field]: ZodType } }`
- `inputSchema` is a **plain shape object** (not `z.object(...)`) — the MCP SDK infers args types automatically
- `handler` is an `async (args) => safe(async () => { ... })` arrow function
- Handler args are automatically decoded through `decodeArgsDeep` by the monkey-patch (see §decodeArgsDeep Analysis)

Representative write tool — `log_measurement` (L2174):
```ts
server.registerTool(
  "log_measurement",
  {
    title: "Log body weight, resting heart rate, body fat, or other body metric",
    description: "...",
    inputSchema: {
      weightLb: z.number().min(0).optional(),
      restingHr: z.number().int().min(0).optional(),
      bodyFatPct: z.number().min(0).max(100).optional(),
      notes: z.string().optional(),
      date: z.string().optional().describe("ISO datetime; default = now"),
    },
  },
  async (input) =>
    safe(async () => {
      const m = await prisma.measurement.create({
        data: {
          date: input.date ? parseDateInput(input.date) : new Date(),
          ...
        },
      });
      return { id: m.id, message: "Measurement logged" };
    }),
);
```

Representative list read tool with filters — `get_nutrition_history` (L1525):
```ts
server.registerTool(
  "get_nutrition_history",
  {
    title: "...",
    description: "...",
    inputSchema: {
      days: z.number().int().min(1).max(180).default(14).describe("..."),
      mealType: z.enum([...]).optional().describe("..."),
    },
  },
  async ({ days, mealType }) =>
    safe(async () => {
      const since = startOfDay(addDays(new Date(), -days));
      const rows = await prisma.nutritionLog.findMany({
        where: { date: { gte: since }, ...(mealType ? { mealType } : {}) },
        orderBy: { date: "desc" },
        ...
      });
      return { count: rows.length, ... };
    }),
);
```

### Integer fields
Always `z.number().int()` (never `z.int()` — not used anywhere in the codebase despite Zod 4 supporting it).

### Limit/pagination fields
```ts
limit: z.number().int().min(1).max(200).default(50).describe("Max items to return. Default 50.")
```

### Date input convention
All `date: string` inputs: `parseDateInput(input.date)`. Default to current instant: `new Date()` (not `startOfDay(new Date())`). For bare `yyyy-mm-dd` to USER_TZ midnight: `parseDateInput("2026-06-12")` returns `parseDateKey("2026-06-12")` = USER_TZ midnight. For `complete_item.completedAt` no-arg default use `new Date()` (current instant, per PRD §4.5).

---

## Related Existing Code (files to modify/reference, key exports, exact import paths)

### Files to modify
| File | Change |
|------|--------|
| `src/lib/mcp/tools.ts` | Import helpers from `tool-helpers.ts`; add `registerProjectTools(server)` after `registerWriteTools(server)` in `registerAll()`; add `todayItems` to `get_today_plan` handler |

### Files to create
| File | Purpose |
|------|---------|
| `src/lib/mcp/tool-helpers.ts` | Extracted helpers: `safe`, `jsonResult`, `errorResult`, `parseDateInput` |
| `src/lib/mcp/tools/project-tools.ts` | 7 new tools, exports `registerProjectTools(server: McpServer)` |

Note: `src/lib/mcp/tools/` directory does not yet exist.

### Key import paths (verbatim from tools.ts)
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { parseDateKey, startOfDay, endOfDay, dateKey as toDateKey } from "@/lib/calendar";
import { z } from "zod";
```

`project-tools.ts` will need: `McpServer`, `prisma`, `Prisma` (for `InputJsonValue`), `parseDateKey`, `startOfDay`, `endOfDay`, `dateKey as toDateKey`, `z`, and the extracted helpers from `@/lib/mcp/tool-helpers`.

### tools.ts public exports
Only two exports exist (confirmed via grep):
```ts
export const MCP_SERVER_VERSION = `1.1.0+${...}`;
export function registerAll(server: McpServer) { ... }
```

Both route files (`src/app/api/mcp/route.ts` and `src/app/api/mcp/[token]/route.ts`) import only these two. No other file imports from `tools.ts`.

---

## Helper Extraction Analysis (Q1)

### The four helpers verbatim (tools.ts L196–222)
```ts
function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

async function safe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

### Imports `tool-helpers.ts` will need
| Helper | External dep needed |
|--------|---------------------|
| `jsonResult` | none |
| `errorResult` | none |
| `safe` | calls `jsonResult` + `errorResult` (intra-module) |
| `parseDateInput` | `parseDateKey` from `@/lib/calendar` |

**Circular import risk**: NONE. `tool-helpers.ts` will import only from `@/lib/calendar` (and zod is not needed there). It will NOT import from `tools.ts`.

### Call-site counts in tools.ts (blast radius of import swap)
| Helper | Occurrences in file | Non-declaration call sites (approx) |
|--------|--------------------|------------------------------------|
| `jsonResult` | 2 | 1 call site (in `safe`) — the definition itself |
| `errorResult` | 2 | 1 call site (in `safe`) — the definition itself |
| `parseDateInput` | 18 | ~17 call sites |
| `safe(` | 75 | ~74 call sites |

After extraction, `tools.ts` adds one import line and removes the four function bodies. Zero behavior change. The import-swap blast radius is exactly one `import { safe, jsonResult, errorResult, parseDateInput } from "@/lib/mcp/tool-helpers"` line plus removing the 4 function declarations.

### Circular import risk assessment
`tool-helpers.ts` → `@/lib/calendar` (one external dep, no `tools.ts` dependency). No circular import possible. This is confirmed safe.

---

## decodeArgsDeep Analysis (Q2)

### Full patch code (tools.ts L486–508)
```ts
export function registerAll(server: McpServer) {
  // Defensive guard against re-introducing the literal-escape corruption that
  // had to be batch-fixed once: when a caller double-escapes JSON, free text
  // arrives as e.g. "—" instead of "—" and gets stored verbatim. Decode at
  // this single registration chokepoint so every tool's args are normalized
  // before its handler runs — no need to touch 48 handlers individually.
  const origRegister = server.registerTool.bind(server) as (
    ...a: unknown[]
  ) => unknown;
  (server as { registerTool: unknown }).registerTool = (
    name: unknown,
    config: unknown,
    cb: unknown,
  ) => {
    const handler = cb as (args: unknown, ...rest: unknown[]) => unknown;
    return origRegister(name, config, (args: unknown, ...rest: unknown[]) =>
      handler(decodeArgsDeep(args), ...rest),
    );
  };

  registerReadTools(server);
  registerWriteTools(server);
}
```

### Coverage analysis
The patch **mutates `server.registerTool` on the server instance** (line `(server as { registerTool: unknown }).registerTool = ...`). This is a property replacement on the object itself, not a closure around specific calls. Any call to `server.registerTool(...)` made after the patch line — including inside `registerProjectTools(server)` called after `registerWriteTools(server)` — will go through the wrapper.

**Verdict**: A `registerProjectTools(server)` call placed anywhere inside `registerAll()` body **after the patch lines** is fully covered. The PRD's requirement to place it after `registerWriteTools(server)` is satisfied by the architecture, since the patch is applied before any register* call at all.

### decodeArgsDeep helper (L469–478)
```ts
function decodeArgsDeep<T>(v: T): T {
  if (typeof v === "string") return decodeUnicodeEscapes(v) as T;
  if (Array.isArray(v)) return v.map((x) => decodeArgsDeep(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = decodeArgsDeep(val);
    return out as T;
  }
  return v;
}
```

`decodeArgsDeep` and `decodeUnicodeEscapes` must remain in `tools.ts` (they are not part of the extraction; `tool-helpers.ts` does not need them — they're an internal detail of `registerAll`).

---

## get_today_plan Analysis (Q3)

### Full handler (tools.ts L550–595)
```ts
server.registerTool(
  "get_today_plan",
  {
    title: "Get today's plan",
    description: "Resolve today's workout... focusGoal is the goal whose plan drives today's prescription (isFocus=true); activeGoal is a duplicate of focusGoal kept for one release ...",
  },
  async () =>
    safe(async () => {
      const [r, standingRules, activeGoalRow] = await Promise.all([
        resolveDay(new Date()),
        prisma.note.findMany({
          where: { type: "standing_rule", resolvedAt: null },
          orderBy: [{ lastAcknowledgedAt: { sort: "desc", nulls: "last" } }, { date: "desc" }],
          select: { id: true, body: true, date: true, lastAcknowledgedAt: true },
        }),
        prisma.goal.findFirst({
          where: { isFocus: true },
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
      return { ...r, standingRules, focusGoal: activeGoal, activeGoal }; // activeGoal: saved-prompt compat, remove next release
    }),
);
```

### Final return statement (verbatim)
```ts
return { ...r, standingRules, focusGoal: activeGoal, activeGoal };
```

### activeGoal resolution (verbatim)
```ts
prisma.goal.findFirst({
  where: { isFocus: true },
  orderBy: { updatedAt: "desc" },
  select: { id: true, kind: true, objective: true, githubRepo: true },
})
```
Then mapped to: `{ id, kind, objective, githubRepo }` or `null`.

### Minimal insertion point for todayItems
After the `activeGoal` constant is constructed (line 585–592), add a conditional query:
```ts
const now = new Date();
let todayItems: { id: string; type: string; title: string; status: string; completedAt: Date | null }[] = [];
if (activeGoalRow?.kind === "project" && activeGoalRow.id) {
  const rows = await prisma.scheduledItem.findMany({
    where: {
      goalId: activeGoalRow.id,
      date: { gte: startOfDay(now), lte: endOfDay(now) },
    },
    orderBy: { date: "asc" },
    select: { id: true, type: true, title: true, status: true, completedAt: true },
  });
  todayItems = rows;
}
```
Then change the return to:
```ts
return { ...r, standingRules, focusGoal: activeGoal, activeGoal, todayItems };
```

**Do NOT** change the existing `Promise.all([...])` or call `resolveDay` with any modification. The `now` variable for today's day bounds can be the same `new Date()` already implicit in `resolveDay(new Date())` — declare a local `const now = new Date()` before the `Promise.all`.

**Important**: The `startOfDay`/`endOfDay` needed here are already imported in `tools.ts` from `@/lib/calendar`. No new imports needed for this change.

---

## Zod + Prisma Json Conventions (Q4, Q5)

### Zod version and style (Q4)
- Version: **Zod 4.4.2** (confirmed from quality-tools.md)
- `inputSchema` is always a **plain shape object** `{ field: ZodType, ... }` — never `z.object(...)`. The MCP SDK accepts this form.
- `.default()` and `.optional()` are used extensively: `z.number().int().min(1).max(200).default(50)`, `z.string().optional()`, `z.enum([...]).default("manual")`
- `.describe()` is on every field
- Integer fields: `z.number().int()` (never `z.int()` despite Zod 4 supporting it)

### z.unknown() for Json payload fields
Used in `apply_day_override` for `workoutJson` (L120–125):
```ts
workoutJson: z.unknown().nullish().describe("...")
```
And in `apply_plan_revision` for `snapshotJson` (L2733):
```ts
snapshotJson: z.unknown().describe("Full ProgramTemplate after the revision")
```

### Prisma Json column writes (Q4)
Pattern: cast to `Prisma.InputJsonValue`:
```ts
data: { items: input.items as Prisma.InputJsonValue }
```
For nullable Json:
```ts
data: { workoutJson: input.workoutJson === null ? Prisma.JsonNull : (input.workoutJson as Prisma.InputJsonValue) }
```

For the `payload` field in `ScheduledItem` and `LogEntry` (both `Json?` columns), the appropriate pattern is:
```ts
payload: input.payload !== undefined ? (input.payload as Prisma.InputJsonValue) : undefined
```
or simply omit if not provided. No `Prisma.JsonNull` needed for optional nullable columns when using Prisma's create (null is the SQL default).

### Prisma error handling — friendly errors (Q5)
Two patterns coexist:

**Pattern A — `findUniqueOrThrow`** (used in ~12 places, e.g. L821, L1904, L2430): Throws a Prisma error on missing row. The error is caught by `safe()` and returned as `errorResult(e.message)`. The message is Prisma's generic "Record to update not found" — not ideal for friendly UX but acceptable.

**Pattern B — `findUnique` + manual check** (used in delete/update tools, e.g. `delete_goal` L4379):
```ts
const goal = await prisma.goal.findUnique({ where: { id: goalId }, select: { id: true, objective: true } });
if (!goal) throw new Error(`Goal not found: ${goalId}`);
```
This throws a **custom, friendly message** caught by `safe()`. The PRD's "friendly error" requirement means Pattern B must be used for all project-tool delete/update/complete operations.

**Recommendation for project-tools.ts**: Use `findUnique` + `if (!row) throw new Error("friendly message")` everywhere a missing-id check is needed.

### P2002 unique constraint (externalRef collision) — no existing handler
There is **no `P2002` or `PrismaClientKnownRequestError` handling anywhere in tools.ts or the project**. For the `externalRef` unique collision case (`@@unique([goalId, externalRef])`), the raw Prisma error will bubble up through `safe()` as an ugly message. To meet the PRD requirement for a friendly error, `schedule_item` must:
```ts
import { Prisma as PrismaClient } from "@/generated/prisma/client";
// in the handler, after prisma.scheduledItem.create:
} catch (e) {
  if (e instanceof PrismaClient.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new Error(`Duplicate externalRef "${input.externalRef}" on goal ${input.goalId}. Each externalRef must be unique per goal.`);
  }
  throw e;
}
```
But since the entire handler is wrapped in `safe()`, which already catches thrown errors, the cleanest approach is to catch P2002 inside the handler body before `safe` re-throws it, or to wrap the `prisma.scheduledItem.create` in a try/catch and rethrow a friendly message (which `safe` then catches cleanly).

---

## Dependencies (Q6)

### MCP server import path (verbatim from tools.ts L5)
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
```
`project-tools.ts` must use the identical import path.

### No new npm packages needed
All dependencies required by the 7 new tools are already in the project:
- `zod` (^4.4.2) — already installed
- `@modelcontextprotocol/sdk` (^1.29) — already installed
- `@/generated/prisma/client` (Prisma 7) — already generated
- `@/lib/db` (prisma singleton) — already exists
- `@/lib/calendar` (`parseDateKey`, `startOfDay`, `endOfDay`, `dateKey`) — already exists

Confirmed: **zero new npm packages required**.

---

## Current Tool Inventory (Q7)

Total current tools: **75** (after adding 7 project tools the total will be 82).

Sorted list of all 75 currently registered tools:
```
acknowledge_lint_finding    get_rarity                  resolve_open_item
acknowledge_notes           get_records_summary         set_goal_feasibility
acknowledge_standing_rule   get_session_brief           set_goal_tracked
add_goal_reference          get_today_plan              set_plan_active
apply_day_override          get_week                    update_baseline
apply_plan_revision         grant_bonus_xp              update_goal
baseline_ops                lint_plan                   update_goal_legend
batch_apply_day_overrides   list_goals                  update_goal_reference
batch_log_note              list_open_items             update_goal_targets
batch_log_nutrition         list_planned_hikes          update_note
clear_day_override          list_promotable_notes       update_nutrition
clear_lint_acknowledgement  log_baseline                update_plan_metadata
compute_readiness           log_hike                    update_workout
confirm_week                log_measurement             update_workout_exercise
create_goal                 log_note                    update_workout_set
delete_baseline             log_nutrition               weekly_summary_data
delete_goal                 log_open_item               workout_ops
delete_hike                 log_review
delete_measurement          log_workout
delete_note                 nutrition_log_ops
delete_nutrition            preview_goal_feasibility
delete_workout              promote_note
export_workout              promote_note_to_goal
find_exercise_in_plan       recent_history
get_baseline_history        reopen_week
get_baseline_schedule
get_day
get_exercise_history
get_game_state
get_goal
get_latest_review
get_nutrition_history
get_pending_notes
```

### Name collision check for 7 new tools
New tool names: `schedule_item`, `delete_scheduled_item`, `complete_item`, `update_scheduled_item`, `list_scheduled_items`, `log_metric`, `list_log_entries`.

No collisions with existing names. No ambiguity:
- `log_metric` is clearly distinct from `log_measurement` (different model, different purpose)
- `list_log_entries` is clearly distinct from `log_note` / `log_review`
- `complete_item` is unique
- `schedule_item` is unique
- `list_scheduled_items` is unique

**CRITICAL GAP — B-6 smoke step 8**: The B-6 runbook step 8 says `set_active_goal → project goal`. There is **no `set_active_goal` MCP tool** — this was intentionally excluded ("focus-switching is app-UI only — no MCP tool exists", confirmed in route.ts instructions and `set_goal_tracked` / `set_plan_active` descriptions). The QA agent must use the app UI (`/goals`) to toggle focus to the test project goal, then run `get_today_plan` to verify `todayItems`, then toggle back. This must be documented in the QA runbook — it is NOT a curl command.

---

## Risks & Considerations

### 1. USER_TZ trap — no raw `setHours`/`getDate()`
Every date/time operation must go through `@/lib/calendar`. The `ScheduledItem.date` comment in the schema says "USER_TZ midnight; written via parseDateInput by future tools" — confirming the expectation. `parseDateInput("2026-06-12")` correctly returns USER_TZ midnight (America/Denver by default). Never write `new Date("2026-06-12")` directly (returns UTC midnight = yesterday MT).

### 2. Fitness regression — `get_today_plan` zero-diff requirement
The `todayItems` branch must be guarded by `activeGoalRow?.kind === "project"`. If `activeGoalRow` is null (no focus goal) or `kind === "fitness"`, `todayItems` must be `[]` with no Prisma query. The return must spread all existing fields unchanged: `{ ...r, standingRules, focusGoal: activeGoal, activeGoal, todayItems }`. Any typo in the spread will break the fitness vertical.

### 3. No `set_active_goal` tool for B-6 testing
Documented above in §Tool Inventory. The QA runbook must explicitly state: focus switch requires app UI or direct DB update (Prisma Studio), not a curl call. If the goal-switch step cannot be automated, `get_today_plan todayItems` test must be done manually.

### 4. P2002 externalRef collision
No existing infrastructure for catching P2002 uniqueness errors. Must implement in `schedule_item` handler explicitly (see §Zod + Prisma Json Conventions). Pattern: try/catch around create, rethrow with friendly message when `e.code === "P2002"`.

### 5. tool-helpers.ts file must NOT import from tools.ts
Critical constraint from REQ-001 AC. `tool-helpers.ts` → `@/lib/calendar` only. If any future refactor adds a helper that needs `prisma` or something else, add that import to `tool-helpers.ts` directly (not a re-export chain from tools.ts).

### 6. `src/lib/mcp/tools/` directory does not yet exist
The `mkdir -p src/lib/mcp/tools/` is implied when creating `project-tools.ts`. TypeScript path aliases (`@/lib/mcp/tools/project-tools`) resolve normally — no tsconfig changes needed.

### 7. connector cache after deploy
Per `docs/project-gotchas.md` §C: `MCP_SERVER_VERSION` stamps off `VERCEL_GIT_COMMIT_SHA`. After deploying Epic B, claude.ai will re-fetch `tools/list` automatically (new SHA = new version). No connector toggle needed unless testing locally — in that case the dev server version is always `1.1.0+dev` and the connector may serve cached tool list.

### 8. `delete_goal` cascade already handles ScheduledItems and LogEntries
`delete_goal` already counts and cascades `scheduledItems` and `logEntries` (L4386–4396). After test goal deletion, `list_scheduled_items { goalId }` will return friendly error (goal not found) or empty — either is acceptable per PRD §8 step 10. No changes to `delete_goal` are needed.

### 9. Unique-constraint collision on `externalRef` with `null`
Postgres treats `NULL != NULL` for unique constraints, so multiple rows with `externalRef: null` on the same goal are allowed. The `@@unique([goalId, externalRef])` only fires when `externalRef` is provided and clashes. `schedule_item` requests without `externalRef` are always safe to create duplicates of.

### 10. LogEntry has no unique constraint — duplicate log_metric calls are allowed
`LogEntry` has no unique constraint (only indexes). Calling `log_metric` twice with the same `metric` + `date` creates two rows. The PRD treats this as expected (B-6 step 7: "log_metric × 2 → list_log_entries count 2"). No dedup logic needed.

---

## Conventions Checklist

Rules the Developer Agents must follow for this backend-only feature (from CLAUDE.md + quality-tools.md):

1. **No LLM calls.** This app has zero `anthropic` / `openai` imports. Never add them.
2. **All DB access via `prisma` from `@/lib/db`.** No new DB clients, no direct Postgres connections.
3. **All date inputs via `parseDateInput`.** No raw `new Date("yyyy-mm-dd")`, no `setHours`, no `getDate()`. Range filters via `startOfDay`/`endOfDay` from `@/lib/calendar`.
4. **`complete_item` default completedAt = `new Date()`** (current instant, NOT midnight). Per PRD §4.5.
5. **inputSchema is a plain shape object** `{ field: ZodType }`, not `z.object(...)`. This is what the MCP SDK's `registerTool` expects.
6. **Every field gets `.describe()`** annotation. Descriptions must state "for project / non-fitness goals" and explicitly exclude fitness tools.
7. **Every handler is wrapped in `safe(async () => { ... })`** which catches thrown errors and returns `errorResult`.
8. **Friendly errors via `throw new Error("human message")`** inside `safe()` — caught and returned as errorResult. Never let raw Prisma errors escape for user-facing "missing row" scenarios.
9. **`findUnique` + manual guard** (not `findUniqueOrThrow`) for missing-id checks on delete/update/complete operations. Pattern: `if (!row) throw new Error("Goal not found: " + goalId)`.
10. **P2002 for externalRef**: catch `PrismaClientKnownRequestError` with `code === "P2002"` explicitly in `schedule_item`, rethrow friendly message.
11. **`update_scheduled_item` with only `{id}` (no other fields)**: return `{ message: "Nothing to update" }` without any Prisma write. Check at the top of the handler.
12. **`log_metric` with neither `value` nor `text`**: throw `new Error("Provide value and/or text")` at top of handler.
13. **`schedule_item` goal-kind check**: fetch goal first, verify `kind === "project"`, else throw friendly error directing to fitness tools.
14. **`z.unknown()` for `payload` fields** (both `ScheduledItem.payload` and `LogEntry.payload`). Cast to `Prisma.InputJsonValue` when writing.
15. **`source` field enum**: `z.enum(["manual", "github", "claude"]).default("manual")` — use default in schema so it's always present.
16. **`registerProjectTools` signature**: `export function registerProjectTools(server: McpServer): void` in `src/lib/mcp/tools/project-tools.ts`.
17. **tool-helpers.ts must NOT import from tools.ts** (circular import prevention). Only imports: `parseDateKey` from `@/lib/calendar`.
18. **`registerProjectTools` call placement**: inside `registerAll()` after `registerWriteTools(server)`, before the closing brace.
19. **`get_today_plan` change is additive only**: spread `...r` unchanged; add only `todayItems`; do not rename or remove `focusGoal`/`activeGoal`/`standingRules`.
20. **QA gate**: `npx tsc --noEmit` zero errors, `npm run lint` no new issues, `npm run build` succeeds. Run all three before marking any REQ done.
21. **No migration**: Epic A shipped `ScheduledItem` and `LogEntry` — do not touch `prisma/schema.prisma`. If you see schema drift, reject and report.
22. **No server actions / UI code**: This feature is MCP-only. No `revalidatePath`, no React components, no `/api/*` routes beyond the existing `/api/mcp`.
23. **`dateKey as toDateKey`**: when serializing DateTime → string for response, use `toDateKey(date)` to get USER_TZ `yyyy-mm-dd`. Never `.toISOString().split("T")[0]` (UTC).
24. **McpServer import is `type`-only**: `import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` — this is how tools.ts declares it.
25. **No `z.object()` anywhere in inputSchemas**: keep consistent with the established pattern (plain object literal, not wrapped in `z.object()`).
