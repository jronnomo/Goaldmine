# Requirements — #227 compare-today-parity

## REQ-001 — Live-today asOf in compare readiness
- **Files**: `src/lib/compare.ts`
- **Description**: PRD §3.1.1. Single `const now = new Date()` in `computeComparison` (reused for the existing `todayKey` at `:36`); `asOfA/asOfB = dateX === todayKey ? now : cutX`; `buildGoalSections(goals, cutA, cutB, asOfA, asOfB)`; only the two `computeReadiness` call sites (`:103-106`) switch to `asOf*`. `createdAfterA` and strength/baselines/body/counters/nutrition builders untouched.
- **Acceptance**: diff shows exactly this; tsc clean.
- **Deps**: none · **Complexity**: S

## REQ-002 — Regression tests
- **Files**: `src/lib/compare.test.ts`
- **Description**: PRD §3.1.2. (a) dateB=today (derive via `toDateKey(new Date())` in-test): mocked `computeReadiness` B-side asOf ∈ [before, after] instants captured around the call — NOT endOfDay; A-side (past) receives `endOfDay(parseDateKey(dateA))` exactly. (b) past-past: both sides endOfDay exactly. Follow the suite's existing mock pattern (`vi.mock("@/lib/db")` dual-export, mocked readiness). No fake timers needed.
- **Acceptance**: fail-before/pass-after demonstrated (orchestrator captures); suite green.
- **Deps**: REQ-001 · **Complexity**: S

## REQ-003 — compare_dates description carve-out
- **Files**: `src/lib/mcp/tools.ts` (registration `:1227-1244`, description string only)
- **Description**: append: values are latest-known ≤ end of each day; a date equal to today uses the live current instant for goal readiness (matching compute_readiness / get_today_plan). Handler/schema unchanged.
- **Acceptance**: description text updated; no other tools.ts diff.
- **Deps**: REQ-001 · **Complexity**: S

## REQ-004 — /compare as-of microcopy
- **Files**: `src/components/compare/HeroSpan.tsx` (or `src/app/compare/page.tsx` — whichever renders the hero date span; dev reads both and picks the hero container)
- **Description**: one line, `text-xs text-[var(--muted)]`: "As of end of day — today is live." Placed under the date span; no layout shift at 390px.
- **Acceptance**: renders at 390px; no hardcoded colors.
- **Deps**: none · **Complexity**: S
