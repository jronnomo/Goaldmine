# Issues — Sprint 4, Iteration 1

**Converged after one fix pass (3 one-line TZ fixes).**

- Gates: tsc 0 · lint clean · build success (re-run post-fix).
- QA agent verdict: MINOR FIXES → Fix agent bf98f97 added explicit `timeZone: USER_TZ` to three milestone date labels (ProjectTodayView, ProjectPlanView dueLabel, MilestoneBurnDown). All REQ ACs PASS.
- Live smoke (#58): effective **29/29**. Raw run showed 8 fails — all script-side, verified and resolved:
  - 2b/5a: grep patterns didn't account for JSON-escaped tool responses; flips proven by rendered pages + DB check.
  - 3i/3l: summary renders "X / Y milestones complete" (matches the UXR §3 ASCII big-number framing; the older issue-AC text said "X of Y" — UXR is normative per PRD §5). Corrected asserts pass.
  - 4c: plan empty state shipped with paraphrased copy ("No scheduled items yet — ask Claude to build out the schedule for this goal") vs the issue AC's quoted sentence — **accepted deviation** (identical intent; Today's empty copy follows UXR-s4-02 verbatim).
  - 5b ×3: regression references were captured pre-fixture but compared while temp goals still existed (their readiness cards/events legitimately appear). Post-cleanup re-comparison: **all four fitness pages byte-identical (extracted text)**.
- Fixtures fully cleaned: temp goals deleted (0 orphans), Chewgether milestones back to 0, fitness focus restored.

## Remaining for the user (UXR §9 manual visual items — not blockers)
On a real 390px device (or `docs/ux-research/sprint-4-project-ui.mockup.html`): ◆ at 13px both themes · ≤14d urgency threshold feel · pop timing/entry-scale at 28px · Bullseye ring read at 1–2 items · off-tap celebration sign-off · two contrast spots · (s4-21 verified in code).
