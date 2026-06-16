# Goaldmine — "What's Next" Strategic Brief
### Input for `/roadmap`: the Multi-Domain Transformation

**Stamped:** 2026-06-16 · **Author:** Gabe + Claude (Opus 4.8)
**Read this cold to understand WHERE goaldmine is going and WHY, then run `/roadmap` on the initiative in §3.**

---

## 0. Where we are (context for a cold reader)
Goaldmine started as a personal 90-day fitness tracker (Mt. Elbert hero goal) with an MCP server that an AI coach in claude.ai reads/writes. As of today it has crossed a threshold: **the central metric is now an honest, goal-generic engine.**

Shipped recently (all live on `main`, deployed to Vercel):
- **Capped, coverage-aware, gated readiness** (`src/lib/readiness.ts`): untested targets count as 0 (no false-100%), `coverage = {tested,total}`, and an optional `gating` flag on targets caps the headline at **80** until every hard gate clears. `score = min(rawScore, ceiling)`.
- **`log:` metrics now respect `direction`** — decrease KPIs (churn, CAC) compute correctly (`resolveMetricStart` reads the earliest logged value).
- **Weekly Recap Card** (`src/lib/recap-card.tsx`, `/recap`, `generate_recap_card` MCP tool): a share-ready 9:16 image + Stories from logged data, with a proportional SVG progress ring, a featured-highlight callout, and a goal-generic progress bar.
- **Proven generic:** a real **Chewgether** project goal (`kind:"project"`, $1k/mo MRR + 7 GitHub launch milestones) now runs through the *exact same* `computeReadiness` and reads `0 · 0/2 verified · 2 gates left`. The engine is no longer fitness-bound.

**The punchline:** the *engine* is a generic, honest goal platform. The *app* still looks like a fitness app. Closing that gap is the whole next chapter.

---

## 1. The thesis — what makes goaldmine incredible (widen these, don't diversify away)
Three moats. Every initiative below should deepen at least one.

1. **Intellectual honesty ("no sugar-coating").** Most trackers flatter. Goaldmine now refuses to: untested gates drag the score, hard gates cap it, coverage is shown. This is *rare* and it's the soul of the product. The user articulated it directly: *"a real indicator of where a user is on their journey. No sugar coating."*
2. **The AI coach loop.** claude.ai ⇄ `/api/mcp` is something no fitness app has — the coach reasons over your data and writes back (logs, plan revisions, gates, reviews). The app holds zero LLM calls; all reasoning is in the conversation. This is the differentiator that compounds.
3. **Goal-genericity.** The schema (`GoalTarget`: metric/target/weight/direction/gating) + `computeReadiness` + the generic `log:` metric path are domain-agnostic. Fitness, business, creative — same engine. Today proved it on Chewgether.

Make these three undeniable and goaldmine stops being "my workout app" and becomes **the honest goal engine — for anyone, any domain.**

---

## 2. The core tension to resolve
> The engine is generic. The surfaces are fitness-shaped.

A live **project** goal (Chewgether) today gets:
- a recap card whose stats are `WORKOUTS / VOLUME / PRs / ELEVATION` and header `Week N · Day M of 90` — meaningless for a business;
- a readiness ring labeled `READINESS` — fitness-framed;
- a Today page (`src/app/page.tsx`) built around the workout rotation.

The progress *bar/ring math* is already goal-generic (it reads `computeReadiness`), but the **stats, labels, and daily surface are not.** That single inconsistency is what separates "fitness app with a business goal bolted on" from "the goal engine."

---

## 3. THE INITIATIVE TO ROADMAP: "Finish the multi-domain goal engine"
Run `/roadmap` on this. Below is the scope — each thread written so you can *visualize what it means*, with current state → target experience → why it's a moat.

