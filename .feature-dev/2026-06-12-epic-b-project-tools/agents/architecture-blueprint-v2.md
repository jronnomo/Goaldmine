# Architecture Blueprint v2 — Epic B: Project MCP Tool Pack

**Author**: Architect Agent (revised after Devil's Advocate review)  
**Date**: 2026-06-12  
**Status**: Final — hand this to Dev agents, read ONLY v2 (v1 superseded)  
**Source docs consumed**: PRD §4.2 (normative), requirements.md, research-output.md, tools.ts L196–595 + L4370–4421, schema.prisma L179–244, quality-tools.md, architecture-critique.md  
**Changes from v1**: C-1 fix (complete_item description); C-2 fix (parseDateKey removed from imports); D-1 fix (Prisma.ScheduledItemUpdateInput); D-2 fix (P2025 catch pattern across all three mutating-by-id tools + findUnique strategy documented); D-3 adopted (kind check in log_metric); S-2 adopted (select clause on update_scheduled_item); S-3 adopted (date format note in list_log_entries description); S-4 adopted (findUnique before no-op in update_scheduled_item); QA runbook extended with M-1/M-2/M-3/D-4 missing tests.

---

## 1. File Plan

| Action | Path | Purpose | Key Exports | Dependencies |
|--------|------|---------|-------------|-------------|
| CREATE | `src/lib/mcp/tool-helpers.ts` | Extracted shared MCP helpers | `safe`, `jsonResult`, `errorResult`, `parseDateInput` | `@/lib/calendar` (parseDateKey only — internal use) |
| CREATE | `src/lib/mcp/tools/project-tools.ts` | 7 new project-domain MCP tools | `registerProjectTools(server: McpServer): void` | `tool-helpers.ts`, `@/lib/mcp/tool-helpers`, `@/lib/calendar`, `@/lib/db`, `@/generated/prisma/client`, `zod`, `@modelcontextprotocol/sdk/server/mcp.js` |
| MODIFY | `src/lib/mcp/tools.ts` | 3 surgical edits (helper swap + wiring + todayItems) | — (no new exports) | `tool-helpers.ts`, `tools/project-tools.ts` |

### tools.ts exact insertion points

#### Edit 1 — Helper import swap (Dev A)

Remove the four function declarations at **L196–222** (exact text to delete):

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

// Bare yyyy-mm-dd is otherwise parsed as UTC midnight, which lands in
// yesterday's MT day. Treat date-only as USER_TZ midnight; full ISO strings
// are returned verbatim.
function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

Replace with one line (place logically near the end of the imports block, before `// ----` divider):

```ts
import { safe, jsonResult, errorResult, parseDateInput } from "@/lib/mcp/tool-helpers";
```

Zero behavior change — the function bodies move verbatim to `tool-helpers.ts`.

#### Edit 2 — registerAll wiring (Dev A)

Add one import near the top of the file alongside other imports:

```ts
import { registerProjectTools } from "@/lib/mcp/tools/project-tools";
```

In `registerAll()`, after **L507** (`registerWriteTools(server);`), insert before the closing brace:

```ts
  registerReadTools(server);
  registerWriteTools(server);
  registerProjectTools(server);  // ← ADD THIS LINE
}
```

The `decodeArgsDeep` monkey-patch is applied before all `register*` calls in `registerAll()`; any `server.registerTool(...)` call made after the patch is automatically wrapped, including all calls from `registerProjectTools`. This is confirmed — the patch mutates the **instance method** on the `server` object, not a closure around a specific call list.

#### Edit 3 — get_today_plan todayItems (Dev B)

Region: `registerReadTools`, `get_today_plan` handler, **L562–594** (the `safe(async () => { ... })` body).

**Step 3a** — Hoist `now` before `Promise.all` (change **L564**):

```ts
// BEFORE:
const [r, standingRules, activeGoalRow] = await Promise.all([
  resolveDay(new Date()),

// AFTER:
const now = new Date();
const [r, standingRules, activeGoalRow] = await Promise.all([
  resolveDay(now),
```

**Step 3b** — Insert todayItems block after the `activeGoal` const (after **L592**):

```ts
        const activeGoal = activeGoalRow
          ? {
              id: activeGoalRow.id,
              kind: activeGoalRow.kind,
              objective: activeGoalRow.objective,
              githubRepo: activeGoalRow.githubRepo,
            }
          : null;
        // ↓↓↓ INSERT BELOW ↓↓↓
        let todayItems: {
          id: string;
          type: string;
          title: string;
          status: string;
          completedAt: string | null;
        }[] = [];
        if (activeGoalRow?.kind === "project") {
          const rows = await prisma.scheduledItem.findMany({
            where: {
              goalId: activeGoalRow.id,
              date: { gte: startOfDay(now), lte: endOfDay(now) },
            },
            orderBy: { date: "asc" },
            select: { id: true, type: true, title: true, status: true, completedAt: true },
          });
          todayItems = rows.map((row) => ({
            id: row.id,
            type: row.type,
            title: row.title,
            status: row.status,
            completedAt: row.completedAt?.toISOString() ?? null,
          }));
        }
        // ↑↑↑ END INSERT ↑↑↑
```

**Step 3c** — Change the return line (was **L593**):

```ts
// BEFORE:
        return { ...r, standingRules, focusGoal: activeGoal, activeGoal }; // activeGoal: saved-prompt compat, remove next release

// AFTER:
        return { ...r, standingRules, focusGoal: activeGoal, activeGoal, todayItems }; // activeGoal: saved-prompt compat, remove next release
```

`startOfDay` and `endOfDay` are **already imported** from `@/lib/calendar` in tools.ts. No new imports needed for Edit 3.

The description string for `get_today_plan` gains one appended sentence (append to the existing multi-string concatenation at **L554–560**):

```ts
        "When focusGoal.kind === 'project', todayItems contains today's ScheduledItems " +
        "(id, type, title, status, completedAt) for that project goal; " +
        "when the focus goal is fitness or no focus goal is set, todayItems is always [].",
```

---

## 2. MCP Tool Surface Changes

### 2.1 tool-helpers.ts (new file, verbatim)

```ts
// src/lib/mcp/tool-helpers.ts
// Shared MCP tool helpers — extracted from tools.ts so project-tools.ts and
// future tool packs (Epic C GitHub pack) can import without circular deps.
// IMPORTANT: this file must NOT import from tools.ts (circular import risk).

import { parseDateKey } from "@/lib/calendar";

export function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export async function safe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

// Bare yyyy-mm-dd is otherwise parsed as UTC midnight, which lands in
// yesterday's MT day. Treat date-only as USER_TZ midnight; full ISO strings
// are returned verbatim.
export function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

### 2.2 project-tools.ts imports block

**IMPORTANT (C-2 fix)**: `parseDateKey` is NOT imported directly in `project-tools.ts` — it is only called internally by `parseDateInput` inside `tool-helpers.ts`. Including it here produces an unused-var lint failure. The correct imports are:

```ts
// src/lib/mcp/tools/project-tools.ts
// Project-domain MCP tools — ScheduledItem lifecycle + LogEntry observations.
// These tools are for project (non-fitness) goals only. Fitness tools live in
// tools.ts (log_workout, log_hike, log_baseline, log_measurement, etc.).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dateKey as toDateKey, startOfDay, endOfDay } from "@/lib/calendar";
import { safe, parseDateInput } from "@/lib/mcp/tool-helpers";

export function registerProjectTools(server: McpServer): void {
  // ... 7 tool registrations below ...
}
```

Every import in this block is used:
- `z` — all inputSchemas
- `McpServer` — `registerProjectTools` parameter type
- `Prisma` — `Prisma.ScheduledItemWhereInput`, `Prisma.LogEntryWhereInput`, `Prisma.ScheduledItemUpdateInput`, `Prisma.InputJsonValue`
- `prisma` — all DB calls
- `toDateKey` — `ScheduledItem.date` serialization in list/create/update handlers
- `startOfDay`, `endOfDay` — date-range filter normalization in list handlers
- `safe` — all handler wrappers
- `parseDateInput` — all date input parsing

---

### 2.3 Tool: `schedule_item`

**Name**: `schedule_item`  
**Title**: `"Schedule a project milestone, task, or review item"`  
**Description**:

```ts
"Create a ScheduledItem on a project (non-fitness) goal — milestones, tasks, launch steps, or review sessions. " +
"For project goals only; do NOT use for fitness activities — use log_workout, log_hike, log_baseline, " +
"or log_measurement for those. The goal must exist and be kind='project'; passing a fitness goal id " +
"returns a friendly error directing to the correct tools. Status is set to 'planned'. " +
"Returns the created item id and the date serialized as yyyy-mm-dd in USER_TZ. " +
"externalRef is optional; if provided it must be unique per goal (e.g. GitHub milestone node id) — " +
"a duplicate triggers a friendly error naming the conflict."
```

**inputSchema** (plain shape object, NOT z.object):

```ts
{
  goalId: z
    .string()
    .describe("ID of the project goal to attach this item to. Must be kind='project'."),
  date: z
    .string()
    .describe(
      "Scheduled date in yyyy-mm-dd format. Stored as USER_TZ midnight. " +
      "Never pass a full ISO string here — use the date portion only.",
    ),
  type: z
    .string()
    .min(1)
    .describe(
      "Item type. Open enum — common values: task | milestone | launch-step | review.",
    ),
  title: z
    .string()
    .min(1)
    .max(500)
    .describe("Short title for the scheduled item (max 500 chars)."),
  detail: z
    .string()
    .optional()
    .describe("Optional longer description or notes for the item."),
  payload: z
    .unknown()
    .optional()
    .describe(
      "Optional JSON payload for arbitrary metadata (e.g. GitHub milestone node data). " +
      "Stored as-is; not interpreted by the app.",
    ),
  externalRef: z
    .string()
    .optional()
    .describe(
      "Optional external reference key (e.g. GitHub milestone node id). " +
      "Must be unique per goal — a duplicate triggers a friendly error.",
    ),
}
```

**Handler pseudocode** (close-to-real):

```ts
async (input) =>
  safe(async () => {
    // 1. Goal existence + kind check
    const goal = await prisma.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true, kind: true },
    });
    if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
    if (goal.kind !== "project") {
      throw new Error(
        `Goal ${input.goalId} is kind='${goal.kind}'. ` +
        `Use fitness tools (log_workout, log_hike, log_baseline, log_measurement) ` +
        `for fitness goals — project tools are for kind='project' goals only.`,
      );
    }

    // 2. Parse date — USER_TZ midnight
    const date = parseDateInput(input.date);

    // 3. Create with P2002 guard for externalRef collision
    // NOTE: @@unique([goalId, externalRef]) only fires for non-null externalRef values
    // (Postgres NULL != NULL semantics — multiple items without externalRef always succeed).
    let item;
    try {
      item = await prisma.scheduledItem.create({
        data: {
          goalId: input.goalId,
          date,
          type: input.type,
          title: input.title,
          detail: input.detail ?? null,
          payload:
            input.payload !== undefined
              ? (input.payload as Prisma.InputJsonValue)
              : undefined,
          status: "planned",
          externalRef: input.externalRef ?? null,
        },
      });
    } catch (e) {
      // @@unique([goalId, externalRef]) violation
      if ((e as { code?: string }).code === "P2002") {
        throw new Error(
          `Duplicate externalRef "${input.externalRef}" already exists on goal ${input.goalId}. ` +
          `Each externalRef must be unique per goal.`,
        );
      }
      throw e;
    }

    return {
      id: item.id,
      goalId: item.goalId,
      date: toDateKey(item.date),
      type: item.type,
      title: item.title,
      status: item.status,
      message: "Item scheduled.",
    };
  }),
