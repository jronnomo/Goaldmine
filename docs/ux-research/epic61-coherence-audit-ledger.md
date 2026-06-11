# Recommendation Ledger — Epic #61 Coherence Audit

**Report:** [`epic61-coherence-audit.md`](./epic61-coherence-audit.md)
**Issue:** jronnomo/workout-planner Epic #61 (cross-phase audit of #62 · interstitial · #63 · #64)

Stable IDs `EPIC61-R-NN` — assigned once, never renumbered. Status starts `proposed`. The implementing PR ticks each row to `shipped` / `reworked` / `dropped` with a SHA, `file:line`, or one-line reason. Rows tagged `tuning⚠` / `decoration⚠` / `a11y` are the ones a future audit cares about most.

These are NEW recommendations from the coherence audit. They do **not** reopen the per-phase ledgers (UXR-62 / 62B / 63 / 64); they reconcile drift *between* them.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| EPIC61-R-01 | Unify the user-visible axis noun on "**Reach**". Replace "rarity" → "Reach" in the 3 visible state strings (Tracked: "counts toward **Reach**"; Untracked: "Hidden from the calendar, coach, and **Reach**…"; Plan paused: "…date, coach, **Reach** intact.") and in the interview-banner "feasibility" → "Reach". Keep "rarity" ONLY in MCP/coach vocabulary (per UXR-63-01). Source: EPIC61-01. | copy | shipped | 068e383 Reach unification across goals pages/glossary/banner |
| EPIC61-R-02 | Change the unrated ReachMeter `aria-label` from "Feasibility not yet rated" → "**Reach not yet rated**" so SR copy matches the on-screen axis. (Supersedes the now-stale UXR-63-19 aria string.) Source: EPIC61-02. | a11y | shipped | 068e383 ReachMeter aria |
| EPIC61-R-03 | Add a "**Last trained**" row to the "What do these states mean?" glossary (or a one-line decision note accepting it as self-evident) so the Phase-3 "trained Nd ago / no training logged" subline is covered like every other row-state. Source: EPIC61-03. | copy | shipped | 068e383 glossary Trained row |
| EPIC61-R-04 | Reconcile the interview-banner sub-copy: drop "feasibility" and resolve the "5-minute intake" vs the 7-step coach prompt body (`coach/page.tsx` PROMPTS[0]) into one number; correct the UXR-64-02 ledger evidence to the actually-shipped string. Source: EPIC61-04. | copy | reworked | 068e383 shipped banner copy kept (more concrete than UXR-64-02 spec) |
| EPIC61-R-05 | (Optional reward-polish) Give the "**trained today**" state a faint affirming register (e.g. `--accent` glyph/text instead of flat `--muted`) so the goal/stack surfaces have at least one positive beat, not only neutral/caution. Keep all other trained states muted. Source: EPIC61-06. | tuning⚠ | shipped | 068e383 per finding |
| EPIC61-R-06 | (Optional reward-polish) Let the **quiet** StackReachCard carry a one-line affirming reason when the slate is well-paced (Common/Uncommon), so the always-present card isn't only ever neutral-or-alarm (mirror the escalated reason line, calm register, no color). Source: EPIC61-06. | copy | shipped | 068e383 per finding |
| EPIC61-R-07 | (Verification, not a change) Resolve the still-owed device/data passes flagged in the audit: the `still-needs-device` perceptual rows (claim-ring @13px, Epic-vs-Legendary 4-vs-5 fill, washes, target rail) and the `still-needs-DATA` escalated StackReachCard / `?stackWarning` banner (no Epic/Legendary goal exists in the DB). `--warning`-on-card AA (UXR-63-22) is resolved by computed contrast ≈5.3:1 and needs no device check. | tuning⚠ | dropped | device/fixture pass owed to user — Legendary-stack fixture + phone check; not codeable |

## ⚠ Provisional / Verify-Visually subset

EPIC61-R-05 (trained-today accent — verify it reads as affirming, not as a new control, on device) · EPIC61-R-07 (the inherited per-phase device/data passes; create a Legendary-stack fixture to confirm alarm-not-prize live).

*Audit ledger — reconciles cross-phase drift only; the per-phase UXR ledgers stand.*
