# PRD: Cold-Start Ergonomics for the MCP Server

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-03
**Status**: Draft
**GitHub Issue**: N/A — direct-to-main
**Branch**: main

---

## 1. Overview

### 1.1 Problem Statement

A fresh claude.ai coaching conversation is expensive to orient. Based on direct coach-side feedback after a full cold-start + workout-log + status-read session:

1. **Cold start costs ~5 tool calls.** Answering "where did we leave off" today means stitching together `get_today_plan` + `recent_history` + `get_goal` + fishing the Sunday review out of a notes array. There is no single catch-up call.
2. **PRs are invisible at log time.** `log_workout` returns only `{ id, message }`. Confirming a rep was a PR requires a separate `get_exercise_history` call, so PRs get missed.
3. **Reviews and open items are buried in prose.** The Sunday review is the best cold-start artifact that exists, but it lives inside the `recent_history` notes firehose as a `journal` note, and its action items (e.g. "pick the Longs date", "Bierstadt fueling", "sleep experiment") are sentences inside a paragraph — not resolvable objects.
4. **Standing-rule bodies are duplicated.** The full rule bodies come back in BOTH `get_today_plan` and `recent_history` (the latter has no type filter), wasting tokens on every wide lookback.

### 1.2 Proposed Solution

Four coordinated MCP changes, built in dependency order. No UI, no LLM calls — pure read/write tool surface plus one additive schema column.

- **#4 De-dupe standing rules (S):** `recent_history` stops returning the three "first-class" note types (`standing_rule`, `review`, `open_item`); it becomes purely activity (`journal`/`audible`/`feedback`). Full standing-rule bodies stay in `get_today_plan` — the coach calls them "load-bearing" for cold-start safety, so they live in exactly one place.
- **#2 PR-in-return (S):** After a `log_workout` write, diff each logged exercise's best set against its prior all-time best (excluding the just-created workout) and return a `recordsSet[]` array so the coach reacts to PRs instantly.
- **#3 open_items + reviews (M, foundation):** Promote two artifacts to first-class objects. An open item = a `Note` with `type:"open_item"` (resolvable via the existing `resolvedAt`/`resolvedReason`, plus optional `targetDate` and a new nullable `priority`). A review = a `Note` with `type:"review"`. Add `log_open_item` / `resolve_open_item` / `list_open_items`, a `log_review` tool (plus `review` in the `log_note` enum), and `get_latest_review`.
- **#1 get_session_brief (M, consumes #3):** One coaching-session catch-up call returning today's date anchored, active goal + target date + days-to-go, current plan week + phase, the last ~5 sessions (workouts + hikes blended) as one-liners, the weight trend, standing-rule **headers** (+ freshness, not full bodies), `latest_review`, and the structured `open_items` list.

### 1.3 Success Criteria

- A new conversation can answer "where did we leave off" in **one** `get_session_brief` call instead of ~5.
- `log_workout` returns a `recordsSet[]` that correctly flags all-time PRs and never false-positives on the just-logged workout.
- `get_latest_review` returns the newest review as a discrete object; `list_open_items` returns unresolved open items sorted by `targetDate` with overdue flagged.
- `recent_history` no longer returns `standing_rule` / `review` / `open_item` notes; `get_today_plan` still returns full standing-rule bodies.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean; every new/changed tool smoke-passes via MCP curl.

---

## 2. User Stories

