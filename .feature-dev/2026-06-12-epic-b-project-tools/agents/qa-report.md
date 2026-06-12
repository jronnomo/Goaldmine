# QA Report — Epic B: Project MCP Tool Pack

**Author**: QA Agent  
**Date**: 2026-06-12  
**HEAD**: 7de063d  
**Files reviewed**: `src/lib/mcp/tool-helpers.ts` (new), `src/lib/mcp/tools/project-tools.ts` (new), `src/lib/mcp/tools.ts` (modified)  
**Blueprint**: `architecture-blueprint-v2.md` (normative)

---

## 1. Requirements Status

| REQ | Title | Status | Notes |
|-----|-------|--------|-------|
| REQ-001 | Helpers extraction + scaffold + schedule_item + delete_scheduled_item | PASS | All four helpers extracted verbatim; tools.ts imports `{ safe, parseDateInput }` (jsonResult/errorResult unused — lint-correct deviation accepted by merge log); registerProjectTools called after registerWriteTools inside decodeArgsDeep patch scope; schedule_item and delete_scheduled_item implement all ACs including goal-exists, kind='project' block, P2002 externalRef guard, P2025 catch on delete |
| REQ-002 | complete_item + update_scheduled_item | PASS | completedAt defaults to `new Date()` (instant, not midnight); parseDateInput used for bare-date input; P2025 catch on both; update_scheduled_item has findUnique-first (S-4), no-op guard, Prisma.ScheduledItemUpdateInput typed data object (D-1), select clause (S-2), P2025 on update; PATCH return semantics correct |
| REQ-003 | list_scheduled_items | PASS | All filters present (goalId/from/to/status/type/limit 1..200 default 50); from→startOfDay, to→endOfDay via parseDateInput; date desc order; goal-not-found error; full select (id/goalId/date/type/title/detail/status/completedAt/externalRef/createdAt); date serialized as yyyy-mm-dd via toDateKey() |
| REQ-004 | log_metric + list_log_entries | PASS | value-or-text guard fires before any DB call; kind='project' check (D-3 fix); date defaults to `new Date()` instant; source enum default 'manual'; list_log_entries has goal-not-found guard, metric/from/to/limit 1..500 default 50; date returned as ISO per PRD §4.2; S-3 description note present |
| REQ-005 | get_today_plan todayItems branch | PASS | `const now` hoisted before Promise.all; resolveDay(now) uses same instant as startOfDay(now)/endOfDay(now) for today range; ScheduledItem query only runs when `activeGoalRow?.kind === 'project'`; else `todayItems = []` with no query; todayItems select is minimal (id/type/title/status/completedAt); completedAt serialized as `.toISOString() ?? null`; return gains `todayItems` — no other field touched; description sentence added |

### Acceptance Criteria Detail

**REQ-001 ACs**:
- [x] tool-helpers.ts does NOT import from tools.ts (imports only `@/lib/calendar`)
- [x] schedule_item: goal-exists check throws friendly "Goal not found: <id>"
- [x] schedule_item: kind check throws friendly error naming log_workout/log_hike/log_baseline/log_measurement
- [x] schedule_item: payload via z.unknown().optional()
- [x] schedule_item: externalRef P2002 → friendly "Duplicate externalRef" error
- [x] delete_scheduled_item: P2025 catch → friendly "Scheduled item not found: <id>"
- [x] registerProjectTools called after registerWriteTools (line 483), inside decodeArgsDeep scope (patch applied lines 467–479)

**REQ-002 ACs**:
- [x] complete_item: completedAt default = new Date() (current instant, not midnight)
- [x] complete_item: completedAt string input → parseDateInput (bare date → USER_TZ midnight)
- [x] complete_item: unknown id → friendly "Scheduled item not found"
- [x] update_scheduled_item: findUnique before no-op (S-4)
- [x] update_scheduled_item: no-op → "Nothing to update — provide at least one field..."
- [x] update_scheduled_item: P2025 on update catches TOCTOU race
- [x] update_scheduled_item: select clause on update (S-2)
- [x] update_scheduled_item: date field → parseDateInput → toDateKey on return

**REQ-003 ACs**:
- [x] limit 1..200 default 50 (Zod .int().min(1).max(200).default(50))
- [x] nonexistent goalId → friendly "Goal not found: <id>"
- [x] from → startOfDay(parseDateInput(from)); to → endOfDay(parseDateInput(to))
- [x] date ordered desc, take limit

**REQ-004 ACs**:
- [x] value/text guard before DB call (throws before prisma.goal.findUnique)
- [x] goal kind check (D-3): fitness goalId → friendly redirect to log_measurement/log_baseline
- [x] metric stored bare (no 'log:' prefix — field is passed through directly)
- [x] date default = new Date() instant
- [x] source enum default 'manual'
- [x] list_log_entries date desc, limit 1..500 default 50