```

**Return shape** (per PRD §4.2):
```json
{ "id": "cuid", "goalId": "cuid", "date": "yyyy-mm-dd", "type": "milestone", "title": "...", "status": "planned", "message": "Item scheduled." }
```

---

### 2.4 Tool: `delete_scheduled_item`

**Name**: `delete_scheduled_item`  
**Title**: `"Hard-delete a scheduled item"`  
**Description**:

```ts
"Permanently delete a ScheduledItem by id. For project goals only — do NOT use for workouts or hikes; " +
"use delete_workout or delete_hike for those. Returns a friendly error if the item does not exist " +
"(second delete of the same id returns a friendly error, not an exception). " +
"No cascade — deletes only the item itself."
```

**inputSchema**:

```ts
{
  id: z.string().describe("ID of the ScheduledItem to permanently delete."),
}
```

**Handler pseudocode** (D-2 fix: no findUnique round-trip; P2025 catch closes double-delete TOCTOU window):

```ts
async (input) =>
  safe(async () => {
    // Single-round-trip delete: attempt delete, catch P2025 for not-found case.
    // No findUnique-first — delete_scheduled_item needs no row data in its response.
    try {
      await prisma.scheduledItem.delete({ where: { id: input.id } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2025") {
        throw new Error(`Scheduled item not found: ${input.id}`);
      }
      throw e;
    }

    return {
      id: input.id,
      deleted: true,
      message: "Scheduled item deleted.",
    };
  }),
```

**Return shape**: `{ "id": "cuid", "deleted": true, "message": "Scheduled item deleted." }`

---

### 2.5 Tool: `complete_item`

**Name**: `complete_item`  
**Title**: `"Mark a scheduled item as done"`  
**Description** (C-1 fix: `delete_workout/delete_hike` → `log_workout/log_hike`):

```ts
"Set a ScheduledItem's status to 'done' and record a completedAt timestamp. " +
"For project goals only — do NOT use for workouts or hikes; use log_workout or log_hike for those. " +
"completedAt defaults to the current instant (now) if omitted — use this for marking things done right now. " +
"Pass a bare yyyy-mm-dd to record USER_TZ midnight for that date, or a full ISO string for a precise moment. " +
"Returns the updated id, status, and completedAt as an ISO string."
```

**inputSchema**:

```ts
{
  id: z.string().describe("ID of the ScheduledItem to mark as done."),
  completedAt: z
    .string()
    .optional()
    .describe(
      "Completion timestamp. Bare yyyy-mm-dd → USER_TZ midnight for that date; " +
      "full ISO string → parsed verbatim. Omit to default to current instant (now).",
    ),
}
```

**Handler pseudocode** (D-2 fix: no findUnique round-trip; P2025 catch handles not-found):

```ts
async (input) =>
  safe(async () => {
    // Default completedAt = current instant (NOT midnight — per PRD §4.5)
    const completedAt = input.completedAt
      ? parseDateInput(input.completedAt)
      : new Date();

    // Single-round-trip update: attempt update, catch P2025 for not-found case.
    // No findUnique-first — complete_item needs no pre-existing row data; the
    // update result supplies all returned fields.
    let updated: { id: string; status: string; completedAt: Date | null };
    try {
      updated = await prisma.scheduledItem.update({
        where: { id: input.id },
        data: { status: "done", completedAt },
        select: { id: true, status: true, completedAt: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2025") {
        throw new Error(`Scheduled item not found: ${input.id}`);
      }
      throw e;
    }

    return {
      id: updated.id,
      status: updated.status,
      completedAt: updated.completedAt!.toISOString(),
      message: "Item marked done.",
    };
  }),
```

**Return shape**: `{ "id": "cuid", "status": "done", "completedAt": "2026-06-12T18:34:00.000Z", "message": "Item marked done." }`

---

### 2.6 Tool: `update_scheduled_item`

**Name**: `update_scheduled_item`  
**Title**: `"Patch a scheduled item's fields"`  
**Description**:

```ts
"Update one or more fields of an existing ScheduledItem (title, detail, date, status, type). " +
"For project goals only — do NOT use for workouts. True PATCH semantics: only explicitly provided fields change; " +
"omitted fields are unchanged. Passing only {id} with no additional fields returns a friendly message " +
"and performs no write. status must be one of: planned | done | skipped. " +
"date must be yyyy-mm-dd and is stored as USER_TZ midnight. Returns the updated fields alongside the id."
```

**inputSchema**:

```ts
{
  id: z.string().describe("ID of the ScheduledItem to update."),
  title: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("New title (max 500 chars). Omit to leave unchanged."),
  detail: z
    .string()
    .optional()
    .describe("New longer description or notes. Omit to leave unchanged."),
  date: z
    .string()
    .optional()
    .describe(
      "New scheduled date in yyyy-mm-dd format (USER_TZ midnight). Omit to leave unchanged.",
    ),
  status: z
    .enum(["planned", "done", "skipped"])
    .optional()
    .describe("New status. One of: planned | done | skipped. Omit to leave unchanged."),
  type: z
    .string()
    .min(1)
    .optional()
    .describe("New item type (e.g. task | milestone | launch-step | review). Omit to leave unchanged."),
}
```

**Handler pseudocode** (D-1 fix: `Prisma.ScheduledItemUpdateInput`; D-2 fix: P2025 catch on update; S-2 fix: select clause; S-4 fix: findUnique before no-op):

```ts
async (input) =>
  safe(async () => {
    const { id, ...fields } = input;

    // 1. Existence check FIRST (S-4: gives "not found" even on no-op call with stale id).
    //    findUnique is kept here — unlike delete/complete, update_scheduled_item needs
    //    it to provide correct "not found" feedback on the no-op path where no
    //    subsequent update call would catch P2025.
    const item = await prisma.scheduledItem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!item) throw new Error(`Scheduled item not found: ${id}`);

    // 2. No-op guard — return friendly message, no write
    if (
      fields.title === undefined &&
      fields.detail === undefined &&
      fields.date === undefined &&
      fields.status === undefined &&
      fields.type === undefined
    ) {
      return {
        message: "Nothing to update — provide at least one field (title, detail, date, status, type).",
      };
    }

    // 3. Build PATCH data object using Prisma-generated type (D-1)
    const data: Prisma.ScheduledItemUpdateInput = {};
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.detail !== undefined) data.detail = fields.detail;
    if (fields.date !== undefined) data.date = parseDateInput(fields.date);
    if (fields.status !== undefined) data.status = fields.status;
    if (fields.type !== undefined) data.type = fields.type;

    // 4. Update with select (S-2: avoids fetching payload Json) + P2025 catch
    //    (D-2: closes the TOCTOU window between findUnique and update)
    let updated: { id: string; title: string; detail: string | null; date: Date; status: string; type: string };
    try {
      updated = await prisma.scheduledItem.update({
        where: { id },
        data,
        select: { id: true, title: true, detail: true, date: true, status: true, type: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2025") {
        throw new Error(`Scheduled item not found: ${id}`);
      }
      throw e;
    }

    // 5. Return only the fields that were changed (plus id and message) — PATCH semantics
    const result: Record<string, unknown> = {
      id: updated.id,
      message: "Item updated.",
    };
    if (fields.title !== undefined) result.title = updated.title;
    if (fields.detail !== undefined) result.detail = updated.detail;
    if (fields.date !== undefined) result.date = toDateKey(updated.date);
    if (fields.status !== undefined) result.status = updated.status;
    if (fields.type !== undefined) result.type = updated.type;

    return result;
  }),
```

**Return shape** (example updating title + status):
```json
{ "id": "cuid", "title": "renamed title", "status": "done", "message": "Item updated." }
```

---

### 2.7 Tool: `list_scheduled_items`

**Name**: `list_scheduled_items`  
**Title**: `"List scheduled items for a project goal"`  
**Description**:

```ts
"Query ScheduledItems for a project goal with optional filters: date range (from/to as yyyy-mm-dd), " +
"status (planned|done|skipped), and type (exact match). For project goals only — do NOT use for workouts or hikes. " +
"Results ordered date descending. Nonexistent goalId returns a friendly error. " +
"Use to answer 'what's planned this sprint', 'what milestones are open', 'what did we complete this month'. " +
"Default limit is 50; max 200."
```

**inputSchema**:

```ts
{
  goalId: z.string().describe("ID of the project goal whose scheduled items to query."),
  from: z
    .string()
    .optional()
    .describe(
      "Start of date range in yyyy-mm-dd (inclusive). Mapped to USER_TZ start-of-day.",
    ),
  to: z
    .string()
    .optional()
    .describe(
      "End of date range in yyyy-mm-dd (inclusive). Mapped to USER_TZ end-of-day.",
    ),
  status: z
    .enum(["planned", "done", "skipped"])
    .optional()
    .describe("Filter by status. Omit to return all statuses."),
  type: z
    .string()
    .optional()
    .describe("Filter by item type (exact match, e.g. 'milestone'). Omit to return all types."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Max items to return. Default 50."),
}
```

**Handler pseudocode**:

```ts
async (input) =>
  safe(async () => {
    // Verify goal exists (friendly error on bad goalId)
    const goal = await prisma.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true },
    });
    if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

    // Build where clause conditionally
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (input.from) dateFilter.gte = startOfDay(parseDateInput(input.from));
    if (input.to) dateFilter.lte = endOfDay(parseDateInput(input.to));

    const where: Prisma.ScheduledItemWhereInput = {
      goalId: input.goalId,
      ...(input.from || input.to ? { date: dateFilter } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
    };

    const items = await prisma.scheduledItem.findMany({
      where,
      orderBy: { date: "desc" },
      take: input.limit,
      select: {
        id: true,
        goalId: true,
        date: true,
        type: true,
        title: true,
        detail: true,
        status: true,
        completedAt: true,
        externalRef: true,
        createdAt: true,
      },
    });

    return {
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        goalId: item.goalId,
        date: toDateKey(item.date),           // yyyy-mm-dd USER_TZ
        type: item.type,
        title: item.title,
        detail: item.detail,
        status: item.status,
        completedAt: item.completedAt?.toISOString() ?? null,  // ISO or null
        externalRef: item.externalRef,
        createdAt: item.createdAt.toISOString(),               // ISO
      })),
    };
  }),