| ID     | As a... | I want to... | So that... | Priority |
|--------|---------|--------------|------------|----------|
| US-001 | coach in a fresh claude.ai chat | call one tool and get fully oriented | I land safe, not reckless, without burning 5 calls | Must Have |
| US-002 | coach logging a parsed workout | see records set in the write's return | I never miss a PR and react in the same turn | Must Have |
| US-003 | coach reviewing the week | read the latest Sunday review as a discrete object | I don't parse it out of a notes firehose | Must Have |
| US-004 | coach planning | list/resolve structured open items with due dates | unresolved threads (Longs date, fueling, sleep) surface and clear cleanly | Must Have |
| US-005 | coach on a wide lookback | not pay for standing-rule bodies twice | token cost stays low while safety stays high | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. `recent_history` returns `notes` filtered to `type IN (journal, audible, feedback)` — excludes `standing_rule`, `review`, `open_item`. A shared `ACTIVITY_NOTE_TYPES` constant defines the set; its description documents where the excluded types now live.
2. `log_workout` returns `{ id, message, recordsSet }` where `recordsSet` is an array of records set this session, each `{ name, equipment, kind: "rm"|"reps"|"duration", value, prior, raw }`. The prior-best baseline excludes the just-created workout id.
3. New nullable `priority` column on `Note` (additive migration).
4. `log_open_item` write tool: `{ body, targetDate?, priority? }` → creates `Note type:"open_item"`.
5. `resolve_open_item` write tool: `{ id, reason }` → sets `resolvedAt = now`, `resolvedReason = reason` on an `open_item` note (errors if the id isn't an open_item).
6. `list_open_items` read tool: returns unresolved `open_item` notes sorted by `targetDate` (nulls last), each with an `overdue` boolean (targetDate < today).
7. `log_review` write tool: `{ body, weekOf? }` → creates `Note type:"review"`; `weekOf` (yyyy-mm-dd) stored on `targetDate` as the week-ending date it covers.
8. `review` added to the `NoteTypeShape` enum so `log_note`/`batch_log_note` can also tag a review.
9. `get_latest_review` read tool: returns the newest `Note type:"review"` (or null), with `body`, `date`, `weekOf` (from targetDate).
10. `get_session_brief` read tool (no args): returns the cold-start bundle (see 4.2).
11. All new tool descriptions follow the "use X, NOT Y" routing style the user praised.
12. `CLAUDE.md` tool inventory updated with the new read/write tools.

### 3.2 Secondary Requirements

13. `get_session_brief` standing-rule entries return a `header` (first line / first ~80 chars of body) + `id` + `lastAcknowledgedAt`, NOT the full body — the coach calls `get_today_plan` for full bodies.
14. `update_note` / `delete_note` continue to work on the new types (no special-casing needed beyond the enum addition).

### 3.3 Out of Scope

- **Backfilling** existing Sunday-review prose into structured reviews/open_items (manual, later).
- PR detection on `log_baseline` / `log_hike` (only `log_workout` gets `recordsSet`).
- Any UI / dashboard surface for reviews or open items.
- Editing `log_workout`'s input shape (only its return changes).
- A DB enum for `Note.type` (stays a free-form `String`; `open_item` is written directly by its tool).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

```prisma
model Note {
  // ... existing fields unchanged ...
  type               String    @default("journal") // audible | journal | feedback | standing_rule | review | open_item
  // Open-item priority. Null for non-open_item notes and for open_items
  // logged without one. One of "high" | "normal" | "low".
  priority           String?
  // ... existing fields unchanged ...
}
```

Migration plan:
- Migration name: `note-priority`
- Commands: `npx prisma migrate dev --name note-priority` then `npx prisma generate`
- ⚠ Neon-shared: additive nullable column only — safe for all existing rows (they get `priority = NULL`). No backfill needed. No index required (open_items are low-volume; sort happens in app code).
- `targetDate` is reused for `open_item` due date and `review` week-of — no new column for those.

### 4.2 MCP Tool Surface

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|
| `get_session_brief` | One-call cold-start catch-up | Read | Composes existing reads; consumes #3 |
| `list_open_items` | Unresolved open items, due-sorted | Read | overdue flag |
| `get_latest_review` | Newest review as an object | Read | null when none |
| `log_open_item` | Create a resolvable open item | Write | body + targetDate? + priority? |
| `resolve_open_item` | Resolve an open item | Write | id + reason; errors on non-open_item |
| `log_review` | Create a review note | Write | body + weekOf? |
| `recent_history` (MOD) | Activity firehose | Read | now excludes 3 first-class types |
| `log_workout` (MOD) | Log workout | Write | now returns recordsSet[] |
| `log_note`/`batch_log_note` (MOD) | — | Write | enum gains `review` |

**`get_session_brief`** — no inputSchema.
Return shape:
```jsonc
{
  "today": "2026-06-03",                         // dateKey, USER_TZ
  "goal": { "id", "objective", "targetDate", "daysToGo", "kind" } | null,
  "plan": { "name", "week": 7, "totalWeeks": 12, "phase": { "index", "name" } | null } | null,
  "recentSessions": [                            // last ~5 workouts+hikes, newest first
    { "date", "kind": "workout"|"hike", "title", "summary" }
  ],
  "weightTrend": { "latest": { "date", "weightLb" } | null, "delta7d": number|null, "delta30d": number|null },
  "standingRules": [ { "id", "header", "lastAcknowledgedAt" } ],  // headers, NOT bodies
  "latestReview": { "body", "date", "weekOf" } | null,
  "openItems": [ { "id", "body", "targetDate", "priority", "overdue" } ]  // unresolved, due-sorted
}
```
Description (what claude.ai sees): "One-call cold-start catch-up for a NEW coaching conversation — today's date, active goal + days-to-go, current plan week/phase, the last ~5 sessions (workouts + hikes), weight trend, standing-rule HEADERS (call get_today_plan for full bodies + today's prescription), the latest review, and unresolved open items. Call this FIRST in a fresh chat instead of stitching together get_today_plan + recent_history + get_goal. For today's full workout/nutrition/baselines use get_today_plan; for a wide activity lookback use recent_history."

curl:
```sh
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_session_brief","arguments":{}}}'
```

**`log_open_item`** inputSchema:
```ts
{
  body: z.string().min(1).describe("The unresolved thread, e.g. 'Pick the Longs Peak date'"),
  targetDate: DateKeyShape.optional().describe("Optional due/decide-by date (yyyy-mm-dd, USER_TZ). Surfaces as overdue in list_open_items / get_session_brief once past."),
  priority: z.enum(["high","normal","low"]).optional().describe("Optional priority; default normal when omitted."),
}
```
Return: `{ id, message }`. Description routes: "Create a resolvable open item (an unresolved decision/thread to track across sessions). NOT for plan-change notes (use log_note type:'audible') and NOT for week recaps (use log_review). Resolve via resolve_open_item; list via list_open_items."

**`resolve_open_item`** inputSchema: `{ id: z.string(), reason: z.string().min(1) }`. Errors if the note isn't `type:"open_item"`. Return `{ id, message }`.

**`list_open_items`** — no inputSchema. Return `{ count, openItems: [{ id, body, targetDate, priority, overdue }] }`, unresolved only, sorted by targetDate (nulls last) then date.

**`log_review`** inputSchema:
```ts
{
  body: z.string().min(1).describe("The week review / Sunday recap prose."),
  weekOf: DateKeyShape.optional().describe("Week-ending date the review covers (yyyy-mm-dd). Stored so get_latest_review can report it."),
}
```
Return `{ id, message }`. Description: "Log a weekly review / Sunday recap as a first-class object (NOT a plain journal note). Surfaced by get_latest_review and get_session_brief. For day-to-day observations use log_note; for trackable action items pulled out of the review use log_open_item."

**`get_latest_review`** — no inputSchema. Return `{ review: { body, date, weekOf } | null }`.

### 4.3 Server Actions

N/A — no dashboard/server-action surface. MCP tools only.

### 4.4 Pages / Components

N/A — backend only. No routes, components, or `BottomNav` changes.

### 4.5 Date / Time Semantics

- `get_session_brief` `daysToGo` = whole-day diff between `startOfDay(now)` and `startOfDay(goal.targetDate)` via `@/lib/calendar` helpers — no raw `getDate()`.
- `today` = `dateKey(new Date())`.
- `overdue` = `targetDate < startOfDay(now)` (USER_TZ).
- `log_open_item.targetDate` / `log_review.weekOf` parsed via `parseDateInput` (bare yyyy-mm-dd → USER_TZ midnight).
- weight-trend deltas: find the measurement nearest to `addDays(now, -7)` / `addDays(now, -30)` with a non-null `weightLb`; delta = latest − that. Null when insufficient data.
- plan week/phase derived from `resolveDay(now).weekIndex` mapped to the active plan template's `phases` (week ranges).

### 4.6 Override-Awareness

- `get_session_brief` plan week/phase uses `resolveDay(now)` (override-aware), never `getTodayContext()`. It does NOT need the full resolved DayTemplate (that's `get_today_plan`'s job) — only `weekIndex` for the phase lookup.

### 4.7 Third-Party Dependencies

None.

---

## 5. UI/UX Specifications

N/A — no UI surface. (MCP tool-result JSON only; no 390 px screens, no Recharts, no `<Card>`.)

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active goal/plan | `get_session_brief.goal` / `.plan` = null; tool still returns the rest |
| No measurements | `weightTrend.latest` = null, deltas null |
| No reviews yet | `get_latest_review.review` = null; brief `latestReview` = null |
| No open items | `list_open_items.openItems` = []; brief `openItems` = [] |
| `log_workout` with brand-new exercise (no prior history) | not a PR — `recordsSet` excludes it (no prior baseline to beat) |
| `log_workout` re-logging same workout | prior-best query excludes the just-created workout id → no false PR |
| Exercise with only bodyweight reps / only duration | PR computed on the correct `primary` (reps / duration), matching records.ts |
| `resolve_open_item` on a non-open_item id | error: "Note <id> is type '<t>', not 'open_item'." |
| `resolve_open_item` on already-resolved item | idempotent-ish: updates resolvedAt/reason again or no-ops; report count |
| open_item with past targetDate | `overdue: true`, sorts to top |
| Phase lookup when template has no `phases` | `plan.phase` = null, week still reported |

---

## 7. Security Considerations

- All new tools registered inside `registerReadTools` / `registerWriteTools`, behind the existing bearer-token gate at `/api/mcp`. No new public route.
- Input validation via Zod on every new tool; `priority` constrained to an enum; dates via `parseDateInput`.
- No raw SQL — Prisma only. No `dangerouslySetInnerHTML` (no UI).

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` passes with 0 errors
2. [ ] `npm run lint` introduces no new errors
3. [ ] `npm run build` succeeds (Turbopack, incl. `/api/mcp`)
4. [ ] `prisma migrate dev --name note-priority` applies; `Note.priority` exists, nullable; `src/generated/prisma` regenerated
5. [ ] `tools/list` shows the 6 new tools with titles + "use X not Y" descriptions
6. [ ] `get_session_brief` returns the documented shape; `goal`/`plan`/`latestReview` null-safe; `recentSessions` blends workouts+hikes newest-first; `standingRules` carry headers (not bodies)
7. [ ] `log_workout` return includes `recordsSet[]`; logging a known sub-PR effort yields `[]`; a true all-time best yields one entry; the just-logged workout is excluded from the prior baseline
8. [ ] `log_open_item` → `list_open_items` round-trips; overdue flag correct; due-sort correct
9. [ ] `resolve_open_item` sets resolvedAt and removes the item from `list_open_items`; errors on non-open_item id
10. [ ] `log_review` → `get_latest_review` round-trips with `weekOf`; `recent_history` does NOT return the review
11. [ ] `recent_history.notes` excludes `standing_rule`/`review`/`open_item`; `get_today_plan.standingRules` still returns full bodies
12. [ ] All Date math goes through `@/lib/calendar` / `parseDateInput` (grep for raw `getDate()`/`setHours` in changed files is empty)
13. [ ] `CLAUDE.md` tool inventory lists the new tools

---

## 9. Open Questions

None — resolved in Phase 1:
- Reviews: **both** `type:'review'` on `log_note` and a dedicated `log_review` tool.
- recent_history excludes **all three** first-class types.
- Sessions in the brief: **workouts + hikes blended**.
- open_items: **body + targetDate + priority**, resolve via existing `resolvedAt`/`resolvedReason`; `priority` is a new nullable `Note` column.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
- `npx tsc --noEmit`, `npm run lint`, `npm run build` — all clean.

### 10.2 MCP curl smoke
- `tools/list` shows 6 new tools.
- `log_open_item` (with + without targetDate/priority) → `list_open_items` shows it, overdue correct.
- `resolve_open_item` → item leaves the list; bad id errors.
- `log_review` → `get_latest_review` returns it with weekOf; `recent_history` omits it.
- `log_workout` with a fabricated all-time-best set → `recordsSet` has one entry; re-run with a weak set → `[]`.
- `get_session_brief` → documented shape, null-safe sections.
- `recent_history` → notes contain no first-class types; `get_today_plan` → full standing-rule bodies present.

### 10.3 Browser smoke
N/A — no UI. (Confirm `npm run dev` boots and `/api/mcp` answers `tools/list`.)

### 10.4 Migration verification
- `prisma migrate dev` succeeds on Neon; `Note.priority` nullable; existing notes unaffected (render in `recent_history` with `priority: null`).
- A Vercel redeploy is what exposes the new client/tools to claude.ai.

---

## 11. Appendix

### 11.1 Discovery Notes

Driven by coach-side feedback: cold start ≈ 5 calls; PRs invisible at log time; reviews/open-items trapped in prose; standing-rule bodies duplicated across `get_today_plan` and `recent_history`. Build order respects the `#3 → #1` dependency (`get_session_brief` consumes structured open_items + latest_review); `#2` and `#4` are independent.

### 11.2 References

- `src/lib/mcp/tools.ts` — `get_today_plan` (521), `recent_history` (578), `log_workout` (1276), `log_note` (1597), `promote_note` (2091), `acknowledge_standing_rule` (2131), `batch_log_note` (2657).
- `src/lib/records.ts` — `getExerciseSummaries`, `getExerciseHistory`, `epley1RM`, `bestSetSummary` (PR engine).
- `src/lib/calendar.ts` — `resolveDay` (273), `weekIndex`/`rotationDay`, `dateKey`, `parseDateKey`, `startOfDay`, `addDays`.
- `prisma/schema.prisma` — `Note` (85), `Goal` (163), `Plan` (231).
- Recent commits: `8a360a2` get_nutrition_history, `df53451` readiness goal-scoping.