**REQ-005 ACs**:
- [x] todayItems: [] returned with no DB query when fitness goal or no focus goal
- [x] todayItems populated when kind='project': gte startOfDay(now), lte endOfDay(now)
- [x] todayItems order: date asc (per blueprint spec)
- [x] fitness fields unaltered (spread `...r` unchanged)
- [x] description addition present at get_today_plan description lines 537–539

---

## 2. USER_TZ Audit

**Grep command**: `grep -n "setHours|setDate|getHours|getDate(|getMonth(|getFullYear" tool-helpers.ts tools/project-tools.ts tools.ts`  
**Result**: Zero matches in all three changed files.

| Check | Result |
|-------|--------|
| Raw `setHours`/`setDate`/`getHours`/`getDate`/`getMonth`/`getFullYear` in changed files | PASS — zero occurrences |
| Date-string inputs flow through `parseDateInput` | PASS — all date inputs in project-tools.ts pass through `parseDateInput(input.date/from/to/completedAt)` |
| Range filters via startOfDay/endOfDay | PASS — list_scheduled_items and list_log_entries use `startOfDay(parseDateInput(input.from))` / `endOfDay(parseDateInput(input.to))` |
| complete_item default = `new Date()` instant | PASS — `const completedAt = input.completedAt ? parseDateInput(input.completedAt) : new Date()` |
| log_metric default = `new Date()` instant | PASS — `const date = input.date ? parseDateInput(input.date) : new Date()` |
| ScheduledItem.date serialized via `toDateKey()` (yyyy-mm-dd) | PASS — all schedule_item, list_scheduled_items, update_scheduled_item returns use `toDateKey(item.date)` |
| ScheduledItem.completedAt serialized via `.toISOString()` | PASS — `item.completedAt?.toISOString() ?? null` in all contexts |
| LogEntry.date serialized via `.toISOString()` | PASS — `entry.date.toISOString()` in log_metric and list_log_entries |
| todayItems.completedAt serialized via `.toISOString() ?? null` | PASS — `row.completedAt?.toISOString() ?? null` in get_today_plan handler |
| const now hoisted before Promise.all in get_today_plan | PASS — line 543: `const now = new Date()` before `Promise.all([resolveDay(now), ...])` |

---

## 3. Helper-Extraction Regression Audit

| Check | Result |
|-------|--------|
| `jsonResult` NOT defined in tools.ts | PASS — removed; no local definition found |
| `errorResult` NOT defined in tools.ts | PASS — removed; no local definition found |
| `safe` NOT defined in tools.ts | PASS — removed; no local definition found |
| `parseDateInput` NOT defined in tools.ts | PASS — removed; no local definition found |
| tools.ts import is `{ safe, parseDateInput }` from "@/lib/mcp/tool-helpers" | PASS — line 197; jsonResult/errorResult not imported (unused in tools.ts after extraction — lint-correct, accepted deviation in merge log) |
| `parseDateKey` import in tools.ts KEPT | PASS — line 26; used at lines 219, 408, 613, 932, 1701, 2904, 2914, 3090, 3216 and more — still required by existing tools |
| No other file imports helpers from "@/lib/mcp/tools" | PASS — only `route.ts` and `[token]/route.ts` import from "@/lib/mcp/tools" and they import `{ registerAll, MCP_SERVER_VERSION }` only |
| tool-helpers.ts does NOT import from tools.ts | PASS — only import is `import { parseDateKey } from "@/lib/calendar"` |
| No circular import chain | PASS — tool-helpers.ts → @/lib/calendar only; project-tools.ts → tool-helpers.ts + @/lib/db + @/lib/calendar + zod + prisma |

**Accepted deviation** (merge log item 1): tools.ts imports only `{ safe, parseDateInput }` instead of all four helpers. `jsonResult` and `errorResult` are not used directly in tools.ts — they are only used inside `safe()` within `tool-helpers.ts`. This is correct and lint-clean.

**Style note** (merge log item 2): The helper import sits mid-file at line 197 (the old definition site) rather than the top import block at lines 4–87. Harmless (imports hoist in ES modules); revisit only if another iteration touches the file.

---

## 4. get_today_plan Regression Audit

Inspection of lines 525–599 (get_today_plan handler in registerReadTools):

