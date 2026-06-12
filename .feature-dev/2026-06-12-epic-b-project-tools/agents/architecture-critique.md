# Architecture Critique — Epic B: Project MCP Tool Pack

**Author**: Devil's Advocate Agent
**Date**: 2026-06-12
**Status**: NEEDS REVISION (2 high issues must be resolved before coding)
**Source docs**: PRD §1–10, requirements.md, research-output.md, architecture-blueprint.md
**Code verified against**: tools.ts L196–595, schema.prisma L179–244, calendar.ts, route.ts (both), generated Prisma types

---

## Critical Issues (must fix before coding)

### C-1: `complete_item` description references wrong fitness redirect tools — AI-routing bug

**What**: Blueprint §2.5 description reads:
```
"For project goals only — do NOT use for workouts or hikes; use delete_workout or delete_hike for those."
```

`delete_workout` and `delete_hike` **permanently delete** fitness records. They are NOT how a user marks a workout done. The correct fitness tools for *completing* an activity are `log_workout` and `log_hike`.

**Why it matters**: `get_today_plan` description is the primary routing signal claude.ai uses. If a user asks "mark today's run as done," the `complete_item` description says to use `delete_hike` — which would **erase the workout record entirely** rather than log it. This is a destructive routing mistake that will corrupt real data.

**Fix**: Change description for `complete_item` to reference `log_workout` and `log_hike`:
```ts
"For project goals only — do NOT use for workouts or hikes; use log_workout or log_hike for those."
```

**Severity**: CRITICAL

Note: `delete_scheduled_item` correctly references `delete_workout` / `delete_hike` in its description (deletion → deletion) — that one is correct.

---

### C-2: `parseDateKey` in project-tools.ts import block contradicts Section 9 — lint gate will fail

**What**: Blueprint §2.2 imports block shows:
```ts
import { dateKey as toDateKey, startOfDay, endOfDay, parseDateKey } from "@/lib/calendar";
```

Blueprint §9 (Concerns) then says: "Remove the `parseDateKey` import from the imports block if unused — tsc will flag it."

`parseDateKey` is NOT used directly in any `project-tools.ts` handler — it is only called internally by `parseDateInput` (which lives in `tool-helpers.ts`). The dev agent who follows §2.2 verbatim will include the import; eslint `no-unused-vars` will then fail `npm run lint`, blocking the build gate.

**Why it matters**: The blueprint presents §2.2 as authoritative code-ready text. The contradiction between §2.2 and §9 creates a silent lint failure that breaks the AC-1 gate (`npm run lint` no new issues).

**Fix**: Remove `parseDateKey` from the §2.2 imports block. Final correct import line:
```ts
import { dateKey as toDateKey, startOfDay, endOfDay } from "@/lib/calendar";
```

**Severity**: CRITICAL (guaranteed lint failure if §2.2 is followed as written)

---

## Design Concerns (should fix)

### D-1: `update_scheduled_item` data object diverges from established Prisma update pattern

**What**: Blueprint §2.6 uses a custom plain-object type:
```ts
const data: {
  title?: string;
  detail?: string;
  date?: Date;
  status?: string;
  type?: string;
} = {};
```

Established pattern in `tools.ts` (confirmed at L327 and L3570):
```ts
const updateData: Prisma.PlanDayOverrideUpdateInput = {};
const data: Prisma.WorkoutExerciseUpdateInput = {};
```

**Why it matters**: Prisma 7's `prisma.scheduledItem.update({ data })` expects `Prisma.XOR<ScheduledItemUpdateInput, ScheduledItemUncheckedUpdateInput>`. The plain object type `{ title?: string; ... }` is a structural subtype that TypeScript may or may not resolve correctly against the `XOR` construct (which synthesizes `Without<B, A>` negation constraints on both arms). In practice this often compiles, but it diverges from the project's established pattern, is fragile if Prisma 7 tightens generated types, and will confuse reviewers.

**Confirmed Prisma types**:
- `ScheduledItemUpdateInput.detail?: NullableStringFieldUpdateOperationsInput | string | null` — our local `detail?: string` drops `null`
- `ScheduledItemUpdateInput.date?: DateTimeFieldUpdateOperationsInput | Date | string`

