# PRD: BottomSheet real two-phase mount (#253)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #253 (Sprint 13 opener — filed by #233's DA with root cause)
**Branch**: feature/phase1-auth
**UX-research**: skipped — bug fix, zero visual/behavioral surface change (sheets render identically; only hydration correctness changes)

---

## 1. Overview

### 1.1 Problem Statement
BottomSheet.tsx:81 guards the portal with `typeof document === "undefined"` — a **server-only** check. `document` exists during the client hydration pass, so the client's first render portals the `<dialog>` where the server emitted nothing → React hydration exception on EVERY route rendering BottomNav (all signed-in routes). Dev mode throws the exception; prod silently discards and regenerates the client tree — wasted work, plus the intermittent eaten-interactions the #235 dev observed on /days (now a richer stateful surface with the override editor). The file's own docstring (:35-42) and guard comment (:78-80) falsely claim two-phase behavior ("returns null during … the initial hydration render") that the code does not implement.

### 1.2 Premise check (2026-07-10, HEAD 54b6e6c) — all claims verified
| Claim | Verdict |
|---|---|
| Guard is server-only; hydration pass renders the portal | TRUE (:81) |
| Docstring/comment claim two-phase behavior falsely | TRUE (:35-42, :78-80) |
| Naive `useState(false)`+`useEffect(setMounted)` fix trips `react-hooks/set-state-in-effect` | TRUE — rule active via eslint-plugin-react-hooks@7.1.1 (BottomNav.tsx:86 carries a disable for it); the docstring cites this rule as why the naive fix was avoided |
| Lint-clean idiom exists in-repo | TRUE — ThemeToggle.tsx:3,21-31 `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` |
| Any consumer opens on first paint (mount race) | FALSE — all 5 mount sites (BottomNav ×2, MealEditButton, NutritionList, BadgeWall) start closed; zero `open={true}`/defaultOpen |
| Late mount breaks the open/close effect | FALSE — `[open]` effect no-ops on null dialogRef (:57) until the portal exists |
| Late mount breaks LogLauncher's fetch | FALSE — closed→open guard (prevOpenRef :146, effect :185-188) tolerates a one-commit-late mount |

### 1.3 Success Criteria
ZERO hydration exceptions on /, /compare, /days (vs the #233 baseline signature: `BottomNav → BottomSheet(open=false) → client <dialog> vs server <script>`); all five sheet consumers functionally unchanged; no new lint disables; gates green at the 770-test baseline.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Any tenant on any signed-in route | hydration to complete without React discarding/regenerating the tree | no wasted work, no intermittently eaten first interactions | Must Have |
| US-002 | Developer | dev consoles free of the app-wide hydration exception | real regressions stop hiding behind a "known warning" exemption | Must Have |

---

## 3. Functional Requirements

### 3.1 Core (single file: `src/components/BottomSheet.tsx`)
1. **Mounted gate**: module-level stable `subscribeNever` (noop subscribe returning a cleanup) + `const mounted = useSyncExternalStore(subscribeNever, () => true, () => false)` — server AND hydration render return the server snapshot (false → null, matching server HTML); post-hydration re-read returns true → second commit portals the dialog. Snapshot getters may also be hoisted module-level for identity stability (ThemeToggle shape).
2. **Guard swap**: `:81` becomes `if (!mounted) return null;` — the `typeof document` check is redundant by construction (mounted is false on the server); drop it or keep with a one-line rationale, dev judgment.
3. **Comment truth**: rewrite the docstring (:35-42) and guard comment (:78-80) to describe the REAL mechanism: server + hydration commit render null; portal on second commit; `useSyncExternalStore` chosen over setState-in-effect because of the `react-hooks/set-state-in-effect` rule, per the ThemeToggle precedent.
4. **NO `suppressHydrationWarning`** — with a correct gate both passes agree; adding suppress would mask future regressions.

### 3.2 Out of Scope
Consumer changes; #252 nested-dialog work; a component test file (untested per repo convention — verification is the browser protocol); any animation/CSS change.

---

## 4. Technical Design
No schema/route/MCP/server-action changes (no connector reload). One client component edited. Portal-to-body invariant, native-dialog open/close driving, scroll lock, and all event wiring untouched.

---

## 5. UI/UX
None — sheets render identically; the dialog simply enters the DOM one commit later, before any user can interact.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Hydration pass | mounted=false → null → matches server HTML → no exception |
| Second client commit | portal renders; `[open]` effect already handles null→ref transition |
| StrictMode double-invoke (dev) | useSyncExternalStore is the sanctioned primitive — consistent snapshots, no tearing |
| Sheet opened rapidly after load | all consumers start closed; open is user-driven, always after mount |
| CSS targeting `dialog:not([open])` | grep confirms nothing depends on the closed dialog existing in DOM (DA verifies) |

---

## 7. Security
None — no inputs, routes, or data-flow changes.

---

## 8. Acceptance Criteria
1. [ ] Browser consoles on /, /compare, /days: ZERO hydration exceptions (baseline signature gone)
2. [ ] All five sheet consumers open/close correctly; LogLauncher fetch fires on open only
3. [ ] grep: no `suppressHydrationWarning` added; no new lint disables; docstring no longer claims hydration-pass nulling via `typeof document`
4. [ ] tsc 0 / lint no new / 770 tests / build OK

---

## 9. Open Questions
DA rules: subscribe identity stability; StrictMode semantics; closed-dialog CSS dependencies; redundant-document-check disposition; suppress-warning question; any code relying on the old client-only presence timing.

---

## 10. Test Plan
Gates; dev-agent in-worktree browser pass (dev server, consoles on the three baseline routes + functional sheet checks); orchestrator after-pass on the same routes.

---

## 11. Appendix
Baseline: `.feature-dev/2026-07-10-233-layout-fetch-deferral/phases/hydration-baseline-before.md`. Root-cause credit: #233's Devil's Advocate. Post-ship: the project-memory "known pre-existing hydration warning" exemption dies.