| Change | Expected | Actual | Result |
|--------|----------|--------|--------|
| Description addition | One sentence about todayItems appended to existing description | Lines 537–539 — added sentence present | PASS |
| `const now = new Date()` hoist | Before Promise.all | Line 543 — `const now = new Date()` before `Promise.all([resolveDay(now), ...])` | PASS |
| `resolveDay(now)` | now used, not `new Date()` inline | Line 545 — `resolveDay(now)` | PASS |
| todayItems block inserted after activeGoal const | After line that sets `activeGoal` const | Lines 573–596 — inserted after activeGoal block (lines 565–572) | PASS |
| todayItems query condition | Only when `activeGoalRow?.kind === 'project'` | Line 580 — `if (activeGoalRow?.kind === 'project')` | PASS |
| ScheduledItem query for fitness goals | No query | `else` path omitted — `todayItems` stays `[]` by initialization | PASS |
| todayItems select | `{ id, type, title, status, completedAt }` only | Line 587 — exact match | PASS |
| todayItems order | `date asc` | Line 586 — `orderBy: { date: "asc" }` | PASS |
| Return field added | `todayItems` added to existing spread | Line 597 — `return { ...r, standingRules, focusGoal: activeGoal, activeGoal, todayItems }` | PASS |
| No fitness fields altered | `...r`, `standingRules`, `focusGoal`, `activeGoal` unchanged | Lines 544–572 — unchanged from pre-Epic-B; no other lines modified | PASS |
| `resolveDay` untouched | resolveDay call unchanged | Line 545 — `resolveDay(now)` — only change is `new Date()` → `now` hoisted variable (same instant) | PASS |

**Zero regression risk**: The only structural change to the fitness path is hoisting `now` (same instant); adding `todayItems = []` (no write, no query); and appending `todayItems` to the return spread (additive). The fitness goal handler branch executes zero new DB calls.

---

## 5. MCP Tool Surface Audit

| Tool | `safe()` wrapper | Zod `.describe()` on every field | `parseDateInput` for date inputs | Friendly errors | Return shape matches PRD §4.2 |
|------|-----------------|----------------------------------|----------------------------------|-----------------|-------------------------------|
| `schedule_item` | PASS | PASS (goalId, date, type, title, detail, payload, externalRef) | PASS (input.date) | PASS (Goal not found; kind check; P2002 externalRef) | PASS ({ id, goalId, date(yyyy-mm-dd), type, title, status:'planned', message }) |
| `delete_scheduled_item` | PASS | PASS (id) | N/A (no date input) | PASS (P2025 → "Scheduled item not found") | PASS ({ id, deleted:true, message }) |
| `complete_item` | PASS | PASS (id, completedAt) | PASS (completedAt optional string) | PASS (P2025 → "Scheduled item not found") | PASS ({ id, status:'done', completedAt(ISO), message }) |
| `update_scheduled_item` | PASS | PASS (id, title, detail, date, status, type) | PASS (fields.date) | PASS (findUnique→not found; P2025 on update; no-op message) | PASS ({ id, ...updatedFields, message }) |
| `list_scheduled_items` | PASS | PASS (goalId, from, to, status, type, limit) | PASS (from, to) | PASS (Goal not found) | PASS ({ count, items: [{id,goalId,date(yyyy-mm-dd),type,title,detail,status,completedAt,externalRef,createdAt}] }) |
| `log_metric` | PASS | PASS (goalId, metric, value, text, date, source) | PASS (input.date optional) | PASS (value+text omitted; Goal not found; kind check) | PASS ({ id, goalId, metric, value, text, date(ISO), source, message }) |
| `list_log_entries` | PASS | PASS (goalId, metric, from, to, limit) | PASS (from, to) | PASS (Goal not found) | PASS ({ count, entries: [{id,goalId,date(ISO),metric,value,text,source,createdAt}] }) |

All 7 tools: project-only scope stated in description; fitness tools (log_workout, log_hike, log_baseline, log_measurement or delete_workout, delete_hike as appropriate) cited as redirects; no tool suggests delete_workout/delete_hike as a substitute for completing a fitness activity.

---

## 6. Code Quality Issues

**1. MINOR — Missing `select` clause on `prisma.scheduledItem.create` in `schedule_item`**  
File: `src/lib/mcp/tools/project-tools.ts:94`  
Issue: The `create` call fetches the full ScheduledItem row (including `payload` Json field which may be large); only 6 fields are used in the response (`id`, `goalId`, `date`, `type`, `title`, `status`). Adding `select: { id, goalId, date, type, title, status }` would avoid transferring the `payload` column for large payloads.  
Severity: Low — no correctness impact; only relevant for large `payload` values.  
Fix: Add `select: { id: true, goalId: true, date: true, type: true, title: true, status: true }` to the create call.

**2. MINOR — Missing `select` clause on `prisma.logEntry.create` in `log_metric`**  
File: `src/lib/mcp/tools/project-tools.ts:513`  
Issue: The `create` call fetches the full LogEntry row including `payload` (if any). Only 7 fields are used in the response (`id`, `goalId`, `metric`, `value`, `text`, `date`, `source`). A select clause would be more precise.  
Severity: Low — no correctness impact; no large payload being written in the current tool, but defensive hygiene.  
Fix: Add `select: { id: true, goalId: true, metric: true, value: true, text: true, date: true, source: true }` to the create call.