```

**Return shape**: `{ "count": 2, "items": [{ "id", "goalId", "date": "yyyy-mm-dd", "type", "title", "detail", "status", "completedAt": "ISO|null", "externalRef": "str|null", "createdAt": "ISO" }, ...] }`

---

### 2.8 Tool: `log_metric`

**Name**: `log_metric`  
**Title**: `"Log a project metric observation"`  
**Description**:

```ts
"Record a numeric or text metric observation (MRR, downloads, milestone count, etc.) as a LogEntry " +
"on a project goal. For project goals only — do NOT use for body metrics (use log_measurement for " +
"weight/HR/body fat) or fitness baselines (use log_baseline for benchmark tests). " +
"Passing a fitness goalId returns a friendly error. " +
"At least one of value or text is required — both cannot be omitted; a friendly error is returned if both are missing. " +
"Store the bare metric key without any 'log:' prefix (e.g. 'mrr', not 'log:mrr'). " +
"date defaults to the current instant if omitted. Duplicate (same metric + date) calls create separate rows — intended for time-series."
```

**inputSchema**:

```ts
{
  goalId: z.string().describe("ID of the project goal to log this metric against. Must be kind='project'."),
  metric: z
    .string()
    .min(1)
    .describe(
      "Bare metric key (e.g. 'mrr', 'downloads', 'milestones_done'). " +
      "No 'log:' prefix — store the key portion only.",
    ),
  value: z
    .number()
    .optional()
    .describe(
      "Numeric metric value (e.g. MRR in USD, download count). " +
      "At least one of value or text is required.",
    ),
  text: z
    .string()
    .optional()
    .describe(
      "Text observation (e.g. a launch note, milestone description). " +
      "At least one of value or text is required.",
    ),
  date: z
    .string()
    .optional()
    .describe(
      "Observation date. Bare yyyy-mm-dd → USER_TZ midnight; full ISO string → parsed verbatim. " +
      "Defaults to current instant (not midnight) if omitted.",
    ),
  source: z
    .enum(["manual", "github", "claude"])
    .default("manual")
    .describe("Source of this metric entry. Default: manual."),
}
```

**Handler pseudocode** (D-3 fix: kind check added):

```ts
async (input) =>
  safe(async () => {
    // 1. value-or-text required guard — check FIRST before any DB call
    if (input.value === undefined && input.text === undefined) {
      throw new Error(
        "Provide value and/or text — both cannot be omitted for a metric log entry.",
      );
    }

    // 2. Verify goal exists AND is a project goal (D-3: prevents silently writing
    //    metric rows to fitness goals, which would corrupt goal-type semantics)
    const goal = await prisma.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true, kind: true },
    });
    if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
    if (goal.kind !== "project") {
      throw new Error(
        `Goal ${input.goalId} is kind='${goal.kind}'. ` +
        `log_metric is for project goals only — use log_measurement for body metrics ` +
        `or log_baseline for benchmark tests.`,
      );
    }

    // 3. date: current instant default, not midnight (per PRD §4.5)
    const date = input.date ? parseDateInput(input.date) : new Date();

    const entry = await prisma.logEntry.create({
      data: {
        goalId: input.goalId,
        metric: input.metric,
        value: input.value ?? null,
        text: input.text ?? null,
        date,
        source: input.source,
        // payload omitted — not exposed in this tool
      },
    });

    return {
      id: entry.id,
      goalId: entry.goalId,
      metric: entry.metric,
      value: entry.value,
      text: entry.text,
      date: entry.date.toISOString(),        // ISO — per PRD §4.2
      source: entry.source,
      message: "Metric logged.",
    };
  }),
