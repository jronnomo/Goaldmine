# Completion Report — Cold-Start Ergonomics

**Date:** 2026-06-03 · **Status:** Complete · **Branch:** main (committed; push pending user OK) · **Iterations:** 2

## What was built

Four coordinated MCP improvements driven by coach-side cold-start feedback. Backend/MCP only — no UI, no LLM calls.

| # | Feature | Result |
|---|---------|--------|
| #4 | De-dupe standing rules | `recent_history` now returns only `journal/audible/feedback`; standing-rule full bodies live only in `get_today_plan` |
| #2 | PR-in-return | `log_workout` returns `recordsSet[]` — verified: brand-new exercise → `[]`, beat → `{kind:rm,value:140,prior:116.67}` |
| #3 | open_items + reviews | `log_open_item`/`resolve_open_item`/`list_open_items` (priority+targetDate+overdue), `log_review` + `get_latest_review`; `review` added to note enum |
| #1 | get_session_brief | One-call cold-start: today, goal+daysToGo, plan week/phase, last 5 completed sessions, weight trend, standing-rule headers, latest review, open items |

## Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `Note.priority String?` (nullable) + type comment |
| `prisma/migrations/20260603130209_note_priority/migration.sql` | `ALTER TABLE "Note" ADD COLUMN "priority" TEXT;` (applied to Neon) |
| `src/lib/records.ts` | export `bestSetSummary`; add `RecordSet` type + `recordsSetInWorkout()` |
| `src/lib/mcp/tools.ts` | `ACTIVITY_NOTE_TYPES`, `NoteTypeShape += review`, `fetchOpenItems`/`noteHeader` helpers, 6 new tools, `recent_history` filter, `log_workout` return, descriptions on `log_note`/`update_note`/`delete_note`/`promote_note`/`batch_log_note` |
| `CLAUDE.md` | Tool inventory updated |

## Requirements — all DONE

REQ-001 (migration) · REQ-002 (recent_history filter) · REQ-003 (recordsSet) · REQ-004 (open_items) · REQ-005 (review) · REQ-006 (get_session_brief) · REQ-007 (docs).

## Iterations

1. Initial implementation — all gates green in worktree.
2. **Live-smoke fix:** `get_session_brief.recentSessions` was returning future *planned* hikes (no status/date filter) instead of completed sessions. Added `status:"completed"` + date/startedAt-≤-now filters to both queries. (This bug was invisible to static review — only the live curl against real data surfaced it.)

## Agent utilization

Research (Sonnet) → Architect (Sonnet) → Devil's Advocate (Sonnet, NEEDS REVISION → 3 medium fixes folded in) → Developer (Sonnet, worktree) → Fix (Sonnet, iteration 2). Orchestrator (Opus) ran all gates + live MCP smoke personally.

## Verification

- `npx tsc --noEmit` → 0 errors · `eslint` (changed files) → 0 · `npm run build` → success
- Migration: additive nullable, applied to Neon, existing rows unaffected
- Live MCP curl smoke (all write tests cleaned up — no test rows left in prod): tools/list (6 new), get_session_brief (full shape + null-safe + recentSessions fixed), open_item round-trip (overdue/priority/sort/resolve/bad-id), review round-trip (weekOf + recent_history exclusion), PR detection (positive + negative), recent_history exclusion, get_today_plan full bodies retained.

## Follow-up (out of scope, noted)

- One-time backfill of existing Sunday-review prose → structured `review` + `open_item` objects (manual).
- `resolve_open_item` on a non-existent id returns a raw Prisma error (functional, `isError:true`) rather than the friendly type-mismatch message (which fires for wrong-type *existing* notes). Cosmetic.
- **Deploy:** push to main → Vercel redeploy is what exposes the new tools to claude.ai; the user must then reload the MCP connector.
