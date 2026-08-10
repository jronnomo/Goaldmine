# Recommendation Ledger — The Program Views

**Feature:** the five surfaces of the Program-model redesign (Sprint 6 / M4b) — Unified Today · `/program` · cross-goal calendar · `/progress` per-metric · SavedMeal quick-pick
**Issue:** none (research-first; the Sprint-6 stories on board #8 consume this)
**Report:** [`program-views.md`](./program-views.md) · **Mockup:** [`program-views.html`](./program-views.html)

Stable IDs `UXR-PV-NN` — assigned once, **never renumbered**. Status starts `proposed`. The **implementing PR ticks each row** to `shipped` / `reworked` / `dropped` with a SHA, `file:line`, or a one-line reason in Evidence.

Rows tagged `tuning⚠` / `decoration⚠` / `a11y` are the ones a future audit cares about most — **confirm them on a real 390px device in both themes.** Because the palette is iso-luminant (every chromatic token pair is 1.00–1.35:1 in grayscale), the acceptance test for every identity row is: **a grayscale screenshot must lose nothing.**

**Six sign-off rows RESOLVED 2026-08-10 by the run orchestrator as owner delegate (one-shot mandate, amendment A1); decisions + rationale in each row's Evidence column:** `UXR-PV-88` (the calendar cell doesn't fit — narrows the Bullseye-exclusivity invariant), `UXR-PV-89` (`ActivityGoalLink` has no remove tombstone), `UXR-PV-90` (`/program` v1 without sparklines contradicts the story AC), `UXR-PV-91` (suppress `OtherGoalsStrip`'s today block), `UXR-PV-92` (`CeilingRule` as divs not SVG), `UXR-PV-93` (accept slot re-flow on archive).

**Thirteen rows (`UXR-PV-94 … 106`) are pre-existing defects found during this research.** They are **not part of this feature** and should be filed independently — `UXR-PV-94/95/96/97` are live a11y bugs on shipped surfaces, and `UXR-PV-106` is a tenant-isolation hazard that `db:verify-isolation` would not catch.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-PV-01 | Direction = **Marked Lane** — a graft of A's economy, B's every-item-every-claim rule, and C's taught-once legend | layout | proposed | |
| UXR-PV-02 | Per-goal identity = monochrome geometric marks `● ■ ▲` (hollow `○ □ △`), never hue | component | proposed | |
| UXR-PV-03 | `▲` and **not** `◆` — `◆` is already the hardcoded scheduled-item marker (`MarkerIcon.tsx:30-42`) and would collide on the calendar | component | proposed | |
| UXR-PV-04 | Slot assignment is **derived** (`src/lib/goal-identity.ts`), never a schema column; sort `isFocus DESC, (kind==='project') ASC, createdAt ASC, id ASC` — the `id` tiebreak is not optional | component | proposed | |
| UXR-PV-05 | Hue is decoration only; the palette is iso-luminant (1.00–1.35:1 between every chromatic pair). Acceptance test: a grayscale screenshot loses nothing | a11y | proposed | |
| UXR-PV-06 | Three `update_goal_legend` calls migrate glyph **and** short label — zero schema change, and there is no `Goal.shortLabel` column to add | copy | proposed | |
| UXR-PV-07 | `MarkerIcon` gains optional `hue?`, applied **only** when `isMonochromeSafe(icon)` — emoji legends are COLR glyphs where `color:` is a silent no-op and must degrade, not fail invisibly | component | proposed | |
| UXR-PV-08 | Document the identity-stability hazard: a new **fitness** member goal pushes AWS out of slot 2 into `+N`; adding a project goal is safe | component | proposed | |
| UXR-PV-09 | One timeline; **every item carries every claim it serves** — no rotation-owner suppression (binding, blockers §3.2) | layout | proposed | |
| UXR-PV-10 | Mark lane is fixed-width, right-aligned, 3 slots + `+N`, inside the row's 44px target | layout | proposed | |
| UXR-PV-11 | Marks are **not** individually tappable; the whole lane is one 44px button opening the attribution sheet | a11y | proposed | |
| UXR-PV-12 | `MarkLegendStrip` teaches the marks once (~20px/surface) instead of word chips per row (~22px × N) | layout | proposed | |
| UXR-PV-13 | Mark state reuses the Bullseye's hollow/filled semantic; **the fan-out receipt IS the marks filling in place** — no separate checkbox, no separate receipt component | component | proposed | |
| UXR-PV-14 | Timeline row = two **non-nested** targets (title `<Link>` + lane `<button>`); a Link containing a button is invalid HTML and breaks keyboard + VoiceOver | a11y | proposed | |
| UXR-PV-15 | Fixed slot-ladder ordering via `src/lib/day-rhythm.ts`; completed rows stay in place and shrink — **never re-sort on completion** | layout | proposed | |
| UXR-PV-16 | `ScheduledItem.payload.rhythm` is the coach's ordering escape hatch — `payload` is already `Json?`, zero schema change; document it in `schedule_item` (three-places rule) | component | proposed | |
| UXR-PV-17 | Honest receipt distinguishes **counted** from **moved**; only AWS's readiness changes from the Monday walk | copy | proposed | |
| UXR-PV-18 | Receipt is driven by **server state**, never `useFormFeedback.saved` (self-clears at 1500ms, taking the only durable record with it) | component | proposed | |
| UXR-PV-19 | Always-mounted empty `aria-live="polite"` region in the timeline card — a live region only announces into an element that already existed | a11y | proposed | |
| UXR-PV-20 | **No optimistic mark fill** — the fill is the receipt for a DB write; filling early makes it a forgery on failure | component | proposed | |
| UXR-PV-21 | Gates use a flat `CeilingRule` bar (track + fill + 2px stile at ceiling + hatch above), same grammar as the shipped `h-1.5 rounded-full` bar | decoration⚠ | proposed | |
| UXR-PV-22 | The headline readiness numeral must **not** sit on a `Bullseye` — `progress={0.80}` renders 4/4 rings, byte-identical to `filled` (`Bullseye.tsx:136-143`) | component | proposed | |
| UXR-PV-23 | **Show `rawScore`.** Three gate copy states: HELD / OPEN-NOT-BINDING / CLEAR | copy | proposed | |
| UXR-PV-24 | Framing line once per card: `Gates are mastery checks — the score waits for them, it doesn't lose points.` No padlock, no `--danger`, no "blocked" | copy | proposed | |
| UXR-PV-25 | `measuredScore` caption for the untested-at-full-weight cliff — derived from `breakdown[]`, zero queries. `coverage.tested === 0` suppresses the number entirely ("Not measured yet") | copy | proposed | |
| UXR-PV-26 | `bodyFatPct` copy must say **"logged but not scored yet — the engine can't read this metric; it counts as 0 at weight .45"**, not "DEXA is scheduled Sep 3" | copy | proposed | |
| UXR-PV-27 | Maintenance targets (`start === target`) are **binary, not stuck**: `25 reps = full credit, 24 = zero. Pass/fail by design.` | copy | proposed | |
| UXR-PV-28 | A **gating** target with `start === target` can never clear — render it as a data-config error, not a stuck 0% | copy | proposed | |
| UXR-PV-29 | `ProgramBlockBand` — proportional segments by day count (14/56/49/25), current block filling as a mini progress bar, 2px `--target` goal-date tick | decoration⚠ | proposed | |
| UXR-PV-30 | Keep the "Spider-Man" archetype **off screen** — trademarked, per-user-meaningless, and "Lighter and Upside Down" already carries it | copy | proposed | |
| UXR-PV-31 | Never render "Block 1 of 4" — the numbering is zero-based; render `BLOCK 1` and let the band carry which-of-four | copy | proposed | |
| UXR-PV-32 | Per-gate rows use `Bullseye size={14} filled={cleared}` — binary, so `progressToRings` never runs and the glyph keeps its true meaning | component | proposed | |
| UXR-PV-33 | Calendar cell marker row `flex-wrap` → `flex-nowrap` (must land with `UXR-PV-88`) | layout | proposed | |
| UXR-PV-34 | `MARKER_CAP` semantic changes from "3 markers" to "**3 goals per cell**"; `DayDetail`'s list must follow or the panel disagrees with the cell | component | proposed | |
| UXR-PV-35 | Deload/travel windows = a **conditional** second grid row per week holding a span bar, positioned by inline `gridColumn` (Tailwind v4 JIT cannot see runtime class strings) | layout | proposed | |
| UXR-PV-36 | Boundary-crossing windows split into two segments cued by `rounded-l-full` / `rounded-r-full`; the flat edge reads as "continues" | layout | proposed | |
| UXR-PV-37 | The span bar is **not tappable** — `aria-hidden`, `pointer-events-none`; the window name goes into each covered cell's `aria-label` and `DayDetail` | a11y | proposed | |
| UXR-PV-38 | **Observance window (Aug 14–15): no band, no wash, no `✕`, no conflict wedge, no dashed-provisional top, no `--warning` rail cap.** One `—` in `--muted`. Label only in the tap sheet | layout | proposed | |
| UXR-PV-39 | The observance day gets **zero motion of any kind** — gate class *emission* in JSX, never a CSS override | animation | proposed | |
| UXR-PV-40 | Observance cells must resolve `confidence` (or be excluded from `inPlan`) or `deriveRailState` dashes the whole week's spine | component | proposed | |
| UXR-PV-41 | **A discriminator is required and does not exist**: `Plan.planJson.windows[]` with `{start, end, kind, label, suppressesExpectation}`. Until it ships, **no surface renders a "Deload" chip** | component | proposed | |
| UXR-PV-42 | The enum value is **`observance`**, not `sacred` — it generalises, it is neutral-precise, and "sacred" in a DB enum is the app presuming to name someone's grief | copy | proposed | |
| UXR-PV-43 | `suppressesExpectation` is a **behavioural** flag honoured by streak/adherence/"days since", not just a colour — otherwise the visual restraint is a lie told over honest data | component | proposed | |
| UXR-PV-44 | Shared metric = ONE series in `--foreground`, ONE `ReferenceLine` at the shared value, and two goal-chipped meanings below under a `SHARED BY 2 GOALS` eyebrow (same grammar as a Today row) | layout | proposed | |
| UXR-PV-45 | Cliff metrics get a status readout (`HOLDING 25` / `BELOW FLOOR · 23`), **never a progress bar** | component | proposed | |
| UXR-PV-46 | Two-metric overlay defaults to **small multiples**; progress-space normalisation only on explicit overlay; a dual `<YAxis>` costs 80px of 390px and must be opt-in | layout | proposed | |
| UXR-PV-47 | Frozen (R9) arcs: `--muted`, **stroke-only, no fill**, no ceiling stile, `FROZEN · <date>` eyebrow, terminal filled `Bullseye`. **Never dashed** — dashed means *provisional* here | component | proposed | |
| UXR-PV-48 | `readinessSeries === null` is ambiguous → render `readinessSeriesHint(targetsTotal)`, never an empty chart frame. One point → "A trend needs two." | copy | proposed | |
| UXR-PV-49 | Sparklines are a pure server-rendered SVG **seam-line**, not Recharts — a sparkline has no axes/tooltip/interaction; the house already hand-rolls `Bullseye`, `ReachMeter`, `XpBar` | decoration⚠ | proposed | |
| UXR-PV-50 | `SeamLine`: `preserveAspectRatio="none"` + `vector-effect="non-scaling-stroke"` mandatory; **no terminal `<circle>`** (non-uniform scale → ellipse); current value adjacent as `tabular-nums` | component | proposed | |
| UXR-PV-51 | Clamp the series domain to `max(goalCreatedAt, program.startedOn)` — the handstand goal predates Phase 2A and its pre-Program arc is noise | component | proposed | |
| UXR-PV-52 | `maxPoints` per surface (`/program` ⚠[10–14], `/progress` 26 ⚠[20–52]); per-goal `batchSize` 8 → ⚠[3–4] so 3×8=24 concurrent stops thrashing a ~10-connection pool | tuning⚠ | proposed | |
| UXR-PV-53 | `/program` route query ceiling ⚠[≤250]; over budget → degrade the sparkline to a text delta (`+12 since Week 1`) | tuning⚠ | proposed | |
| UXR-PV-54 | If Suspense is used, the page component must **not `await`** readiness work — pass async RSC components into boundaries or the shell never flushes | component | proposed | |
| UXR-PV-55 | **`unstable_cache` is unsafe here** — `cookies()` throws inside it, and the ALS `_userScope` propagates on a MISS but not a HIT; `db:verify-isolation` would not catch the leak | component | proposed | |
| UXR-PV-56 | Plan tab `href` `/calendar` → `/program`; `match` gains `startsWith("/program")`. Label stays "Plan". Two lines, one-line reversal | layout | proposed | |
| UXR-PV-57 | `/program` renders a zero-row state at HTTP 200 — **never 404, never redirect** — plus a `Month view →` escape hatch so the Plan tab is never a dead end on day one | copy | proposed | |
| UXR-PV-58 | Reciprocal header pills (`Month →` on `/program`, `Program →` on `/calendar`) using the shipped pill idiom | layout | proposed | |
| UXR-PV-59 | SavedMeal row is the **first block inside `controls`**, above the food quick-pick row — `controls` already owns `addItem` and is injected into every host | layout | proposed | |
| UXR-PV-60 | Chip second line = `310 · 31P` in `font-mono text-[11px]` — calories and protein are the two numbers that decide the tap against a 150 g floor, and sans-brand vs mono-numerals distinguishes "adds several" from "adds one" | copy | proposed | |
| UXR-PV-61 | Chip tap opens a `BottomSheet`; **never adds directly** — the Chipotle bowl logs in fractions | component | proposed | |
| UXR-PV-62 | Servings stepper reuses the shipped `h-11 w-11` `−`/`+` and the `.qty-bump` re-key; step ⚠[0.25–0.5], floor 0.25 | component | proposed | |
| UXR-PV-63 | Expansion goes through `addItem()`, **never `setItemsText`** — reconstructing a text line strips `amount`/`unit`/`source` from *all* existing items | component | proposed | |
| UXR-PV-64 | **No `savedMealId` + `servings` form field on the web path** — `itemsJson` is the single source of truth; a parallel field desyncs the raw-text fallback. `log_nutrition(savedMealId, servings)` is the coach's channel. Write this into the story or a dev will helpfully add it | component | proposed | |
| UXR-PV-65 | SavedMeal row renders `null` at zero rows — no empty labelled row. Teach "save a meal" in the composer footer *after* a successful log | layout | proposed | |
| UXR-PV-66 | **Zero new keyframes across the entire wave** | animation | proposed | |
| UXR-PV-67 | Fan-out = `.save-confirm-fade` (fills) → `.macro-flash` (moved only) → `.item-row-anim` (receipt) | animation | proposed | |
| UXR-PV-68 | Stagger 60ms ⚠[50–70], hard ceiling 85ms (derived); total wave ≈570ms ⚠[520–620], under the 620ms ceremony floor; flash offset 30ms ⚠[20–60] | tuning⚠ | proposed | |
| UXR-PV-69 | **Never `bullseye-pop`** for the fan-out — it is localStorage-gated once-per-day and the codebase has twice documented not reusing it | animation | proposed | |
| UXR-PV-70 | Imperative `classList.add` + removal on `animationend`, keyed in **sessionStorage** (not localStorage), no `setState` — avoids hydration mismatch and the `set-state-in-effect` lint rule | component | proposed | |
| UXR-PV-71 | **Filling = counted, flashing = moved.** Three identical flashes would say "3 goals advanced" in motion while the copy says otherwise — and motion wins at a glance | animation | proposed | |
| UXR-PV-72 | Reduced motion: claimed marks must be **statically filled** (`.macro-flash` rests at `transparent`), plus the server-rendered receipt line and per-mark `aria-label` as the two other static channels | a11y | proposed | |
| UXR-PV-73 | Un-log: no stagger, no flash; `.is-exiting` 190ms + the shipped `.undo-bar` with `UNDO_WINDOW_MS = 5000` ⚠[4–6s] and its optimistic-hide/deferred-commit mechanism | animation | proposed | |
| UXR-PV-74 | `attribute_activity` remove: **no undo bar** — non-destructive, sticky by design, re-tappable; spending the bar here devalues it for the destructive case | animation | proposed | |
| UXR-PV-75 | SavedMeal N-item expand: **accept simultaneity**, no per-index stagger (rows mount behind the closing sheet; there is zero house precedent for a staggered *reflow*). Fallback is a two-value inline `transitionDelay`, ⚠ verify the positional mapping | animation | proposed | |
| UXR-PV-76 | **`transitionend` never fires under `transition: none`** — any collapse path that splices on it needs the instant path `MealComposer.tsx:200-207` exists for. This has bitten once already | a11y | proposed | |
| UXR-PV-77 | Calendar span bar and block band are **static, no motion** — a band is a fact, not an event (`ReachMeter.tsx:12` precedent) | animation | proposed | |
| UXR-PV-78 | `bullseye-pop` fires on `done === required` where required = rotation blocks + due scheduled items + outstanding baselines − optional. **Links never count toward `required`** | animation | proposed | |
| UXR-PV-79 | Caller-side clamp `progress = done===required ? 1 : Math.min(done/required, 0.74)` ⚠ verify visually — never modify `Bullseye.tsx`. Known limitation: a 4-step meter can't resolve fifths | tuning⚠ | proposed | |
| UXR-PV-80 | The `required === 0` guard must run **before** the localStorage write, or a false-positive at 06:00 permanently consumes the day's one pop | component | proposed | |
| UXR-PV-81 | Extract a shared `EmptyState` — 6 sites, two already byte-identical (`page.tsx:128-141` ≡ `calendar/page.tsx:79-90`) | component | proposed | |
| UXR-PV-82 | Extract `GoalMark` · `MarkLane` · `MarkLegendStrip` · `CeilingRule` · `SeamLine` · `TimelineRow` · `ProgramBlockBand` · `WindowSpanBar` | component | proposed | |
| UXR-PV-83 | Extract pure `readiness-copy.ts` (gate state, measured score) and `day-rhythm.ts` — both zero-query; `readiness.ts` is **consumed, not modified** | component | proposed | |
| UXR-PV-84 | Lift `TypeBadge` / `typeBadgeClass` / `UrgencyChip` / `MILESTONE_WARNING_DAYS` out of `ProjectTodayView` **before** deleting it | component | proposed | |
| UXR-PV-85 | Kill the duplicate `db.nutritionLog.findMany` on Today — `resolveDay` already returned it | component | proposed | |
| UXR-PV-86 | Narrow Today's workout re-query to `resolved.workouts` ids so it cannot disagree with `resolved` about what happened today | component | proposed | |
| UXR-PV-87 | Batch the per-goal `goalForFeas` reads into one `findMany` over member ids | component | proposed | |
| UXR-PV-88 | **⚑ SIGN-OFF — the calendar cell doesn't fit.** `flex-nowrap` overflows at 390px today (34.6px available, 38–43px needed). Recommended fix A: the rotation goal contributes its `GoalMark`, not the `trained` Bullseye — **this narrows the "Bullseye stays EXCLUSIVE to focus training" invariant** | layout | approved | Fix A approved by run-orchestrator as owner delegate (A1 mandate): rotation goal contributes its GoalMark; Bullseye exclusivity invariant narrowed to non-Program tenants. Fixes live 390px overflow. |
| UXR-PV-89 | **⚑ SIGN-OFF — `ActivityGoalLink` has no remove tombstone.** `source` is `"auto"\|"explicit"` only and the unique key makes the rule write an upsert, so a backfill resurrects removed links. Add a `removed` source, or make the rule engine strictly once-per-activity with a remove-aware backfill path | component | approved | Tombstone approved: attribute_activity remove flips source→'removed' (row kept — unique key then blocks auto/backfill resurrection); list/badges filter it. Activity-delete hooks still hard-delete. |
| UXR-PV-90 | **⚑ SIGN-OFF — `/program` v1 may ship without sparklines** (contradicts the story AC). Alternative: the app's first `<Suspense>` + a tenant-isolation smoke test, since `force-dynamic` + streaming × the ALS `_userScope` is unexercised | component | rejected | Sparkline cut REJECTED — story AC + owner's four-visualizations requirement name trend sparklines. Mitigation instead: plain awaited server component (no Suspense/streaming), so the ALS×streaming interaction is never exercised. |
| UXR-PV-91 | **⚑ SIGN-OFF — suppress `OtherGoalsStrip`'s "Also today" block**; it duplicates the mark lane, and its `isFocusGoal` filter stops meaning anything under membership. Keep the 7-day lookahead and conflict rows | component | approved | Suppress the 'Also today' block; keep 7-day lookahead + conflict rows. |
| UXR-PV-92 | **⚑ SIGN-OFF — `CeilingRule` as divs, not inline SVG.** The cited precedents are divs; divs give a crisp 2px stile with no viewBox scaling artifact and a CSS `repeating-linear-gradient` hatch | decoration⚠ | approved | Divs, per existing precedents (decoration⚠ tier). |
| UXR-PV-93 | **⚑ SIGN-OFF — accept slot re-flow on archive** (rare, user-initiated) rather than paying for a persisted slot column | component | approved | Slot re-flow on archive accepted; no persisted slot column. |
| UXR-PV-94 | **Pre-existing bug** — `WeightChart` and `HistoryChart` ignore `prefers-reduced-motion` and play Recharts' 1500ms mount animation. One-line fix each, copying `ReadinessChart.tsx:103` | a11y | proposed | |
| UXR-PV-95 | **Pre-existing bug** — `animate-pulse` is not among the 16 reduced-motion guards; all six `loading.tsx` skeletons pulse infinitely under reduce. Three-line unlayered fix | a11y | proposed | |
| UXR-PV-96 | **Pre-existing bug** — `.level-up-ring` / `.goal-completed-ring` use `display:none` under reduce, leaving no compensating composition (the assay system already documents this as the model of what not to do) | a11y | proposed | |
| UXR-PV-97 | **Pre-existing gap** — no global `:focus-visible`; BottomNav `<Link>` tabs and calendar day cells have no focus ring. BottomNav also relies on `py-3` arithmetic with no explicit `min-h-[44px]` | a11y | proposed | |
| UXR-PV-98 | **Pre-existing** — three stale "Card does not accept `data-testid`" comments produced three unnecessary wrapper divs; `Card` does accept it | component | proposed | |
| UXR-PV-99 | **Pre-existing** — `MealComposer` create mode never receives `plannedTarget`, so the projected-vs-target hero is always hollow exactly when it matters | component | proposed | |
| UXR-PV-100 | **Pre-existing** — `resolveLegend`'s invalid-parse branch ignores `kind`, so a project goal with a corrupt legend silently gets the hike legend | component | proposed | |
| UXR-PV-101 | **Pre-existing** — the `schema.prisma` legend-kind comment is stale (missing `baseline`, `scheduled-item`) | copy | proposed | |
| UXR-PV-102 | **Pre-existing** — the `globals.css:121-124` bullseye-pop comment is stale; it claims the React driver is unwired, but `TodayCelebration` ships | copy | proposed | |
| UXR-PV-103 | **Pre-existing** — `SummitSheet.tsx:203,231` uses Tailwind's default `font-serif`, not `--font-display` | layout | proposed | |
| UXR-PV-104 | **Pre-existing** — four independent rotation implementations disagree on `baselinesDue` semantics (credit-window vs unlogged-count vs no-window). A cross-goal calendar mixing them shows conflicting badge counts | component | proposed | |
| UXR-PV-105 | **Pre-existing** — `scheduledItemCount` is always 0 unless the focus goal is `kind:"project"`, so DEXA scans and weigh-ins cannot appear on a fitness-focus month | component | proposed | |
| UXR-PV-106 | **Pre-existing hazard** — `getDb()`'s `$extends` scoping does **not** fire on nested relation writes. The three `ActivityGoalLink` rows must be **top-level creates**, or they carry `userId: null` and become cross-tenant-readable — a leak `db:verify-isolation` would not catch | a11y | proposed | |

**106 rows.** 87 feature recommendations (`01–87`) · 6 sign-off items (`88–93`) · 13 pre-existing defects (`94–106`).

By type: component 43 · layout 17 · copy 16 · a11y 12 · animation 10 · `decoration⚠` 4 · `tuning⚠` 4.

The 8 `⚠`-tagged rows — `21`, `29`, `49`, `52`, `53`, `68`, `79`, `92` — plus the 12 `a11y` rows are the audit surface. Every one of them is expanded with a range and a what-to-check in [`program-views.md` §9](./program-views.md).
