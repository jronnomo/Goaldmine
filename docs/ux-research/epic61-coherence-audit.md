# Epic #61 — Cross-Phase UX Coherence Audit

**Scope:** Do the three independently-researched phases of Epic #61 cohere as ONE experience?
**Method:** Read-only audit of the rendered app (dev server on :3462, all pages 200) + the four shipped reports + four ledgers, checked against live markup/classes/copy.
**Not in scope:** new design. Findings + ≤3 optional reward-polish items only.
**Surfaces shipped:** Phase 1 (#62) cross-goal awareness · interstitial goal-state controls · Phase 2 (#63) Reach/feasibility · Phase 3 (#64) goal-intake entry.
**Repo:** jronnomo/workout-planner · **Profile:** `.claude/skills/ux-research/profiles/goaldmine.profile.md`

---

## Executive summary — is this epic seamless and rewarding?

Structurally, **yes — it reads as one experience.** Every phase reuses the same four-rung loudness ladder (`--muted` → `--accent-soft` → `--target` → `--warning`), one conflict-banner recipe (`◣` + `border-l-[3px] var(--warning)` + 8% wash, body in `--foreground`), the claim-ring figure/ground rule, and the Bullseye-reserved-for-focus rule. All four journeys trace end-to-end through live surfaces with the right wiring (interview deep-link, promote prefill, someday→unrated meter, conflict→coach CTA). Empty states correctly render **nothing** (the Today strip is absent from the home DOM today), and the **reward layer is live** — `QuestCard` now hosts the once-per-day `bullseye-pop`, plus streak/level/XP on `/character` — so the system is *not* only loud when negative.

The one real crack is **lexical, not structural**: the product shows **three different user-visible words — "Reach," "rarity," and "feasibility" — for the same axis**, and the collision lands *inside the very glossary meant to teach it*. The new Phase-3 "last-trained" subline also isn't covered by that glossary. No critical/high structural defects; fix the vocabulary and the epic is genuinely seamless.

---

## Findings

| id | surface | sev | what | evidence | suggested fix |
|----|---------|-----|------|----------|---------------|
| EPIC61-01 | /goals glossary + Track/Untrack + Plan-paused + interview banner | **high** | Three user-visible nouns for ONE axis. The Reach glossary row teaches "Reach," but the **Tracked**, **Untracked** and **Plan-paused** rows (same glossary) say "**rarity**," and the interview banner says "**feasibility**." Cross-phase drift: UXR-62B state strings (pre-rename) say "rarity"; UXR-63 renamed the on-screen axis to "Reach"; never reconciled. | `/goals` rendered HTML: "…and counts toward **rarity**.", "Hidden from the calendar, coach, and **rarity** until you track it again.", "Goal stays tracked — date, coach, **rarity** intact." + banner "…the date, targets, and **feasibility** before you commit." vs meter `aria-label="Reach: …"` & glossary `<strong>Reach</strong>` | In all user-facing copy replace "rarity"/"feasibility" → "**Reach**" (keep "rarity" only in MCP/coach vocabulary, which is correct per UXR-63-01). 4 strings. |
| EPIC61-02 | ReachMeter (unrated) | low | Unrated meter `aria-label="Feasibility not yet rated"` — screen-reader users hear "Feasibility" while sighted users see "Reach"/"—". Matches UXR-63-19 literally, but that spec predates the Reach rename and is now internally incoherent. | `ReachMeter.tsx` aria-label (rendered on /goals: `aria-label="Feasibility not yet rated"`) | "Reach not yet rated". |
| EPIC61-03 | /goals "What do these states mean?" glossary | **med** | Glossary coverage gap. The Phase-3 "**trained Nd ago / no training logged**" subline appears on every goal row but is **not** explained in the 7-row glossary (Focus, Tracked, Untracked, Someday, Plan active, Plan paused, Reach). The audit brief explicitly asks whether the glossary covers the trained lines — it does not. | Rendered glossary `<strong>` rows = the 7 above; no "trained"/"last trained" row. Subline `goal-row-trained` renders "no training logged" / "trained Nd ago" unexplained. | Add one "Last trained" glossary row ("When this goal was last matched by a logged workout"), or accept as self-evident with a one-line decision note. |
| EPIC61-04 | /goals interview banner sub-copy | low | Shipped sub-copy is **not** the UXR-64-02 string the ledger marks `shipped`. Spec: "A 7-step chat shapes your targets and a plan before you commit the goal." Shipped: "…a **5-minute** intake nails the date, targets, and feasibility before you commit." Introduces "feasibility" (→ EPIC61-01) and "5-minute" while the coach card body is a **7-step** prompt — an internal 5-min-vs-7-step mismatch. | `/goals` HTML banner sub; `coach/page.tsx` PROMPTS[0] body = 7 steps | Reconcile the banner copy (drop "feasibility"; align "7-step" vs "5-minute"); correct UXR-64-02 ledger evidence to reflect the actual shipped string. |
| EPIC61-05 | /goals row subline | low | Three date idioms coexist in one muted subline: absolute `toLocaleDateString()` ("6/15/2026"), relative "trained 3d ago", and "Someday". Defensible (deadline=absolute, log=relative) but worth noting for one-dialect consistency. | `goals/page.tsx` subline: `new Date(g.targetDate).toLocaleDateString()` + `relativeTrainedLabel()` + "Someday" | Optional: keep absolute for the deadline; no change required. Logged for the record. |
| EPIC61-06 | Epic-61 goal/stack surfaces (reward symmetry) | low | The Epic-61 surfaces are exclusively neutral-or-negative loudness (Reach goes loud only at Epic/Legendary; race/conflict/stack banners are cautions). The positive "win" beat lives entirely *outside* the epic (QuestCard pop, streak, level/XP on /character). By design "reward = absence of loudness" (rarity §2) — acceptable, but the always-present StackReachCard and the trained line never have an affirming register. | OtherGoalsStrip null on home (good); StackReachCard quiet-when-calm; "trained today" rendered as plain `--muted`. No positive accent anywhere in the goal/stack surfaces. | Optional reward-polish (≤2 below). Not a defect. |

**No critical findings. No high structural findings.** EPIC61-01 is the only `high`, and it is pure copy.

---

## Consistency matrix (across all three phases)

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **Axis terminology** (Reach / rarity / feasibility) | ⚠ **inconsistent** | "Reach" on meter/card/glossary-row/character; "rarity" in 3 glossary/pill strings; "feasibility" in banner + unrated aria. → EPIC61-01/02/04. |
| **State vocabulary** (Focus/Tracked/Untracked/Someday/Plan active/Plan paused) | ✅ consistent | Identical words across /goals row, glossary, detail toggle, and consequence strings. Closed 6-state set taught once. |
| **Loudness ladder** (muted→accent-soft→target→warning) | ✅ consistent | Reach meter folds onto it (Common/Uncommon=`--muted`, Rare=`--accent`, Epic/Legendary=`--warning`); Today strip & banners obey the same rungs. No 5th rung invented. |
| **Conflict-banner recipe** (race vs conflict vs stackWarning vs Legendary) | ✅ consistent | Conflict / stackWarning / StackReachCard-escalated ALL use `border border-[var(--warning)] border-l-[3px]` + `color-mix(… var(--warning) 8% …)` + `◣` + `--foreground` body. **Race** banner deliberately distinct: `border-[var(--target)]` + 12% target wash, full border (key positive event, not a warning). Clean grammar separation. |
| **Chip recipes** (Someday / Focus / Track / +N / coach tag) | ✅ consistent | All `rounded-full`, token borders; Someday & Untracked share `--border`/`--muted`; Focus = accent outline + filled Bullseye `size=14`; +N = `text-[9px] var(--muted)` on `--accent-soft`. |
| **Claim-ring / Bullseye-reserved-for-focus** | ✅ consistent | Foreign markers (`MarkerIcon`, `OtherGoalsStrip`) all use `outline:1px solid var(--muted); opacity .65; radius 9999px`; Bullseye renders ONLY for `kind==="trained"`/focus. Meter is a separate glyph (Bullseye not overloaded). |
| **Date formats** | ⚠ minor | Absolute (`toLocaleDateString`) + relative ("trained Nd ago") + "Someday" coexist. → EPIC61-05. |
| **Glossary coverage** | ⚠ gap | 7 states taught; "Reach" added; **last-trained subline NOT taught**. → EPIC61-03. |
| **aria / labels** | ✅ mostly | Conflict glyph `aria-hidden`, meter `role=img`+aria-label, banner testIDs present. One drift: unrated aria "Feasibility…" (EPIC61-02). |
| **Animation discipline** | ✅ consistent | Zero motion across all Epic-61 surfaces; `bullseye-pop` reserved for the genuine once-per-day completion (now wired via QuestCard). |

---

## Journey verdicts

- **J1 new-goal** — **seamless, one terminology seam.** `/goals` dashed interview banner → `/coach#interview` (PROMPTS[0], `id="interview"`) → coach/MCP `create_goal` → goal appears with bare Reach meter in subline → `?stackWarning=epic|legendary` banner on detail (with interview-nudge sentence). All wired. Seam: banner says "feasibility," destination glossary/meter say "Reach"/"rarity" (EPIC61-01/04).
- **J2 aspiration** — **seamless.** Journal note → PendingNotes "Promote to goal →" (live on /journal) → `/goals?objective=…#new-goal` prefill → someday goal row (Someday chip + unrated "—" meter + "no training logged") → trained indicator on first match → dated upgrade. Confirmed live: a someday goal's detail shows the Someday chip and a blank/unrated Reach. Minor: unrated aria "Feasibility…" (EPIC61-02).
- **J3 multi-goal week** — **seamless (loud states owe a data/device pass).** Race day → OtherGoalsStrip loud (`accent-soft` + `border-l-2 var(--target)`) → calendar claim-ring foreign markers + `+N` cap=3 + conflict wedge → day-page race banner (target-tint) / conflict banner (warning) → "Ask your coach to sort the week →". Grammar consistent across all four surfaces. Current DB is calm (strip null, no escalation), so the *loud* perception is verified from source/mockup, not live.
- **J4 stack management** — **mostly seamless; seam in the teaching surface.** Glossary (7 states, comprehensible) → Focus/Track/Pause controls (pill + detail toggle, focus guards present) → Reach card (Computed + Coach side-by-side + rationale + per-target) → gold "coach" calibration tag. Seam: the glossary itself says "rarity" in 3 rows while branding the axis "Reach" (EPIC61-01), and omits the trained line (EPIC61-03).

---

## Rendered-vs-spec check on prior `shipped*` rows

**Verified-in-HTML (structure / class strings / copy / tokens exact as speced):**
UXR-62-01,02,03,04,06,08,09,11,12,14,15,16 · UXR-62B-01,04,06,07,08,10 · UXR-63-01,02,03,07,08,10,11,13,15,16,19,20 · UXR-64-01,04,05,06,07,08,09,11,12,13. (Claim-ring tokens, +N chip, loud-strip rail, both banner recipes, focus badge, pause toggle asymmetry, meter ramp, glossary rows, note 2-row split, interview card id — all match byte-for-byte.)

**Resolved via computed contrast (now safe — remove the device-owe):**
- **UXR-63-22** — `--warning #A8511A` on `--card #FFFBF0` computes to **≈5.3:1** (light), well above AA 4.5; dark `--warning #E0915C` on `--card #1A130C` is high-contrast light-on-dark. The "AA edge" worry is unfounded on `--card`; banner/tier text passes. (Keep ≥12px.)

**Still-needs-device (perceptual — NOT confirmable from the DOM):**
- UXR-62-01 claim-ring legibility at 13px · UXR-62-02 opacity channel · UXR-62-04 `+N` 9px AA on `--accent-soft` · UXR-62-06 target rail not out-shouting the hero · UXR-62-08 12% target wash perceptible on cream · UXR-62B-01 paused-subline skimmability · UXR-62B-05 Resume CTA `--accent`-on-`--accent-soft` AA (dark gold tighter) · UXR-63-04 Epic-vs-Legendary (4-vs-5 fill) **and** Common-vs-Uncommon distinguishability · UXR-63-05 segment geometry · UXR-63-07 bare meter at subline scale · UXR-63-09 XP-bar squeeze @390 · UXR-63-13/14 warning-wash perceptibility · UXR-64-15/16/18 banner rhythm / two-link one-row fit / inter-row gap.

**Still-needs-DATA (no Epic/Legendary goal in the current DB):**
- The **escalated** StackReachCard (`stack-rarity-card-escalated`) and the `?stackWarning` banner never render with today's calm data (`stack-rarity-card-escalated` count = 0). Their source + `rarity-tiers.html` mockup are correct; create a Legendary-stack fixture (or a dated stretch goal) to confirm the alarm-not-prize read on a real screen.

---

## Reward audit

- **Nag vs info:** Good posture. OtherGoalsStrip renders **nothing** when empty (confirmed absent from home DOM). "no training logged" is factual, non-guilt (UXR-64-09 intent met). The interview banner is non-dismissible but whisper-rung (dashed), not accent-soft — informs without nagging. StackReachCard is quiet when calm.
- **Legendary alarming-not-prizey:** Correct **in source** — Epic/Legendary meter = `var(--warning)` (amber/orange, never gold, never the reserved rust-red `--target`/`--danger`), Legendary word bold, copy "near-impossible in the time set." Prize-proof by construction. **Cannot confirm live** (no Legendary goal in DB) → verify against `rarity-tiers.html` / a fixture.
- **Empty states render nothing:** ✅ confirmed (strip).
- **Is there a win moment?** ✅ **Yes, and it's live** — `QuestCard` hosts `TodayCelebration` (once-per-day `bullseye-pop`, gated via localStorage), plus a "6 day streak", Level/XP, and achievement rows on `/character`. (Note: the profile's claim that TodayCelebration is "defined but not wired" is now **stale** — it was wired via QuestCard, `page.tsx:175-176` / `QuestCard.tsx:41`.) The system is not only-loud-when-negative.
- **Symmetry within Epic 61:** the goal/stack surfaces themselves carry only neutral/caution registers (by design: reward = absence of loudness). Acceptable; two *optional* polish items below if a small positive beat is wanted.

---

## Bottom line

One experience, one grammar, no structural defects, reward layer live. The only thing standing between "coherent" and "seamless" is a four-string vocabulary cleanup (Reach/rarity/feasibility) and a one-row glossary addition. Ship the copy fix; everything tagged `still-needs-device` remains a genuine on-phone obligation, but nothing there is blocked.

*Audit performed read-only against the live dev render (:3462) + shipped reports/ledgers. New recommendations tracked in `epic61-coherence-audit-ledger.md`.*
