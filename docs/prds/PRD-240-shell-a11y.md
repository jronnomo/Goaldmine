# PRD: Shell/menu tap-target + focus-management a11y (#240)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #240 (Sprint 13 — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — a11y compliance fix with AC-prescribed values (44px minimum, ARIA menu semantics); no design-space exploration

---

## 1. Overview

### 1.1 Problem Statement
The theme toggle, account-menu avatar, and sheet close buttons are 36px hit targets (below the 44px minimum). The account menu announces `aria-haspopup="true"` instead of `"menu"`, has zero focus management (focus never enters the menu or returns to the trigger), and a broken avatar URL shows a broken-image glyph instead of the initials fallback.

### 1.2 Premise check (2026-07-10, HEAD 238ceca) — corrections
| Claim | Verdict |
|---|---|
| ThemeToggle:51 w-9 h-9 | TRUE; header row is h-12 (48px) — 44px fits |
| SessionMenu:73 + BottomSheet:112 | SessionMenu accurate; **BottomSheet's button is at :141** (stale line — #253 shifted it). **AC missed the byte-identical sibling `ScanFoodSheet.tsx:361`** — included (scope amendment). Other 36px targets (BarcodeScanner, LibraryPickerOverlay, MealComposer ×2) stay out — not shell/sheet chrome |
| aria-haspopup fix | TRUE (:71); menu/menuitem roles already real (:94/:116/:125). **Gap: no aria-controls/menu id** — wired in (useId) |
| Focus via single useEffect | Goal valid but **built from scratch** — no refs/focus() exist; `element.focus()` in an effect is lint-clean (≠ setState); layers on the existing two close effects (outside-click :30-39, Escape :42-49); no trap needed (menu ≠ modal) |
| onError → "existing" fallback | **Overstated** — initials markup exists (:84-88, `abbrev`/`initials()`) but is `user.image`-gated only; `imgError` state + onError must be ADDED (event-handler setState — lint-clean) |

### 1.3 Success Criteria
All four shell/sheet buttons ≥44px with no layout break; menu semantics correct (haspopup="menu" + aria-controls); focus enters first item on open and returns to trigger on any close path; broken avatar degrades to initials; gates green at 794.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Phone user | 44px tap targets in the shell | no mis-taps on the smallest controls | Must Have |
| US-002 | Keyboard/screen-reader user | the account menu to behave like a menu | operable without a pointer | Must Have |
| US-003 | User with a stale Google avatar URL | initials, not a broken-image icon | shell never looks broken | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. `ThemeToggle.tsx:51`, `SessionMenu.tsx:73`, `BottomSheet.tsx:141`, `ScanFoodSheet.tsx:361`: `w-9 h-9` → `w-11 h-11`. SessionMenu's `Image` intrinsic `width/height` 36 → 44 (unoptimized).
2. SessionMenu: `aria-haspopup="menu"`; `id={menuId}` (useId) on the menu div; `aria-controls={menuId}` on the trigger.
3. SessionMenu focus: `triggerRef` + `firstItemRef` (Settings Link); one `useEffect([open])` — open → focus first item; cleanup → refocus trigger. Existing two close effects untouched.
4. SessionMenu avatar: `imgError` state + `onError`; render `user.image && !imgError ? <Image/> : initials`.

### 3.2 Out of Scope
Arrow-key roving focus (DA rules on whether tab-only degrades semantics); other 36px targets outside shell/sheet chrome; signed-out variant.

---

## 4. Technical Design
Three client components + one sheet touched; no schema/route/MCP changes. No new lint disables (focus() and event-handler setState are both clean).

---

## 5. UI/UX
Buttons grow 36→44px inside a 48px header row (4px clearance, was 12px) and intrinsic-height sheet headers. No other visual change.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Escape / outside click / Settings click | Menu closes AND focus returns to avatar trigger |
| Settings navigation | Refocus fires then navigation proceeds (no-op if unmounted) |
| Sign-out submit | Form navigates; teardown refocus no-ops harmlessly |
| Broken avatar URL | onError → initials render, no layout shift (same box) |
| Signed-out header | Sign-in pill unchanged |

---

## 7. Security
None.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] Four buttons at w-11 h-11 (incl. ScanFoodSheet); header/sheet layouts intact
2. [ ] aria-haspopup="menu" + aria-controls/menu id wired
3. [ ] Focus enters Settings on open, returns to trigger on all close paths (single new effect)
4. [ ] Broken avatar → initials (state-driven)
5. [ ] tsc 0 / lint no new / 794 / build OK
6. [ ] Manual keyboard-only pass (browser-dependent — REQUIRED debt if Chrome extension still disconnected)

---

## 9. Open Questions
DA rules: cleanup-refocus semantics on unmount/navigation; mousedown-close + refocus interaction; next/image 36→44 with unoptimized; Link ref forwarding (React 19/Next 16); role="menu" keyboard expectations (tab-only vs arrow keys).

---

## 10. Test Plan
Gates; greps; keyboard pass (tab → Enter → Escape → focus assertions) when browser available; devtools broken-avatar simulation.

---

## 11. Appendix
Premise findings inline. Related: #253 (BottomSheet edits explain the stale line); #235 UXR ledger's 44px tap-target convention.
