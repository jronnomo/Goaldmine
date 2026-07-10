# PRD: Per-route loading.tsx skeletons for heavy routes (#239)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #239 (Sprint 13 — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — loading-state decoration following the prescribed root-loading.tsx idiom; the AC dictates the visual pattern and shapes derive mechanically from each page's real structure

---

## 1. Overview

### 1.1 Problem Statement
/progress, /calendar, /nutrition, /recap, /compare are force-dynamic server components with heavy `getDb()` awaits. Navigation shows nothing until data lands. Route-level `loading.tsx` gives an immediate route-shaped skeleton, matching the root's existing pattern.

### 1.2 Premise check (2026-07-10, HEAD 265313e) — PREMISE HOLDS (first clean AC of the queue)
- Root `src/app/loading.tsx` exists with exactly the claimed idiom (animate-pulse rounded-2xl card shells, `aria-hidden="true"`, one sr-only "Loading…", container `max-w-md mx-auto p-4 space-y-4`).
- None of the five routes has a loading.tsx; all five are `dynamic = "force-dynamic"` with heavy awaits — skeletons will genuinely show. No internal Suspense boundaries (no conflicts).
- Known trade-off: loading.tsx also fires on same-route searchParams navigation (calendar month prev/next; compare date form) — skeleton flash replaces "old view stays until new data". Accepted as the story's value (immediate feedback); DA to confirm.

### 1.3 Success Criteria
Five route-shaped skeletons, idiom-consistent, container-matched (no layout shift at swap), server components; gates green at 794.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Phone user on slow network | immediate skeleton on nav | the app feels alive, not hung | Must Have |
| US-002 | Screen-reader user | a "Loading…" announcement, decoration hidden | a11y parity with the root | Must Have |

---

## 3. Functional Requirements

### 3.1 Core — five new server-component files, static JSX only
Shared idiom: root's container + card shell classes verbatim (`animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm`); bars `rounded bg-[var(--border)]`; `aria-hidden="true"` per decorative block; exactly ONE `<span className="sr-only">Loading…</span>` per file. Shapes:
1. **progress/loading.tsx**: header bar → recap-link pill (min-h-[64px] rounded-xl) → readiness card (title + score block + h-40 chart + 2 bars) → weight card (title + 3-col h-16 tile grid + h-32 chart) → records card (title + 3 rows).
2. **calendar/loading.tsx**: header row (title + pill) → month-nav row → calendar card with 7-col grid of ~35 aspect-square cells → legend card (2-col, 6 rows) → 4-col h-16 tile grid.
3. **nutrition/loading.tsx**: header (title + subtitle) → h-16 macro banner → two meal cards (title + 3 rows) → form card (title + h-24 block).
4. **recap/loading.tsx**: header bar → one tall card (title + h-64 block + 2 bars) — page is a single client shell; one large placeholder is the honest shape.
5. **compare/loading.tsx**: h-20 hero band → chips row (4× h-8 w-16 rounded-full) → form card → two section cards with 3-col h-16 tile grids.

### 3.2 Out of Scope
Shared Skeleton component (inline per precedent; AC wants per-route shapes); skeletons for /days/[dateKey] or /nutrition/[id]; any client-side transition mitigation for the searchParams flash.

---

## 4. Technical Design
Static server components — zero logic, zero imports (tokens via Tailwind classes). No schema/route/MCP changes.

---

## 5. UI/UX
New loading states only; content rendering unchanged. Containers match each page to prevent layout shift at swap.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Calendar month prev/next | Skeleton flash (accepted trade-off, DA-confirmed) |
| Compare form submit | Same |
| Dark + light themes | var(--border) bars on var(--card) — both themes correct by token design |
| prefers-reduced-motion | animate-pulse behavior per existing globals.css rules (DA checks) |

---

## 7. Security
None.

---

## 8. Acceptance Criteria
1. [ ] Five loading.tsx files exist, server components (no "use client")
2. [ ] Root idiom followed: animate-pulse rounded-2xl card shells, aria-hidden="true" blocks, one sr-only "Loading…" each
3. [ ] Route-shaped (calendar grid, nutrition meal cards, etc.), containers match their pages
4. [ ] tsc 0 / lint no new / 794 tests / build OK
5. [ ] Visual confirmation via throttled navigation (or documented browser-debt if Chrome extension remains disconnected)

---

## 9. Open Questions
DA rules: searchParams-flash accept/mitigate; container/class parity incl. recap's `<main>`; reduced-motion; scope note on other heavy routes.

---

## 10. Test Plan
Gates; build-output route check; dev-mode navigation flash check (browser-dependent).

---

## 11. Appendix
Root pattern: src/app/loading.tsx. Sibling idiom: LogLauncher.tsx:116 LogSheetSkeleton (#232). Page structures enumerated in the premise report (plan file §Design).