```

**Return shape**: `{ "id": "cuid", "goalId": "cuid", "metric": "mrr", "value": 450, "text": null, "date": "2026-06-12T18:34:00.000Z", "source": "manual", "message": "Metric logged." }`

---

### 2.9 Tool: `list_log_entries`

**Name**: `list_log_entries`  
**Title**: `"List metric log entries for a project goal"`  
**Description** (S-3 fix: date format note added):

```ts
"Query LogEntry metric observations for a project goal, optionally filtered by metric key and/or date range. " +
"For project goals only — do NOT use for body measurements or fitness baselines. " +
"Results ordered date descending (newest first). Nonexistent goalId returns a friendly error. " +
"Use to answer 'what was the MRR trend', 'how many downloads this month'. " +
"Note: the date field is returned as an ISO string (not yyyy-mm-dd) — LogEntry.date is an instant, not a calendar date; " +
"contrast with list_scheduled_items where date is yyyy-mm-dd. " +
"Default limit is 50; max 500."
```

**inputSchema**:

```ts
{
  goalId: z.string().describe("ID of the project goal whose log entries to query."),
  metric: z
    .string()
    .optional()
    .describe(
      "Filter by metric key (exact match, e.g. 'mrr'). Omit to return all metrics.",
    ),
  from: z
    .string()
    .optional()
    .describe("Start of date range yyyy-mm-dd (inclusive, USER_TZ start-of-day)."),
  to: z
    .string()
    .optional()
    .describe("End of date range yyyy-mm-dd (inclusive, USER_TZ end-of-day)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Max entries to return. Default 50."),
}
```

**Handler pseudocode**:

```ts
async (input) =>
  safe(async () => {
    const goal = await prisma.goal.findUnique({
      where: { id: input.goalId },
      select: { id: true },
    });
    if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (input.from) dateFilter.gte = startOfDay(parseDateInput(input.from));
    if (input.to) dateFilter.lte = endOfDay(parseDateInput(input.to));

    const where: Prisma.LogEntryWhereInput = {
      goalId: input.goalId,
      ...(input.metric ? { metric: input.metric } : {}),
      ...(input.from || input.to ? { date: dateFilter } : {}),
    };

    const entries = await prisma.logEntry.findMany({
      where,
      orderBy: { date: "desc" },
      take: input.limit,
      select: {
        id: true,
        goalId: true,
        date: true,
        metric: true,
        value: true,
        text: true,
        source: true,
        createdAt: true,
      },
    });

    return {
      count: entries.length,
      entries: entries.map((e) => ({
        id: e.id,
        goalId: e.goalId,
        date: e.date.toISOString(),          // ISO — per PRD §4.2; see description note
        metric: e.metric,
        value: e.value,
        text: e.text,
        source: e.source,
        createdAt: e.createdAt.toISOString(), // ISO
      })),
    };
  }),
