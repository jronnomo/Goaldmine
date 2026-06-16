# PRD: Capped, Coverage-Aware Readiness

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-16
**Status**: Draft
**GitHub Issue**: N/A — direct-to-main
**Branch**: main
**UX-research**: skipped — UI change is a single additive text line ("N/M verified · K gates left") on existing surfaces (recap card ring, Progress page); no new visual/interactive component.

---

## 1. Overview

### 1.1 Problem Statement
`computeReadiness` is the app's central "where am I on this goal" metric — it drives the recap card/Story ring, the in-chat coach, the readiness chart, and rarity. Today it **lies in two structural ways**:
1. **Untested targets are excluded entirely.** `readiness.ts:80` does `usable = breakdown.filter(b => b.progress !== null)`, so untested targets leave *both* numerator and denominator. Early in a build you can read **100% of the 3 things you've logged** while the hard, unproven gates simply don't count — a false-ready.
2. **It's a flat weighted average** that treats a trivial 0.05-weight target and a disqualifying gate (e.g. "no high-altitude loaded exposure" for a 14er) the same. A critical, unmet gate barely dents the score.

This makes "100%" mean "passed what I tried," not "ready." We want an honest, no-sugar-coating indicator that **generalizes to any goal** a user sets.

### 1.2 Proposed Solution
Make readiness a **capped, coverage-aware** score (design locked with the user):
- **Untested = 0 in the headline**, full weight kept in the denominator → `rawScore = Σ(weightᵢ·progressᵢ)/Σ(all weights)`.
- **Coverage** `{ tested, total }` surfaced separately ("9 of 15 verified").
- **Gating**: an optional `gating?: boolean` on `GoalTarget`. A gate is *cleared* when `progress !== null && progress >= 1`. While **any** gate is open (incl. untested): `ceiling = 80`; all gates cleared → `ceiling = 100`. `score = min(rawScore, ceiling)`. Goals with no gates → ceiling stays 100 (just the honest coverage-aware average).
- `ReadinessSnapshot` extended **additively** so every existing consumer keeps working.

The visible number is **expected to drop** — that is the feature working.

