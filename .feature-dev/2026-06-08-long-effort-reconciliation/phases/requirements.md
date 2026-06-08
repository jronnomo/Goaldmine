# Requirements — Long-Effort Reconciliation (Track 1)

Spec: `docs/design/long-effort-reconciliation.md` · PRD: `docs/prds/PRD-long-effort-reconciliation.md`

All requirements are ONE cohesive backend stream (shared types in `calendar.ts` flow into `tools.ts`, `plan-lint.ts`, and the harness) → assign to a **single Developer Agent** in one worktree. No parallel split (heavy interdependence → merge conflicts).

---

### REQ-001 — `rotationWeekWindow` + `resolveDay` restructure
**Description:** Add `rotationWeekWindow(program, weekIndex)` to `calendar.ts` (USER_TZ via `addDays`/`startOfDay`/`endOfDay`). Hoist the rotation math (`daysDelta`/`rotationDay`/`weekIndex`) above the `resolveDay` `Promise.all` (design §3); add a `prisma.hike.findMany({ status:"planned", date in week window })` to that parallel block, gated on in-plan (resolve `[]` otherwise). Reuse the hoisted values downstream — don't recompute `daysDelta` for the baseline block.
**Files:** `src/lib/calendar.ts`
**Acceptance:** `resolveDay` still returns identical results for existing fields; the planned-hike query runs only when in-plan; no second `daysDelta` computation; `tsc` clean.
**Deps:** none. **Complexity:** M

### REQ-002 — Pure reconciliation function + 3 `ResolvedDay` fields
**Description:** Extract a pure function `reconcileLongEffort({ rotationDay, weekIndex, thisDateKey, plannedHikesThisWeek, isOverride, workoutTemplate }) → { plannedHikeToday, workoutDeferredForHike, longEffortConflict }` (no DB, no `await`, no mutation). Add the three fields to the `ResolvedDay` type (design §5 shapes) and populate them in `resolveDay`. `workoutDeferredForHike` mirrors `workoutDeferredForBaseline` (`calendar.ts:403`): advisory boolean, `workoutTemplate` stays populated. **Never mutate `workoutTemplate`.**
**Files:** `src/lib/calendar.ts`
**Acceptance:** function is pure (no `prisma`/`await`); flags match design §4 rules; `workoutTemplate` byte-unchanged in all branches; `tsc` clean.
**Deps:** REQ-001. **Complexity:** M

### REQ-003 — `weekConflicts` shared helper
**Description:** `weekConflicts(program, weekIndex)` returns `{ dateKey; kind: "long-effort"|"retest-on-hike"; withDates: string[] }[]`, override-aware (skip days with an override). `long-effort` from REQ-002's reconciliation; `retest-on-hike` = a baseline due on a date carrying a planned hike (derive the test's calendar date from its rotation `dayOfWeek` within the week, cross-referenced with `getBaselineSchedule`/the rotation default in `records.ts`/`calendar.ts`). Single source of truth — used by REQ-004 (cell), REQ-006 (lint), and later the Track-2 confirm guard.
**Files:** `src/lib/calendar.ts` (or a small sibling), reading `records.ts` baseline logic.
**Acceptance:** returns both kinds; an overridden day contributes nothing; pure-ish (one program snapshot + planned-hike read); `tsc` clean.
**Deps:** REQ-002. **Complexity:** M

### REQ-004 — `CalendarDayCell.conflict` (data only)
**Description:** Add `conflict: { kind; withDates: string[] } | null` to `CalendarDayCell` (`calendar.ts:9-25`). Populate in `buildCell`/`getCalendarMonth` by reconciling per rotation-week **in memory** from the already-fetched month hikes (do NOT call `resolveDay` per cell). **No `CalendarMonth.tsx` JSX/style change** — data only.
**Files:** `src/lib/calendar.ts`
**Acceptance:** field present + populated; month grid still one query set; `CalendarMonth.tsx` untouched (or only type-import); `tsc` clean.
**Deps:** REQ-003. **Complexity:** M

### REQ-005 — Wire flags into read tools + `get_week`
**Description:** Surface `plannedHikeToday`/`workoutDeferredForHike`/`longEffortConflict` in `get_session_brief` (most important — cold-start), `get_today_plan`, `get_day`. Add `get_week` read tool (optional `startDate?: string` via `parseDateInput`; default = current rotation week; v1 loops `resolveDay` over the 7 dates; returns `{ days: [...] }`). Register via `server.registerTool(..., safe(async () => …))`.
**Files:** `src/lib/mcp/tools.ts`
**Acceptance:** `tools/list` shows `get_week`; the three read tools include the new flags; handlers use `safe()` + Zod + `parseDateInput`; `tsc` clean.
**Deps:** REQ-002 (+ REQ-003 if brief carries week summary). **Complexity:** M

### REQ-006 — Four lint rules
**Description:** In `plan-lint.ts` `lintActivePlan`: `pre-hike-leg-load` (warning — planned hike the day after a Day-2 `lower` / Day-5 `lower-power` rotation day), `multiple-hikes-one-week` (info — >1 planned hike per rotation week; distinct from existing same-day `duplicate-planned-hikes`), `hike-outside-plan` (warning — before `startedOn` / past `totalWeeks*7`), `retest-on-hike-day` (warning — **thin caller of `weekConflicts`**, emit one finding per `retest-on-hike`). Follow the existing `findings.push({rule, severity, message, context})` shape.
**Files:** `src/lib/plan-lint.ts`
**Acceptance:** four rules present; `retest-on-hike-day` delegates to `weekConflicts`; messages + `context` follow existing style; `tsc` clean.
**Deps:** REQ-003. **Complexity:** M

### REQ-007 — Test harness
**Description:** `scripts/test-reconciliation.ts` (tsx; precedent `scripts/test-revision-flow.ts`). Cover the §6 edge cases against `reconcileLongEffort` (pure — no DB needed) and, where practical, `resolveDay`/`weekConflicts`. **Loudest assertion: `workoutTemplate` is unchanged by reconciliation in every case.** Print pass/fail per case, exit non-zero on failure.
**Files:** `scripts/test-reconciliation.ts`
**Acceptance:** `npx tsx scripts/test-reconciliation.ts` exits 0 with all cases green; deliberately covers the no-hike, hike-on-Day-6, hike-elsewhere, 2-hikes, retest+hike, outside-plan, and override cases.
**Deps:** REQ-002, REQ-003. **Complexity:** M
