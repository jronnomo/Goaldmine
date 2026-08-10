# Phase 2A — Goal Import Spec
### "Lighter and Upside Down" · Aug 10 – Dec 31, 2026
*Authored 2026-08-10. Source of truth for importing the three Phase 2A goals + Program into Goaldmine once the Program-model redesign (see goaldmine-program-redesign-brief.md + the RFC) ships. Until then, Goal 1 already exists in the app (id cmsmi9k20000004laub50psio) on the OLD model with an auto-scaffolded plan that should be set inactive; Goals 2 and 3 are NOT yet created — do not create them on the old model, import them here.*

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
**Objective:** `Freestanding Handstand — repeatable holds (mastery + consistency), then 5 wall HSPU`
**kind:** fitness · **targetDate:** 2026-12-31 · **owns the Program rotation**
**Status:** IMPORTED to prod 2026-08-10 under the Program (id `cmsmi9k20000004laub50psio`, re-parented — not duplicated) carrying the ORIGINAL single-hold rung below; re-targeting to the redesigned rung is pending the measurement decision.

Two gating rungs; ceiling capped at 80 until BOTH clear (mastery-before-done). Rung 3 (5 freestanding HSPU) deferred to Phase 2B/2027.

### Rung 1 — REDESIGNED 2026-08-10: repeatable holds, not one max hold
The original rung ("a single 20s hold") measured a peak. The redesign measures **mastery**: multiple freestanding holds **within a session**, repeated **across sessions** — this is the rolling window the travel-section caveat scores off ("last 6 qualifying sessions").

- **Within-session bar:** ⟨N holds ≥ T seconds in one skill session⟩ — **N and T TBD** (decide with the measurement design)
- **Across-session bar:** hit the within-session bar in ⟨K of the last 6 qualifying sessions⟩ — **K TBD**
- **Qualifying session:** **definition TBD** (needs to settle: which session types count, minimum attempts recorded, and whether travel-window sessions per the Oct 2–5 rules enter the denominator)
- **Peak signal retained:** best single hold still logged every session for trend/records — it just no longer gates on its own
- **Gate semantics unchanged:** rung 1 still caps readiness at 80 until the across-session bar clears

**Measurement mechanics — DECISION PENDING (next conversation):** (a) coach-computed rolling rate logged per session as a `log:*` snapshot metric (works today, zero engine change — coach reasons, app stores); (b) engine-native `rolling:*` metric family computed from per-session baseline rows (new resolver work, engine-computed). Until decided, prod keeps the imported single-hold rung so readiness stays honest, and **Session-1 logging records EVERY attempt's duration, not just the best** — per-attempt data backfills either design.

| metric | label | start | target | units | dir | weight | gate |
|---|---|---|---|---|---|---|---|
| ⟨rung-1 repeatability metric — mechanics TBD, replaces the single-hold row⟩ | Repeatable freestanding holds | 0 | ⟨TBD⟩ | sessions | inc | 0.35 | ✅ |
| *(imported interim: baseline:Freestanding Handstand Hold 0→20 sec, gated — live in prod until the row above is defined)* | | | | | | | |
| baseline:Wall Handstand Push-Up | Wall handstand push-up (full ROM) | 0 | 5 | reps | inc | 0.25 | ✅ |
| baseline:Chest-to-Wall Handstand Hold | Chest-to-wall handstand hold | 30 | 60 | sec | inc | 0.12 | |
| baseline:Pull-Up Max Reps | Pull-up max (maintain) | 25 | 25 | reps | inc | 0.10 | |
| baseline:Floating Pike Push-Up | Floating pike push-up | 5 | 10 | reps | inc | 0.09 | |
| baseline:L-Sit (Parallettes) | L-sit hold (parallettes) | 30 | 60 | sec | inc | 0.09 | |

**attributionHints:** Chest-to-Wall Handstand Hold · Freestanding Handstand Hold · Freestanding Hold Attempts · Shoulder Taps (chest-to-wall) · Kick-up + Bail Practice · Toe Pulls (wall) · Crow Pose Hold · Crow → Headstand → Crow Sequence · Headstand · L-Sit Progression · L-Sit (Parallettes) · Pike Push-Up · Elevated Pike Push-Up · Floating Pike Push-Up · Floating Pike Push-Up Press · Wall Handstand Push-Up · Wrist Prep

**legend:** 🤸 trained · 🎯 goal-date · 📏 baseline

**Session-1 verification flags:** Wall HSPU start 0 pending full-ROM-vs-assisted check; L-Sit start 30 pending confirmation; re-log Pull-Up Max Reps = 25 (baseline currently reads stale 20; true max hit 7/29).

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

## SESSION-1 BASELINE TEST (run FRESH, before other work — the first skill session)
Log these against Goal 1 once performed. Do NOT pre-seed — log actual results.

- **Freestanding Handstand Hold** — 3–4 attempts; **record EVERY attempt's duration** (the rung-1 repeatability redesign needs per-attempt data), best-of feeds the interim single-hold metric
- **Wall Handstand Push-Up** — max clean FULL-ROM reps (head to floor, full lockout); note if assisted
- **L-Sit (Parallettes)** — max hold, short parallettes
- **Floating Pike Push-Up** — max reps, feet float ~1 ft and return (strict definition)
- **Floating Pike Push-Up Press** — record attempts/quality (currently ~2 with strong press but falls off balance) — tracked indicator, not a scored target
- **Chest-to-Wall Handstand Hold** — max (confirms the 30s start)
- **Pull-Up Max Reps** — re-log at 25 to correct the stale 20 baseline

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
