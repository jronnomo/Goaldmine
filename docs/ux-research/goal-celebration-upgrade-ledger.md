# Recommendation Ledger — Goal-Completion Celebration Upgrade ("The Assay")

**Feature:** Make achieving a goal feel monumental — `/goals/[id]`, `status === "achieved"`
**Issue:** none yet (research-first; a `/feature-dev` PRD follows)
**Report:** [`goal-celebration-upgrade.md`](./goal-celebration-upgrade.md) · **Mockup:** [`goal-celebration-upgrade.html`](./goal-celebration-upgrade.html) · **Phase-A options:** [`goal-celebration-upgrade-phase-a.md`](./goal-celebration-upgrade-phase-a.md)

Stable IDs `UXR-GCU-NN` — assigned once, **never renumbered**. Status starts `proposed`. The **implementing PR ticks each row** to `shipped` / `reworked` / `dropped` with a SHA, `file:line`, or a one-line reason in Evidence.

Rows tagged `tuning⚠` / `decoration⚠` / `a11y` are the ones a future audit cares about most — **confirm them on a real 390px device in both themes, light first** (light is the failing case for the two contrast-critical values, UXR-GCU-08 and UXR-GCU-04).

Two rows need explicit founder sign-off before implementation: **UXR-GCU-45** (retire the 🏆 as the ceremony hero glyph) and **UXR-GCU-46** (decline the overlay PRD US-007 already sanctions).

