# PRD: Remove /stats page — redirect to /progress, port Totals card

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-05
**Status**: Approved
**GitHub Issue**: https://github.com/jronnomo/goaldmine/issues/219 (Sprint 10, audit-fixes backlog)
**Branch**: feature/phase1-auth
**UX-research**: skipped — removal/refactor of a duplicate page, no new UX surface.

---

## 1. Overview

### 1.1 Problem Statement
`/stats` is a live, orphaned near-duplicate of `/progress` (audit v2 finding N1, `docs/ux-research/full-app-audit.md`). Zero inbound links exist anywhere in `src/` — the only reference is BottomNav's active-state match. It duplicates the Readiness/Weight/BodyMetrics blocks and silently drifts from the Progress hub; 19 server-action `revalidatePath("/stats")` calls keep revalidating a page nobody can reach.

### 1.2 Proposed Solution
Delete the page body; keep the route as a page-level `redirect("/progress")` so old URLs survive. Port the one unique piece — the Totals card (Workouts/Baselines/Hikes counts) — to `/progress`, rendered with the shared `StatTile` component. Remove the BottomNav `/stats` match, the 19 dead revalidate calls, and the stale route-access test entry.

### 1.3 Success Criteria
GET /stats lands on /progress; /progress shows a correct Totals card styled like its siblings; zero `revalidatePath("/stats")` matches in src/; all four quality gates green.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-001 | any user with an old /stats URL or habit | be taken to /progress | I land on the canonical progress surface instead of a drifting duplicate | Must Have |
| US-002 | any user on /progress | see my total Workouts/Baselines/Hikes counts | the one thing /stats uniquely offered isn't lost | Must Have |
| US-003 | developer/maintainer | have one progress page and no dead revalidations | changes to progress surfaces can't silently diverge | Must Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. `src/app/stats/page.tsx` replaced by a server-component `redirect("/progress")` (`next/navigation`).
2. `/progress` gains three tenant-scoped counts in its existing `Promise.all` — `db.baseline.count()`, `db.workout.count({ where: { status: "completed" } })`, `db.hike.count()` (exact queries from the old stats page) — and renders `Card title="Totals"` after `<RecordsSummary />` as a `grid grid-cols-3 gap-2` of `StatTile`s.
3. `BottomNav.tsx` Progress-tab `match` drops `p.startsWith("/stats")`; comment updated.
4. All 19 `revalidatePath("/stats")` calls removed: workout-actions ×6, workout-edit-actions ×2, goal-actions ×6, day-log-actions ×5 (each site already revalidates /progress — no replacement needed).
5. `src/lib/auth/route-access.test.ts` drops the `["/stats", "stats page"]` protected-pages entry.

### 3.2 Secondary Requirements
None.

### 3.3 Out of Scope
- Migrating `/progress`'s local `WeightStat` (or any other duplicate tile) onto StatTile — that is Sprint 13 story #236.
- Any change to `/baselines`, RecordsSummary, or Progress-hub information architecture (story #249 covers nav dead-zones).
- next.config-level redirects.

---

## 4. Technical Design

- **Data**: no schema changes. Counts use the already-in-scope `getDb()` client (tenant-scoped; owned models). No new MCP tools (no leaky-reads impact). No new date math (no USER_TZ surface).
- **Routes/auth**: `/stats` stays a protected route (middleware default for non-public paths); it just redirects. No `route-access.ts` change — only the test table entry.
- **Components**: reuse `StatTile` (`src/components/StatTile.tsx`) exactly as-is. Server components only; no `"use client"` additions.
- **Revalidation**: pure deletion; every touched action already calls `revalidatePath("/progress")` adjacent to the removed line — verify per-site during implementation, do not remove anything else.

## 5. Acceptance criteria (verbatim from issue #219)
- GET /stats issues a page-level redirect("/progress") — verified by requesting /stats.
- /progress renders a Totals card using StatTile; no local duplicate Stat function remains for this card.
- BottomNav no longer matches '/stats'.
- `grep -rn 'revalidatePath("/stats")' src/` returns zero matches.
- route-access.test.ts no longer asserts the /stats entry; suite passes.
- `npx tsc --noEmit`, `npm run build`, `npm run lint`, `npm run test` all succeed.
