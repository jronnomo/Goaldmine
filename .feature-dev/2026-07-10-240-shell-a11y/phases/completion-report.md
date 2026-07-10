# Completion report — #240 — 2026-07-10 · Sprint 13

## Shipped (commit 7fe57d3, merged c5b5e87 on feature/phase1-auth; +67/-20 across 4 files)
1. **44px tap targets**: ThemeToggle, SessionMenu avatar trigger, BottomSheet close, **ScanFoodSheet close (scope amendment — byte-identical sibling the AC missed)** all `w-9 h-9` → `w-11 h-11`; avatar Image intrinsic 36→44. Header's 48px row and the sheets' intrinsic-height headers absorb it.
2. **Real menu semantics**: `aria-haspopup="menu"`, useId-backed `id`/`aria-controls` (a gap the AC missed).
3. **Focus management (built from scratch — AC overstated the scaffolding)**: focus → Settings on open; containment-guarded refocus of the trigger on close. The guard is the DA's pre-implementation catch: an unconditional cleanup refocus would have yanked focus off an outside element the user just clicked into (native focus-on-mousedown runs before React's cleanup). Ref snapshots inside the effect keep exhaustive-deps clean with zero disables.
4. **Avatar fallback**: extracted `Avatar` subcomponent holding `imgError`, keyed by `user.image` so a router.refresh-delivered URL change resets the error state (DA finding — a bare onError would latch broken forever).
5. Tab-only navigation documented in-code as deliberate APG debt for a 2-item menu (DA: don't ship it silently).

## Verification
- Gates: tsc 0 · lint 0 errors, 0 new warnings (dev agent verified via stash-diff; the DA's literal snippet would have added 2 exhaustive-deps warnings — fixed with the standard ref-snapshot idiom) · **794/794** · build OK.
- Greps: no `w-9 h-9` in the four files; `aria-haspopup="menu"`.
- **REQUIRED DEBT — keyboard-only pass NOT RUN** (Chrome extension disconnected, 4th consecutive story). This story's AC explicitly demands a manual keyboard pass (Tab→Enter→focus-on-Settings, Escape→focus-return, outside-click non-theft, broken-avatar fallback). Unlike #237-#239's parity debt (byte-identical refactors), this is NEW BEHAVIOR — the focus logic is DA-reviewed and simple, but it should be keyboard-verified before the next production deploy. **Recommend: reconnect Chrome, run the consolidated debt pass (#237-#240) before /launch-gate.**

## Process
Premise check (BottomSheet line stale post-#253; focus mgmt from scratch; fallback not state-driven; ScanFoodSheet sibling found) → PRD → DA **APPROVE-WITH-CONDITIONS** (verified Next 16 Link ref-as-prop in installed source; caught the mousedown focus-theft race; imgError latch; ruled tab-only acceptable-but-documented) → dev agent (stale base self-corrected; one sound deviation: ref-snapshot for exhaustive-deps) → gates. Zero iterations.

## Notes
- Sprint 13 remaining: #241–#244, #249.
- Browser-debt ledger: #237 (nutrition labels parity), #238 (plan-format parity), #239 (skeleton flash checks), **#240 (keyboard pass — REQUIRED before deploy)**.