```

**Return shape**: `{ "count": 2, "entries": [{ "id", "goalId", "date": "ISO", "metric", "value", "text", "source", "createdAt": "ISO" }, ...] }`

---

## 3. Type Definitions

No new shared TypeScript types are needed beyond what Prisma generates. Key type facts:

- `Prisma.ScheduledItemWhereInput` and `Prisma.LogEntryWhereInput` — available from `import { Prisma } from "@/generated/prisma/client"` and used for `where` clause typing in list handlers.
- `Prisma.ScheduledItemUpdateInput` — available from the same import and used in `update_scheduled_item` data object. Fields accept both direct value types (`string`, `Date`) and Prisma's atomic update operation types — assigning a `string` to a `NullableStringFieldUpdateOperationsInput | string | null` field compiles correctly.
- `Prisma.InputJsonValue` — cast target for `payload: z.unknown()` fields when writing to `Json?` columns.
- The `todayItems` inline type in `get_today_plan` is declared inline (no export needed):
  ```ts
  let todayItems: { id: string; type: string; title: string; status: string; completedAt: string | null }[] = [];
  ```
- The `safe<T>()` generic return type is inferred by TypeScript from the helper signature — no manual typing required in handlers.
- When typing the `updated` variable from `prisma.scheduledItem.update({ ..., select: { id, title, detail, date, status, type } })`, TypeScript infers the shape from the select clause — the explicit type annotation in handler pseudocode is for documentation clarity only; developers may omit it and let inference work.

---

## 4. Data Flow

```
claude.ai
  │
  └─ POST /api/mcp (Bearer token)
       │
       └─ route.ts: fresh McpServer per request
            │
            └─ registerAll(server)
                 │  [patch: server.registerTool mutated to wrap decodeArgsDeep]
                 ├─ registerReadTools(server)    ← get_today_plan gains todayItems
                 ├─ registerWriteTools(server)
                 └─ registerProjectTools(server) ← 7 new tools
                      │
                      └─ handler: safe(async () => {
                           prisma.goal.findUnique()   ← existence/kind check (where needed)
                           prisma.scheduledItem.*()   ← or prisma.logEntry.*()
                           return { ...fields }        ← serialized per §2.x
                         })
                           │
                           └─ jsonResult({ ... })  or  errorResult("...")
                                │
                              MCP JSON response to claude.ai
```

---

## 5. Work Streams

| Stream | Requirements | Files | Can Parallelize With |
|--------|-------------|-------|---------------------|
| Dev A | REQ-001, REQ-002, REQ-003, REQ-004 | `src/lib/mcp/tool-helpers.ts` (create), `src/lib/mcp/tools/project-tools.ts` (create), `src/lib/mcp/tools.ts` (Edit 1 helper swap + Edit 2 registerAll wiring) | Dev B (disjoint file regions) |
| Dev B | REQ-005 | `src/lib/mcp/tools.ts` (Edit 3 only: get_today_plan handler L562–594) | Dev A (different lines in tools.ts) |

**Merge-conflict surface analysis**: Both streams touch `src/lib/mcp/tools.ts`, but at disjoint regions:
- Dev A: L196–222 (helper block removal + import add) and L507 (registerAll closing area)
- Dev B: L562–594 (get_today_plan handler body only)

Git will merge these cleanly as non-overlapping hunks. However, to be safe:

**Merge order**: Dev A commits first. Dev B must rebase onto Dev A's commit before merging, to ensure the helpers import and project-tools wiring are already in place when Dev B's `tools.ts` diff applies. Dev B's change does NOT need any of Dev A's new files — it only uses `startOfDay`/`endOfDay` already imported in tools.ts — so Dev B can develop in parallel but should rebase before final merge.

**Single shared import to be careful about**: Dev A's Edit 1 removes lines 196–222 and adds an import. If Dev B's diff is based on a pre-Edit-1 line count, the `get_today_plan` region has shifted by approximately -21 lines (removed function bodies) + 1 line (import). Dev B should work from a post-Edit-1 branch or resolve this 20-line offset during merge. State explicitly in the PR: "Dev B rebases after Dev A lands."

---

## 6. Implementation Order (Dev A)

1. **Create `src/lib/mcp/tool-helpers.ts`** — copy the four function bodies verbatim from tools.ts; add `export` keyword to each; add `import { parseDateKey } from "@/lib/calendar"`. Run `npx tsc --noEmit` — must pass with zero errors.

2. **Modify `tools.ts` Edit 1 (helper swap)** — remove lines 196–222, add `import { safe, jsonResult, errorResult, parseDateInput } from "@/lib/mcp/tool-helpers"`. Run `npx tsc --noEmit` again — must pass. This is the riskiest step (blast radius: ~74 `safe()` call sites). If tsc passes, behavior is proven unchanged.

3. **Create `src/lib/mcp/tools/project-tools.ts` scaffold** — add the imports block from §2.2 (verbatim — no `parseDateKey`, no extra imports) and a stub `registerProjectTools` that registers zero tools. Run `npx tsc --noEmit` and `npm run lint` — both must pass with zero new errors.

4. **Modify `tools.ts` Edit 2 (registerAll wiring)** — add the import of `registerProjectTools` and the call inside `registerAll()`. Run `npx tsc --noEmit` + dev server quick check: `tools/list` should return the same 75 tools (stub registers nothing yet).

5. **Implement `schedule_item` + `delete_scheduled_item`** (REQ-001). Run tsc after each. Smoke both via curl.

6. **Implement `complete_item` + `update_scheduled_item`** (REQ-002). Run tsc. Smoke.

7. **Implement `list_scheduled_items`** (REQ-003). Run tsc. Smoke.

8. **Implement `log_metric` + `list_log_entries`** (REQ-004). Run tsc. Smoke. Verify `tools/list` now shows 82 tools total.

9. **Final gate**: `npx tsc --noEmit` + `npm run lint` + `npm run build` — all must be clean.

## Implementation Order (Dev B)

1. (Wait for Dev A step 2 to land, or work in parallel on a branch — rebase before merging.)
2. **Modify `tools.ts` Edit 3 (get_today_plan todayItems)** — three-step change: hoist `const now`, change `resolveDay(new Date())` → `resolveDay(now)`, insert todayItems block, update return. Run `npx tsc --noEmit`.
3. **Smoke REQ-005**: with fitness goal as focus, curl `get_today_plan` → verify `todayItems: []` and output otherwise identical. With project goal as focus (via direct DB flip), verify `todayItems` contains today's items.

---

## 7. Critical Decisions

### D-1: Date serialization convention

| Field | Stored as | Returned as | Rationale |
|-------|-----------|-------------|-----------|
| `ScheduledItem.date` | USER_TZ midnight `DateTime` | `toDateKey(date)` → `yyyy-mm-dd` | It's a calendar date, not an instant — returning as ISO would mislead (the "midnight" detail is an implementation artifact) |
| `ScheduledItem.completedAt` | any `DateTime` | `.toISOString()` | It's a precise completion instant, not a calendar date |
| `ScheduledItem.createdAt` | system `DateTime` | `.toISOString()` | System timestamp, always ISO |
| `LogEntry.date` | USER_TZ midnight or instant `DateTime` | `.toISOString()` | PRD §4.2 explicitly says "(ISO)" for log_metric return date |
| `LogEntry.createdAt` | system `DateTime` | `.toISOString()` | System timestamp |
| `todayItems.completedAt` (in get_today_plan) | nullable `DateTime` | `.toISOString() \| null` | Consistent with full ScheduledItem serialization |

Decision: **ScheduledItem.date always serializes to `yyyy-mm-dd` via `toDateKey()`; all other DateTime fields use `.toISOString()`**. The `list_log_entries` description explicitly calls this out to orient the AI (adopted S-3).

### D-2: kind check on schedule_item — block (not warn)

PRD §6 says "errorResult directing to fitness tools." This is a hard block, not a warning. Rationale: claude.ai routes tool selection by description text; if a fitness goal accidentally gets a ScheduledItem, the data model is corrupted. Block hard with a friendly message naming the right tools.

### D-3: status field on update_scheduled_item — z.enum, not open string

PRD §4.2 says `status?: 'planned'|'done'|'skipped'`. Using `z.enum(["planned","done","skipped"])` provides MCP-level validation before the handler runs, which is preferable to open-string + runtime check. The schema column is `String` with no DB constraint, but Zod enforces correctness at the API boundary.

### D-4: update_scheduled_item with only {id} — findUnique first, then friendly no-op

The existence check (`findUnique`) runs before the no-op guard. This means `update_scheduled_item { id: "nonexistent" }` correctly returns "Scheduled item not found" rather than the misleading "Nothing to update." The cost is one extra DB round-trip on pure no-op calls — acceptable; correct error feedback outweighs the marginal extra latency. (Adopted from critique S-4.)

### D-5: log_metric value-or-text check — pre-DB guard

The check throws before any Prisma call. This avoids creating a `LogEntry` with `value=null, text=null` which would be a semantically useless row. The guard runs as the very first statement inside `safe()`.

### D-6: P2002/P2025 error duck-typing — not instanceof

Both P2002 (externalRef collision) and P2025 (not-found) are caught via `(e as { code?: string }).code === "P2025/P2002"` duck typing. This matches the project's established pattern elsewhere and avoids importing `PrismaClientKnownRequestError` (which IS available via `Prisma.PrismaClientKnownRequestError` per confirmed generated types, but adding an `instanceof` check for the same outcome is extra surface with no practical benefit in this single-ORM codebase). See critique S-1 for the alternative. Rejected for consistency.

### D-7: externalRef = null and @@unique — no collision risk

Postgres `NULL != NULL` semantics mean `@@unique([goalId, externalRef])` only fires when both values are non-null. Multiple `schedule_item` calls without an `externalRef` always succeed. The P2002 guard only matters when `input.externalRef` is provided and clashes. A code comment documents this in the handler.

### D-8: get_today_plan — const now hoisting

`resolveDay(new Date())` and `startOfDay(now)` for todayItems must use the same "now" to avoid a clock edge case (e.g. midnight crossing during request). Hoisting `const now = new Date()` before `Promise.all` ensures consistency.

### D-9: No set_active_goal tool — QA uses direct Prisma script

Per orchestrator: `update_goal`'s description confirms focus-switching is app-UI only (`setFocusGoal`). The B-6 runbook step 8 uses `npx tsx --env-file=.env -e "..."` promise-style scripts to flip `isFocus` directly. The scripts must RESTORE the fitness goal to `isFocus: true` before the session ends. See QA Runbook §8 for exact commands.

### D-10: LogEntry.source — z.enum with .default

`source: z.enum(["manual", "github", "claude"]).default("manual")` means the field is always populated in the DB row. The schema column is `String?` (nullable), but the tool always writes a value. Consistent with PRD §4.2 which says `default('manual')`.

### D-11: P2025 catch pattern — consistent across all three mutating-by-id tools

The three mutating-by-id project tools follow a consistent strategy that minimizes round-trips while meeting the PRD §6 friendly-error requirement:

| Tool | findUnique-first? | P2025 catch on mutation? | Rationale |
|------|-------------------|--------------------------|-----------|
| `delete_scheduled_item` | No | Yes | No row data needed in response; single `delete` + P2025 catch is one round-trip |
| `complete_item` | No | Yes | `update` result supplies all returned fields (`id`, `status`, `completedAt`); no pre-read needed |
| `update_scheduled_item` | Yes | Yes | findUnique needed to give "not found" feedback on the no-op path (D-4); P2025 catch on update closes the TOCTOU window between findUnique and update |

Rule: **Keep `findUnique`-first only where the row's data is needed for the response, or where it is required for correct no-op behavior. Rely on the P2025 catch everywhere else.** P2025 catch is present on ALL three mutation calls.

### D-12: kind check scope — log_metric write tool only

The `kind='project'` check is added to `log_metric` (the only write tool that accepts a `goalId` and could silently corrupt a fitness goal). The three ScheduledItem-by-id mutation tools (`delete_scheduled_item`, `complete_item`, `update_scheduled_item`) operate on ScheduledItem IDs — if the row exists, it is already correctly associated. The two list tools (`list_scheduled_items`, `list_log_entries`) are reads — a wrong kind produces empty results, not data corruption. `schedule_item` already has its kind check. This gives the minimum enforcement surface consistent with PRD §3.2 spirit.

---

## 8. QA Runbook Sketch (B-6)

Complete runbook artifact goes to `.feature-dev/2026-06-12-epic-b-project-tools/phases/qa-runbook.md`. This section provides the exact commands for the Architect handoff; the QA agent produces the full artifact with expected outputs.

### Prerequisites

```sh
# Start dev server in a separate terminal:
npm run dev