**Fix**: Replace the local type with the established pattern:
```ts
const data: Prisma.ScheduledItemUpdateInput = {};
```

Then assign fields using the same pattern as L3570:
```ts
if (fields.title !== undefined) data.title = fields.title;
if (fields.detail !== undefined) data.detail = fields.detail;
if (fields.date !== undefined) data.date = parseDateInput(fields.date);
if (fields.status !== undefined) data.status = fields.status;
if (fields.type !== undefined) data.type = fields.type;
```

`ScheduledItemUpdateInput` is available via `import { Prisma } from "@/generated/prisma/client"` — confirmed in `src/generated/prisma/internal/prismaNamespace.ts` via `export type * from '../models'` which includes `ScheduledItemUpdateInput` from `src/generated/prisma/models/ScheduledItem.ts`.

**Severity**: HIGH (may cause tsc failures; diverges from project convention)

---

### D-2: `complete_item` description also misroutes double-delete scenario

**What**: `delete_scheduled_item` description says "second delete is safe, returns error rather than throwing." The blueprint correctly uses `findUnique` + manual check (Pattern B). However, it uses this flow:

```
findUnique → if not found → throw Error (safe catches → errorResult)
                    ↓ found
              delete
              return { deleted: true }
```

Between `findUnique` and `delete`, a concurrent caller could delete the same row. In that case `delete` would throw `P2025`. This escapes `safe` as a raw Prisma error message, not the friendly "Scheduled item not found" message.

**Why it matters**: Single-user app, so true race concurrency is near-impossible. But a single request retry or a programmatic double-call within ms would still surface the raw Prisma error. PRD §6 requires friendly error for double-delete.

**Fix**: Either wrap the `delete` in a try/catch for P2025, or (simpler) use a single DB round-trip: attempt `delete`, catch P2025:
```ts
try {
  await prisma.scheduledItem.delete({ where: { id: input.id } });
} catch (e) {
  if ((e as { code?: string }).code === "P2025") {
    throw new Error(`Scheduled item not found: ${input.id}`);
  }
  throw e;
}
return { id: input.id, deleted: true, message: "Scheduled item deleted." };
```

This also eliminates the extra `findUnique` round-trip. For a single-user app the existing approach is acceptable, but since PRD §6 explicitly requires friendly double-delete behavior, the P2025 catch is needed.

**Severity**: HIGH (PRD §6 requirement; will fail B-6 step 9)

---

### D-3: `log_metric` performs no `kind='project'` check on goalId

**What**: `schedule_item` has a hard `kind='project'` guard (correct, per PRD §3.2). None of the other 6 tools (`complete_item`, `update_scheduled_item`, `delete_scheduled_item`, `list_scheduled_items`, `log_metric`, `list_log_entries`) check that the target goal is `kind='project'`.

**Why it matters**: A `log_metric { goalId: <fitnessGoalId>, metric: "mrr", value: 450 }` call would silently create a `LogEntry` row attached to a fitness goal. This pollutes fitness goal data and could cause future `compute_readiness` tools to misread metric history. The tool description says "for project goals only" but there is no enforcement.

**Fix (minimal)**: Add a goal-exists-and-kind check to `log_metric` (and ideally all write project tools). The PRD only explicitly requires the check on `schedule_item` (§3.2), but the spirit of §3.1 ("every tool description states it is for project goals") implies enforcement. At minimum, add to `log_metric`:
```ts
const goal = await prisma.goal.findUnique({ where: { id: input.goalId }, select: { id: true, kind: true } });
if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
if (goal.kind !== "project") throw new Error(`Goal ${input.goalId} is kind='${goal.kind}' — log_metric is for project goals only.`);
```

**Severity**: MEDIUM (data model integrity; not a crash but creates semantically incorrect rows)

---

### D-4: QA runbook B-6 step 6 does not test `update_scheduled_item` with unknown id

**What**: PRD §6 lists "complete_item/update_scheduled_item with unknown id → friendly errorResult" as a required edge case. The QA runbook (§8.6) tests the no-op case and a rename, but has no test for `update_scheduled_item { id: "nonexistent" }`.

