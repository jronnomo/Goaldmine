# Plan Critique — Finish the Multi-Domain Goal Engine

**Role:** Plan Devil's Advocate (read-only; verified every load-bearing claim against the real codebase)
**Date:** 2026-06-16
**Attacks:** `agents/plan-blueprint.md` (the hardened plan)
**Verdict:** **APPROVE-WITH-FIXES**

The blueprint is unusually well-grounded — I checked all five of its load-bearing facts against source and **four are exactly right**. The engine work it claims is "already done" really is already done; the one genuine code change (the `log:` observed path) really does already exist. The corrections below are mechanical (how the refactor threads through `recap.ts` and the Satori card) plus **one factual overstatement** in the feasibility-readout spec that will produce a wrong "honest" copy state if implemented literally.

---

## Claim verification (the blueprint's load-bearing facts)

| # | Blueprint claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `log:*` observed-only path already exists in `rarity-core.ts` (~458–487), fires with ≥3 pts + positive slope → real ratio/verdict | **TRUE** | `rarity-core.ts:458–465` (`observedPoints >= minObservedPoints && observedWeeklyRate > 0`, null norm → `plausibleRate = observedWeeklyRate`, `rateBasis:"observed"`). `:466–485` ≤0 slope + null norm → `ratioCap`/`legendary`. `:491–505` `<3` pts → `unknown`/`countsTowardTier:false`. `log:` family → `normForFamily` returns `null` at `:331–333`. `observedSeriesFor` log branch at `rarity.ts:125–137`. |
| 2 | Chewgether `no-data` is honest (zero LogEntry rows) | **TRUE (code-path confirmed)** | `observedSeriesFor("log:mrr")` reads `LogEntry where metric="mrr"` (`rarity.ts:127`, bare key); 0 rows → `points=[]` → `weeklySlope(...,3)=null` (`rarity-core.ts:257`). `aggregateGoalTier` over all-`unknown` → `tier:null` → `computeGoalFeasibility` sets `unratedReason:"no-data"` (`rarity.ts:279–286`). I could not query live Neon from here, but every code path corroborates the blueprint's live dump. |
| 3 | `get_goal.feasibility.computed` returns full per-target `required/observed/plausible/ratio/verdict` + `weeksRemaining` — no read-tool extension needed | **TRUE** | `tools.ts:896–910` returns `feasibility:{ computed, coach }` where `computed = await computeGoalFeasibility(...)` (the full `GoalFeasibility`, `rarity-core.ts:209–218` / per-target `:191–207`). `preview_goal_feasibility` returns the same shape (`tools.ts:4752`). The draft's one Open Question is answered: **YES**. |
| 4 | Fitness recap path is byte-identical-able after the registry refactor | **TRUE, but conditional** | Achievable, but only if two mechanics are pinned — see **Concern C-1** and **C-2**. Not free. |
| 5 | `src/lib/goal-presentation.ts` is client-safe (Satori + server can both import) | **TRUE (by design)** | File does not exist yet; the proposed shape (`:57–151`) is types + const config + one pure function, no Prisma/calendar/Node. `recap-card.tsx` already imports only `react` + the pure `recap-templates.ts` (`recap-card.tsx:7–9`), so adding a pure import is safe. `recap.goal` is a `RecapGoalBlock` carrying `.kind` (`recap.ts:62`), so `presentationForGoal(recap.goal)` type-checks. |

**Migration safety (Neon, shared with prod):** **Clean.** `Goal` already has `kind` (`@default("fitness")`, `@@index([kind])`), `targets Json?`, `legend Json?`, `coachFeasibility Json?` (schema confirmed). `ScheduledItem` is indexed `@@index([goalId, status])` and `@@index([goalId, date])`; `LogEntry` is indexed `@@index([goalId, metric, date])`. The blueprint's two new project queries (`scheduledItem.groupBy({by:["status"], where:{goalId,type}})` and `logEntry.findFirst({where:{goalId,metric}})`) are **fully index-backed**. **No schema change, no backfill, no destructive op** — verified, the blueprint's "no Prisma" posture holds.

---

## Critical

**None.** No claim is load-bearing-false in a way that breaks the architecture, and there is no migration/honesty/Satori hazard that blocks the initiative. The plan is safe to decompose.

---

## Concerns (fix before/within Sprint 1–3)

### C-1 — §3.3 overstates the no-data readout: `requiredRate` is `null` at true zero-data, not "needs $66/wk"
**Blueprint §3.3 state 3** says: *"Per-target rows still show `requiredRate` ('needs $66/wk to hit $1,000 by 9/30' — derived from gap/weeksRemaining, computable even with 0 observed)."* **This is false for Chewgether today.**

