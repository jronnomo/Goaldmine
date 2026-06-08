# PRD: Long-Effort (Hike) Reconciliation — Track 1 (backend)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-08
**Status**: Approved
**GitHub Issue**: N/A — direct-to-main
**Branch**: main (per-agent worktrees, squash-merged)
**Design spec**: `docs/design/long-effort-reconciliation.md` (the authoritative spec — read it fully; this PRD operationalizes its Track 1)
**UX-research**: skipped — pure backend (resolver/MCP/lint); the calendar visual is covered by the separate `docs/ux-research/plan-confidence-calendar.md` pass (Track 2)

---

## 1. Overview

### 1.1 Problem Statement
The 7-day rotation is anchored to `plan.startedOn` via `daysDelta % 7`, so rotation **Day 6 = "Long Endurance"** always renders "Long Run or Hike" on a fixed weekday *every week*, regardless of whether a real hike is planned. Real hikes are `Hike` rows with an arbitrary `date` and **no link to the rotation**. The two are never reconciled, so a hike planned off Day 6 produces a "phantom" long-effort the coach must manually override **every week**. The user is tired of being the one who catches it.

### 1.2 Proposed Solution
Make `resolveDay` **surface** the mismatch at read time — **never auto-rewrite the plan** (the displaced day's fate is a coaching decision, per design §2/§10). Add advisory flags + a normalized conflict signal that flow to the coach's cold-start (`get_session_brief`) and the calendar cell, plus a shared `weekConflicts` helper that is the single source of truth consumed by the (future) confirm guard, the calendar, and lint. Add `get_week` for a cheap weekly scan and four lint rules as a detection backstop.

This is **Track 1 only** — pure backend/MCP/lint. The provisional/confirmed calendar visual + `Plan.confirmedThroughDate` + `confirm_week` are **Track 2** and explicitly out of scope here.

### 1.3 Success Criteria
- `resolveDay(date)` returns the three new flags correctly for every design §6 edge case, and **`workoutTemplate` is returned byte-unchanged** in all of them (the core invariant — reconciliation only annotates).
- `weekConflicts(program, weekIndex)` returns both `long-effort` and `retest-on-hike` conflicts, override-aware.
- `get_session_brief` / `get_today_plan` / `get_day` expose the flags; `CalendarDayCell` carries a normalized `conflict` field (data only — no styling).
- `get_week` returns 7 resolved days in one MCP call.
- Four lint rules fire on the right conditions; `retest-on-hike-day` is a thin caller of `weekConflicts`.
- `scripts/test-reconciliation.ts` exercises the §6 cases and asserts the invariant.
- `tsc --noEmit`, `lint`, `build` all clean.

---

## 2. User Stories

| ID | As… | I want… | So that… | Priority |
|----|-----|---------|----------|----------|
| US-001 | Gabe (via Claude coach) | the cold-start brief to flag when a planned hike collides with the Day-6 long-effort | I never have to be the one who notices the rotation is wrong | Must |
| US-002 | Gabe (via Claude coach) | a one-call 7-day resolved view | the weekly maintenance scan is cheap, not seven `get_day` calls | Must |
| US-003 | Gabe (via Claude coach) | `lint_plan` to flag retest-on-hike, pre-hike leg-load, multi-hike weeks, out-of-plan hikes | scheduling problems surface automatically | Should |
| US-004 | Gabe | the app to **never** silently change my prescribed plan | the coaching conversation stays in control of deviations | Must |

---

## 3. Functional Requirements

### 3.1 Core
1. `rotationWeekWindow(program, weekIndex)` helper in `calendar.ts` (USER_TZ-aware via `addDays`/`startOfDay`/`endOfDay`).
2. Hoist the rotation math (`daysDelta`/`rotationDay`/`weekIndex`) above the `resolveDay` `Promise.all`; add the planned-hike-this-week query to that parallel block, gated on in-plan (return `[]` when out of plan).
3. A **pure** reconciliation function: `(rotationDay, weekIndex, thisDateKey, plannedHikesThisWeek, isOverride, workoutTemplate) → { plannedHikeToday, workoutDeferredForHike, longEffortConflict }`. No DB, no template mutation.
4. Three new `ResolvedDay` fields: `plannedHikeToday`, `workoutDeferredForHike` (advisory, mirrors `workoutDeferredForBaseline` at `calendar.ts:403`), `longEffortConflict`.
5. `weekConflicts(program, weekIndex)` — single source of truth surfacing `long-effort` (from the reconciliation) **and** `retest-on-hike` (a baseline due — via the rotation/`getBaselineSchedule` logic — on a date with a planned hike), override-aware (an overridden day contributes nothing).
6. Wire `plannedHikeToday` + `workoutDeferredForHike` + `longEffortConflict` into `get_session_brief` (the load-bearing cold-start path), `get_today_plan`, `get_day`.
7. Expose a normalized `conflict: { kind: "long-effort" | "retest-on-hike"; withDates: string[] } | null` on `CalendarDayCell`, derived in `buildCell`/`getCalendarMonth` via per-week reconciliation in memory (do **not** call `resolveDay` per cell; the month query already fetches hikes). **Data only — no visual treatment** (Track 2 owns styling).
8. `get_week` MCP read tool — v1 loops `resolveDay` over the 7 rotation-week dates and returns them.

### 3.2 Secondary
9. Lint rules in `plan-lint.ts` `lintActivePlan`: `pre-hike-leg-load` (warning — planned hike the day after a heavy-leg rotation day: Day 2 `lower` / Day 5 `lower-power`), `multiple-hikes-one-week` (info — >1 planned hike in one rotation week; distinct from the existing same-day `duplicate-planned-hikes`), `hike-outside-plan` (warning — planned hike before `startedOn` or past `totalWeeks*7`), and `retest-on-hike-day` (warning — a **thin caller of `weekConflicts`**).
10. `scripts/test-reconciliation.ts` — tsx harness over §6 cases (precedent: `scripts/test-revision-flow.ts`).

### 3.3 Out of Scope
- **Track 2 entirely:** `Plan.confirmedThroughDate`, `confirm_week`/`reopen_week`, the `log_review` confirm extension, the calendar confidence rail/cap/cell styling, `CalendarDayCell.confidence`, any migration.
- Baseline pull-forward window (design §9).
- Standing-rule stopgap.
- Completed-hike reconciliation (v1 = `status:"planned"` only).
- Any **visual** treatment of the conflict on the calendar.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
**No schema change.** `Hike` already exists (`schema.prisma:115-130`); reconciliation reads `status:"planned"` rows. No migration, no `prisma generate` needed. (Track 2 adds the only column.)

### 4.2 MCP Tool Surface

| Tool | Purpose | R/W | Notes |
|------|---------|-----|-------|
| `get_week` | 7 resolved days for a rotation week | Read | New. Optional `startDate?: string` (USER_TZ via `parseDateInput`); defaults to the current rotation week. Returns `{ days: ResolvedDay-shaped[] }`. v1 loops `resolveDay`. |
| `get_today_plan` | adds the 3 flags | Read | Modified — surface `plannedHikeToday`, `workoutDeferredForHike`, `longEffortConflict`. |
| `get_day` | adds the 3 flags | Read | Modified — same. |
| `get_session_brief` | adds week conflicts | Read | Modified — surface `longEffortConflict` (and/or `weekConflicts` for the current week) alongside standing rules. **The most important wiring.** |
| `lint_plan` | +4 rules | Read | Modified via `plan-lint.ts`. |

All handlers stay wrapped in `safe(async () => …)`; any `date: string` input uses `parseDateInput`. Architect specifies the exact `get_week` Zod schema + return shape and whether the brief embeds `longEffortConflict` per-day or a `weekConflicts` summary.

### 4.3 Server Actions
N/A — no new mutations (all reads + a pure helper). No `revalidatePath` changes.

### 4.4 Pages / Components
No new routes/components in Track 1. `CalendarDayCell` (`calendar.ts:9-25`) gains the `conflict` field; `buildCell`/`getCalendarMonth` populate it. **No JSX/styling changes** — `CalendarMonth.tsx` consumption is Track 2.

### 4.5 Date / Time Semantics
Every date computation routes through `@/lib/calendar` (`startOfDay`, `endOfDay`, `addDays`, `dateKey`). `rotationWeekWindow` uses them. `get_week`'s `startDate` uses `parseDateInput`. No raw `setHours/getDate/...`. Reuse the existing `daysDelta % 7` math — do not reinvent it.

### 4.6 Override-Awareness
Central to the feature. Precedence **override > rotation default** is preserved: all flags are suppressed when `isOverride` (the coach already resolved that day). `weekConflicts` skips overridden days. Reads stay on `resolveDay`, never `getTodayContext`.

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications
N/A for Track 1 (pure backend). The only UI-adjacent change is a **data** field on `CalendarDayCell`; its rendering is Track 2 (`plan-confidence-calendar.md`). No mockups, no nav changes.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected |
|----------|----------|
| No active program | `resolveDay` returns `isInPlan:false`; all new flags `null`/`false`. No queries beyond existing. |
| No planned hike this week | No flag; Day-6 template unchanged. (Critical: never suppress a real Day-6 run.) |
| Hike on the Day-6 date | `plannedHikeToday` set; no `longEffortConflict`. |
| Hike on a non-Day-6 date | `plannedHikeToday` on the hike date (+ `workoutDeferredForHike` if that day's template isn't `rest`); `longEffortConflict` on Day 6. |
| Hike lands on a `rest` rotation day | `plannedHikeToday` set, `workoutDeferredForHike:false` (nothing to defer). |
| 2+ hikes same week | `plannedHikeToday` per hike date; `longEffortConflict.plannedHikeDates` lists all; lint `multiple-hikes-one-week` (info). |
| Retest due + hike same day | both `workoutDeferredForBaseline` and `workoutDeferredForHike` may fire; surfaced not resolved; `weekConflicts` emits `retest-on-hike`; lint warns. |
| Hike outside plan window | no flags; lint `hike-outside-plan` (warning). |
| Explicit override on the day | all new flags suppressed. |
| DST week | week window via `addDays`/`startOfDay` — no shear. |

### Core invariant
Across **every** case above, `resolveDay(...).workoutTemplate` must equal what the pre-change code returned. The test harness asserts this explicitly.

---

## 7. Security Considerations
No new routes; MCP bearer-token coverage unchanged. `get_week` input validated by Zod + `parseDateInput`. Reads only — no injection surface beyond existing Prisma queries. No user-rendered HTML.

---

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit` — 0 errors.
2. [ ] `npm run lint` — no new errors.
3. [ ] `npm run build` — Turbopack build succeeds.
4. [ ] `ResolvedDay` includes `plannedHikeToday`, `workoutDeferredForHike`, `longEffortConflict` with the design §5 shapes.
5. [ ] A **pure** reconciliation function exists (no `prisma`/`await` inside it) and is unit-exercised by the harness.
6. [ ] `weekConflicts(program, weekIndex)` returns both conflict kinds, override-aware; an overridden day contributes nothing.
7. [ ] `get_week` appears in `tools/list` with title+description; `tools/call` returns 7 days.
8. [ ] `get_session_brief`, `get_today_plan`, `get_day` return the new flags (curl-verified shape).
9. [ ] `CalendarDayCell` has `conflict`; `buildCell` populates it; **no** `CalendarMonth.tsx` JSX/style change.
10. [ ] Lint rules `pre-hike-leg-load`, `multiple-hikes-one-week`, `hike-outside-plan`, `retest-on-hike-day` exist; the last calls `weekConflicts`.
11. [ ] `scripts/test-reconciliation.ts` runs via `tsx` and asserts the §6 cases **including** the `workoutTemplate`-unchanged invariant.
12. [ ] All new Date math goes through `@/lib/calendar`; no raw `setHours/getDate/...` in app code.
13. [ ] No template mutation anywhere in the reconciliation path.

---

## 9. Open Questions
None — resolved by the design doc + UX pass. (Architect picks the exact `get_week` return shape and whether the brief carries per-day `longEffortConflict` vs a `weekConflicts` summary — both acceptable; document the choice.)

---

## 10. Test Plan

### 10.1 Gates
`npx tsc --noEmit` · `npm run lint` · `npm run build` — all clean.

### 10.2 MCP curl smoke
- `tools/list` shows `get_week`.
- `get_week` → 7 days.
- `get_today_plan` / `get_day` → include the new flags.
- `get_session_brief` → includes conflict surfacing.
- `lint_plan` → exercise with a seeded off-Day-6 planned hike; expect `retest-on-hike-day`/`multiple-hikes-one-week`/etc. as applicable.

### 10.3 Harness
`npx tsx scripts/test-reconciliation.ts` — green across §6 cases; loudest assertion = `workoutTemplate` unchanged.

### 10.4 Migration
N/A — no schema change.

---

## 11. Appendix

### 11.1 Discovery Notes
Originated from a coach⇄user exchange: the user objected to manually correcting the rotation weekly. Root cause = two unreconciled sources of truth for the week's long effort (rotation Day-6 template vs `Hike` rows). Decision (saved to memory `plan-is-conversational-not-auto-resolved`): the app **surfaces**, the coach **resolves** — no deterministic auto-rewrite. UX pass chose a per-week confidence rail + `confirmedThroughDate` high-water mark (Track 2), coupling to Track 1 only via `weekConflicts`.

### 11.2 References
- Spec: `docs/design/long-effort-reconciliation.md`
- UX: `docs/ux-research/plan-confidence-calendar.md` (+ `-ledger.md`, `.html`)
- Code: `src/lib/calendar.ts` (`resolveDay:273`, `buildCell:117`, `workoutDeferredForBaseline:403`), `src/lib/plan-lint.ts` (`lintActivePlan:153`), `src/lib/records.ts` (`getBaselineSchedule:143`), `src/lib/program.ts` (`ActiveProgramSnapshot:5`), `src/lib/mcp/tools.ts` (tool registrations), `prisma/schema.prisma` (`Hike:115`).
