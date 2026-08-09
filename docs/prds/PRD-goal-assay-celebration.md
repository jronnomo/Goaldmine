# PRD: The Assay — Goal-Completion Celebration Upgrade

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-08-09
**Status**: Approved
**GitHub Issue**: N/A
**Branch**: feature/phase1-auth
**UX-research**: INVOKED — `docs/ux-research/goal-celebration-upgrade.md` (+ phase-a companion, HTML pixel mockup, 52-row ledger at `docs/ux-research/goal-celebration-upgrade-ledger.md` — implementing commits MUST tick rows). **The research report is co-equal source of truth with this PRD for all visual/timing/copy specification** — this PRD scopes and sequences; the report specifies. Where they conflict, report §7 (implementation) and §9 (provisional values) win.

---

## 1. Overview

### 1.1 Problem Statement
The shipped goal-completion celebration is categorically indistinguishable from a routine level-up (same keyframe, +1 ring, +240ms), probably fires off-screen and burns its one-shot token unseen (last child of a tall card), is `aria-hidden` in full (screen-reader users get nothing), and shows none of the goal's own story ceremonially. The biggest moment in the app reads as the smallest.

### 1.2 Proposed Solution
Ship the research's chosen direction **plus** the founder-approved overlay:
1. **The Assay monument** (report §2): the achieved page renders proud permanently from the top of the viewport — 224px⚠ rust Bullseye hero nested in a gold annulus (🏆 retired as ceremony hero per approved sign-off 10.1; kept everywhere else), 36px serif objective, mono fact line, `WHAT MOVED` evidence rows (met-first, cap 6, **last slot reserved for the first miss** — Rule B corollary), readiness with honest caption, static ReachMeter, badge medals + level crossing, permanence line, 44px CTAs. A ~700ms⚠ flourish garnishes first view; **static IS final** (Rule A): reduced-motion/missed/revisit states are byte-identical to the settled frame.
2. **The Summit Sheet takeover** (phase-a D1, approved sign-off 10.2-inverted): on first view of an unburned token, a full-bleed portaled `<dialog>` (on the existing BottomSheet foundation) plays the staged beat sequence (B1 scrim → B2 Bullseye discs seat → B3 gold ring-break → B4 objective → B5 stat cells → B6 Reach/badges/level → B7 footer), ~1440ms⚠ Summit / ~1180ms⚠ Marker, then dismisses onto the monument. **One form for all tiers** (D1 author's lean; proportionality is emergent from beat count — fewer true things = shorter ceremony, no `if (tier)` branching in CSS). Skip is opaque+focusable from frame 0 (tap 1 = land all beats via a `.landed` class hard-override; tap 2 = close; label swaps Skip→Close, same DOM node). Reduced-motion opens the dialog directly at the terminal composition with the ring-break rendered as a static engraved rosette (three hairline circles at launch radii).
3. **Ceremony tiers** (Rule C): Marker / Ascent / Summit from the **modal** value of `feasibilityTierAtCompletion`, `xpBasis.weeks`, `targetsMet`, evidence density (never XP — it saturates at 700). The hero never shrinks; the evidence scales.
4. **Token semantics fixed**: burn `goaldmine.celebrated.goal.<goalId>.<capturedAt>` on the dialog's actual first paint AND only when `document.visibilityState === "visible"` — never on blind effect mount (the current bug). Monument+flourish uses the same token; overlay-shown implies flourish-skipped (the overlay IS the first-view ceremony; the monument flourish fires only when the overlay didn't, e.g. token burned by overlay → no double ceremony — exact interplay per architecture).
5. **Ship-regardless spine** (report §7.1) + a11y/pre-existing fixes: celebration above the fold; both duplicate 🏆 deleted from the achieved card; `Completion card →` promoted to 44px button (`Make a share card`, keepsake framing); Reopen card demoted below Story; `usePrefersReducedMotion` hook + guard on ReadinessChart (live bug on /progress + Story); StrikeBand light-mode AA fix; `Card` data-testid prop; zero-target-safe copy for the missing-series hint.

