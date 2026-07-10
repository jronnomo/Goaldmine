# Completion report — #233 — 2026-07-10

## Shipped (commit 9f90e70 on feature/phase1-auth) — net −73 lines
1. layout.tsx signed-in path: down to auth/session + AppHeader + `getGoalCount()` + `<BottomNav goalCount>` — the per-request 4-query meal fetch is GONE from every signed-in route render. TodayMealLite re-export deleted (zero consumers).
2. BottomNav props collapsed to `{ goalCount: number }`; dead type imports removed; latestWeight/onClose/open forwarding preserved.
3. LogLauncher fully self-sufficient: prop-seed branch deleted (initializer = idle/null → the #232 skeleton path on every first open); DA-caught orphans (ZERO_MACROS, DayMacros import fragment) deleted with it — would have failed the lint gate otherwise.
4. Today's dead latestMeasurement query deleted; 9→8 tuple re-destructured with the critique's prescribed names; Today page verified live (all downstream consumers correct).

## Verification
tsc 0 · 680/680 · lint 0 errors · build OK · greps clean (no meal-prop refs in layout/BottomNav; no @/app/layout type imports repo-wide; latestMeasurement gone).
**Hydration before/after protocol** (the story's real risk): baseline captured on pre-change HEAD — ONE pre-existing BottomSheet dialog-vs-script mismatch, route-independent (fires on / too, broader than the old memory). After: IDENTICAL single signature, and the trace itself shows the win (`<BottomNav goalCount={7}>` vs the old props list). No new warnings — corrected AC satisfied.
**Functional**: Log sheet opens post-deletion; `GET /api/log-sheet-data → 200` fires on reopen (fetch-on-every-open confirmed in the network log); sheet UI fully rendered.

## Premise corrections & findings
- AC's "no console hydration warnings" was unsatisfiable as written (pre-existing warning) → corrected to no-NEW-vs-baseline, documented.
- DA diagnosed the baseline puzzle: BottomSheet's guard is SSR-only, not two-phase (its comment is wrong) — structural, app-wide in dev, #233-independent → **filed #253** with the diagnosis + fix direction.
- latestWeight kept (feeds weight quick-log; always-null is pre-existing — backlog candidate).

## Process
Architect skipped (research = deletion map); DA APPROVE-WITH-FIXES (orphan deletions + the BottomSheet diagnosis); dev self-corrected a stale base (was on main tip); orchestrator ran the before/after browser protocol personally.

## Sprint 12 status
#232 ✅ #233 ✅ — the layout-fetch-deferral pair complete. Next: #234 (day-override write-path hardening w/ DayTemplate validation) → #235 (structured Day Override editor v1). NOTE: these touch plan writes/overrides — read docs/project-gotchas.md §B before planning (per CLAUDE.md).
