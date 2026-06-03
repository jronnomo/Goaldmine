# Requirements — Cold-Start Ergonomics

PRD: `docs/prds/PRD-cold-start-ergonomics.md`. Build order respects `#3 → #1`. All tool code lives in the single file `src/lib/mcp/tools.ts`, so **one backend developer** owns the implementation to avoid merge conflicts on that file. The PR-diff helper lives in `src/lib/records.ts`; the migration in `prisma/`.

---

## REQ-001 — Schema: `Note.priority` (foundation) — S
**Description:** Add nullable `priority String?` to `Note` in `prisma/schema.prisma`. Create + apply the migration; regenerate the client.
**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_note_priority/`, `src/generated/prisma` (regen).
**Acceptance:** `prisma migrate dev --name note-priority` applies cleanly against Neon; column is nullable; existing rows unaffected; `npx prisma generate` regenerates; `Prisma` types include `priority`.
**Deps:** none. **Must complete before REQ-004, REQ-006.**
⚠ Additive nullable column only. Validate the SQL diff is a single `ADD COLUMN ... NULL` before applying.

## REQ-002 — `recent_history` excludes first-class note types (#4) — S
**Description:** In `recent_history` (`tools.ts:578`), filter the `notes` query to `type IN (journal, audible, feedback)`. Define a module-level `const ACTIVITY_NOTE_TYPES = ["journal","audible","feedback"] as const`. Update the tool description to note that `standing_rule` → `get_today_plan`, `review` → `get_latest_review`, `open_item` → `list_open_items`. Do NOT touch `get_today_plan`'s standing-rule query (full bodies stay).
**Files:** `tools.ts`.
**Acceptance:** `recent_history.notes` returns no `standing_rule`/`review`/`open_item`; `get_today_plan.standingRules` still returns full bodies. AC#11.
**Deps:** none.

## REQ-003 — `log_workout` returns `recordsSet[]` (#2) — M
**Description:** Add a helper to `src/lib/records.ts` — `recordsSetInWorkout(workoutId): Promise<RecordSet[]>` — that, for each exercise in the given workout, compares this session's best (via the same `bestSetSummary` / `primary` logic) against the prior all-time best **excluding `workoutId`**, and returns the exercises where this session strictly beats prior (or is the first-ever with a real metric → treat as NOT a PR per PRD edge case; only count when a prior best exists and is beaten). Each entry: `{ name, equipment, kind: "rm"|"reps"|"duration", value, prior, raw }`. Then in `log_workout` (`tools.ts:1276`), after `create`, call it and return `{ id, message, recordsSet }`.
**Files:** `src/lib/records.ts`, `tools.ts`.
**Acceptance:** AC#7. Re-logging excludes the just-created workout from prior baseline (no false PR). Brand-new exercise with no history → not a PR. Reps-only / duration-only exercises use the correct `primary`.
**Deps:** none (records.ts + tools.ts return only).

## REQ-004 — open_items write+read tools (#3) — M
**Description:** Add `log_open_item` `{ body, targetDate?, priority? }`, `resolve_open_item` `{ id, reason }`, `list_open_items` (no args). open_item = `Note type:"open_item"`. `priority` enum `["high","normal","low"]`, stored in new `priority` column. `targetDate` via `parseDateInput`. `resolve_open_item` errors if the note isn't `open_item`. `list_open_items` returns unresolved, sorted by `targetDate` (nulls last) then `date`, each with `overdue` (targetDate < startOfDay(now)).
**Files:** `tools.ts`.
**Acceptance:** AC#8, AC#9. Round-trip + overdue + due-sort + bad-id error.
**Deps:** REQ-001.

## REQ-005 — review tools + enum (#3) — S
**Description:** Add `review` to `NoteTypeShape` (`tools.ts:63`). Add `log_review` `{ body, weekOf? }` (weekOf → `targetDate` via `parseDateInput`; type `"review"`). Add `get_latest_review` (no args) → `{ review: { body, date, weekOf } | null }` (newest `type:"review"`).
**Files:** `tools.ts`.
**Acceptance:** AC#10. `log_review` → `get_latest_review` round-trips with weekOf; review excluded from `recent_history` (depends on REQ-002).
**Deps:** none (enum + tools). Pairs with REQ-002 for the exclusion AC.

## REQ-006 — `get_session_brief` (#1) — M
**Description:** Add `get_session_brief` (no args) returning the bundle in PRD §4.2: `today` (dateKey), `goal` (active goal + `daysToGo`), `plan` (`resolveDay(now).weekIndex` → name/week/totalWeeks/phase from active plan template `phases`), `recentSessions` (last 5 workouts+hikes blended, newest first, each `{date,kind,title,summary}`), `weightTrend` (`latest` + `delta7d` + `delta30d`), `standingRules` (id + `header` = first line/~80 chars + `lastAcknowledgedAt`, NOT bodies), `latestReview`, `openItems` (reuse REQ-004 list logic). All null-safe.
**Files:** `tools.ts` (may extract small helpers in `tools.ts` or `src/lib/`).
**Acceptance:** AC#6. Null-safe goal/plan/review/measurements. Headers not bodies. Workouts+hikes blended. Date math via `@/lib/calendar`.
**Deps:** REQ-001 (priority in openItems), REQ-004 (open-items shape), REQ-005 (latestReview).

## REQ-007 — Docs: `CLAUDE.md` tool inventory — S
**Description:** Add the 6 new tools to the Read/Write tool lists in `CLAUDE.md`; note `recent_history`/`log_workout` behavior changes.
**Files:** `CLAUDE.md`.
**Acceptance:** AC#13.
**Deps:** REQ-002..006 (names finalized).

---

### Sequencing
1. REQ-001 (migration) → unblocks 004, 006.
2. REQ-002, REQ-003, REQ-005 — independent, any order.
3. REQ-004 — after 001.
4. REQ-006 — after 001, 004, 005.
5. REQ-007 — last.

All in `tools.ts` (+ records.ts + schema) → **single backend developer agent** in one worktree, in the order above.
