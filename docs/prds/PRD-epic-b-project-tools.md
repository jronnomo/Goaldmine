# PRD: Epic B — Project MCP Tool Pack (chewabl Sprint 2)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-12
**Status**: Approved
**GitHub Issue**: #24–#29 (roadmap stories; closed on ship)
**Branch**: main
**UX-research**: skipped — pure MCP-tool/backend feature, no UI surface.

---

## 1. Overview

### 1.1 Problem Statement
Goaldmine is becoming a multi-domain goal engine; chewgether (vertical #2) is a `kind='project'` goal. Sprint 1 (Epic A) shipped the data spine — `Goal.kind`, `Goal.githubRepo`/`githubProjectNumber`, `ScheduledItem`, `LogEntry` — but **no MCP tools operate on those models**. Claude in claude.ai cannot yet plan, track, or score any non-fitness goal.

### 1.2 Proposed Solution
A 7-tool "project tool pack" in a new module `src/lib/mcp/tools/project-tools.ts`, registered from `registerAll()`:

- **ScheduledItem lifecycle**: `schedule_item`, `complete_item`, `update_scheduled_item`, `delete_scheduled_item`, `list_scheduled_items`
- **LogEntry observations**: `log_metric`, `list_log_entries`
- **Today integration**: `get_today_plan` gains an additive `todayItems` field (today's ScheduledItems when the active goal is `kind='project'`; `[]` for fitness — zero regression).

Shared MCP helpers (`safe`, `jsonResult`, `errorResult`, `parseDateInput`) are extracted from the `tools.ts` monolith into `src/lib/mcp/tool-helpers.ts` so this and future packs (Epic C GitHub pack) can consume them without circular imports.

### 1.3 Success Criteria
- `tools/list` exposes exactly the 7 new tools alongside the existing surface.
- End-to-end via curl: create test project goal → schedule milestone → list (planned) → complete → list (done); log MRR → list entries — all shapes per §4.2.
- `get_today_plan` with fitness goal active is **byte-identical** except `todayItems: []`; with a project goal active, `todayItems` reflects today's rows in USER_TZ.
- tsc/lint/build clean; fitness vertical untouched.

---

## 2. User Stories

| ID     | As... | I want to... | So that... | Priority |
|--------|-------|--------------|------------|----------|
| US-001 | Gabe via Claude (claude.ai) | schedule milestones/tasks/launch-steps for chewgether | project work is plannable on the calendar spine | Must Have |
| US-002 | Gabe via Claude | mark items done, reschedule/rename them | the plan reflects reality as the launch evolves | Must Have |
| US-003 | Gabe via Claude | query "what's planned this sprint / open milestones" | coaching sessions are grounded in real state | Must Have |
| US-004 | Gabe via Claude | log MRR/downloads/milestone counts | readiness scoring (`log:*` metrics) gets real data | Must Have |
| US-005 | Gabe via Claude | see today's project items inside `get_today_plan` | session opens grounded without an extra tool call | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. New module `src/lib/mcp/tools/project-tools.ts` exporting `registerProjectTools(server: McpServer): void`; called in `registerAll()` **after** `registerWriteTools(server)` so the `decodeArgsDeep` monkey-patch covers it (the patch wraps `server.registerTool` before any register* call).
2. The 5 ScheduledItem tools + 2 LogEntry tools per §4.2 exact schemas/shapes.
3. Every tool description states it is for **project / non-fitness goals** and explicitly NOT for workouts/hikes/baselines/measurements (claude.ai routes between tool packs on descriptions).
4. All date inputs go through `parseDateInput` (bare `yyyy-mm-dd` → USER_TZ midnight); range filters via `startOfDay`/`endOfDay`; `complete_item.completedAt` defaults to `new Date()` (current instant).
5. Friendly `errorResult` (never raw Prisma throws) for: nonexistent ids, nonexistent goalId, double-delete, `log_metric` with neither `value` nor `text`.
6. `get_today_plan` response gains `todayItems` (additive); ScheduledItem query issued **only** when active goal `kind === 'project'`; `resolveDay` untouched.

### 3.2 Secondary Requirements
1. Helper extraction to `src/lib/mcp/tool-helpers.ts` (`safe`, `jsonResult`, `errorResult`, `parseDateInput`), re-used by `tools.ts` with no behavior change.
2. `schedule_item` validates the goal exists and (warn-don't-block) is `kind='project'` — scheduling against a fitness goal returns a friendly error directing to fitness tools.

### 3.3 Out of Scope
- GitHub pack tools (#30–34), project UI (#35–40), chewgether seeding (#41–48), fitness convergence (#50).
- No schema changes / migrations (Epic A shipped the models).
- No dashboard rendering of ScheduledItems (Epic D).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
N/A — uses existing `ScheduledItem` and `LogEntry` (prisma/schema.prisma:210–244). No migration.

Relevant semantics: `ScheduledItem.date` DateTime = USER_TZ midnight; `status` ∈ planned|done|skipped; `@@unique([goalId, externalRef])`. `LogEntry.metric` stores the **bare key** (`mrr`, not `log:mrr`).

### 4.2 MCP Tool Surface

| Tool | Purpose | R/W | Notes |
|------|---------|-----|-------|
| `schedule_item` | Create a ScheduledItem | W | goal must exist; project-kind check |
| `delete_scheduled_item` | Hard-delete an item | W | friendly error on missing id |
| `complete_item` | status='done' + completedAt | W | default now; `yyyy-mm-dd` → USER_TZ midnight |
| `update_scheduled_item` | PATCH title/detail/date/status/type | W | only provided fields change |
| `list_scheduled_items` | Query items w/ filters | R | date desc, default limit 50 |
| `log_metric` | Create LogEntry | W | value and/or text required |
| `list_log_entries` | Query LogEntries w/ filters | R | date desc, default limit 50 |

Exact input schemas (Zod, all with `.describe()` annotations):

- `schedule_item`: `{ goalId: string, date: string (yyyy-mm-dd), type: string.min(1) (open enum hint: task|milestone|launch-step|review), title: string.min(1).max(500), detail?: string, payload?: unknown (z.unknown()), externalRef?: string }` → returns `{ id, goalId, date (yyyy-mm-dd), type, title, status: 'planned', message }`
- `delete_scheduled_item`: `{ id: string }` → `{ id, deleted: true, message }`; missing id → errorResult
- `complete_item`: `{ id: string, completedAt?: string }` → `{ id, status: 'done', completedAt (ISO), message }`
- `update_scheduled_item`: `{ id: string, title?, detail?, date? (yyyy-mm-dd), status? ('planned'|'done'|'skipped'), type? }` → `{ id, ...updatedFields, message }`; true PATCH semantics
- `list_scheduled_items`: `{ goalId: string, from?, to? (yyyy-mm-dd), status?: z.enum(['planned','done','skipped']), type?: string, limit?: int 1..200 default 50 }` → `{ count, items: [{ id, goalId, date, type, title, detail, status, completedAt, externalRef, createdAt }] }` ordered date desc; nonexistent goal → errorResult
- `log_metric`: `{ goalId: string, metric: string.min(1) ('mrr','downloads','milestones_done'), value?: number, text?: string, date?: string (default now; bare date → USER_TZ midnight), source?: z.enum(['manual','github','claude']).default('manual') }` → `{ id, goalId, metric, value, text, date (ISO), source, message }`; both value+text omitted → errorResult
- `list_log_entries`: `{ goalId: string, metric?: string, from?, to?: string, limit?: int 1..500 default 50 }` → `{ count, entries: [{ id, goalId, date, metric, value, text, source, createdAt }] }` ordered date desc

Sample curl (pattern for all):
```sh
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"schedule_item","arguments":{"goalId":"<id>","date":"2026-06-15","type":"milestone","title":"Submit to App Store"}}}'
```

`get_today_plan` (modified, additive): response gains `todayItems: { id, type, title, status, completedAt }[]`. Implementation: in the handler (src/lib/mcp/tools.ts ~550–595), after resolving `activeGoalRow`, if `kind === 'project'` run `prisma.scheduledItem.findMany({ where: { goalId, date: { gte: startOfDay(now), lte: endOfDay(now) } }, orderBy: { date: 'asc' } })`; else `todayItems = []` with **no query issued**.

### 4.3 Server Actions
N/A — no UI mutations.

### 4.4 Pages / Components
N/A — no routes/components change.

### 4.5 Date / Time Semantics
- All math via `@/lib/calendar` (`parseDateKey`, `startOfDay`, `endOfDay`); tool date inputs via shared `parseDateInput`.
- `complete_item` no-arg default is the current instant (`new Date()`), NOT midnight.

### 4.6 Override-Awareness
N/A — ScheduledItems are orthogonal to `PlanDayOverride`; `resolveDay` untouched (explicit constraint from #28).

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications
N/A — MCP-only feature (UX-research skip recorded in header). No BottomNav, no screens.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| `schedule_item` with nonexistent goalId | errorResult "Goal not found" |
| `schedule_item` against a fitness goal | errorResult directing to fitness tools (log_workout etc.) |
| `delete_scheduled_item` twice on same id | 2nd call → friendly errorResult, not Prisma P2025 throw |
| `complete_item`/`update_scheduled_item` with unknown id | friendly errorResult |
| `log_metric` with neither value nor text | errorResult "Provide value and/or text" |
| `update_scheduled_item` with only `{id}` | no-op success or friendly "nothing to update" — pick one, document in description (decision: friendly message, no write) |
| Bare `yyyy-mm-dd` dates | USER_TZ midnight via parseDateInput (never UTC midnight) |
| `externalRef` collision (`@@unique([goalId, externalRef])`) | friendly errorResult naming the conflict |
| Fitness goal active in `get_today_plan` | `todayItems: []`, zero ScheduledItem query, otherwise byte-identical output |
| `limit` outside bounds | Zod clamps via schema (min/max) → MCP-level validation error is acceptable |

---

## 7. Security Considerations
- Tools live behind the existing bearer-token gate at `/api/mcp` — no new routes.
- All inputs Zod-validated; `payload` is `z.unknown()` stored to a Json column via Prisma (no execution path).
- No raw SQL; Prisma only. No new env vars.

---

## 8. Acceptance Criteria

The roadmap issues' acceptance criteria are normative, verbatim: **#24 (B-1), #25 (B-2), #26 (B-3), #27 (B-4), #28 (B-5), #29 (B-6)**. Summary gates:

1. [ ] `npx tsc --noEmit` 0 errors; `npm run lint` no new issues; `npm run build` succeeds
2. [ ] `tools/list` includes exactly the 7 new tools with project-goal-scoped descriptions
3. [ ] All §4.2 return shapes verified via curl
4. [ ] All §6 edge cases return friendly errors
5. [ ] `get_today_plan` fitness regression: `todayItems: []`, no other diff
6. [ ] All date handling per §4.5 (grep: no raw `setHours`/`getDate()` outside `@/lib/calendar`)
7. [ ] QA runbook documented (curl commands + expected outputs) in run dir
8. [ ] Test project goal created → smoked → **deleted** (cascade verified); fitness goal restored as focus

---

## 9. Open Questions
None — resolved in discovery (scope: Epic B only; ceremony: main + close issues; test goal: create→smoke→delete).

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
`npx tsc --noEmit` · `npm run lint` · `npm run build` — all clean.

### 10.2 MCP curl smoke (the B-6 runbook)
With `npm run dev` running and `TOKEN` from `.env`:
1. `tools/list` → assert 7 new tool names present.
2. `create_goal` `{ objective: "TEST chewgether smoke", kind: "project" }` → capture goalId.
3. `schedule_item` (milestone, today) → capture itemId; `schedule_item` with bad goalId → friendly error.
4. `list_scheduled_items` `{ goalId, status: 'planned' }` → count ≥ 1.
5. `complete_item { id }` → status done; `list_scheduled_items { status: 'done' }` → item present.
6. `update_scheduled_item { id, title: 'renamed' }` → only title changed.
7. `log_metric { goalId, metric: 'mrr', value: 450 }` ×2 → `list_log_entries { metric: 'mrr' }` → count 2, newest first; `log_metric` with no value/text → friendly error.
8. `set_active_goal` → project goal; `get_today_plan` → `todayItems` contains the item. Switch back to fitness goal → `todayItems: []`.
9. `delete_scheduled_item { id }` → ok; repeat → friendly error.
10. `delete_goal` on test goal → cascade removes remaining items/entries (verify via `list_scheduled_items` error/empty); fitness goal restored as focus; `list_goals` confirms.

### 10.3 Browser smoke
N/A (no UI). Sanity-load `/` once to confirm no regression from helper extraction.

### 10.4 Migration verification
N/A — no migration.

---

## 11. Appendix

### 11.1 Discovery Notes
User chose: Epic B only · main + close issues #24–29 + board → Done · test goal create→smoke→delete (Neon dev DB is prod). UX research skipped (backend-only).

### 11.2 References
- Roadmap issues #24–#29; Epic A PRD: `docs/prds/PRD-sprint-1-data-spine.md`
- Patterns: `src/lib/mcp/tools.ts` — `safe()` ~L209, `jsonResult`/`errorResult` ~L196–207, `parseDateInput` ~L220, `decodeArgsDeep` patch ~L495–504, `get_today_plan` ~L550–595, `create_goal` kind handling ~L3734
- Plan file: `~/.claude/plans/smooth-mixing-garden.md`