# Extract token (in another terminal for all curl commands):
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
BASE_URL="http://localhost:3000/api/mcp"

# Capture fitness goal id (current isFocus goal) for RESTORE step later:
FITNESS_ID=$(npx tsx --env-file=.env -e "
const { PrismaClient } = require('./src/generated/prisma/client');
const p = new PrismaClient();
p.goal.findFirst({ where: { isFocus: true }, select: { id: true } }).then(function(g) {
  console.log(g ? g.id : 'NONE');
  return p.\$disconnect();
});
")
echo "Fitness goal id: $FITNESS_ID"
```

### Step 1 — tools/list: assert 7 new tools present

```sh
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -m json.tool \
  | grep '"name"' \
  | grep -E 'schedule_item|delete_scheduled_item|complete_item|update_scheduled_item|list_scheduled_items|log_metric|list_log_entries'
# Expected: 7 lines, one per tool name
```

### Step 2 — create_goal (test project goal)

```sh
RESP=$(curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_goal","arguments":{"objective":"TEST chewgether smoke B-6","kind":"project"}}}')
echo $RESP | python3 -m json.tool
# Extract GOAL_ID from the response (id field in result)
GOAL_ID="<paste from output>"
```

### Step 3 — schedule_item + error cases + externalRef collision (M-3)

```sh
# Happy path:
ITEM_RESP=$(curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"$(date +%Y-%m-%d)\",\"type\":\"milestone\",\"title\":\"B-6 smoke milestone\"}}}")
echo $ITEM_RESP | python3 -m json.tool
ITEM_ID="<paste item id from output>"

# Error case — bad goalId:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"schedule_item","arguments":{"goalId":"nonexistent-id","date":"2026-06-15","type":"task","title":"should fail"}}}' \
  | python3 -m json.tool
# Expected: isError=true, "Goal not found: nonexistent-id"

# Error case — fitness goal:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$FITNESS_ID\",\"date\":\"2026-06-15\",\"type\":\"task\",\"title\":\"should fail\"}}}" \
  | python3 -m json.tool
# Expected: isError=true, message directing to fitness tools

# externalRef collision test (M-3):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5b,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"2026-06-20\",\"type\":\"task\",\"title\":\"ext ref item\",\"externalRef\":\"ext-unique-1\"}}}" \
  | python3 -m json.tool
# Expected: success — first use of externalRef "ext-unique-1"

curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5c,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"2026-06-21\",\"type\":\"task\",\"title\":\"dup ref item\",\"externalRef\":\"ext-unique-1\"}}}" \
  | python3 -m json.tool
# Expected: isError=true, "Duplicate externalRef \"ext-unique-1\" already exists on goal..."
```

### Step 4 — list_scheduled_items (planned)

```sh
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"list_scheduled_items\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"status\":\"planned\"}}}" \
  | python3 -m json.tool
# Expected: count >= 1, item with status='planned'
```

### Step 5 — complete_item + list (done) + error case (M-1)

```sh
# Happy path:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"complete_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
# Expected: status='done', completedAt=ISO string

curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"list_scheduled_items\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"status\":\"done\"}}}" \
  | python3 -m json.tool
# Expected: item present with status='done'

# Error case — unknown id (M-1):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":8b,"method":"tools/call","params":{"name":"complete_item","arguments":{"id":"nonexistent-item-id"}}}' \
  | python3 -m json.tool
# Expected: isError=true, "Scheduled item not found: nonexistent-item-id"
```

### Step 6 — update_scheduled_item + error cases (D-4 / M-1)

```sh
# Happy path — rename:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"update_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\",\"title\":\"B-6 smoke milestone (renamed)\"}}}" \
  | python3 -m json.tool
# Expected: { id, title: "B-6 smoke milestone (renamed)", message: "Item updated." }
# Other fields NOT present in response (PATCH semantics)

# No-op test:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"update_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
# Expected: { message: "Nothing to update..." }

# Error case — unknown id with a field (M-1 / D-4):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"9b","method":"tools/call","params":{"name":"update_scheduled_item","arguments":{"id":"nonexistent-item-id","title":"should fail"}}}' \
  | python3 -m json.tool
# Expected: isError=true, "Scheduled item not found: nonexistent-item-id"

# Error case — unknown id with NO fields (S-4 verification):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"9c","method":"tools/call","params":{"name":"update_scheduled_item","arguments":{"id":"nonexistent-item-id"}}}' \
  | python3 -m json.tool
# Expected: isError=true, "Scheduled item not found: nonexistent-item-id"
# (NOT "Nothing to update" — findUnique-first ensures correct feedback on stale id)
```

### Step 7 — log_metric × 2 + list + error cases (including fitness goalId)

```sh
# First entry:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\",\"value\":450}}}" \
  | python3 -m json.tool

# Second entry:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\",\"value\":480}}}" \
  | python3 -m json.tool

# List entries — expect count=2, newest first:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",\"params\":{\"name\":\"list_log_entries\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\"}}}" \
  | python3 -m json.tool
# Expected: count=2, ordered date desc; date field is ISO string (not yyyy-mm-dd)

# Error case — both value and text omitted:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":14,\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"metric\":\"mrr\"}}}" \
  | python3 -m json.tool
# Expected: isError=true, "Provide value and/or text..."

# Error case — fitness goalId (D-3 enforcement):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":14b,\"method\":\"tools/call\",\"params\":{\"name\":\"log_metric\",\"arguments\":{\"goalId\":\"$FITNESS_ID\",\"metric\":\"mrr\",\"value\":100}}}" \
  | python3 -m json.tool
# Expected: isError=true, "...log_metric is for project goals only..."
```

### Step 8 — isFocus flip + get_today_plan todayItems + RESTORE

```sh
# Schedule a new item for TODAY first (the completed one from step 5 is already done):
TODAY_ITEM_RESP=$(curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":15,\"method\":\"tools/call\",\"params\":{\"name\":\"schedule_item\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"date\":\"$(date +%Y-%m-%d)\",\"type\":\"task\",\"title\":\"Today task for todayItems test\"}}}")
echo $TODAY_ITEM_RESP | python3 -m json.tool

# Flip isFocus to test project goal:
npx tsx --env-file=.env -e "
const { PrismaClient } = require('./src/generated/prisma/client');
const p = new PrismaClient();
p.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } }).then(function() {
  return p.goal.update({ where: { id: '$GOAL_ID' }, data: { isFocus: true } });
}).then(function() {
  console.log('Focus switched to project goal');
  return p.\$disconnect();
});
"