### 1.3 Success Criteria
- First completion view = staged ceremony (or its one-frame reduced-motion equivalent); every later state = the permanent monument; screenshot-diff of reduced-motion vs settled frame is EMPTY (the Rule A regression test).
- Screen readers read the monument as ordinary content (no live regions, no aria-hidden text); overlay is fully dismissible, Skip focusable at t=0, no focus trap bugs.
- Both palettes AA per report §8.4; rust↔gold never touch (10–18px⚠ gap, verified in cream first).
- All 4 gates green; ledger rows ticked.

## 2. User Stories
| ID | As a... | I want... | So that... | Priority |
|---|---|---|---|---|
| US-001 | user completing a goal | a first-view ceremony that lands the weight of what I did (staged reveal of MY numbers) | I feel genuine pride | Must |
| US-002 | user revisiting the goal | a permanent, proud monument — not a missed moment | the pride is an artifact | Must |
| US-003 | reduced-motion / SR user | the full composition, readable, nothing lost | ceremony ≠ motion | Must |
| US-004 | user with a modest goal | an honest, composed ceremony (fewer beats, same dignity, hero never shrinks) | no overclaiming, no condescension | Must |
| US-005 | user | a 44px "Make a share card" keepsake CTA | the share is an epilogue, never the climax | Should |

## 3. Functional Requirements

### 3.1 Core
1. `src/lib/goal-assay-core.ts` (pure, client-safe, unit-tested): `ceremonyTier(...)` (modal-not-max), `heroStatPrecedence(...)`, honesty guards (report §8.5: ceiling guard — score===ceiling<100 never the hero number; coverage guard — score never without denominator when tested<total; framing copy "weighted progress across your targets"; readinessSeries-null ambiguity handled), evidence-row builder porting `TargetRow` logic from `completion-card.tsx:99-147` + reserve-slot-for-first-miss.
2. `src/components/goal-assay/GoalAssayHero.tsx` (server): Bullseye (existing component, one-prop size change) + annulus (border-radius div, NOT SVG; r per report §7.4.2: ≈119-121 at 224 hero = 14px⚠ gap from the VISIBLE 105px rust radius) + eyebrow `GOAL COMPLETE` on plain background.
3. `src/components/goal-assay/AssayTargetRows.tsx` (server): evidence rows; zero-target → one honest sentence (Marker floor).
4. `src/components/goal-assay/AssayFlourish.tsx` ("use client", imperative-only, no setState-in-effect): monument flourish (~700ms⚠, budget 620-780) — rim disc cap 1.04-1.06⚠ (1.08 CLIPS the viewBox — verified), inner discs ≤1.10, flying ring terminal 2.0-2.6⚠ with `overflow-x: clip` on page root, `will-change` on the flying ring only + removed on animationend.
5. `src/components/goal-assay/SummitSheet.tsx` ("use client"): full-bleed dialog variant on the BottomSheet foundation (sibling panel class, panel bg `--background` not `--card`); beat map per phase-a D1 (B1-B7 with fill-mode both, delay-ladder custom properties); Skip/Close semantics; token burn on open+visible; `.landed` skip class; reduced-motion terminal frame with engraved-rosette rings.
6. `src/app/globals.css`: ALL new keyframes/classes/delay ladder/reduced-motion blocks — nothing animates outside this file. Sequencing = keyframes + animation-delay + **fill-mode: both** (non-negotiable; NOT @starting-style — Safari 17.5 gate, chains snap on iOS 16-17.4).
7. `src/app/goals/[id]/page.tsx` achieved branch: monument hoisted to top; duplicate 🏆s deleted; one `computeGameState()` call for level diff + badges (sign-off 10.3 — QA must confirm page latency); Reopen demoted below Story; SummitSheet mounted with the ~11 plain scalars.
8. `GoalCompletedCelebration.tsx`: superseded on this page but `celebrationStorageKey`/`shouldCelebrate` exports stay byte-identical (tests depend); component itself removed from the achieved page (its rendering role ends).
9. `usePrefersReducedMotion` hook (useSyncExternalStore) + `ReadinessChart` `isAnimationActive={!reduce}`.
10. Pre-existing defects: StrikeBand light AA (report 10.5), Card testid prop, StoryReadinessCard zero-target hint copy.

