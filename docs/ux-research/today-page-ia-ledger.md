# Recommendation Ledger — Today-page IA Consolidation

**Report:** [`today-page-ia.md`](./today-page-ia.md) · **Mockup:** [`today-page-ia.html`](./today-page-ia.html)
**Slug:** `today-page-ia` · **Opened:** 2026-08-10

> **IDs are stable and are never renumbered.** `Status` starts at `proposed`. The implementing PR ticks each row to `shipped` / `reworked` / `dropped` and fills `Evidence` with a SHA, a `file:line`, or a one-line reason.
> Rows typed **`tuning⚠`** or **`decoration⚠`** are the ones future audits care about most — none of them may ship without a visual check on a real 390×844 device in both themes.

| ID | Recommendation | Type | Status | Evidence |
|---|---|---|---|---|
| UXR-TIA-01 | Adopt the 5-tier card grammar (Tier 0 hero / 1 primary Card / 2 compact strip with no `h2` / 3 collapsed lid / 4 chip). Flatness is the bloat. | layout | proposed | |
| UXR-TIA-02 | Structural rule: **no TRACK-zone surface may be a Tier 1 Card.** This is what prevents the flat-ten-cards regression. | layout | proposed | |
| UXR-TIA-03 | Reorder `page.tsx:468-657` to the new manifest — nutrition 9 → 4, Reach 5 → chip, deferred → TRACK lid, Recent cut. | layout | proposed | |
| UXR-TIA-04 | Land the reorder as **two commits**: (1) pure extraction to an ordered `{key,node}` manifest, byte-identical order; (2) the reshuffle. A combined 190-line diff is unreviewable. | layout | proposed | |
| UXR-TIA-05 | Manifest uses `{key, node}` in literal source order. **Reject a `priority` field with a runtime sort** — it destroys the table-of-contents benefit and invites persisted per-user ordering (a data-model change). | layout | proposed | |
| UXR-TIA-06 | Manifest keys must be stable string literals, **never the array index** — index keys re-key subtrees on conditional appear/disappear, unmounting everything below (would slam an open `MealEditButton` sheet shut mid-edit). | component | proposed | |
| UXR-TIA-07 | New `FuelRail` (Tier 2, `src/components/today/FuelRail.tsx`) at slot 4, replacing the 283–331px Nutrition Card. Server component, whole strip is one `<Link href="/nutrition">`. | component | proposed | |
| UXR-TIA-08 | `FuelRail` uses the `h-1.5 rounded-full` track + `bg-[var(--accent)]` fill (`CeilingRule.tsx:47` grammar). **Never a Bullseye** — `Bullseye.tsx:136-143` `ceil(p×4)` at `size≥20` renders any p>0.75 byte-identical to `filled`, so the shipped `size={20}` day-total strip currently shows "done" at 78% of calories. Honesty fix. | component | proposed | |
| UXR-TIA-09 | **BLOCKING.** Extract `sumLoggedDayMacrosWithPlanFallback(logs, plan)` into `src/lib/nutrition-macros.ts` and have both `FuelRail` and `NutritionToday` call it. `NutritionToday.tsx:162-170` uses a plan-target fallback; `sumLoggedDayMacros:31` does not — mixing them prints two contradicting day totals. | component | approved | Delegate-approved as BLOCKING: single shared fallback-aware macro sum — two contradicting calorie totals is a correctness bug, not a style choice. |
| UXR-TIA-10 | `FuelRail` leads with **remaining**, not consumed (goal-gradient). Inverts the shipped ordering at `NutritionToday.tsx:261-283`. | copy | proposed | |
| UXR-TIA-11 | `FuelRail` zero-row: render `Nothing logged yet` + the action rather than `return null` (a new user must discover logging) — a deliberate departure from `TodayMacroSummary.tsx:25`. With logs but no plan target: `No daily target set` (verbatim `NutritionToday.tsx:290`), no meter. | copy | proposed | |
| UXR-TIA-12 | `FuelRail` is a `<Link>` for wayfinding, **not** a log trigger. Fitts's law: a target at px ~300 is outside the thumb arc; the fixed bottom-edge Log tab is already optimal. | layout | proposed | |
| UXR-TIA-13 | Reach chip (`ReachMeter size="sm" label` + `12 wk`) into the hero eyeline's already-empty `justify-between` right slot at `page.tsx:496`. 0px cost. Never animated (UXR-63-21). | layout | proposed | |
| UXR-TIA-14 | **Cut** the `FeasibilityReadout` Card from Today (`page.tsx:555-561`) — byte-for-byte duplicate of `goals/[id]/page.tsx:604`, read ~0.03×/day. | layout | proposed | |
| UXR-TIA-15 | **Correction to the headline claim:** cutting the card while keeping the chip saves **0 queries** — both need `computeGoalFeasibility`. The win requires a narrowed `getReachTier()` read. Worth up to 2 queries/target plus, per rolling target, a `findUnique` + an **unbounded all-history `workout.findMany` with nested sets** (`goal-targets.ts:173-190`); cumulative metrics add a sequential per-week loop, up to 17 round-trips (`rarity.ts:113-146`). | component | approved | Delegate-approved: narrowed Reach query so the FeasibilityReadout cut actually removes its cost. |
| UXR-TIA-16 | Render no Reach chrome at all when `tier === null` — removes a full Card of apology copy from a brand-new user's first screen. | layout | proposed | |
| UXR-TIA-17 | New `SessionDossier` (Tier 1) — one Card, blocks as native `<details>` rows (`text-sm font-medium` label + `text-xs tabular-nums` digest + `▼`), replacing the 3-Card block stack and the 486–586px `CompletedWorkoutCard`. | component | proposed | |
| UXR-TIA-18 | Completed-day dossier keeps the **receipt** (`4:12 PM · 5 exercises · 18 sets`) in the summary and the set list in the body — peak-end + IKEA effect. Collapse the detail, never the acknowledgment. | component | proposed | |
| UXR-TIA-19 | **ADOPTED RULE: `defaultOpen` may depend only on state that cannot change without a full navigation.** Every lid ships a literal (`false` for Tier-3, `true` for the dossier). `resolveDay().todayTask` is the only sanctioned data dependency. | component | proposed | |
| UXR-TIA-20 | Do **not** use `defaultOpen={loggedNutrition.length === 0}` or `{todayCompletedDetails.length === 0}` on Today — the Log sheet's `safeRevalidate("/")` (`food-actions.ts:349,446,541,665`) flips the prop and React calls `removeAttribute("open")`, slamming the section shut under the user's finger. Verified in react-dom 19.2.4 `updateProperties`. | component | proposed | |
| UXR-TIA-21 | Comment the accident at `days/[dateKey]/page.tsx:287` — `defaultOpen={completedWorkouts.length === 0}` is safe **only** because the Log sheet has no workout row today. The day it gains one, that precedent becomes UXR-TIA-20's bug. | component | proposed | |
| UXR-TIA-22 | Deferred banner + `opacity-60` block stack (`page.tsx:598-609`, 916px) → one Tier-3 lid titled `Deferred today — {title}`. | layout | proposed | |
| UXR-TIA-23 | **Drop `opacity-60` from the deferred stack.** `--muted #7A5E3A` at 60% over `--card #FFFBF0` ≈ 2.6:1 — an AA failure on content the user can open. The closed lid plus the word "Deferred" carries "not today" better than dimming. | a11y | proposed | |
| UXR-TIA-24 | Demoted `BaselineBlockCard` (`page.tsx:617-619`) → Tier-3 lid, `defaultOpen={false}`. | layout | proposed | |
| UXR-TIA-25 | **Cut** the "Recent workouts" Card (`page.tsx:634-656`) **and its query** (`:213-218`). Strict subset of `/history` take:50, its own "All →" points there, and today's workout renders twice (`:580` and `:645`). | layout | proposed | |
| UXR-TIA-26 | If Recent workouts survives, narrow `include:{exercises:{include:{sets:true}}}` → `select:{id,title,startedAt,_count:{select:{exercises:true}}}` — only 3 scalars are consumed (`:647-650`). | component | proposed | |
| UXR-TIA-27 | **Fix the baseline-day lie.** Gate `page.tsx:586-587` on `dayBlocks.length===0 && deferredBlocks.length===0 && !showProminentBaseline && !resolved.plannedHikeToday`. For Program users render nothing (the timeline owns a better empty state at `TodayTimeline.tsx:50-53`); for zero-Program tenants use `No session scheduled today.` inside the Session card. | copy | proposed | |
| UXR-TIA-28 | New `ZoneDivider` — the word `Tracking` + `h-px flex-1 bg-[var(--border)]`. Renders **only** when the TRACK zone is non-empty. | decoration⚠ | proposed | |
| UXR-TIA-29 | Extract the local unexported `BlockCard` / `ExerciseRow` / `defaultBlockLabel` (`page.tsx:661-713`) to `src/components/today/BlockCard.tsx` — 53 lines out, zero behavioural risk. | component | proposed | |
| UXR-TIA-30 | Keep everything a Server Component. Only the optional 1-tap log button would be a client island; the reorder itself adds none. | component | proposed | |
| UXR-TIA-31 | **Non-goal, comment it in the manifest: never wrap `TodayTimeline` in a `CollapsibleCard`.** A live region inside `content-visibility:hidden` is removed from the a11y tree and a future announcement would be silently dropped. | a11y | proposed | |
| UXR-TIA-32 | **Ship zero new keyframes and zero new CSS classes.** Motion budget ledger: 11 REJECT, 3 ADOPT, none of which is a motion. | animation | proposed | |
| UXR-TIA-33 | Collapse/expand **snaps** — no `<details>` height animation. The house `.item-row-anim` grid-rows technique is structurally incompatible with `<details>` (`@starting-style` never re-fires on continuously-rendered content); the `::details-content` route would be three CSS firsts at once; every collapsible is below the fold where expansion fights iOS scroll momentum; and all 17+ existing `<details>` in the repo snap. | animation | proposed | |
| UXR-TIA-34 | **The FuelRail must not celebrate.** The once-per-day `bullseye-pop` is claimed by `TodayCelebration` (`localStorage["goaldmine.celebrated.<dateKey>"]`); a calorie target is not a completion (the failure mode is going over); and it is a visual no-op above p>0.75 (F2). | animation | proposed | |
| UXR-TIA-35 | **REJECTED, keep rejected:** `.macro-flash` re-keyed on the FuelRail numerals. Mount-parity defect — a CSS `animation` fires on first mount too, and unlike `MealComposer.tsx:317` there is no `flashMacros === null` gate, so **every cold load of Today would flash the calorie numeral** (~15–30×/day vs ~4.5 real changes). | animation | proposed | |
| UXR-TIA-36 | **Correction:** the sheet does **not** auto-dismiss after "Log meal" (`MealComposer.tsx:1384` + `LogLauncher.tsx:301`) — it stays open, resets, and refetches. Three acknowledgments already land inside the sheet before Today is seen again. Do not add a fourth on the page behind it. | animation | approved | Delegate-approved: default the Log sheet to 'meal' — matches owner's stated highest-frequency write; 4→3 taps. |
| UXR-TIA-37 | **Correction:** the sheet dismiss is **0ms** — `.bottom-sheet:not([open]){display:none}` (`globals.css:262`), no `allow-discrete` anywhere. The app already ships animate-in / snap-out on its busiest surface. Do not "fix" this. | animation | proposed | |
| UXR-TIA-38 | Add `motion-safe:transition-transform` to `CollapsibleCard.tsx:24` — the only animated thing on the Today path with **no** reduced-motion guard (a Tailwind utility that none of the 16 `globals.css` guards cover). Zero new CSS. | a11y | proposed | |
| UXR-TIA-39 | Add `motion-safe:` to `LogLauncher.tsx:120`'s `animate-pulse` — required if UXR-TIA-41 ships, since the skeleton then renders on every sheet open instead of rarely. | a11y | proposed | |
| UXR-TIA-40 | **Keep** the permanently-empty 16px `aria-live` region at `TodayTimeline.tsx:63-68` and the mirror at `MealComposer.tsx:1393`. Reserved space preventing layout shift (UXR-PV-19); a live region only announces into an element that already existed. Do not delete as "an empty div." | a11y | proposed | |
| UXR-TIA-41 | **SIGN-OFF (outside `page.tsx` scope):** `LogLauncher.tsx:136` `useState<ExpandedRow>(null)` → `"meal"`. Kills the zero-information tap #2. 4 taps → 3, ≈ −1,588 taps/yr against +52 for the weekly weigh-in (~31:1). Use a **constant** default, never context-aware — adaptive defaults destroy the spatial memory that makes a 3-tap path feel like one gesture. | component | proposed | |
| UXR-TIA-42 | **SIGN-OFF:** reorder `NutritionToday` to strip-before-list so a collapsed detail still shows the day total. One line outside `page.tsx`. | component | proposed | |
| UXR-TIA-43 | **SIGN-OFF (optional):** widen `CollapsibleCard`'s `title` from `string` to `ReactNode` (matching `Card.tsx:10`) so a closed lid can carry a `text-xs tabular-nums` digest. If an `action` prop is added instead, it must be a **sibling** of `<summary>`, never a child (nested-interactive / focus-order bug). | component | proposed | |
| UXR-TIA-44 | **REJECT: no page-level sticky quick-log bar.** Two fatal reasons: it would inherit and amplify `BottomNav`'s missing `env(safe-area-inset-bottom)` despite `viewportFit:"cover"`; and it would be the app's first *document-level* sticky, hitting iOS Safari's collapsing URL bar — whereas both existing stickies live in a contained `85dvh` scroller and still carry a documented iOS caveat. A `fixed` variant means ~110–120px of permanent chrome on a page whose complaint is bloat. | layout | proposed | |
| UXR-TIA-45 | **SEPARATE PR:** `cache()` on `getActiveProgram` (`program.ts:98`) and `getRotationOwnerGoal` (`goal-focus.ts:162`) — ~10–16 duplicate queries/render. Tenant-isolation blast radius (12 MCP call sites run under ALS outside any React render, where `cache()` is a no-op passthrough): **must ship with an assertion test**, shape per `program.acceptance.test.ts`. | component | proposed | |
| UXR-TIA-46 | **SEPARATE PR:** add `env(safe-area-inset-bottom)` padding to `BottomNav` — its lower ~34px currently sits under the iOS home indicator. Precedent: `NutritionList.tsx:239`. Prerequisite for any future page-level sticky. | a11y | proposed | |
| UXR-TIA-47 | **SEPARATE PR:** thread a `ctx` into `resolveDay(now)` at `page.tsx:219` — ~7 avoidable queries (`calendar.ts:1127`). | component | proposed | |
| UXR-TIA-48 | **OPTIONAL GRAFT, follow-up:** the repeatability line — `Handstand ≥20s — 3 of 6 sessions · 2 attempts today`. Closes the sharpest gap in the app (highest-cadence write, zero Today surface; `grep rolling src/**/*.tsx` = 0 hits). Defensible against "no gamification" only because `computeRollingHits` **can regress** (`rolling-metrics.ts:140`: *"a consistency measure, not a trophy case"*). | component | proposed | |
| UXR-TIA-49 | The repeatability line is **not free**: `recentWorkouts` is `take: 3` (`page.tsx:216`), so a 6-session window needs `take: 8` or a second query, else "3 of 6" silently reads "3 of 3". | component | proposed | |
| UXR-TIA-50 | Named `data-testid`s: `today-fuel-rail`, `today-fuel-meter`, `today-reach-chip`, `today-session-dossier`, `today-session-block-{i}`, `today-zone-divider`, `today-deferred-lid`, `today-baselines-completed-lid`, `today-repeatability`. | component | proposed | |
| UXR-TIA-51 | **Non-goal:** do not persist collapse state in `localStorage` — reading storage during render forces `suppressHydrationWarning` (an exemption the repo **retired** after #253) or a two-pass mount. The only clean route is a server-side `cookies()` read, which is a separate feature. | a11y | proposed | |
| UXR-TIA-52 | **Non-goal:** do not add an `@starting-style` rule to any Today section — it would fire on every page load, the same mount-parity failure as UXR-TIA-35. | animation | proposed | |
| UXR-TIA-53 | ⚠ **Resolve the fold arithmetic.** Two passes measured `BottomNav` at 53px and 58px → fold at **742px** vs **737px**. The mockup draws 742. Changes which timeline row is clipped. | tuning⚠ | proposed | |
| UXR-TIA-54 | ⚠ FuelRail height **72–84px**. | tuning⚠ | proposed | |
| UXR-TIA-55 | ⚠ Tier-3 collapsed lid height **56–60px**. | tuning⚠ | proposed | |
| UXR-TIA-56 | ⚠ ZoneDivider height **20–28px**. | tuning⚠ | proposed | |
| UXR-TIA-57 | ⚠ SessionDossier **190–215px** collapsed / **440–500px** open. | tuning⚠ | proposed | |
| UXR-TIA-58 | ⚠ Tier-1 Card cap in the fold: **2–3**. | tuning⚠ | proposed | |
| UXR-TIA-59 | ⚠ Block-overflow threshold for "Show all N blocks": **3–5** (`compare/page.tsx:55-62` idiom). | tuning⚠ | proposed | |
| UXR-TIA-60 | ⚠ **Tier 2 and Tier 3 may read as the same visual weight at 390px.** Compare side by side in both themes — the single biggest risk to the grammar. | tuning⚠ | proposed | |
| UXR-TIA-61 | ⚠ The Reach chip may force the hero eyeline to wrap with a long phase name (~18px). Fallback: drop the weeks label. | tuning⚠ | proposed | |
| UXR-TIA-62 | ⚠ FuelRail copy A/B — consumed-first (matches shipped `TodayMacroSummary`) vs remaining-first (matches goal-gradient). | tuning⚠ | proposed | |
| UXR-TIA-63 | ⚠ On a baseline day, timeline rows 6–8 land at ~846px — the actual test rows fall below the fold on the highest-stakes day of the program (6.4% of days). Recommend accepting; verify tolerable. | tuning⚠ | proposed | |
| UXR-TIA-64 | ⚠ The 3-tap variant (UXR-TIA-41) exposes **~0–660ms** of latency that tap 2 previously hid. Measure on device. | tuning⚠ | proposed | |
| UXR-TIA-65 | ⚠ Projected scroll totals (~1,141 / ~1,274 / ~1,409px) are arithmetic, not rendered measurements. | tuning⚠ | proposed | |
| UXR-TIA-66 | ⚠ The `opacity-60` contrast failure is computed at ~2.6:1. Verify the exact ratio before citing it. | tuning⚠ | proposed | |
| UXR-TIA-67 | ⚠ Gantt offsets — server-action round trip (~300–800ms) and tap-to-tap dwell (~800–1,600ms) are placeholders. Bar durations are real; offsets are illustrative. | tuning⚠ | proposed | |
| UXR-TIA-68 | ⚠ **decoration:** the FuelRail meter. Cheaper alternative (type alone) was considered and rejected because the meter is the shipped `CeilingRule.tsx:47` grammar and the honest replacement for a lying Bullseye. **Verify it reads at 390px in both themes and that the fill is visible at low percentages.** | decoration⚠ | proposed | |
| UXR-TIA-69 | ⚠ **decoration:** the ZoneDivider. Cheapest possible zone signal (one hairline, one 10px word, zero new CSS). **Verify it does not read as a broken card edge and that the non-empty gate works.** | decoration⚠ | proposed | |
| UXR-TIA-70 | ⚠ **decoration:** the Reach chip's 5×(3×9px) segments. **Verify the segments are distinguishable at that size in both themes** given the iso-luminant palette. | decoration⚠ | proposed | |
| UXR-TIA-71 | ⚠ **Owner decision:** move `CharacterHeader` below the Tracking rule? Worth 92–108px of fold. Research position: **leave it** (brand face, one 72px tap target, the streak is a real hook, and moving it fires `LevelUpCelebration` off-screen). | tuning⚠ | proposed | |
| UXR-TIA-72 | ⚠ **Owner decision:** cutting "Recent workouts" is the one removal he might miss. Fallback: Tier-3 lid at last position. | tuning⚠ | proposed | |
| UXR-TIA-73 | ⚠ **Owner decision:** is "day met" (calories at target) a strike moment? Research position: **no** — it happens daily, strikes must be rare, and going over is the failure mode. | tuning⚠ | proposed | |
| UXR-TIA-74 | ⚠ **Ruling needed:** `LevelMedallion.tsx` sets `font-family: var(--font-display)` inside `CharacterHeader`, contradicting "DM Serif Display is never used on the Today page." | tuning⚠ | proposed | |
| UXR-TIA-75 | ⚠ `BaselineBlockCard`'s `N.` ordinal prefix numbers a flat block stack that the tier grammar deletes. Render with `index={null}`. | tuning⚠ | proposed | |
| UXR-TIA-76 | Pre-existing a11y violation found in passing: the "Get started →" link (`page.tsx:166-171`) is an inline `text-sm` with **no `min-h-[44px]`**. Unrelated to this pass; fix opportunistically. | a11y | proposed | |
| UXR-TIA-77 | **Locked decisions NOT reopened**, recorded for the auditor: the 240ms sheet slide, the 320ms `bullseye-pop`, the `w-[64px]` mark lane, the Marked Lane treatment, UXR-63-21 (never animate Reach), UXR-PV-05 (iso-luminant — hue is never an identity channel), UXR-PV-15 (completed rows never re-sort), UXR-PV-19 (the reserved live region), and UXR-PV-90/PV-54 (no `<Suspense>` on this path). Evidence was logged suggesting the PV-90 ALS×streaming hazard may not be reachable from a page render — **no action requested**; and independently, deleting the read beats streaming it. | layout | proposed | |

---

## Type key

`copy` · `layout` · `animation` · `component` · `tuning⚠` · `a11y` · `decoration⚠`

## Counts at open

| Type | Rows |
|---|---|
| layout | 12 |
| component | 22 |
| animation | 7 |
| a11y | 9 |
| copy | 4 |
| **tuning⚠** | **20** |
| **decoration⚠** | **3** |
| **Total** | **77** |