Four rows (**UXR-GCU-48 … 51**) are pre-existing defects found during this research. They are **not part of this feature** and should be filed independently — UXR-GCU-49 in particular is a live a11y bug on two shipped surfaces.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-GCU-01 | Direction = **The Assay**: pride is a permanent in-page artifact; the flourish is removable garnish | layout | proposed | |
| UXR-GCU-02 | Move the ceremony above the fold; it currently mounts as the last child of the Completed card and burns its token unseen | layout | proposed | `page.tsx:346-351` |
| UXR-GCU-03 | Delete both 🏆 from the achieved card (header + celebration) | layout | proposed | `page.tsx:284`, `:90` |
| UXR-GCU-04 | Promote `Completion card →` to a 44px button labelled `Make a share card` | a11y | proposed | live ≥44px invariant violation |
| UXR-GCU-05 | Demote the Reopen card below the Story section (peak–end) | layout | proposed | `page.tsx:365-377` |
| UXR-GCU-06 | Hero = filled `<Bullseye>` at 200–240px, rust, unmodified component | component | proposed | |
| UXR-GCU-07 | Hero nested inside a closed gold annulus — closes the Bullseye↔sweep-arc seam by nesting, not morphing | decoration⚠ | proposed | verify visually |
| UXR-GCU-08 | **Mandatory 10–18px background gap between rust and gold** (measured 1.35:1 dark / 1.16:1 light) | tuning⚠ | proposed | **verify in cream first — the failing case** |
| UXR-GCU-09 | Annulus drawn at r≈119–121 for a 224px hero, derived from the 105px *visible* rust radius | tuning⚠ | proposed | |
| UXR-GCU-10 | Objective in DM Serif Display 400 at `text-4xl` — reuses the existing app max, no new precedent | layout | proposed | |
| UXR-GCU-11 | Eyebrow `GOAL COMPLETE` on plain `--background`, never on `--accent-soft` | a11y | proposed | 4.14:1 fails AA in light |
| UXR-GCU-12 | Port `TargetRow` in-app as `WHAT MOVED` (met-first, `✓`/`·`, `start → final units`, cap 6 + `+N more`) | component | proposed | `completion-card.tsx:99-147` |
| UXR-GCU-13 | **Rule B — render the misses**, staggered at the same tempo and style as the hits | copy | proposed | anti-saccharine guarantee |
| UXR-GCU-14 | The 6-row cap **reserves its last slot for the first unmet target** — else met-first hides every miss behind `+N more` | component | proposed | |
| UXR-GCU-15 | **Rule A — "static IS final"**: author finished states; keyframes displace at 0% and return at 100% with `fill-mode: both` | animation | proposed | |
| UXR-GCU-16 | Reduced motion = one `animation: none` block, byte-identical to settled; screenshot-diff must be empty | a11y | proposed | replaces the `display:none` bug |
| UXR-GCU-17 | **Rule C — scale by beat count, never loudness**; tier = modal of Reach + weeks + targetsMet + evidence density | layout | proposed | |
| UXR-GCU-18 | **Never scale ceremony weight off XP** — `goalAchievedXp` saturates at 700 | layout | proposed | `rules.ts:128-150` |
| UXR-GCU-19 | Reach tier must not become a loudness/colour dial — Epic/Legendary `--warning` is "alarming-not-prizey" | decoration⚠ | proposed | `epic61-coherence-audit.md:79` |
| UXR-GCU-20 | **The hero never shrinks by tier** — the claim is constant, only the evidence scales | layout | proposed | |
| UXR-GCU-21 | Tier thresholds 0–3 / 4–11 / 12+ weeks; evidence density 0–2 / 3–19 / 20+ | tuning⚠ | proposed | re-fit against real completions |
| UXR-GCU-22 | Flourish ≈700ms total; ring pinned at ~690ms across all tiers so motion never becomes a ranking | tuning⚠ | proposed | |
| UXR-GCU-23 | Annulus and flying ring are **two separate DOM nodes** born at the same delay — makes the flourish deletable | animation | proposed | |
| UXR-GCU-24 | Discs seat outer→in via `transform-box: fill-box` + `scale()`; `Bullseye.tsx` unmodified | animation | proposed | |
| UXR-GCU-25 | **Rim overshoot capped at 1.04–1.06** — 1.08 clips the viewBox (15×1.08 = 16.2 > 16) | tuning⚠ | proposed | verified geometrically |
| UXR-GCU-26 | Sequencing via `@keyframes` + `animation-delay` + `fill-mode: both`, **never `@starting-style`** (Safari 17.5+) | animation | proposed | would snap to end state on iOS 16–17.4 |
| UXR-GCU-27 | **Fold rule** — cap animated rows at 3–5; nothing below the fold carries a class | tuning⚠ | proposed | correctness, not optimisation |
| UXR-GCU-28 | `overflow-x: clip` (not `hidden`) on the page root for the expanding ring | animation | proposed | |
| UXR-GCU-29 | `will-change` on the flying ring only, added with the class and removed on `animationend` | animation | proposed | |
| UXR-GCU-30 | One-shot gate unchanged: `celebrationStorageKey`/`shouldCelebrate` exported byte-identical; write on mount, before play | component | proposed | `GoalCompletedCelebration.test.ts` must pass unchanged |
| UXR-GCU-31 | `Replay` affordance (44×44 hit area) — does **not** write localStorage; scrolls only under reduced motion. Plus `?replay=1` QA bypass | a11y | proposed | |
| UXR-GCU-32 | Degraded/no-snapshot path gets a **hollow** Bullseye inside the same gold annulus, no flourish, no fabricated zeros, permanence line suppressed | component | proposed | `Bullseye.tsx:61-72` |
| UXR-GCU-33 | Surface `badgesUnlocked` + `levelBefore→levelAfter` on the page via one `computeGameState()` call | component | proposed | prefix-sum precedent `compare.ts:417-422` |
| UXR-GCU-34 | Permanence line `Frozen at completion. This never recomputes.` — suppressed on the degraded path | copy | proposed | truthful only because R9 binds |
| UXR-GCU-35 | Honest readiness copy: *"weighted progress across your targets"* + ceiling and coverage guards | copy | proposed | untested targets count 0 at full weight |
| UXR-GCU-36 | Share is a **keepsake epilogue**, never the climax and never gated; reuse `RecapClient` handler incl. `AbortError`-is-success | copy | proposed | over-justification effect |
| UXR-GCU-37 | Share PNG fetched **only on tap** — never speculatively (route is `force-dynamic` + Satori per hit) | component | proposed | |
| UXR-GCU-38 | **Ship no sound and no haptics.** `navigator.vibrate` unsupported on iOS Safari incl. PWAs; audio unreliable on navigation | decoration⚠ | proposed | revisit only if WebKit ships Vibration, as a whole-app decision |
| UXR-GCU-39 | Reuse the `@keyframes bullseye-pop` **rule**, never the `.bullseye-pop` **class** — keeps Today decoupled | animation | proposed | |
| UXR-GCU-40 | Today QuestCard single-completion-moment invariant untouched (disjoint keys, classes, routes) | layout | proposed | |
| UXR-GCU-41 | Reject CSS-only XP count-up (`@property` + `counter()`); animate emphasis via `macro-flash` + `bullseye-pop` on real text | animation | proposed | generated content unselectable + unreliable in VoiceOver |
| UXR-GCU-42 | Reject Recharts inside the ceremony; the readiness arc stays on the page | animation | proposed | 0×0 measure, no `cubic-bezier`, paint-per-frame |
| UXR-GCU-43 | Reject confetti / particles / sparkles / glows / gradients outright | decoration⚠ | proposed | no precedent; a glow blurs the mandatory gap |
| UXR-GCU-44 | Mitigate the SSR pre-hydration rewind by keeping all `0%` displacements ≤12px and never fading the rim | tuning⚠ | proposed | escalate to a pre-paint attribute only if it visibly fails |
| UXR-GCU-45 | **CHALLENGE** — retire 🏆 as the ceremony hero glyph only (challenges PRD §5.3); **needs sign-off** | component | proposed | §10.1; fallback = type-led hero |
| UXR-GCU-46 | **CHALLENGE** — decline the sanctioned first-view overlay (diverges from PRD US-007); **needs sign-off** | layout | proposed | §10.2; D1 fully specified if overruled |
| UXR-GCU-47 | Name the feature **"The Assay"**; components `GoalAssay*` | copy | proposed | §10.4 |
| UXR-GCU-48 | **BUG (separate)** — `StrikeBand.tsx:24` accent-on-accent-soft is 4.14:1, fails AA in light | a11y | proposed | file independently |
| UXR-GCU-49 | **BUG (separate)** — Recharts 1500ms default animation unguarded for reduced motion on `/progress` + Story card | a11y | proposed | ship `usePrefersReducedMotion` regardless |
| UXR-GCU-50 | **BUG (separate)** — `page.tsx:493` passes `data-testid` to `<Card>`, which does not accept it | component | proposed | |
| UXR-GCU-51 | **BUG (separate)** — `StoryReadinessCard`'s "reopen and re-complete to record it" is misleading for zero-target goals | copy | proposed | |
| UXR-GCU-52 | Extract `ceremonyTier` / `heroStatPrecedence` / honesty guards into a pure, unit-tested, Prisma-free `goal-assay-core.ts` | component | proposed | |