Evidence: with zero MRR logs, `resolveMetricValue("log:mrr")` returns **`null`**, not `0` (`goal-targets.ts:111` — `return entry?.value ?? null`; the `log:` branch is *not* a build-from-zero branch — contrast `hike:*`/`workout:count` at `:153` which return `0`). `resolveMetricStart` for `log:` also returns `null` with no logs (`goal-targets.ts:158–165`). So in `computeGoalFeasibility`, `current` resolves `null` and `target.start` is absent → `computeTargetFeasibility` hits the **early return at `rarity-core.ts:409–423`** which sets `requiredRate: null`, `verdict:"unknown"`, `currentValue:null`. **`requiredRate` is null at 0 logs.**

It only becomes non-null once **≥1** MRR is logged (then `current` is non-null, gap is computable, and the `<3`-points branch at `:491–505` returns a populated `requiredRate` while `observedRate` stays null/low-confidence).

**Why it matters:** the blueprint sells state 3 as already rich ("needs $66/wk") to justify making "no-data" first-class. In reality there are **two** distinct honest sub-states the readout must render differently:
- **0 logs** (Chewgether right now): `requiredRate:null`, `observedRate:null` → copy can only say *"Add at least one MRR entry to compute the pace you need."*
- **1–2 logs**: `requiredRate` populated, `observedRate` null/unrated → copy can say *"needs ~$66/wk; not enough points yet to estimate your pace."*