**Fix**: Add to step 6:
```sh
curl ... -d '{"jsonrpc":"2.0","id":9b,"method":"tools/call","params":{"name":"update_scheduled_item","arguments":{"id":"nonexistent-id","title":"should fail"}}}'
# Expected: isError=true, "Scheduled item not found: nonexistent-id"
```

Similarly, `complete_item` on an unknown id is also not tested in the runbook (step 5 only tests the happy path). Add parallel error-case coverage.

**Severity**: MEDIUM (B-6 acceptance criteria are incomplete as written)

---

### D-5: Blueprint §2.2 imports block includes `parseDateKey` AND `parseDateInput` from two sources

**What** (related to C-2): The blueprint imports both `parseDateInput` from tool-helpers and `parseDateKey` from calendar. At §9 it acknowledges the latter is unused. But independently, note that `parseDateInput` is the only date-input function `project-tools.ts` needs. The blueprint's own rule 17 in requirements.md convention checklist says "tool-helpers.ts must NOT import from tools.ts" but it can and should export `parseDateInput`. This is fine. The confusion arises only from the contradictory imports block. Fixed by C-2 above.

---

## Suggestions (nice to have)

### S-1: P2002 duck-type — use the available `Prisma.PrismaClientKnownRequestError` class

**What**: Blueprint §D-6 justifies duck-typing `(e as { code?: string }).code === "P2002"` because "import path may shift across Prisma 7 minor versions."

**Actual code**: `src/generated/prisma/internal/prismaNamespace.ts` explicitly exports:
```ts
export const PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
```

This is re-exported through the `Prisma` namespace in `client.ts`. So `Prisma.PrismaClientKnownRequestError` IS available via the existing import `import { Prisma } from "@/generated/prisma/client"` — no new import needed, no version fragility.

**Suggested change** (eliminates theoretical false-positive from any non-Prisma error with a `.code` property):
```ts
if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
```

**Severity**: LOW (duck-type is safe in this single-ORM codebase; this is a robustness polish)

---

### S-2: `update_scheduled_item` Prisma update should use `select` clause

**What**: The `complete_item` handler correctly uses `select: { id, status, completedAt }` on the update. The `update_scheduled_item` handler fetches the full row (including `payload: Json?`) with no `select`, then mirrors only the changed fields. The full-row fetch includes the potentially large `payload` Json field unnecessarily.

**Fix**: Add `select` to the update call scoped to `{ id, title, detail, date, status, type, updatedAt }`.

**Severity**: LOW (performance, not correctness)

---

### S-3: `list_log_entries` date serialization inconsistency is documented but worth an extra tool description note

**What**: `ScheduledItem.date` returns `yyyy-mm-dd` via `toDateKey()`; `LogEntry.date` returns ISO via `.toISOString()`. The decision is justified in D-1 of the blueprint. But claude.ai's AI needs to know this distinction to avoid confusing the two date formats when comparing scheduled items to log entries.

**Fix**: Add a brief note to `list_log_entries` description: "Note: date field is returned as an ISO string (not yyyy-mm-dd) — LogEntry.date is an instant, not a calendar date."

**Severity**: LOW (AI routing polish)

---

### S-4: `update_scheduled_item` no-op check runs before `findUnique`, giving no "id not found" feedback on pure no-ops

**What**: Blueprint D-4 (design decision): "early return before the findUnique call, so zero DB round-trips on a pure no-op." This means `update_scheduled_item { id: "nonexistent" }` returns `"Nothing to update"` instead of `"Scheduled item not found"`.

**Why it could matter**: claude.ai may pass a stale/wrong id with no other fields (e.g., a copy-paste error) and get a misleading "Nothing to update" success response.

**Suggested fix**: Flip the order — do `findUnique` first, then check no-op:
```ts
const item = await prisma.scheduledItem.findUnique({ where: { id }, select: { id: true } });
if (!item) throw new Error(`Scheduled item not found: ${id}`);
if (title === undefined && detail === undefined && date === undefined && status === undefined && type === undefined) {
  return { message: "Nothing to update — provide at least one field." };
}
```

This costs one extra DB round-trip for no-op calls (acceptable) and gives correct "not found" feedback when the id is stale.