# Call get_today_plan — expect todayItems non-empty:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"get_today_plan","arguments":{}}}' \
  | python3 -m json.tool | grep -A 20 '"todayItems"'
# Expected: todayItems array with at least one item (type, title, status, completedAt)

# RESTORE fitness goal as focus immediately:
npx tsx --env-file=.env -e "
const { PrismaClient } = require('./src/generated/prisma/client');
const p = new PrismaClient();
p.goal.updateMany({ where: { isFocus: true }, data: { isFocus: false } }).then(function() {
  return p.goal.update({ where: { id: '$FITNESS_ID' }, data: { isFocus: true } });
}).then(function() {
  console.log('Fitness goal RESTORED as focus');
  return p.\$disconnect();
});
"

# Verify fitness regression — todayItems must be []:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"get_today_plan","arguments":{}}}' \
  | python3 -m json.tool | grep -A 3 '"todayItems"'
# Expected: "todayItems": []
```

### Step 9 — delete_scheduled_item + double-delete

```sh
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":18,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
# Expected: { id, deleted: true, message }

# Second delete — friendly error (not raw Prisma P2025):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":19,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_scheduled_item\",\"arguments\":{\"id\":\"$ITEM_ID\"}}}" \
  | python3 -m json.tool
# Expected: isError=true, "Scheduled item not found: ..."
# (Must NOT be a raw Prisma error message — verify this explicitly)
```

### Step 10 — delete test goal (cascade) + verify list_scheduled_items + list_log_entries (M-2)

```sh
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_goal\",\"arguments\":{\"goalId\":\"$GOAL_ID\",\"confirm\":true}}}" \
  | python3 -m json.tool
# Expected: cascaded.scheduledItems >= 1, cascaded.logEntries >= 2

# Verify cascade — list_scheduled_items should return friendly error (goal gone):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"tools/call\",\"params\":{\"name\":\"list_scheduled_items\",\"arguments\":{\"goalId\":\"$GOAL_ID\"}}}" \
  | python3 -m json.tool
# Expected: isError=true, "Goal not found: ..."

# Verify cascade — list_log_entries should also return friendly error (M-2):
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":21b,\"method\":\"tools/call\",\"params\":{\"name\":\"list_log_entries\",\"arguments\":{\"goalId\":\"$GOAL_ID\"}}}" \
  | python3 -m json.tool
# Expected: isError=true, "Goal not found: ..."

# Confirm fitness goal is still focus:
curl -s -X POST $BASE_URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"list_goals","arguments":{}}}' \
  | python3 -m json.tool | grep -E '"isFocus"|"kind"|"objective"'