### 1.3 Success Criteria
- A goal with 3/15 targets tested can no longer read 100% — `rawScore` reflects all 15 weights.
- A goal with an unproven `gating` target caps at 80 no matter how strong the rest is; clearing all gates lifts the cap.
- `compute_readiness` MCP tool returns `coverage` + per-gate status so the coach can name unproven gates.
- The recap card/Story ring and Progress page show the honest `score` plus a "N/M verified · K gates left" line.
- `ReadinessSnapshot` change is back-compatible: `.score`, `.breakdown`, `.missing` unchanged in meaning/shape; `computeReadinessSeries`, `rarity-core`, charts still compile and behave consistently.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` clean.

---

## 2. User Stories

| ID | As Gabe, I want... | So that... | Priority |
|----|--------------------|-----------|----------|
| US-001 | readiness to count targets I haven't tested as 0, not drop them | "100%" means ready, not "passed what I tried" | Must |
| US-002 | to mark certain targets as hard gates that cap readiness until proven | unmet disqualifiers (altitude exposure, dress rehearsal) can't be averaged away | Must |
| US-003 | the coach (via MCP) to see coverage + which gates are open | it can give me an honest, specific readout | Must |
| US-004 | the recap card/ring to show the honest number + "N/M verified · K gates left" | the shareable visual can't sugar-coat either | Should |
| US-005 | this to work for any goal's targets, not just Elbert | the engine generalizes as I add goals | Must |

---

## 3. Functional Requirements

### 3.1 Core
1. `GoalTarget` gains optional `gating?: boolean` in the **type** and the **`GoalTargetSchema` zod** (`metrics-registry.ts`) — kept mirrored.
2. `computeReadiness` computes `rawScore` with untested = 0 progress and full denominator weight.
3. `coverage = { tested: count(progress !== null), total: targets.length }`.
4. Gating: `gates = targets.filter(gating)`; `cleared = progress !== null && progress >= 1`; `openGateCount = gates.filter(not cleared).length`; `ceiling = openGateCount > 0 ? GATE_CEILING(80) : 100`; `score = min(rawScore, ceiling)`.
5. `ReadinessSnapshot` extended additively: `+rawScore`, `+ceiling`, `+coverage`, `+gates: {label, progress, cleared}[]`, `+openGateCount`. `score`, `breakdown`, `missing` retained.
6. `GATE_CEILING = 80` exported constant.
7. `compute_readiness` MCP tool returns the new fields; description updated to explain coverage + gating + cap.
8. `create_goal` / `update_goal_targets` accept and persist `gating` (verify they validate via `GoalTargetSchema`).
9. `MT_ELBERT_DEFAULT_TARGETS`: mark the natural gate(s) (dress-rehearsal / ≥12k-ft loaded exposure / full-pack summit-sim) with `gating: true` for NEW goals.
10. Recap: `WeeklyRecap.goal` gains `coverage` + `openGateCount`; the card/Story ring renders a compact "N/M verified · K gates left" line near READINESS. Progress page surfaces coverage/gates.

### 3.2 Secondary
11. `rarity-core.ts` (the "mirrors readiness missing semantics" block) kept consistent with untested-as-0 (no double-counting or divergence).

### 3.3 Out of Scope
- Layer-1 test-protocol standardization + re-baselining today's step-down result — the **coach's** job in claude.ai (MCP data edits), not this build.
- Setting `gating: true` on the user's **live** Elbert goal targets — that's DB JSON the coach flags via `update_goal_targets`; this build only makes the engine honor the flag + seeds gates on new goals.
- Per-goal configurable ceiling (hardcode 80 for v1).
- Prisma migration (none — targets are JSON; `gating` is additive optional).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
**No schema change, no migration.** `gating` lives in the `Goal.targets` JSON array, validated by `GoalTargetSchema`. Existing target rows without `gating` are treated as non-gates (optional field).

### 4.2 MCP Tool Surface
| Tool | Change |
|------|--------|
| `compute_readiness` | Return `coverage`, `gates`, `openGateCount`, `rawScore`, `ceiling` alongside `score`/`breakdown`. Update description. Read tool, `safe()` wrapper unchanged. |
| `update_goal_targets`, `create_goal` | Confirm `gating` flows via `GoalTargetSchema`; no shape change if they validate the whole target. |
| `get_goal` | If it returns targets verbatim, `gating` rides along — confirm. |

No new tools. `tools/list` count unchanged.

### 4.3 Server Actions
None new. Readiness is read-only/computed. (Progress page is a server component reading `computeReadiness`.) No `revalidatePath` changes.

### 4.4 Pages / Components
- **Modify** `src/lib/readiness.ts` (engine + `ReadinessSnapshot` + `GATE_CEILING`).
- **Modify** `src/lib/metrics-registry.ts` (`GoalTarget` type + `GoalTargetSchema` + `MT_ELBERT_DEFAULT_TARGETS` gates).
- **Modify** `src/lib/mcp/tools.ts` (`compute_readiness` return + description).
- **Modify** `src/lib/recap.ts` (`RecapGoalBlock` + `WeeklyRecap.goal` gain `coverage`, `openGateCount`).
- **Modify** `src/lib/recap-card.tsx` (compact "N/M verified · K gates left" line by the READINESS ring on card + story cover; satori-safe, flex-only).
- **Modify** `src/app/progress/page.tsx` (surface coverage/open gates per goal).
- **Verify/Modify** `src/lib/rarity-core.ts` (~401) for consistency.

### 4.5 Date / Time Semantics
N/A — no new date math. `computeReadiness(targets, asOf, goalId)` keeps its `asOf` param; week math in the recap layer is unchanged and already via `@/lib/calendar`.

### 4.6 Override-Awareness
N/A — readiness reads goal targets + metric values, not per-day plan state.

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions
**Recap card / Story ring:** below the existing "READINESS" label (under the ProgressRing whose center already shows the capped `score`%), add one muted line: `"{tested}/{total} verified · {openGateCount} gate{s} left"` (omit the "· K gates left" clause when `openGateCount === 0`). Satori-safe (flex, inline styles, no CSS vars). Must not break the balanced layout.

**Progress page:** for each goal's readiness, show the score plus a small coverage/gates line in existing token styles.

### 5.2 Navigation Flow
Unchanged.

### 5.3 Responsive + Mobile-First Spec
Progress page line uses existing tokens (`var(--muted)`), ≤390px clean. The card line is on the fixed 1080×1920 canvas (template hex, not CSS vars).

### 5.4 Accessibility
Coverage line readable contrast (`var(--muted)` ≥ 4.5:1 on Progress; template muted on the card).

---

## 6. Edge Cases & Error Handling

| Scenario | Expected |
|----------|----------|
| Goal with no targets | `score 0`, `coverage {0,0}`, `gates []`, `openGateCount 0`, `ceiling 100`. No crash (matches existing empty behavior). |
| No gating targets | `ceiling 100`; behaves as honest coverage-aware average. |
| Gate target untested (progress null) | counts as open → caps at 80; appears in `gates` with `progress: null, cleared: false`. |
| All targets untested | `rawScore 0`, coverage `{0,N}`. |
| `rawScore < ceiling` | `score = rawScore` (cap not binding). |
| Existing targets without `gating` | treated as non-gate (optional field defaults undefined/false). |
| `computeReadinessSeries` historical points | each uses capped `score` at that `asOf` — confirm chart renders (score may now be lower historically — acceptable/honest). |
| Back-compat | any consumer reading only `.score`/`.breakdown`/`.missing` keeps working. |

---

## 7. Security Considerations
- `compute_readiness` stays behind the MCP bearer gate; read-only; `safe()` wrapper.
- `gating` validated by zod (`GoalTargetSchema`) on the write tools.
- No new public route, no `dangerouslySetInnerHTML`, no raw SQL.

---

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit` 0 errors; `npm run lint` no new errors; `npm run build` succeeds.
2. [ ] `GoalTarget` type AND `GoalTargetSchema` both gain `gating?: boolean` (mirrored).
3. [ ] `computeReadiness`: untested targets contribute 0 to numerator, full weight to denominator (`rawScore`).
4. [ ] `score === min(rawScore, openGateCount>0 ? 80 : 100)`; `GATE_CEILING = 80` exported.
5. [ ] `ReadinessSnapshot` additively includes `rawScore`, `ceiling`, `coverage{tested,total}`, `gates[]`, `openGateCount`; `.score`/`.breakdown`/`.missing` unchanged.
6. [ ] MCP `compute_readiness` `tools/call` returns the new fields; description mentions coverage + gating cap.
7. [ ] `create_goal`/`update_goal_targets` persist `gating` (curl round-trip: set gating, read back via get_goal/compute_readiness).
8. [ ] `MT_ELBERT_DEFAULT_TARGETS` marks the natural gate(s) `gating: true`.
9. [ ] Recap card + story cover render "N/M verified · K gates left" near READINESS; no layout break (render + visual check).
10. [ ] Progress page shows coverage/open-gate info per goal at 390px.
11. [ ] `rarity-core.ts` consistent with untested-as-0 (no divergence/double-count); documented.
12. [ ] Cap binds ONLY when `rawScore > ceiling` (it's a safety net, not always-on). Weight-aware tests: a goal with a LIGHT (~0.1) untested gate + the rest at 100% → `rawScore ≈ 90`, `score === 80` (cap bites); a HEAVY (~0.3) untested gate + rest 100% → `rawScore ≈ 70`, `score === 70` (untested-as-0 already honest, cap moot). Clearing all gates → `ceiling = 100`. Do NOT assume Elbert's gate weights produce exactly 80.

---

## 9. Open Questions
*(Empty — design locked: untested=0, GATE_CEILING=80 ceiling-until-gates-clear, coverage shown, additive snapshot, no migration.)*

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
`npx tsc --noEmit` · `npm run lint` · `npm run build` clean.

### 10.2 MCP curl smoke
- `compute_readiness` on the focus goal → returns `score`, `rawScore`, `ceiling`, `coverage`, `gates`, `openGateCount`. Verify `score = min(rawScore, ceiling)`.
- `update_goal_targets` set a target `gating: true` then `compute_readiness` → `openGateCount` increments and `score` caps at 80 if that gate is open. Read back via `get_goal`.

### 10.3 Browser/render smoke
- `npm run dev`; render `/recap/card?weekOffset=0` and `/recap/story/1` → confirm the "N/M verified · K gates left" line renders and the ring shows the (now lower) capped score; visually inspect.
- `/progress` at 390px → coverage/gates surfaced.

### 10.4 Migration
N/A.

---

## 11. Appendix

### 11.1 Discovery Notes
Originated from a coach conversation separating Layer 1 (test-protocol standardization — coach's MCP job) from Layer 2 (engine: false-100% via excluded-untested + flat-average treating gates as trivial). User chose "ceiling until gates clear (80)" with untested=0 and coverage shown. Goal-generic by design (see memory `goal-progress-bars-are-goal-generic`).

### 11.2 References
- `src/lib/readiness.ts` (computeReadiness:60, scoring:80, series:91), `src/lib/metrics-registry.ts` (GoalTarget:12, GoalTargetSchema:51, MT_ELBERT_DEFAULT_TARGETS:189), `src/lib/mcp/tools.ts` (compute_readiness:915), `src/lib/rarity-core.ts:401`, `src/lib/recap.ts`, `src/lib/recap-card.tsx`, `src/app/progress/page.tsx`.
- Memory: `goal-progress-bars-are-goal-generic`, `satori-no-conic-use-svg-arc`.