### 3.2 Out of Scope
Sound/haptics (rejected — iOS PWA reality); confetti/particles/glows (rejected outright, ledger 21); CSS count-up (rejected, emphasis-not-value instead); Recharts inside the ceremony; Bullseye→arc morph (nesting instead); 🏆 removal anywhere except the ceremony hero.

## 4. Technical Design
Per report §7 (files, testIDs, settled decisions, geometry corrections, SSR-rewind mitigation #1) — binding. No schema change, no migration, no new dependency, no new MCP tools (**no connector reconnect**). No new queries beyond the one `computeGameState()` call. Date formatting via existing pure string-split (never `new Date(dateKey)`).

## 5. UI/UX
Per report §2.1 composition, §5 storyboard, phase-a D1 frames, and the HTML pixel mockup — binding, with §9's 21 provisional values to verify at 390px in BOTH palettes (cream first — it's the failing case for rust↔gold and annulus stroke).

## 6. Edge Cases
Zero-target goal (readiness null → no readiness row, honest sentence, 2 stat cells); null/legacy snapshot (degraded card unchanged — no ceremony without a snapshot); token already burned (monument only, no overlay, no flourish); storage blocked (ceremony may repeat — accept, degrade silently); visibilityState hidden at mount (don't burn); levelBefore===levelAfter (no crossing line); no badges (omit block); Reach unrated (omit row, never render empty); SSR rewind (≤12px displacements, rim never fades); backdated (subline suffix).

## 7. Security
No new surface. No data changes. Client leafs receive plain scalars only.

## 8. Acceptance Criteria
1-4. [ ] tsc / lint / vitest / build clean (baseline 1015)
5. [ ] goal-assay-core unit tests: tier modal logic, honesty guards, reserve-slot rule
6. [ ] Reduced-motion === settled-frame (component render-smoke asserting identical markup/classes under both, per the report's regression-test rule)
7. [ ] Skip semantics: `.landed` overrides all beats; label swap same node
8. [ ] Token burns only on visible first paint (unit-testable via exported pure predicate)
9. [ ] All 12 testIDs present; CTAs ≥44px; `:active` states (global tap-highlight is transparent)
10. [ ] `GoalCompletedCelebration` exports unchanged; its test suite still green
11. [ ] ReadinessChart reduced-motion guard on both surfaces
12. [ ] Ledger: every UXR-GCU row ticked shipped/reworked/dropped with evidence
13. [ ] Founder visual pass at 390px both palettes for the §9 provisional list (post-merge; ledger rows updated after)

## 9. Open Questions
None — sign-offs resolved: Bullseye hero ✓ · overlay YES (build D1 on the monument) ✓ · "The Assay" naming ✓ · one-form-all-tiers (orchestrator call per D1 author's lean; DA may challenge) · computeGameState on page ✓ pending latency check.

## 10. Test Plan
Unit: goal-assay-core (tiers/guards/rows), token-burn predicate, hook. Component render-smoke (react-dom/server precedent): monument Summit + Marker fixtures; reduced-motion equivalence. Gates + build. Browser: founder walkthrough (§9 list) — agents cannot judge the tuning values; QA verifies structure/classes/budget-sums instead.

## 11. Appendix
Research: `docs/ux-research/goal-celebration-upgrade.md` · phase-a companion · HTML mockup · ledger. Decisions log: this session (Bullseye hero, overlay, naming approved by founder 2026-08-09).