**Severity**: LOW (UX quality)

---

## Missing Requirements

### M-1: `complete_item` and `update_scheduled_item` error cases not in B-6 runbook

The runbook smoke steps don't test `complete_item { id: "nonexistent" }` or `update_scheduled_item { id: "nonexistent", title: "x" }`. These are PRD §6 required edge cases. The QA agent must add these.

### M-2: `list_scheduled_items` + `list_log_entries` goal-not-found after cascade

After `delete_goal` (step 10), calling `list_scheduled_items { goalId }` should return "Goal not found." The runbook includes this (step 10 `list_scheduled_items` post-delete check). But `list_log_entries { goalId }` post-delete is not verified. Add a parallel check.

### M-3: `externalRef` collision test not in B-6 runbook

PRD §6 requires a friendly error for `@@unique([goalId, externalRef])` violations. The QA runbook has no curl test for this. Add:
```sh
curl ... schedule_item { goalId, date, type: "task", title: "dup1", externalRef: "ext-1" } → ok
curl ... schedule_item { goalId, date, type: "task", title: "dup2", externalRef: "ext-1" } → isError=true, "Duplicate externalRef..."
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `complete_item` description routes to `delete_workout/delete_hike` — AI deletes fitness workouts | High (if ever triggered) | Critical | Fix description to `log_workout/log_hike` (C-1) |
| `parseDateKey` unused import fails lint gate | Certain (if §2.2 followed verbatim) | Medium | Remove from imports block (C-2) |
| `update_scheduled_item` plain-object data type fails tsc XOR resolution | Medium | High | Use `Prisma.ScheduledItemUpdateInput` (D-1) |
| `delete_scheduled_item` double-delete surfaces raw P2025 instead of friendly error | Low (single-user) | Medium | Add P2025 catch (D-2) |
| `log_metric` silently writes to fitness goal | Medium (AI routing occasionally fails) | Low | Add kind check (D-3) |
| Git merge conflict between Dev A and Dev B | Low (disjoint regions) | High | Blueprint rebase instruction sufficient |
| QA isFocus flip leaves DB in wrong state | Low | High | Blueprint step 8 RESTORE is sequential (safe) |
| `decodeArgsDeep` mangles legitimate `\uXXXX` in payload | Near-zero (JSON-parsed payload has real chars, not escape sequences) | Low | No action needed |
| `new Date(isoNoZ)` timezone trap (e.g. `complete_item completedAt: "2026-06-15T10:00:00"`) | Low | Medium | Pre-existing behavior; AI should pass ISO-Z or bare dates |
| Prisma `ScheduledItemWhereInput` / `ScheduledItemUpdateInput` unavailable | None — confirmed present in `src/generated/prisma/internal/prismaNamespace.ts` via `export type * from '../models'` | — | — |

---

## Dimensions Checked

1. **Completeness**: All 7 tools per REQ-001..004 are addressed with correct return shapes matching PRD §4.2. REQ-005 (`todayItems`) is correctly guarded. One gap: B-6 runbook misses `complete_item` and `update_scheduled_item` error-case tests (M-1).

2. **Helper extraction safety**: `tool-helpers.ts` imports only `parseDateKey` from `@/lib/calendar` — confirmed no circular dep risk. Both route handlers (`route.ts` and `[token]/route.ts`) import only `{ registerAll, MCP_SERVER_VERSION }` from `tools.ts` — confirmed by direct code read. The helper extraction swap is safe for both.

3. **USER_TZ traps**: All date inputs correctly go through `parseDateInput` → `parseDateKey` (bare dates) or `new Date()` (ISO strings). `startOfDay`/`endOfDay` wrappers on list filters are correct — not redundant (they normalize full ISO inputs to day boundaries). `todayItems` query uses `startOfDay(now)` / `endOfDay(now)` with `now` hoisted before `Promise.all` (D-8 is correctly addressed). `completedAt` default is `new Date()` (instant, not midnight) — correct per PRD §4.5.

4. **Fitness regression in `get_today_plan`**: Guard `if (activeGoalRow?.kind === "project")` correctly returns `todayItems: []` for null `activeGoalRow` and for `kind='fitness'`. No query issued for non-project goals. The `{ ...r, standingRules, focusGoal: activeGoal, activeGoal, todayItems }` return preserves all existing fields. Zero regression risk for fitness path.

5. **decodeArgsDeep coverage**: Patch mutates `server.registerTool` on the instance *before* any `register*` call — confirmed at L486–507. `registerProjectTools(server)` placed after `registerWriteTools(server)` (still inside `registerAll()` body) is fully covered. No double-decode risk: JSON-parsed payload values are real Unicode characters, not escape sequences.

6. **Zod v4 nuances**: Plain-shape `inputSchema` pattern confirmed throughout codebase. `.default()` on enums (`z.enum(...).default("manual")`) follows the same pattern as `z.number().int().default(50)` used in existing limit fields — confirmed to work with MCP SDK. `z.unknown()` is the established pattern for `Json?` fields (confirmed at L120 `workoutJson: z.unknown().nullish()` and L2733 `snapshotJson: z.unknown()`).

7. **Prisma errors**: `@@unique([goalId, externalRef])` only fires for non-null `externalRef` values (Postgres NULL ≠ NULL semantics) — correctly noted in blueprint D-7. The P2002 duck-type will only fire when `input.externalRef` is provided and collides. `delete_scheduled_item` double-delete gap identified (D-2 above).

8. **Merge-conflict reality**: Dev A and Dev B edit disjoint regions of `tools.ts`. Dev A modifies L196–222 and ~L507; Dev B modifies L562–594. After Dev A's -26 net line change, Dev B's region shifts to ~L536–568 — git 3-way merge handles this as non-overlapping hunks. Blueprint's rebase instruction ("Dev B rebases after Dev A lands") is actionable and sufficient for the orchestrator.

9. **Naming/routing confusion**: `complete_item` and `schedule_item` descriptions correctly include "do NOT use for workouts" language. C-1 above fixes the wrong redirect. No ambiguity between `log_metric` and `log_measurement` (different models, clear descriptions).

10. **Type safety**: `Prisma.InputJsonValue` cast for `payload` fields is the established pattern. `Prisma.ScheduledItemWhereInput` and `Prisma.LogEntryWhereInput` are confirmed available in generated types. Issue D-1 flags the `update_scheduled_item` data object typing pattern.

11. **Complexity/over-engineering**: The architecture is appropriately lean. No over-engineering detected. The goal-exists check before list operations adds one extra round-trip but is required for the PRD's friendly-error contract.

12. **QA runbook**: isFocus flip/restore scripts are sequential (restore always runs after flip+curl). `require('./src/generated/prisma/client')` in tsx inline scripts: package.json has no `"type": "module"`, and tsx's esbuild transform handles the ESM-to-CJS bridge for the generated Prisma client (`import.meta.url` shimmed by tsx). Script is safe. `delete_goal` cascade confirmed at L4386–4403 — counts both `scheduledItems` and `logEntries` before deleting; onDelete: Cascade confirmed in schema.prisma L213, L232. Missing runbook tests noted in M-1, M-2, M-3.

---

## Verdict — NEEDS REVISION

Fix the following before handing to dev agents:

1. **C-1** (CRITICAL): Change `complete_item` description from `"use delete_workout or delete_hike"` to `"use log_workout or log_hike"` — wrong tools referenced, will route AI to delete fitness records instead of logging them.

2. **C-2** (CRITICAL): Remove `parseDateKey` from the §2.2 project-tools.ts imports block — it is unused in the file and will fail `npm run lint`. The lint gate is an explicit acceptance criterion.

3. **D-1** (HIGH): Change `update_scheduled_item` data variable type to `Prisma.ScheduledItemUpdateInput` — follows the established pattern at L327 and L3570, avoids fragile XOR resolution.

4. **D-2** (HIGH): Add P2025 catch to `delete_scheduled_item` delete call to meet PRD §6's friendly double-delete requirement (the `findUnique`→`delete` two-phase approach leaves a TOCTOU window that surfaces a raw Prisma error on rapid double-call).

Issues D-3 through M-3 should be fixed before sprint close but do not block coding from starting after C-1, C-2, D-1, D-2 are resolved.