**Fix:** Specify both sub-states in the `FeasibilityReadout` spec, keyed on `requiredRate === null`. Add Sprint-4 fixtures for **0-log**, **1–2-log**, and **≥3-log** cases (the blueprint's Sprint-4 list only names ≥3 and "<3 → unknown"; split the `<3` case at the `requiredRate` boundary).

### C-2 — `recap.ts` cannot gate project-source fetches inside the existing `Promise.all` (kind is unknown until the goal resolves)
**Blueprint §2.2** says fetch `logLatest`/`scheduledAgg` *"in the existing `Promise.all` at lines 180–211, gated on the resolved presentation needing them."* **Not literally possible.** The focus goal itself is fetched *inside* that same `Promise.all` (`recap.ts:189–194`), so `goal.kind` — and therefore `presentationForGoal(goal)` — is **not known until the block resolves**. You cannot gate a member of a `Promise.all` on a value another member of the same block produces.

**Fix (pick one, pin it in the story):**
- (a) Fetch the goal first (`await`), derive `presentation`, then run a single `Promise.all` for everything else (workouts/hikes/PRs/program/gameState **+** the gated project sources). Costs one extra sequential round-trip on the focus goal — negligible, and `recap.ts` already tolerates latency here.
- (b) Always fetch the two cheap project aggregates unconditionally (both are single indexed queries) and let `resolveStatSlot` ignore them for fitness. Simpler, keeps one `Promise.all`, costs two always-on indexed reads even for fitness.
Recommend (a) — it keeps fitness query-count byte-identical (no extra reads on the fitness path), which is the stated invariant.

### C-3 — Byte-identical fitness requires hoisting the formatters AND touching every render site (two stat grids + three ring/header sites)
The card's exact strings come from `fmtVolume`/`fmtElevation` defined **inside `recap-card.tsx`** (`:17–23`, `Intl.NumberFormat maximumFractionDigits:0`). The blueprint puts the *formatted value* in `resolveStatSlot` (in `recap.ts`, §2.1). If `recap.ts` re-implements the Intl formatting independently, the strings can drift (thousands separators, the `—` sentinel) and the snapshot breaks.

Also the refactor surface is **larger than a single grid**: the stat grid is rendered in **two** places — the main card (`recap-card.tsx:607–649`) **and** `SlideTwo` (`:951–960`, which today reads `recap.workoutsCompleted`/`fmtVolume(recap.volumeLb)`/etc. directly). The ring label appears at `:426` **and** `:855`; `programLine` at `:304–307` **and** `:793–795`. Miss any one and you get a half-migrated card (fitness regression on one slide, project mislabel on another).

**Fix:** (1) Move `fmtVolume`/`fmtElevation` (and the `int` `String()` / `currency` / `ratioOfTotal` / `percent` formatters) into the pure `goal-presentation.ts` so `resolveStatSlot` and any direct card use share **one** implementation. (2) The Sprint-1 story must **enumerate all five sites** (two grids, two ring labels, two `programLine`s) as explicit acceptance checklist items, and the snapshot test must cover both the main card **and** `SlideTwo`.

### C-4 — New `weeks-to-target` header is net-new date math; keep it on `@/lib/calendar`
`headerStyle:"weeks-to-target"` needs `weeksToTarget` + `targetDateLabel` added to `RecapProgramHeader` (currently only `programWeek/dayOfProgram/totalProgramDays`, `recap.ts:70–74`). That is **new** date math in a file whose existing program-week math is carefully `startOfDay()`-normalized (`recap.ts:297–309`) and whose labels use `Intl` with `timeZone: USER_TZ` (`weekRangeLabel`, `:148–152`). The goal's `targetDate` *is* available server-side in `recap.ts` (the full goal row is fetched at `:190–194`, even though only `RecapGoalBlock` is exposed), so this is feasible — but a dev could reach for raw `new Date()` diffing.

**Fix:** Require `weeksToTarget` to reuse `weeksRemainingFrac` (already `startOfDay`-based, `rarity.ts:40–50`) or `startOfDay` + the existing ms-diff idiom, and `targetDateLabel` to use the `Intl … timeZone: USER_TZ` pattern from `weekRangeLabel`. Add it to the story's USER_TZ acceptance line. (`ProjectTodayView` already does `daysToGoal` correctly via `startOfDay` at `:85–90` — use it as the reference.)

---

## Suggestions (non-blocking)

### S-1 — Advertise feasibility in `get_goal`'s description for coach discoverability
`get_goal` **returns** `feasibility.computed` (`tools.ts:910`) but its **description** (`tools.ts:821–828`) never mentions feasibility, `unratedReason`, or `no-data`. The coach reads tool descriptions to decide what a tool yields; today nothing tells it that `get_goal` carries the per-target required/observed/verdict + `weeksRemaining`. Add one sentence (e.g. *"Also returns `feasibility.computed` — per-target requiredRate/observedRate/verdict, weeksRemaining, and `unratedReason` (someday|no-targets|no-data) — so you can read whether the date is a stretch and whether more logging is needed to rate it."*). This is the cheapest lever for the "MCP is the coach's surface" invariant and pairs with the §6 coaching-doc updates.

### S-2 — Pin the `doneOverTotal` denominator semantics vs `MilestoneBurnDown`
`MilestoneBurnDown` computes `total = milestones.length` over **all** statuses (`MilestoneBurnDown.tsx:23`), `done = status==="done"` (`:24`). The blueprint's `scheduledAgg` uses `groupBy(status)` and `doneOverTotal` — if it sums all statuses for the denominator it matches the burn-down (good: both show `0/7`). But once a milestone is `skipped`, "0/7" silently includes a skipped item. Decide explicitly whether `doneOverTotal` denominator is "all milestones" (matches burn-down) or "non-skipped milestones," and document it on the `StatSource` `scheduledItem` variant so the recap stat and the burn-down card can never diverge (the §0.2 desync lesson, applied one layer down).

### S-3 — Satori render gate: verify the 2-cell grid wrapper, not just the ring
The Satori risk here is **not** the ring (untouched SVG `stroke-dasharray`, per memory `satori-no-conic-use-svg-arc`) — it's the new **variable-count grid wrapper** (`recap-card.tsx:588–651` / `:951–961`) going from a fixed 4-cell layout to `.map()` over 2 **or** 4 slots. A flex wrapper sized for 4 children can collapse or mis-center with 2. The blueprint's Sprint-1 "Satori re-render verified" gate covers this; make the gate concrete: **render the Chewgether card (2 cells) and the fitness card (4 cells) and eyeball both at 1080×1920** — a 2-cell centered row is the specific new geometry.

---

## Scope / coexistence / "secretly two projects"

- **Still one initiative.** 3.1/3.2/3.6 share the single registry seam; the dependency chain (Sprint 1 ships `presentationForGoal` + `statSlots` → 2/3 consume → 4 tests) is coherent. Nothing to cut.
- **Sprint 3 correctly downgraded to surface-only** — verified: `rarity-core.ts` needs **no** change for the `log:` observed path (it exists). The blueprint's instinct to *not* "fix" a working honesty path is correct; building an engine fix here would be wasted scope against a correct mechanism.
- **Coexistence tax is justified.** Fitness is one registry entry resolving from `recapField` sources that map 1:1 to today's strings; the snapshot test (C-3) is the guardrail. The `__default__`-clone-of-fitness fallback (`:146–154`) correctly preserves current null-kind behavior without declaring fitness the universal default.
- **Anti-vertical guardrail holds.** Dropping Subs/Conversion to a 2-slot data-derived grid (§1.4) and choosing `PROGRESS` over `TRACTION` are the right calls and are backed by live data (only MRR + Milestones have any backing). Endorsed.

---

## Verdict: APPROVE-WITH-FIXES

The plan's factual spine is sound and verified. Land these before/within the sprints:

1. **C-1** (Sprint 3 spec + Sprint 4 fixtures): `requiredRate` is `null` at 0 logs — render/ test the 0-log and 1–2-log no-data sub-states distinctly; don't promise "$66/wk" until ≥1 MRR is logged.
2. **C-2** (Sprint 1 mechanics): restructure `recap.ts` to fetch the goal first, then a single gated `Promise.all` — the project sources can't be gated inside the existing block.
3. **C-3** (Sprint 1 mechanics + gate): hoist `fmtVolume`/`fmtElevation` into the pure module and enumerate **all five** card render sites (two stat grids, two ring labels, two headers) in the acceptance checklist + snapshot both the main card and `SlideTwo`.

S-1 (advertise feasibility in `get_goal`'s description) is a near-free discoverability win worth folding into the §6 coaching work.
