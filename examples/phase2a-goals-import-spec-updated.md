# Phase 2A — Goal Import Spec
### "Lighter and Upside Down" · Aug 10 – Dec 31, 2026
*Authored 2026-08-10. **Revised 2026-08-09** — handstand repeatability merge (Goal 1 targets), three-session baseline split, Oct 2–5 travel window. Source of truth for importing the three Phase 2A goals + Program into Goaldmine once the Program-model redesign (see goaldmine-program-redesign-brief.md + the RFC) ships. Until then, Goal 1 already exists in the app (id cmsmi9k20000004laub50psio) on the OLD model with an auto-scaffolded plan that should be set inactive; Goals 2 and 3 are NOT yet created — do not create them on the old model, import them here.*

> **⚠️ `phase2a-addendum-handstand-rubric.md` is RETIRED — delete it.** Its content is merged into Goal 1 below. As written it *replaced* Goal 1's six targets rather than extending them, which would have silently dropped the wall-HSPU gate and the pull-up lean-mass canary. It also used `exercise:*` metric keys where this spec uses `baseline:*`. Do not import from it.
>
> **Duplicate-goal cleanup owed at import:** two handstand goals currently exist — `cmsmi9k20000004laub50psio` (focus, auto-scaffolded 21-week plan, targetDate 2026-12-31) and `cmq8pz7xp000304ic0wux6r2a` (someday, 1 target, no plan). Keep the former, resolve the latter. Verified via `list_goals` 2026-08-09.

---

## PROGRAM

```
name: Phase 2A — Lighter and Upside Down
window: 2026-08-10 → 2026-12-31 (20 weeks)
archetype: Spider-Man — control, flexibility, relative strength, lean aesthetic
active: true (single active program; replaces isFocus)
members: [Goal 1 Handstand, Goal 2 Body Comp, Goal 3 AWS SAA]
plan-owner: Goal 1 (Handstand) owns the training rotation; Goals 2 & 3 ride plan-less
blocks:
  - Block 0 · Aug 10–23 · recovery + baselines + DEXA prep · eat at maintenance
  - Block 1 · Aug 24–Oct 18 (8 wk) · skill acquisition + moderate deficit · rung-1 target
  - Block 2 · Oct 19–Dec 6 (7 wk) · deeper cut + skill consolidation · AWS exam window
  - Block 3 · Dec 7–31 · final lean-out + rung-2 test
deloads: ~every 4–5 wks, aligned to Jerry's out-of-town trips (see travel windows below)
```

### Travel & special-date windows (schedule adjusts around these)

