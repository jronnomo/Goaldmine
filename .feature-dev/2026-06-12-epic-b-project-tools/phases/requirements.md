# Requirements — Epic B: Project MCP Tool Pack

Source of truth: `docs/prds/PRD-epic-b-project-tools.md` + roadmap issues #24–#29 (ACs normative, verbatim).

---

## REQ-001 — Helpers extraction + registerProjectTools scaffold + schedule_item + delete_scheduled_item
**Issue:** #24 (B-1) · **Complexity:** M · **Depends:** —

Extract `safe`, `jsonResult`, `errorResult`, `parseDateInput` from `src/lib/mcp/tools.ts` into new `src/lib/mcp/tool-helpers.ts`; `tools.ts` imports them (zero behavior change). Create `src/lib/mcp/tools/project-tools.ts` exporting `registerProjectTools(server: McpServer): void`; `registerAll()` in `tools.ts` imports and calls it **after** `registerWriteTools(server)` (inside decodeArgsDeep patch scope — the patch wraps `server.registerTool` before register* calls; verify and document). Implement `schedule_item` and `delete_scheduled_item` per PRD §4.2.

**Files:** `src/lib/mcp/tool-helpers.ts` (new), `src/lib/mcp/tools/project-tools.ts` (new), `src/lib/mcp/tools.ts` (helper imports + registerAll call)

**Acceptance:** issue #24 ACs verbatim, plus: helper extraction introduces no circular import (`tool-helpers.ts` must not import from `tools.ts`); goal-exists + project-kind check on schedule_item (PRD §3.2.2, §6); `payload` via `z.unknown()`; `externalRef` unique-collision → friendly error.

## REQ-002 — complete_item + update_scheduled_item
**Issue:** #25 (B-2) · **Complexity:** S · **Depends:** REQ-001

PATCH semantics; `completedAt` default `new Date()`; `yyyy-mm-dd` inputs through `parseDateInput`→`startOfDay`; unknown id → friendly error; `{id}`-only update → friendly "nothing to update" message, no write.

**Files:** `src/lib/mcp/tools/project-tools.ts`
**Acceptance:** issue #25 ACs verbatim + PRD §6 rows.

## REQ-003 — list_scheduled_items
**Issue:** #26 (B-3) · **Complexity:** S · **Depends:** REQ-001

Filters goalId(required)/from/to/status/type/limit(1..200 def 50); from/to via `parseDateInput`→`startOfDay`/`endOfDay`; order date desc; nonexistent goal → friendly error.

**Files:** `src/lib/mcp/tools/project-tools.ts`
**Acceptance:** issue #26 ACs verbatim.

## REQ-004 — log_metric + list_log_entries
**Issue:** #27 (B-4) · **Complexity:** M · **Depends:** REQ-001

LogEntry create/query. Bare metric keys (no `log:` prefix). value-and/or-text required. `date` default = now instant; bare date → USER_TZ midnight. `source` enum manual|github|claude default manual. list: metric/from/to/limit(1..500 def 50) filters, date desc.

**Files:** `src/lib/mcp/tools/project-tools.ts`
**Acceptance:** issue #27 ACs verbatim.

## REQ-005 — get_today_plan todayItems branch
**Issue:** #28 (B-5) · **Complexity:** S · **Depends:** REQ-001 (only for merge timing; code is independent)

In the `get_today_plan` handler (src/lib/mcp/tools.ts ~L550–595): after `activeGoalRow` resolution, if `kind === 'project'` query today's ScheduledItems (gte startOfDay / lte endOfDay, order asc) and map to `{ id, type, title, status, completedAt }[]`; else `todayItems: []` with **no query**. Do NOT touch `resolveDay`. Do NOT alter any existing field.

**Files:** `src/lib/mcp/tools.ts` (get_today_plan handler only)
**Acceptance:** issue #28 ACs verbatim; fitness output byte-identical except added `todayItems: []`.

## REQ-006 — Epic B integration smoke + Sprint 2 QA gate (QA-only)
**Issue:** #29 (B-6) · **Complexity:** S · **Depends:** REQ-001..005

No code. Execute PRD §10.2 runbook end-to-end against local dev server; document commands + outputs as the runbook artifact; verify the 7 tools in tools/list; fitness regression check; test goal create→smoke→**delete** + fitness goal restored as focus.

**Files:** `.feature-dev/2026-06-12-epic-b-project-tools/phases/qa-runbook.md` (artifact)
**Acceptance:** issue #29 ACs verbatim (connector-reload item happens post-merge, user-facing reminder).