### 3.1 Goal-kind-aware surfaces  *(highest leverage — the #1 thing)*
- **What it means:** every user-facing surface adapts to `goal.kind` (and ultimately to the goal's own targets) instead of assuming fitness.
- **Current state:** `recap-card.tsx` hardcodes fitness stats; the ring says `READINESS`; the header is `Day M of 90`; Today is workout-shaped.
- **Target experience:** open Chewgether and the recap card shows `MRR / Milestones / Paying Subs / Conversion`; the ring says `TRACTION` (or `PROGRESS`); the header reflects the project timeline ("Day 19 of the build", or weeks-to-target). Open Elbert and it's the fitness version. Same components, kind-driven content.
- **Concrete example:** Chewgether Sunday card → `🏆 First 10 paying users · 18% MoM growth · 3/7 milestones · 2 gates left` instead of `2 WORKOUTS / 2,370 lb`.
- **Why it's a moat:** this is the visible proof of #3 (genericity). It's the difference between a demo and a platform.

### 3.2 Feasibility — "is this date a fantasy?"  *(sleeping killer feature)*
- **What it means:** goaldmine already *computes* a feasibility tier per goal — `get_goal.feasibility` returns `requiredRate` vs `observedRate` vs `plausibleRate`, a `ratio`, a `verdict` per target, and `weeksRemaining`. Right now it's `tier:null, unratedReason:"no-data"` and barely surfaced.
- **Target experience:** a prominent, honest readout: *"At your current logging pace you reach ~62% of your targets by Sept 30 — this date is a stretch. The MRR target needs $140/wk of growth; you're observing $0."* Pair it with the gates/coverage already shipped.
- **Why it's a moat:** this is the *most* differentiated thing in the whole product — no tracker tells you your timeline is fiction. It's honesty (#1) made unavoidable. Surface it on Today, the goal page, and the recap.

### 3.3 Make the coach proactive  *(deepen moat #2)*
- **What it means:** the MCP read surface is rich (`get_session_brief`, `list_open_items`, `compute_readiness`, `get_latest_review`, `weekly_summary_data`). The coach is currently *reactive* — it answers. Make it *initiate*.
- **Target experience:** "Your altitude gate is the only thing blocking 80 — let's plan the ≥12k-ft hike." / "You haven't logged MRR in 2 weeks; the Chewgether gate is going stale." / an auto Sunday recap. (Mechanism TBD: scheduled cloud agent / routine that runs read tools and surfaces nudges.)
- **Why it's a moat:** a coach that *notices* is categorically better than one that waits.

### 3.4 Close the content flywheel  *(growth + dogfood)*
- **What it means:** the Weekly Recap Card → Instagram journey the user just started. The tool that documents discipline becomes the thing that grows the audience *and* markets goaldmine.
- **Target experience:** auto-generate the Sunday card from the week's data (maybe scheduled); build-in-public the dev work; the recap becomes a habit, not a manual export.
- **Why it's a moat:** compounding distribution at $0 cost, and it's authentic (you're documenting a real journey).

### 3.5 Goal onboarding / the "goal interview"
- **What it means:** a guided first-run that turns a fuzzy goal ("get a business to $1k/mo", "summit a 14er") into measurable, weighted, **gated**, feasibility-rated targets — for any domain.
- **Target experience:** someone who isn't Gabe can create a goal and get a real, honest scoreboard without hand-authoring a `targets[]` JSON. The coach conducts the interview; goaldmine persists the result.
- **Why it's a moat:** this is what makes goaldmine *usable by other people* — the precondition for it being a product, not a personal tool.

### 3.6 Earn trust — tests on the load-bearing math
- **What it means:** Vitest landed today (`food-units.test.ts`). The honesty engine has to be bulletproof.
- **Target:** unit tests on `computeReadiness` / `progressFor` (gating cap, untested=0, decrease metrics, coverage, edge cases) and the recap aggregator. The math that tells users the truth must be provably correct.
- **Why it's a moat:** an honest engine that's occasionally wrong destroys the one thing that makes it special.

---

## 4. Constraints / invariants `/roadmap` must respect
- **Goal-generic, always.** No new surface may hardcode the focus goal or "Elbert." (See memory `goal-progress-bars-are-goal-generic`.)
- **Honesty-first.** Never re-introduce a path that can read falsely "ready" (no dropping untested, no un-capped gates).
- **Single user today, but design for multi-domain/multi-user.** The architecture should generalize even while serving one person.
- **No LLM calls in the app.** All reasoning stays in claude.ai via MCP.
- **MCP is the coach's surface.** New capabilities usually need a read/write tool, not just a UI.
- **Satori constraints** for any card/image work (see memory `satori-no-conic-use-svg-arc`).
- **USER_TZ via `@/lib/calendar`; Prisma 7 split-config; Next 16 + Turbopack** (see `CLAUDE.md`, `.claude/quality-tools.md`).

## 5. Suggested priority for the roadmap (starting point, not gospel)
1. **Goal-kind-aware surfaces** (3.1) — unlocks the platform identity; highest visible leverage.
2. **Feasibility surfacing** (3.2) — biggest honesty differentiator, mostly already computed.
3. **Proactive coach** (3.3) — deepens the loop moat.
4. **Goal onboarding / interview** (3.5) — the usable-by-others unlock.
5. **Content flywheel** (3.4) + **tests** (3.6) — compounding + trust, run alongside.

## 6. How to run it
`/roadmap` on **"Finish the multi-domain goal engine"**, scoped to §3, honoring §4, seeded with §5's priority. It should iron this into epics → stories (acceptance criteria / effort / priority / dependencies / sprint) and materialize them as GitHub issues on the **"Goaldmine Roadmap" project (#8)** in `jronnomo/workout-planner`. Each story then becomes a `/feature-dev` build — same pipeline that shipped the readiness engine and the recap card this session.

## 7. References / grounding
- Engine: `src/lib/readiness.ts` (computeReadiness, GATE_CEILING, progressFor), `src/lib/metrics-registry.ts` (GoalTarget + gating + GoalTargetSchema), `src/lib/goal-targets.ts` (resolveMetricValue/Start, `log:` path).
- Surfaces: `src/lib/recap-card.tsx`, `src/app/recap/`, `src/app/page.tsx` (Today), `src/app/progress/page.tsx`.
- MCP: `src/lib/mcp/tools.ts`, `src/lib/mcp/tools/project-tools.ts` (schedule_item/log_metric/GitHub pack — note these exist in the live server but project-goal UX is thin).
- Proof point: Chewgether goal `cmqbfseel0000cgdn3oz1uz2u` (kind:project, gated MRR + milestones).
- PRDs shipped this session: `docs/prds/PRD-weekly-recap-card.md`, `docs/prds/PRD-capped-coverage-readiness.md`.
- Memories: `multi-domain-vision`, `goal-progress-bars-are-goal-generic`, `satori-no-conic-use-svg-arc`.