**3. INFORMATIONAL — `Prisma.InputJsonValue` cast for payload field (blessed by blueprint)**  
File: `src/lib/mcp/tools/project-tools.ts:103`  
Pattern: `input.payload as Prisma.InputJsonValue` — duck-typed cast for `z.unknown()` → Prisma `Json?` column.  
Status: Explicitly blessed in blueprint §2.2. Not a defect.

**4. INFORMATIONAL — Helper import sits mid-file (L197) rather than top import block**  
File: `src/lib/mcp/tools.ts:197`  
Status: Accepted deviation from merge log item 2. Harmless (imports hoist in ES modules). Revisit only if another iteration touches the file.

**5. INFORMATIONAL — `(e as { code?: string }).code` duck-type P2002/P2025 catch**  
Files: `src/lib/mcp/tools/project-tools.ts:111, 155, 211, 313`  
Status: Explicitly blessed by blueprint §7 D-6 as the established project pattern. Not a defect.

---

## 7. Edge-Case Coverage

| Scenario | PRD §6 Requirement | Implemented | Status |
|----------|--------------------|-------------|--------|
| schedule_item nonexistent goalId | "Goal not found" friendly error | `throw new Error(\`Goal not found: ${input.goalId}\`)` inside safe() | PASS |
| schedule_item against fitness goal | Friendly error directing to fitness tools | Kind check + `throw new Error(...)` naming log_workout/log_hike/log_baseline/log_measurement | PASS |
| delete_scheduled_item twice on same id | 2nd call → friendly errorResult, not P2025 throw | P2025 caught → `throw new Error(\`Scheduled item not found: ${input.id}\`)` | PASS |
| complete_item unknown id | Friendly errorResult | P2025 caught → "Scheduled item not found: <id>" | PASS |
| update_scheduled_item unknown id | Friendly errorResult | findUnique returns null → "Scheduled item not found: <id>" | PASS |
| log_metric neither value nor text | "Provide value and/or text" errorResult | Pre-DB guard: `if (input.value === undefined && input.text === undefined)` | PASS |
| update_scheduled_item {id} only | Friendly "nothing to update" no-write | No-op guard after findUnique, returns "Nothing to update — provide at least one field..." | PASS |
| Bare yyyy-mm-dd dates | USER_TZ midnight via parseDateInput | All date string inputs → parseDateInput; parseDateInput uses parseDateKey for bare dates | PASS |
| externalRef collision | Friendly error naming conflict | P2002 caught → "Duplicate externalRef \"...\" already exists on goal ..." | PASS |
| Fitness goal active in get_today_plan | todayItems:[], zero ScheduledItem query | `if (activeGoalRow?.kind === 'project')` — else branch is implicit; todayItems stays [] | PASS |
| limit outside bounds | Zod clamps via min/max → MCP-level validation | z.number().int().min(1).max(200)/.max(500) — Zod rejects before handler | PASS |
| log_metric with fitness goalId | Friendly redirect error | kind check added per D-3 fix | PASS |
| externalRef = null (no collision) | Multiple items succeed | Postgres NULL!=NULL semantics; P2002 guard only fires for non-null externalRef | PASS (documented in code comment) |

**One edge case NOT covered by the implementation but considered acceptable by design (D-12)**:  
`list_scheduled_items` and `list_log_entries` do not check `kind='project'` on the goal — a wrong-kind goalId produces empty results (not an error). This is a reads-only safety decision: empty results are not data corruption; the PRD §6 table does not require a kind check on read tools. INFORMATIONAL.

---

## 8. Overall Verdict

**SHIP IT**

All 5 requirements (REQ-001..005) pass all acceptance criteria. No bugs found. Two minor quality nits (missing select on create calls) do not affect correctness, only marginal efficiency. The helper extraction is clean, the USER_TZ discipline is correct throughout, and the get_today_plan regression surface is zero for the fitness path. The decodeArgsDeep monkey-patch correctly covers all project tools. All PRD §6 edge cases are handled with friendly errors.

### Fix Priority List

| # | Severity | Item | File:Line | Recommended Action |
|---|----------|------|-----------|-------------------|
| 1 | Low | Missing select on scheduledItem.create | project-tools.ts:94 | Add select clause to avoid fetching payload on create response. Non-blocking. |
| 2 | Low | Missing select on logEntry.create | project-tools.ts:513 | Add select clause for consistency with list/update patterns. Non-blocking. |

No FAIL or PARTIAL items. No blockers.