# Expected: fitness goal has isFocus=true; test goal is absent
```

### Post-deploy reminder (connector cache)

After merging to main and Vercel deploys, `MCP_SERVER_VERSION` changes (new SHA). claude.ai's connector automatically re-fetches `tools/list` on the next request. No manual connector toggle needed unless testing against the production URL before the first post-deploy request.

---

## 9. Concerns

1. **`Prisma.ScheduledItemWhereInput` / `Prisma.LogEntryWhereInput` / `Prisma.ScheduledItemUpdateInput` availability**: These types come from `import { Prisma } from "@/generated/prisma/client"`. Confirmed generated by Prisma 7 for every model — verified in `src/generated/prisma/internal/prismaNamespace.ts` via `export type * from '../models'`. If TypeScript can't resolve them at first, run `npx prisma generate` (should be a no-op since schema is unchanged, but clears stale type cache).

2. **Fitness regression is zero-diff except `todayItems: []`**: The PRD acceptance criteria says "byte-identical except `todayItems: []`." This is achievable only if no whitespace or ordering changes are introduced to the `{ ...r, standingRules, focusGoal, activeGoal }` spread. The `todayItems` field appends last. Dev B must not reformat any existing lines.

3. **`source` on `LogEntry` is `String?` in schema but always written**: `log_metric` always writes `source` (defaults to `"manual"`). `list_log_entries` selects `source` — it will be non-null for all entries created by this tool, but may be `null` for legacy rows (none exist yet). The serialization `e.source` (not `e.source ?? null`) is fine — Prisma returns `string | null` and JSON.stringify handles null correctly.

4. **`Prisma.ScheduledItemUpdateInput` field type widths**: `ScheduledItemUpdateInput.detail` accepts `NullableStringFieldUpdateOperationsInput | string | null`. Assigning a `string` directly to it compiles correctly — TypeScript resolves the union. The same applies to `date: DateTimeFieldUpdateOperationsInput | Date | string` — assigning a `Date` from `parseDateInput()` works without casting.

5. **select clause return type in update_scheduled_item**: The handler declares `let updated: { id: string; title: string; detail: string | null; date: Date; status: string; type: string }` for documentation clarity. In practice, TypeScript infers this shape from the `select` clause — the annotation can be omitted and TypeScript will still correctly type `updated.date` as `Date` for `toDateKey()`.

---

## 10. Devil's Advocate Trail — Critique Response

This section audits every critique finding and records its status in v2. Required for traceability.

### Critical Issues (Mandatory)

| ID | Finding | Status | Action |
|----|---------|--------|--------|
| C-1 | `complete_item` description says `delete_workout/delete_hike` instead of `log_workout/log_hike` | **ADOPTED** | Description corrected in §2.5. Full 7-tool audit performed: only `complete_item` was mis-routed. `delete_scheduled_item` correctly says `delete_workout/delete_hike` (deletion → deletion analogy is correct). All other 5 tools either name the right redirects or omit specific redirects (acceptable for read/generic patch tools). |
| C-2 | `parseDateKey` in project-tools.ts imports block fails lint | **ADOPTED** | Removed from §2.2. Final import: `import { dateKey as toDateKey, startOfDay, endOfDay } from "@/lib/calendar"`. Each import in the block is now documented with its usage. |

### Design Concerns (High)

| ID | Finding | Status | Action |
|----|---------|--------|--------|
| D-1 | `update_scheduled_item` uses plain object type instead of `Prisma.ScheduledItemUpdateInput` | **ADOPTED** | Handler in §2.6 now uses `const data: Prisma.ScheduledItemUpdateInput = {}`. Import already present. Field assignment patterns (`data.title = fields.title` etc.) are compatible with the union types in `ScheduledItemUpdateInput`. |
| D-2 | `delete_scheduled_item` findUnique→delete TOCTOU window surfaces raw P2025 | **ADOPTED** | All three mutating-by-id tools revised with consistent P2025 catch strategy documented in D-11. `delete_scheduled_item` and `complete_item` drop findUnique entirely; `update_scheduled_item` keeps findUnique (required for S-4 no-op behavior) but adds P2025 catch on update. |

### Design Concerns (Medium)

| ID | Finding | Status | Action |
|----|---------|--------|--------|
| D-3 | `log_metric` no `kind='project'` check — silently writes to fitness goals | **ADOPTED** | kind check added to `log_metric` handler in §2.8 (after value-or-text guard, before create). Added to QA runbook step 7 as a fitness-goalId error case. Read tools (`list_log_entries`, `list_scheduled_items`) not updated — reads against wrong kind return empty results, no integrity risk. |
| D-4 | QA runbook missing `update_scheduled_item` unknown-id error case | **ADOPTED** | Step 6 now includes two error cases: unknown-id with a field (standard "not found") and unknown-id with no fields (verifies S-4 "not found" beats "nothing to update"). |
| D-5 | Duplicate of C-2 (parseDateKey contradiction) | **N/A** | Resolved by C-2. |

### Suggestions (Low)

| ID | Finding | Status | Action |
|----|---------|--------|--------|
| S-1 | Use `Prisma.PrismaClientKnownRequestError instanceof` instead of duck-type | **REJECTED** | Duck-typing `(e as { code?: string }).code === "P20XX"` is the established pattern in this codebase (used for P2002 elsewhere). `Prisma.PrismaClientKnownRequestError` IS available via the existing import, but the isinstance check adds no practical safety benefit in this single-ORM app. Keeping duck-type for consistency. |
| S-2 | `update_scheduled_item` update call should use `select` to avoid fetching `payload` | **ADOPTED** | `select: { id, title, detail, date, status, type }` added to the update call in §2.6. |
| S-3 | `list_log_entries` description should note ISO vs yyyy-mm-dd date format difference | **ADOPTED** | Note added to description in §2.9: "Note: the date field is returned as an ISO string (not yyyy-mm-dd)..." |
| S-4 | `update_scheduled_item` no-op check before findUnique gives misleading "nothing to update" on stale id | **ADOPTED** | Order flipped in §2.6 — findUnique runs first. Costs one extra DB round-trip on pure no-op calls; correct error feedback outweighs marginal latency. Verified in QA runbook step 6 case "9c". |

### Missing Requirements

| ID | Finding | Status | Action |
|----|---------|--------|--------|
| M-1 | `complete_item` and `update_scheduled_item` unknown-id cases missing from runbook | **ADOPTED** | Step 5 now includes `complete_item { id: "nonexistent" }` error case. Step 6 includes two `update_scheduled_item` unknown-id error cases. |
| M-2 | `list_log_entries` post-delete check missing from runbook | **ADOPTED** | Step 10 now includes `list_log_entries { goalId: $GOAL_ID }` after `delete_goal`, expecting "Goal not found." |
| M-3 | `externalRef` collision test missing from runbook | **ADOPTED** | Step 3 extended with two-call collision test: first `externalRef: "ext-unique-1"` succeeds, second returns "Duplicate externalRef" error. |

---

## 11. Summary (10 lines)

Three files change: `tool-helpers.ts` (new — 4 extracted helpers), `tools/project-tools.ts` (new — 7 tools in `registerProjectTools`), and `tools.ts` (3 surgical edits: helper import swap at L196–222, `registerProjectTools` call after L507, `todayItems` branch at L562–594). **v2 changes from v1**: (a) `complete_item` description fixed to reference `log_workout/log_hike` not `delete_workout/delete_hike`; (b) `parseDateKey` removed from project-tools.ts import block; (c) `update_scheduled_item` data object types to `Prisma.ScheduledItemUpdateInput`; (d) all three mutating-by-id tools now catch P2025 to produce friendly errors, with findUnique kept only where needed per D-11; (e) `log_metric` adds kind check; (f) `update_scheduled_item` checks findUnique before no-op guard; (g) `update_scheduled_item` update call gains `select` clause; (h) `list_log_entries` description notes ISO date format; (i) QA runbook extended with 5 additional test cases (externalRef collision, complete_item unknown-id, update_scheduled_item unknown-id × 2, list_log_entries post-delete). The decodeArgsDeep patch coverage, date serialization convention, merge strategy, and all other v1 decisions are unchanged and carry forward.
