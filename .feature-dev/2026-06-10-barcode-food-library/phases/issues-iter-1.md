# Issues — Iteration 1 (QA: MINOR FIXES)

Gates: tsc clean · feature-files lint clean · build OK (scanner in async chunks) · wasm 200 · /nutrition 200 (empty-library scan affordance) · MCP frequentFoods present · all 12 critique resolutions verified in code.

| # | Sev | File | Issue | Fix |
|---|-----|------|-------|-----|
| BUG-001 | Minor (ship-blocking) | ScanFoodSheet.tsx:186 | Esc/backdrop close in scan phase leaves camera running (phase not reset on !open → active stays true) | `active={open && phase === "scan"}` (+ consider phase reset on close) |
| FIND-001 | Low | BottomSheet.tsx:31-39 | show-effect missing cleanup return per blueprint §7.2 | add cleanup closing open dialog |
| FIND-002 | Trivial | docs/project-gotchas.md:68 | §B numbering: new entry inserted before existing §B.5, duplicate "5." | renumber |

Device-test-only (user, post-deploy): iPhone PWA scan, green-light clearance, stacked-dialog Esc/backdrop/VoiceOver.
