# PRD: Compare-vs-progress readiness parity for today (#227)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-07
**Status**: Approved
**GitHub Issue**: #227 (Sprint 11 — Feature correctness, P0; unblocks #228 → #229)
**Branch**: feature/phase1-auth (queue convention)
**UX-research**: skipped — bug-fix/microcopy, no new surface

---

## ⚠ AMENDMENT (2026-07-09) — premise disproven, story re-scoped

The Devil's Advocate empirically disproved §1.1: `computeReadiness` is **deliberately day-granular** — `resolveMetricValue` wraps every `asOf` in `endOfDay(asOf)` (`src/lib/goal-targets.ts:44`, comment cites the 9:30pm-baseline bug this fixes) and the hike gate does the same (`readiness.ts:206`). Therefore `/compare`'s `endOfDay(today)` and `/progress`'s `new Date()` produce byte-identical readiness **by construction**; the divergence this story targets cannot occur. MCP capture corroborates (identical 78/78; `.feature-dev/2026-07-07-227-compare-today-parity/phases/mcp-smoke-before.txt`).

**Re-scoped deliverable** (user question defaulted to the recommended option — flag for review):
1. Regression test pinning the day-granularity invariant in `src/lib/goal-targets.test.ts` (so removing the wrap can't silently break compare/progress parity).
2. Truthful microcopy on `/compare`: "Values as of end of each day." (the originally prescribed "today is live" would be false).
3. §3.1.1–3 (asOf plumbing, compare.test.ts arg tests, tools.ts description change) — **dropped**: dead plumbing; the current `compare_dates` description ("latest-known value ≤ end of each day") is already accurate.
4. #227 closes with the disproof as evidence; #228 unblocks. Meta-note: #228/#229 came from the same audit — premise-check first during their runs.

---

## 1. Overview

### 1.1 Problem Statement
`/compare` and the `compare_dates` MCP tool compute readiness for both compared dates as end-of-day snapshots (`src/lib/compare.ts:39-40`, call sites `:103-106`), while `/progress` computes today's readiness at the live instant (`src/app/progress/page.tsx:44`, `computeReadiness(targets, new Date(), g.id)`). A comparison ending today silently diverges from /progress — violating the CLAUDE.md invariant that both surfaces share the same `computeReadiness` path and numbers.

### 1.2 Proposed Solution
Today's side of a comparison uses the live instant for **readiness only**; every other section (strength, baselines, body, counters, nutrition) keeps end-of-day snapshot semantics. One wall-clock read per comparison. The MCP tool inherits the fix via `computeComparison`; its description documents the carve-out. A microcopy line on /compare communicates the semantic.

### 1.3 Success Criteria
Per-goal readiness for a today-ending comparison is byte-identical to /progress (same function, same asOf convention); regression test proves the argument path; MCP smoke shows live parity; all gates green.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-001 | Any tenant in the PWA | see the same "today" readiness on /compare as on /progress | the numbers never contradict each other | Must Have |
| US-002 | The coach via MCP (`compare_dates`) | get today's live readiness when comparing to today | coaching decisions use current data, and the tool description tells me the semantics | Must Have |
| US-003 | Any user on /compare | read a hint that past dates are end-of-day snapshots but today is live | the mixed semantic is explicit, not mysterious | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements (from issue #227, verified against code)
1. `src/lib/compare.ts`: single wall-clock read (`const now = new Date()`; reuse for the existing `todayKey = toDateKey(now)` at `:36`); `asOfA = dateA === todayKey ? now : cutA`, `asOfB = dateB === todayKey ? now : cutB`; `buildGoalSections` takes 4 date args `(cutA, cutB, asOfA, asOfB)` and uses `asOf*` ONLY at the two `computeReadiness` call sites (`:103-106`). `createdAfterA` (`:94`) and all other builders keep `cutA`/`cutB` unchanged.
2. Regression test in `src/lib/compare.test.ts`: dateB = today → the mocked `computeReadiness` receives an asOf in `[before, after]` captured around the call (live instant, NOT `endOfDay`); past A side still gets `endOfDay`. Must fail pre-fix (prove by running against HEAD~1 or stashing the compare.ts change), pass post-fix. Plus a past-past case asserting endOfDay on both sides.
3. `src/lib/mcp/tools.ts` `compare_dates` description (`:1227-1244`): document the today carve-out. Handler unchanged.
4. As-of microcopy near the /compare hero (`src/app/compare/page.tsx` or `src/components/compare/HeroSpan.tsx`): "As of end of day — today is live." (muted token, 390px-verified).

### 3.2 Secondary Requirements
1. MCP curl smoke captured before AND after: `compare_dates {a: <30d ago>, b: <today>}` per-goal readiness vs `compute_readiness` (no asOf) for the same goal — diverges before, matches after.

### 3.3 Out of Scope
- `compute_readiness`'s third asOf convention (`parseDateKey` start-of-day for explicit past asOf, `tools.ts:1032`) — pre-existing, untouched.
- #228 (dead counters) and any /calendar work (no `computeComparison` call site there).
- `computeReadinessSeries` (already receives raw now on /progress).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
N/A — no schema change.

### 4.2 MCP Tool Surface
`compare_dates`: **description text only** (today carve-out). No input-schema/handler/read-shape change → no leaky-reads impact. Tool list unchanged (same name/count) → connector reload NOT required, but description refresh follows the same cache: note in report.

Smoke:
```sh
curl -s -X POST http://localhost:3000/api/mcp -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_dates","arguments":{"a":"<30d-ago>","b":"<today>"}}}'
```
vs `compute_readiness` with `{}` for the same goal.

### 4.3 Server Actions
N/A — read-path change only; no mutations, no revalidatePath.

### 4.4 Pages / Components
- `src/app/compare/page.tsx` / `src/components/compare/HeroSpan.tsx`: one muted microcopy line near the hero. Server-rendered; no client component changes.
- No navigation changes.

### 4.5 Date / Time Semantics
- The single `new Date()` is a wall-clock instant (allowed); ALL day math stays on `@/lib/calendar-core` helpers already imported in compare.ts (`parseDateKey`, `endOfDay`, `dateKey as toDateKey`).
- `todayKey` derivation is USER_TZ-correct via `dateKey()`.
- Same-day-today comparison (`dateA === dateB === today`, normalizeDateRange allows sameDay): both sides live — acceptable and consistent; document in blueprint.
- Future dates already clamped to today by `normalizeDateRange` (`clampedToToday`) — clamped date === todayKey → live semantics apply; correct.

### 4.6 Deferral / Override Awareness
N/A — readiness path only; no per-day plan reads.

### 4.7 Tenant Scoping & Auth
No new queries; existing compare.ts queries already tenant-scoped via `getDb()`. No route/auth changes.

### 4.8 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions
/compare hero gains one line under the date span (390px):
```
┌──────────────────────────────┐
│  Jun 7 → Jul 7   (30 days)   │
│  As of end of day — today    │
│  is live.                    │
└──────────────────────────────┘
```
States: line is static copy — no loading/empty variants.

### 5.2 Navigation Flow
Unchanged.

### 5.3 Responsive + Mobile-First Spec
`text-xs text-[var(--muted)]`; no hardcoded colors; must not wrap awkwardly at 390px (verify).

### 5.4 Accessibility
Plain text; inherits contrast from `--muted` (adequate on both themes).

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| dateB = today | Readiness B computed at live instant; all other sections end-of-day today |
| dateA = dateB = today (sameDay) | Both readiness sides live; deltas zero; unchanged elsewhere |
| Future date input | Already clamped to today by normalizeDateRange → live semantics |
| Goal created after dateA | `createdAfterA` keeps using `cutA` — behavior unchanged |
| Brand-new user, zero goals | buildGoalSections returns [] — unchanged |
| Test run near midnight | Test derives todayKey from the same `new Date()` convention; assert via [before, after] window — no fake-timer flake |

---

## 7. Security Considerations

Read-path only; no new inputs, routes, or queries. No tenant-isolation surface change (existing `getDb()` queries untouched).

---

## 8. Acceptance Criteria

1. [ ] compare.ts change exactly per §3.1.1 (verified by reading the diff — only the readiness call sites gain asOf semantics)
2. [ ] New compare.test.ts cases: today-live + past-endOfDay + past-past regression; **fail-before/pass-after demonstrated** (run new tests against stashed pre-fix compare.ts once, capture output)
3. [ ] `compare_dates` description documents the today carve-out
4. [ ] Microcopy renders at 390px on /compare
5. [ ] `npx tsc --noEmit` 0 errors; `npm run lint` no new; `npm run test` green; `npm run build` succeeds
6. [ ] MCP smoke before/after captured in RUN_DIR showing divergence→parity for b=today and no change for past-past

---

## 9. Open Questions

None — design fully prescribed by the audit-fixes decomposition (issue #227).

---

## 10. Test Plan

10.1: all four gates; new suites: compare.test.ts additions only.
10.2: MCP curls per §4.2 (before-capture happens BEFORE merging the fix — orchestrator runs it against current HEAD).
10.3: browser — /compare at 390px signed in: microcopy visible; today-compare readiness equals /progress in the same session (spot-check). Pre-existing hydration warning on /compare (BottomSheet) is known — ignore.
10.4: N/A (no migration).

---

## 11. Appendix

### 11.1 Discovery Notes
Explore verified: buildGoalSections signature `compare.ts:86-90`; call sites `:103-106`; /progress parity target `progress/page.tsx:44-47`; `toDateKey` = import alias of `dateKey` (calendar-core:83); compare_dates handler passes through `computeComparison` (tools.ts:1242) — inherits fix; calendar has no computeComparison call site; compare.test.ts mocks computeReadiness with no fake timers; readiness.ts:206 hike-gate re-wraps asOf in endOfDay internally (same on /progress — not a parity risk).

### 11.2 References
Issue #227; `docs/roadmap/audit-fixes-plan.md` + `-backlog.md`; `.roadmap/2026-07-03-audit-fixes/coordination/backlog.json`; CLAUDE.md compare invariant; `docs/project-gotchas.md` §B.