| dates | what | plan treatment |
|---|---|---|
| **Aug 14–15** | **Mirror Lake — spreading Matt's ashes** | **SACRED TIME, not a deload.** No training expectation, no logging, no readiness math, no makeup sessions. Matt is the friend whose death opened this program in week 2; this is the point. Falls in Block 0 recovery anyway — zero conflict. |
| Sep 4–7 | Virginia / Labor Day | ~wk 2 of Block 1. Light/mobility + travel; skill only if a wall's available. Too early for a formal deload — just a soft break. |
| Sep 24 | Golf invitational in Matt's honor (early start) | Single light day; partial or no lift. No plan-around needed. |
| Sep 25–27 | Virginia get-together | **FORMAL DELOAD #1** (pair with Sep 24 → ~4-day down-week, mid-Block-1). |
| **Oct 2–5** | **Out of town — destination TBD** | **UNCERTAIN TRAINING WINDOW.** No fixed expectation. Skill only if space/wall allows; walk if a treadmill exists, outdoor walk if not. Nothing scored, no makeup sessions, no readiness penalty for a gap. **Do NOT schedule any baseline retest, DEXA, or practice exam in this window or the 3 days after it.** See the clustering note below — this sits 5 days after Deload #1 ends. |
| Nov 26–29 | Thanksgiving / Virginia | **DELOAD #2** (~5 wks later, good cadence). Block 2 deep-cut — eat at MAINTENANCE these days, not deficit. Holiday + cut is the hard combo; don't white-knuckle it. |
| Dec 23–27 | Christmas / Virginia | Block 3, final lean-out + rung-2 test window. **TENSION: 4 travel days right before the Dec 31 target.** Decide later: (a) run the rung-2 test BEFORE traveling (~Dec 20–22, preferred — don't let the finish depend on a hotel), or (b) slide the effective deadline to early Jan. |
```

**⚠️ Sep 24 – Oct 5 is a disruption cluster.** Golf day, Deload #1 (Sep 25–27), five normal days, then the Oct 2–5 window. That is roughly 8 disrupted days inside a 12-day span, landing in the middle of Block 1 — the skill-acquisition block, where consistency matters most for the handstand rungs.

Do not treat this as two independent breaks. Options, to decide by mid-September:
- **(a) Absorb it** — treat Sep 24 – Oct 5 as one extended low-consistency stretch, hold skill frequency as the only priority (even 10 min against a wall counts), accept that the rolling-window handstand rates will dip and let them recover honestly afterward.
- **(b) Shift Deload #1 to Oct 2–5** — train through Sep 25–27 at reduced volume instead, making the second trip the real deload. Better training density, but Sep 25–27 is a Virginia get-together and may not cooperate.
- **(c) Front-load Block 1** — push harder Sep 8–23, go in with margin.

**Nutrition through the cluster:** Block 1 is a moderate deficit, and ~8 disrupted days of white-knuckling a floor while traveling is where adherence breaks. Default to **maintenance on all travel days in both windows**, deficit on the normal days between. Not a refeed schedule — just not fighting two things at once.

**Rolling-window caveat:** the handstand repeatability targets score off the last 6 *qualifying* sessions. A cluster like this can leave the denominator stale — sessions from mid-September still counting in mid-October. Read the rates as provisional until 6 fresh sessions have accumulated post-Oct 5.

---

## GOAL 1 — Freestanding Handstand
**Objective:** `Freestanding Handstand — 20s hold, then 5 wall HSPU`
**kind:** fitness · **targetDate:** 2026-12-31 · **owns the Program rotation**
**Status:** ALREADY CREATED on old model, id `cmsmi9k20000004laub50psio` — migrate/re-parent under Program; do not duplicate.

Two gating rungs; ceiling capped at 80 until BOTH clear (mastery-before-done). Rung 3 (5 freestanding HSPU) deferred to Phase 2B/2027.

**Revised 2026-08-09 — repeatability merge.** The freestanding hold was originally a single 0→20s max at weight 0.35. A single max can be satisfied by one good day, and this skill has now produced a ≥10s hold twice, months apart, without becoming repeatable. Jerry's framing: *"ultimately what I want is repeatability of the skill when I want it."* The max target is retained but demoted; three rolling measures now carry the weight. All six original targets survive — nothing was removed.

| metric | label | start | target | units | dir | weight | gate |
|---|---|---|---|---|---|---|---|
| baseline:Freestanding Handstand Hold | Max freestanding hold | 10 | 20 | sec | inc | 0.12 | |
| log:hs_sessions_10s_of6 | ≥10s hold — sessions hit, last 6 | 0 | 4 | of 6 | inc | 0.08 | |
| log:hs_sessions_20s_of6 | ≥20s hold — sessions hit, last 6 | 0 | 4 | of 6 | inc | 0.15 | |
| log:hs_triple20_of6 | **3× ≥20s in one session** — sessions hit, last 6 | 0 | 1 | of 6 | inc | 0.20 | ✅ |
| baseline:Wall Handstand Push-Up | Wall handstand push-up (full ROM) | 0 | 5 | reps | inc | 0.20 | ✅ |
| baseline:Chest-to-Wall Handstand Hold | Chest-to-wall handstand hold | 30 | 120 | sec | inc | 0.08 | |
| baseline:Pull-Up Max Reps | Pull-up max (lean-mass canary) | 25 | 25 | reps | inc | 0.07 | |
| baseline:Floating Pike Push-Up | Floating pike push-up | 5 | 10 | reps | inc | 0.05 | |
| baseline:L-Sit (Parallettes) | L-sit hold (parallettes) | 30 | 60 | sec | inc | 0.05 | |

Weights sum to 1.00. Approved by Jerry 2026-08-09.

**Notes on the merge:**
- **Handstand cluster went 0.35 → 0.55.** Four targets now measure the anchor skill instead of one; accessories compressed to make room. Defensible only because the skill *is* the goal and the rest is support.
- **Still two gates, not three.** The gate came off the max — you cannot hit 3× ≥20s in a session without a 20s max, so `log:hs_triple20_of6` subsumes it. Wall HSPU keeps its gate as the independent second rung.
- **Pull-up canary weighted 0.07** — deliberately low, but it is not weighted for difficulty. It is the alarm that says the cut is eating muscle (see Goal 2). Do not drop it for being cheap to hold.

### Start value: max freestanding hold = 10, not 0
Set from the **2026-08-09 video-verified hold** (below), not an estimate. 0 would assert he cannot hold a freestanding handstand at all, which is false. S1 (Aug 10) **confirms or raises** this — it does not establish it from scratch.

**⚠️ Do not let a fatigued S1 overwrite it.** S1 falls two days after a 12.69-mile Elbert descent. If it returns less than 10s, that is a fatigue reading, not a corrected baseline. **Verify whether the engine resolves `baseline:*` as best-recorded or most-recent before S1 is logged** — if most-recent, a sub-10 S1 silently drops the start and the target reads as regression on day one.

Note this target now begins at 50% of the way to its goal (10 of 20s) while the skill is not repeatable at all. That is exactly why the max was demoted to 0.12 and the rolling measures carry 0.43 — the progression math would otherwise flatter a skill Jerry does not yet own.

### Chest-to-wall hold: target raised 60 → 120s (2026-08-09)
Raised at Jerry's call. Rationale: chest-to-wall removes balance entirely — toes rest on the wall as contact, not support — so this is a pure **shoulder-endurance and line-quality** measure. Uncapped by the skill's hardest variable, it can carry a genuine reach number.

**Honest framing:** 120s is **not on the critical path** to a 20s freestanding hold or 5 wall HSPU. Roughly 60s is the commonly cited prerequisite for freestanding work; past that, carryover to *balance* drops off and it becomes general shoulder endurance. Its value here is different and real — it is the one handstand metric that is purely trainable without the balance lottery, so it keeps producing honest progress during the months when freestanding work is frustrating and the rolling rates sit at zero.

**Two consequences, accepted:**
- Partial credit gets much slower. 60s — a real achievement — now reads as **33%** of this target (30→120), where it previously read 100%. Readiness will be lower than under the old table. This is the honest number.
- Long isometrics are fatiguing. **Do not let 2-minute-hold grinding eat the balance and pressing work.** If a session has to choose, toe pulls and kick-ups win. Test this at S3 and at retests; do not chase it every session.

### ⚠️ Chest-to-wall protocol (REQUIRED — the score is meaningless without it)
The number depends almost entirely on **hand distance from the wall**. Hands 6" out is near-vertical and brutal; 18" out is a leaning plank and dramatically easier. Same named test, incomparable results.

- **Measure and record hand distance from the wall.** Use the **identical distance** at every retest. Jerry's natural working distance sets it — do not impose a number, but lock it once measured, since the 30s start was recorded at whatever distance he already uses.
- **Position standard:** ribs down, glutes engaged, no lower-back arch. Stacked line, not a banana.
- **Toe contact is a brush, not a lean.** Pressing into the wall for support inflates the number.
- **Hold ends when the LINE breaks** — hips pike or lumbar arches — not when he falls off the wall.
- Back-to-wall (heels on wall, facing out) is **not** this test and does not substitute; it teaches the arch this target exists to eliminate.

### Rolling-measure parameters (approved)
- **Window:** last **6 qualifying sessions** (~2 weeks at current cadence)
- **Hit rate for "locked in":** **4 of 6** (67%)
- **Attempt cap on the triple:** the 3 qualifying ≥20s holds must land within **5 attempts** in the same block; rest between them unrestricted
- **Qualifying session** = a dedicated skill block: wrist prep done, deliberate max-hold attempts, logged as a session. Incidental time upside down (warmups, a wall hold between sets of something else) does **NOT** enter the denominator — diluting it makes the rate read artificially low.

### ⚠️ These must be able to REGRESS
`log:hs_sessions_10s_of6`, `log:hs_sessions_20s_of6`, and `log:hs_triple20_of6` are **snapshot metrics — `cumulative: false`.** Each is recomputed over the trailing 6 qualifying sessions and re-logged after every session.

**Do NOT implement any of them as cumulative counters.** A counter cannot decrease, so "sessions where I hit 20s" would climb to 4 and stay there through a six-week layoff — a trophy case, not a consistency measure. `log:hs_triple20_of6` is framed as "achieved in ≥1 of last 6" rather than "ever achieved" for the same reason: it lights up on first success and goes dark if the capacity disappears.

Contrast with Goal 3's `log:study_hours`, which IS `cumulative: true`. Do not copy that pattern here.

### Per-session logging protocol
1. `log_workout` — each attempt as its own set on `Freestanding Handstand Hold`, duration in seconds. **Log every attempt, not just the best** — the rolling targets need attempt counts for the ≤5-attempt cap.
2. Recompute the three rolling values over the trailing 6 qualifying sessions.
3. `log_metric` × 3 for `hs_sessions_10s_of6`, `hs_sessions_20s_of6`, `hs_triple20_of6`.

Four writes per session. Build a helper if it gets tedious.

### Milestone on record (import as a data point, NOT completion)
**2026-08-09 — ~10s freestanding hold, video-verified.** Frame analysis at 24fps: stacked and vertical ~27.5s, first visible break ~38.25s, controlled pike-out bail, no wall contact, no finger-save. Conservative floor 10.0s; frame estimate 10.7s. Jerry confirms 10s. Second occurrence ever, first in many months.

### ⚠️ Unverified before import
How the readiness engine resolves `baseline:*` vs `log:*` targets for this goal — `log:*` snapshot behavior is confirmed via Goal 3's pattern, but the interaction of four handstand targets on one goal has never been run. **Call `compute_readiness` immediately after creation** and confirm the score reflects the intended weights before trusting it.

**Expected at import (only the 8/9 session on record):** max at 50% (10 of 20s), rolling measures at or near 0, `triple20` gate open → **ceiling 80, raw score low.** That is correct and honest. The max and the 10s rate will carry live signal for the next few months while the 20s measures sit at zero — that is the intended function of a progression rubric, not dead weight.

**attributionHints:** Chest-to-Wall Handstand Hold · Freestanding Handstand Hold · Freestanding Hold Attempts · Shoulder Taps (chest-to-wall) · Kick-up + Bail Practice · Toe Pulls (wall) · Crow Pose Hold · Crow → Headstand → Crow Sequence · Headstand · L-Sit Progression · L-Sit (Parallettes) · Pike Push-Up · Elevated Pike Push-Up · Floating Pike Push-Up · Floating Pike Push-Up Press · Wall Handstand Push-Up · Wrist Prep

**legend:** 🤸 trained · 🎯 goal-date · 📏 baseline

**Baseline verification flags:** Wall HSPU start 0 pending full-ROM-vs-assisted check (S2); L-Sit start 30 pending confirmation (S1); re-log Pull-Up Max Reps = 25 (S3 — baseline currently reads stale 20; true max hit 7/29). See the three-session baseline split below.

---

## GOAL 2 — Reach 10% Body Fat
**Objective:** `Reach 10% body fat`
**kind:** fitness · **targetDate:** 2026-12-31 · **NO PLAN** (metrics only)
**Status:** NOT created. Create fresh under Program.

| metric | label | start | target | units | dir | weight | gate |
|---|---|---|---|---|---|---|---|
| bodyFatPct | Body fat % (DEXA-anchored) | TBD 9/3 | 10 | % | dec | 0.45 | |
| weightLb | Body weight (proxy) | 155 | 143 | lb | dec | 0.40 | |
| baseline:Pull-Up Max Reps | Pull-up max (lean-mass canary) | 25 | 25 | reps | inc | 0.15 | |

**Notes / rationale:**
- **Target is body-fat %, weight is the proxy.** 143 assumes ~129 lb lean mass (129 ÷ 0.90). If the Sept 3 DEXA says lean mass is ~135, 10% ≈ 150 and the weight target moves — do NOT hard-commit 143 until the scan.
- **Pull-up canary:** losing weight while pull-up max holds = losing fat, not muscle. If it drops at constant bodyweight, slow the deficit.
- **⚠️ VERIFY `bodyFatPct` metric key resolves in the readiness engine.** It was never used during Elbert (weightLb was). If the key is unsupported, either add engine support or fall back to weight-only until the field exists. Run compute_readiness immediately after creation to confirm.
- **Rate:** ~1 lb/week, ~0.7 net, target reachable ~early Nov (≈7 wk early) — bank the margin, don't spend it.
- **Phase 2B sequel:** this goal continues into 2027 as a reverse diet (143 → 155 across the year). Don't design it as Dec-terminal.

**attributionHints:** (none — advanced by nutrition logging + weigh-ins, not exercises)
**legend:** ⚖️ weigh-in · 🎯 goal-date · 📊 DEXA

---

## GOAL 3 — AWS Solutions Architect Associate
**Objective:** `Pass the AWS Solutions Architect Associate exam`
**kind:** project · **targetDate:** none (readiness-GATED, ~Q1 2027) · **NO training plan**
**Status:** NOT created. Create fresh under Program.

Readiness-gated, not date-driven — you don't control an exam you haven't studied for. Schedule the exam only when practice exams clear 80%.

| metric | label | start | target | units | dir | weight | gate | cumulative |
|---|---|---|---|---|---|---|---|---|
| log:study_hours | Cumulative study hours | 0 | 120 | hours | inc | 0.45 | | ✅ yes |
| log:sections_done | Course sections complete | 0 | 23 | sections | inc | 0.30 | | no (snapshot) |
| log:practice_exam_score | Practice exam score | 0 | 80 | % | inc | 0.25 | ✅ | no (snapshot) |

**Notes / rationale:**
- **Course:** Learn Cantrill SAA (~350 lectures, ~60–65 hr video). No fast-forwarding — Jerry pauses/rewinds/rewatches. Total effort incl. demos, labs, notes, practice exams estimated **115–125 hr**. Target 120.
- **Split:** treadmill = lectures (Mon/Wed/Thu fasted-walk mornings, ~3 hr/wk); desk = demos, labs, diagram-heavy sections (Tue/Fri + weekend, ~2–3 hr/wk). Demos can't be done on a treadmill.
- **`log:study_hours` is cumulative:true** — log per-session increments; engine sums. Do NOT log running totals.
- **`log:sections_done` and `log:practice_exam_score` are snapshots** — log the current value.
- **Practice-exam gate:** readiness caps at 80 until practice exams ≥ 80%. This is the "schedule the exam" trigger.
- **Feeds SimpleSense** — the cert strengthens that application; keep them mentally linked.

**legend:** 📚 study session · 🎓 exam-ready gate

---

## NUTRITION — the descent (standing rule under Program)
Jerry lives at a **1,500–1,600 cal floor on normal days** and does NOT pre-plan refeeds. High days arrive unplanned (hikes, travel, events, or a day the body clearly wants it) and are logged as they come — over a 20-week block with 6 travel windows + events, there are enough of them to punctuate the floor naturally. This matches his demonstrated pattern: clean-week floors of 1,355–1,622 with strength climbing throughout (goblet → 176, 25-rep pull-up, 405 step-ups). Do NOT impose scheduled refeed days.

```
Normal day (default): 1,500–1,600 cal — where he lives on the descent
Abnormal/high day: UNPLANNED, as it comes — hike / travel / event / body-driven.
  Eat to the occasion, log it, no guilt, no pre-scheduling.
Protein floor: 150–155 g EVERY day, all tiers — muscle-sparing, non-negotiable
Fat: ~20 g weekday is fine done right; higher on abnormal days
```

**The one watch (reactive, not planned):**
- **Pull-up max is the lean-mass canary.** Holding 25 while weight drops = losing fat. A persistent dip at constant bodyweight = deficit too deep → eat more.
- **Soft flag:** if ~10+ consecutive floor days stack with NO high day above them (likeliest in the deep-winter months when hikes thin out), that's the one place the self-regulating pattern can drift too deep. Nudge a high day in. Elbert never hit this because weekly hikes broke it up automatically.
- No deficit chasing in any future final-2-weeks-before-a-peak window.
- Greek yogurt default: nonfat vanilla Chobani. Eggs counted individually. Log only what's stated.
- Saved meals to carry over: **Protein Brookie** (310/6.5F/31P/42.5C per brookie), **Chipotle Protein Bowl** (670/20F/71P/60C full bowl, log fractions). Honey Blend, Chick-fil-A sauce defaults exist.

---

## CHECKPOINTS (scheduled items — surface on Today without a plan)

| date | goal | item |
|---|---|---|
| 2026-09-03 | Body Comp | **DEXA scan #1 (baseline)** — fasted, AM, normally hydrated, no training that morning, not day-after-hike. Sets the real bodyFatPct start + confirms/moves the 143 target. |
| weekly (Sun/Mon) | Body Comp | Weigh-in + waist tape (navel, fasted) + note |
| ~2026-10-18 | Body Comp | **DEXA scan #2** — end of Block 1. Watch LEAN MASS, not just fat %. If lean mass dropping → slow the deficit. |
| ~2026-12-28 | Body Comp | **DEXA scan #3** — confirm finish, set baseline for 2027 reverse diet |
| Block 1 end (~10/18) | AWS | Practice-exam checkpoint #1 |
| Block 2 end (~12/6) | AWS | Practice-exam checkpoint #2 — if ≥80%, schedule the real exam |
| monthly | Body Comp | Progress photos — same bathroom/light/poses; continues the May 2 / Jun 15 / Jul 29 / Aug 9 series |

---

## BASELINE TESTING — SPLIT ACROSS THREE SESSIONS
*Revised 2026-08-09. Previously specified as one session ("SESSION-1"); that was a measurement error.*

**Why split.** Five of the six tests load the same shoulder complex — freestanding hold, chest-to-wall hold, wall HSPU, floating pike push-up, floating pike press. Run back-to-back, everything after the second test is measured under accumulated fatigue. Start values come in artificially low, readiness under-reads for the whole block, and the week-6 retest shows "improvement" that is partly just a different fatigue state. **Both gating targets are in this battery** — a depressed gate start makes the 80-ceiling math wrong for months. Block 0 runs two full weeks; there is no reason to compress this.

Log against Goal 1 once performed. **Do NOT pre-seed — log actual results.**

### S1 · Mon Aug 10 — Balance (fully fresh)
Nothing precedes these that loads a shoulder.
- **Wrist Prep** (5 min, not scored) — kneeling rocks: fingers-forward ×10, fingers-back ×10, palm-up ×10, knuckle ×10, circles ×10 each way; then 2× 15s chest-to-wall at ~50%
- **Freestanding Handstand Hold** — best of **3–4 attempts**, **2–3 min full rest between attempts**. Stop at 4 even if it feels good. Record **every attempt individually** (duration + clean kick-up vs. save), not just the best
- **L-Sit (Parallettes)** — max hold, single attempt, 3+ min after the last handstand attempt. Straight-arm support and compression, not pressing — safe to pair here. Confirms or moves the 30s start

### S2 · Wed Aug 12 — Vertical press
These three genuinely conflict and cannot be fully separated, so order by stakes: gate first, cheapest target absorbs the fatigue.
- **Wrist Prep**
- **Wall Handstand Push-Up** — max clean **FULL-ROM** reps (head to floor, full lockout). Note if assisted — the 0 start depends on this
- *(5+ min rest)*
- **Floating Pike Push-Up** — max strict reps, feet float ~1 ft and return
- **Floating Pike Push-Up Press** — attempts + quality notes (currently ~2 with strong press but falls off balance). **Tracked indicator, not a scored target**

### S3 · Thu Aug 13 — Support isometric + admin
A max chest-to-wall hold is a shoulder isometric to failure — it needs its own slot, and it is the test most likely to contaminate a freestanding attempt if they share a morning.
- **Wrist Prep**
- **Chest-to-Wall Handstand Hold** — max hold. Confirms the 30s start
- **Pull-Up Max Reps** — **do not test. Re-log at 25** to correct the stale 20 (true max hit 7/29)

**All baselines land before Aug 14–15 (Mirror Lake). That window stays untouched.**

### ⚠️ Protocol-consistency rule (applies to every retest, weeks 6 and 12)
Perfect isolation is not achievable in this battery — **consistent conditions are.** For each session record: **test order, rest intervals actually taken, and time of day.** Retest in the **identical order with the same rests**. A retest run in a different sequence is not comparable to the initial no matter how clean each individual test was, and will produce phantom progress or phantom regression.

---

## THE WEEK (rotation for Goal 1's plan — build once redesign ships)

| day | fasted AM (walk 45' @15% 2.3mph + AWS lectures) | main session | PM |
|---|---|---|---|
| Mon | ✅ walk + AWS | Upper — pressing anchor: overhead + **incline DB bench** + accessory/TRX | skill |
| Tue | ✖ (lower day — lift fresh) · AWS desk block | Lower — Smith-loaded squat/RDL + **pull-up GTG** (2–3 submax) | skill |
| Wed | ✅ walk + AWS | Mobility-forward + light skill | skill |
| Thu | ✅ walk + AWS | Upper — vertical/HSPU builder: push press / wall-pike press + **weighted dips** (belt) | skill |
| Fri | ✖ (lower day — lift fresh) · AWS desk block | Lower + explosive + **pull-up GTG** | skill |
| Sat | long effort | Hike (default) / "get steps in" (winter fallback) + AWS desk | — |
| Sun | optional walk + AWS | Active recovery + mobility | skill |

**Principles baked in:**
- Skill is a **daily PM block**, programmed A/B/C rotation (NOT a menu — Jerry wants no choosing). AM only if PM won't happen.
- **Pull-ups to failure 2–3×/wk** (kept — Jerry enjoys them) PLUS GTG submax on lower days.
- Strength **maintained, not built** — heavy, low volume.
- **No incline walk before lower days** (pre-fatigues legs) — those mornings do AWS desk work instead.
- Equipment: 65 lb DB ceiling, short parallettes, **Smith machine** (solves the DB ceiling for loaded legs), **TRX** (handstand/pike scaling + rows), **weight belt** (weighted dips/pull-ups), wall + floor. Incline walk = concentric calf (safe daily-ish).
- Morning Achilles first-step check stays a standing item.

**A/B/C skill sessions (all open with Wrist Prep, ≤20 min, stop at quality drop, never to failure):**
- **A — Balance:** chest-to-wall accumulation → toe pulls (find the float) → kick-up + bail (only if toe pulls felt controlled) → pike/hamstring close
- **B — Pressing:** floating pike push-ups (parallettes) → floating pike press attempts → pike compression → thoracic/lat close
- **C — Ground/Support:** crow → headstand → crow (CoG play) → L-sit progression → shoulder taps (grip cue) → long mobility close
