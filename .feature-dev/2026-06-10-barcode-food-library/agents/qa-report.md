# QA Report — Barcode Food Library (issue #66)

**QA Agent**: Claude (Sonnet 4.6)
**Date**: 2026-06-10
**HEAD commit**: 100387f (integration commit)
**Baseline**: architecture-blueprint-v2.md + architecture-critique.md

---

## Overall Verdict: MINOR FIXES

One functional bug (BUG-001: camera not stopped on Esc/backdrop close) and one missing defensive guard (FIND-001: BottomSheet show-effect cleanup). Everything else passes code review. tsc and lint are clean. Device camera testing remains gated on hardware access (§8.10).

---

## 1. REQ-001..009 Status

| REQ | Description | Status | Evidence |
|-----|-------------|--------|---------|
| REQ-001 | food-types.ts contract | **PASS** | All 4 types present, MACRO_KEYS correct, no Prisma imports, no "use server" |
| REQ-002 | FoodLibrary model + migration | **PASS** | Schema matches PRD §4.1 exactly; migration SQL is 1 CREATE TABLE + 2 indexes; additive only |
| REQ-003 | OFF normalizer | **PASS** | All rules correct: kcal-not-kJ, sodium×1000, salt×400, null discipline, pipe-strip, rounding. See §3 deep-dive. |
| REQ-004 | Food server actions | **PASS** | lookupBarcode/getQuickPickFoods/recordFoodUse correct; EAN-8 not padded; OFF 404 vs 5xx; independent error paths |
| REQ-005 | Wasm pipeline + BarcodeScanner | **PASS (code review)** | H-1 gen-counter at every await; willReadFrequently; null guard; lazy import; pipeline resilient. Device camera: see §8.10 |
| REQ-006 | ScanFoodSheet | **PARTIAL FAIL** | Phase machine, stepper (MAX_SERVINGS=20), manual strip, a11y all correct — but camera not stopped on Esc/backdrop close from scan phase (BUG-001) |
| REQ-007 | MacroInputs controlled mode | **PASS** | Opt-in values/onChange; isControlled=false path preserves defaultValue for EditNutritionForm |
| REQ-008 | LogNutritionForm integration | **PASS** | Chips row, dynamic ScanFoodSheet mount, handleAdd merge math, chipSource conditional recordFoodUse, useMemo prop-sync, onSuccess reset, failure state preserved |
| REQ-009 | MCP frequentFoods | **PASS** | Independent try/catch; degrades to []; always present in response even if empty |

---

## 2. PRD §8 Acceptance Criteria

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| §8.1 | tsc 0 errors | **PASS** | `npx tsc --noEmit` exits clean |
| §8.2 | lint no new errors | **PASS** | `npm run lint` exits 0 |
| §8.3 | Build + lazy chunks | **UNTESTED** | Requires `npm run build`; merge-log agent verified "scanner code in 3 async chunks only" |
| §8.4 | Migration applied, FoodLibrary in generated client | **PASS** | 20260610135945_add_food_library; SQL verified additive |
| §8.5 | Nutella lookup: sane macros, second call fromLibrary:true | **PASS (live-verified by Stream A agent)** | kcal 539 confirmed; repeat call hits library branch |
| §8.6 | UPC-A zero-pad retry; garbage → not_found | **PASS (code verified)** | `padded13 = barcode.length === 12 ? "0" + barcode : null`; forms set built correctly |
| §8.7 | Chips + merge + Add fills items+macros | **PASS (minus BUG-001)** | Merge math correct; chips render; BUG-001 means camera leak on close |
| §8.8 | Manual meal logging + EditNutritionForm regression | **PASS** | EditNutritionForm untouched; MacroInputs back-compat confirmed (isControlled=false path) |
| §8.9 | frequentFoods in curl | **PASS (live-verified)** | merge-log confirms live curl returns frequentFoods:[] before population |
| §8.10 | Desktop Chrome + iPhone PWA scan | **DEVICE-TEST REQUIRED** | Desktop Chrome native path is code-correct; iOS zxing-wasm path requires hardware |
| §8.11 | No raw Date outside @/lib/calendar; no hex literals in new components | **PASS** | `new Date()` in food-actions.ts is server-side timestamp per PRD §4.5 (explicitly allowed); `new Date().getHours()` in LogNutritionForm.defaultMeal() is client-side browser-local-time, pre-existing. No hex literals in any new component. |
| §8.12 | public/zxing gitignored; postinstall copies wasm | **PASS** | .gitignore line 52; postinstall = `prisma generate && node scripts/copy-zxing-wasm.mjs`; script resilient (graceful no-op if not installed) |

---

## 3. Critique-Resolution Verification

All 12 critique items traced to code. Result table:

| ID | Severity | Issue | Code Status |
|----|----------|-------|-------------|
| H-1 | High | Camera track leak: in-flight getUserMedia resolves after stopCamera | **RESOLVED** — `startGenRef` in BarcodeScanner.tsx:127; `gen = ++startGenRef.current` before await (line 189); guards at getUserMedia (202), after play() (215), after initDecoder (229); `stopTracks()` increments first (line 252) |
| H-2 | High | handleAdd dual versions; unconditional recordFoodUse double-counts | **RESOLVED** — single `handleAdd` in LogNutritionForm.tsx:173; `chipSource` conditional at line 183; `mergeFoodIntoForm` exported as pure helper for testability |
| M-1 | Medium | BadgeWall stacked-dialog claim false; BottomSheet cleanup missing | **PARTIALLY RESOLVED** — stacked-dialog contract documented in blueprint v2 §7.2 and smoke tests in §11.5; BottomSheet cleanup return NOT added (FIND-001 below) |
| M-2 | Medium | EAN-8 zero-padded to 13 digits violates PRD §3.1.3 | **RESOLVED** — food-actions.ts:33: `barcode.length === 12 ? "0" + barcode : null`; EAN-8 stored raw |
| M-3 | Medium | quickPick stale after in-session scan | **RESOLVED (superior approach)** — blueprint prescribed useEffect+setState; implementation uses `useMemo` keyed on `[quickPickFoods, lazyFoods, localAdditions]` (lint-safe, no extra render cycle). Optimistic prepend via `setLocalAdditions` in handleAdd line 191. |
| M-4 | Medium | willReadFrequently missing | **RESOLVED** — BarcodeScanner.tsx:345: `canvas.getContext("2d", { willReadFrequently: true })` inside `if (!ctxRef.current)`; ctxRef cleared in stopTracks() line 257 |
| M-5 | Medium | OFF 429/5xx mapped to not_found | **RESOLVED** — food-actions.ts:101: `res.status === 404 ? { status: "not_found" } : { status: "error", message: ... }` |
| M-6 | Medium | frequentFoods failure kills get_nutrition_history | **RESOLVED** — tools.ts:1490-1524: independent try/catch; byDay returned regardless |
| S-1 | Low | Wasm DX gap in worktrees | **RESOLVED** — copy-zxing-wasm.mjs gracefully no-ops (process.exit(0)) when src absent |
| S-2 | Low | No max on servings stepper | **RESOLVED** — ScanFoodSheet.tsx:37: `MAX_SERVINGS = 20`; increment disabled at line 332 |
| S-3 | Low | canvasRef! non-null assertion unsafe | **RESOLVED** — BarcodeScanner.tsx:333: `const canvas = canvasRef.current; // S-3: null guard` |
| S-4 | Low | Chips loading state on LogLauncher path | **DEFERRED (signed off)** — explicit in blueprint §18 |
| S-5 | Low | Library staleness undocumented | **RESOLVED** — project-gotchas.md §B entry 6 |
| S-6 | Low | BottomSheet double-onClose on Esc | **DEFERRED (pre-existing; all side effects idempotent)** |

---

## 4. Normalizer Correctness (PRD §3.1.4)

| Rule | Implementation | Verdict |
|------|---------------|---------|
| kcal-not-kJ | Priority 1: `energy-kcal_{suffix}`; Priority 2: `energy_{suffix} / 4.184`; no bare `energy` as kcal; no Atwater derivation | PASS |
| sodium ×1000 | `sodiumRaw * 1000` (mg) | PASS |
| salt ×400 | `saltRaw * 400` when sodium missing | PASS |
| null discipline | `safeNum()` returns null for null/non-finite/negative; never 0-fill | PASS |
| pipe-strip | `replace(/\|/g, "-")` on name and brand at normalizer level; DB-wide guarantee | PASS |
| rounding | cal/sodium: `Math.round`; grams: `Math.round(n * 10) / 10` | PASS |
| basis selection | serving when `serving_size` + ≥1 serving macro present; 100g otherwise; `servingSize="100 g"` on 100g path | PASS |
| name fallback | `raw.product_name?.trim().replace(/\|/g, "-") \|\| barcode` | PASS |
| brand: first comma segment | `raw.brands?.split(",")[0]?.trim() ?? null` | PASS |

**Floating-point note**: `30.9g * 1.5` → `46.349999...` → rounds to `46.3g` (not 46.4). This is expected IEEE-754 behavior for 1dp rounding in JavaScript and is nutritionally insignificant (< 0.1g error). Not a bug.

---

## 5. Merge Math — LogNutritionForm/mergeFoodIntoForm

| Rule | Implementation | Verdict |
|------|---------------|---------|
| Rounding | `cal/sodiumMg`: `Math.round`; gram fields: `Math.round(sum * 10) / 10` | PASS |
| Null-skip | `if (foodVal == null) continue;` — null keys do not zero existing entries | PASS |
| Pipe-safety | food.name/brand are DB-guaranteed pipe-free; no sanitization needed at call site | PASS |
| 100g basis qty text | `${Math.round(servings * 100)} g` | PASS |
| Serving qty text | `${servings} serving${servings === 1 ? "" : "s"}` | PASS |
| Optimistic prepend | `setLocalAdditions` dedup by id; cap via useMemo `.slice(0, 8)` | PASS |
| Items line format | `"Name (Brand) \| qty"` — round-trips through parseItemsTextarea correctly | PASS |

---

## 6. Controlled-Form Regression Surface

| Check | Status |
|-------|--------|
| Input `name=` attributes unchanged in MacroInputs | PASS — MACRO_FIELDS uses same key strings |
| onSuccess resets itemsText + macros + mealType | PASS — LogNutritionForm.tsx:207-218 |
| Failure path preserves controlled state | PASS — useFormFeedback only calls onSuccess on success; error branch sets error only |
| EditNutritionForm untouched | PASS — not in changed files; MacroInputs `isControlled=false` when values prop absent |
| formRef.reset() + controlled state reset separation | PASS — onSuccess handles both formRef.reset() (via useFormFeedback) and setState clears |

---

## 7. Lifecycle Leaks Audit

| Close path | Camera stop mechanism | Status |
|------------|----------------------|--------|
| onDetected → lookup phase | `active={phase === "scan"}` → false on lookup → Effect 1 fires `stopTracks()` | PASS |
| "Add to meal" button | Phase was "lookup"→"confirm" before add; active already false | PASS |
| Esc key / backdrop tap from scan phase | `onClose()` → `scanOpen=false` → `open=false` in ScanFoodSheet — but phase stays "scan" → active stays true → **CAMERA NOT STOPPED** | **FAIL (BUG-001)** |
| visibilitychange (app backgrounded) | Effect 2: when active, `document.hidden` → `stopCamera(); setScannerState("starting")` | PASS |
| Component unmount | Effect 1 cleanup: `() => stopCamera()` | PASS |
| chip tap (initialFood provided) | BarcodeScanner not active during confirm phase (active={phase === "scan"}); chip path skips scan phase | PASS |

---

## 8. Security Audit

| Check | Status |
|-------|--------|
| Barcode regex before DB/network | `if (!/^\d{8,14}$/.test(barcode)) return { status: "not_found" }` at food-actions.ts:28 | PASS |
| OFF fetch server-only (no client CORS exposure) | food-actions.ts has `"use server"`; lookupBarcode is a server action; no client-side fetch | PASS |
| Fixed OFF host | Hardcoded `https://world.openfoodfacts.org/api/v2/product/` — no SSRF vector | PASS |
| User-Agent header | `"Goaldmine/1.0 (github.com/jronnomo/goaldmine)"` per OFF policy | PASS |
| Timeout | `AbortSignal.timeout(6000)` | PASS |
| No dangerouslySetInnerHTML | Confirmed absent in all new components | PASS |
| Server-action input validation | Barcode validated before any I/O; logNutrition unchanged | PASS |
| Library rows contain no secrets | FoodLibrary fields are food metadata only | PASS |

---

## 9. Bundle / a11y Checks

**Bundle (code reasoning)**:
- `next/dynamic(() => import("@/components/ScanFoodSheet"), { ssr: false })` in LogNutritionForm.tsx:16-20 creates a lazy chunk boundary.
- `import("zxing-wasm/reader")` inside `initDecoder()` is a second-level dynamic import, never in the base bundle.
- merge-log confirms: "scanner code in 3 async chunks only."

**a11y**:
- BarcodeScanner: `aria-live="polite"` on status text (line 450); `aria-hidden` on video/reticle/canvas; torch button `aria-label` present; all targets ≥ 44px (video is 4:3 container, torch button `w-9 h-9` = 36px — borderline; PRD says ≥44px for interactive targets but torch button is supplemental).
- ScanFoodSheet: scan phase status messages wrapped in `aria-live="polite"` (lines 193, 207); lookup spinner `role="status"` + `aria-label` (lines 276-277); manual input `aria-label="Barcode digits"` (line 236); stepper buttons have `aria-label` (311, 327); servings value `aria-live="polite" aria-atomic="true"` (line 322); Add to meal `min-h-[44px]` (line 387).
- Chips: all chip/scan buttons `min-h-[44px]` per LogNutritionForm.tsx:248, 267, 285.

**Torch button size note**: `w-9 h-9` = 36px, below the 44px target. This is a supplemental control (camera still works without torch), and the PRD calls for ≥44px "targets" generally but the viewfinder context is constrained. Low-severity advisory.

---

## 10. USER_TZ / Date Audit (changed files)

| Location | Usage | Verdict |
|----------|-------|---------|
| food-actions.ts:49,122,132,171 | `new Date()` for server-side `lastUsedAt` timestamps | PASS — PRD §4.5 explicitly allows; no calendar math |
| LogNutritionForm.tsx:36 | `new Date().getHours()` in `defaultMeal()` | PASS — `"use client"` component; runs in browser with user's local TZ; no server-side date math; likely pre-existing |
| All other new components | No Date usage | PASS |

---

## Bugs and Findings

### BUG-001 (MINOR — 1-line fix required before ship)

**Camera not stopped on Esc/backdrop close from scan phase**

- **File**: `src/components/ScanFoodSheet.tsx:186`
- **Current code**: `<BarcodeScanner active={phase === "scan"} onDetected={...} />`
- **Problem**: `ScanFoodSheet.useEffect` at line 107 guards `if (!open) return;` — so when `open` goes false (sheet closed by Esc or backdrop), `phase` is NOT reset. It stays "scan". `active` stays `true`. BarcodeScanner's Effect 1 (`[active]`) does not fire again. Camera tracks keep running. iOS green camera indicator stays on.
- **Fix**: `<BarcodeScanner active={open && phase === "scan"} onDetected={...} />`
- **PRD violation**: §3.1.5 "full cleanup on unmount/close (tracks stopped — iOS green light off)"
- **Severity**: Minor (one-line fix; does not affect data correctness, merge math, or server logic)

### FIND-001 (LOW — advisory)

**BottomSheet show-effect missing cleanup return**

- **File**: `src/components/BottomSheet.tsx:31-39`
- **Issue**: The show-effect (`[open]`) does not return a cleanup function. Blueprint v2 §7.2 explicitly prescribed adding `return () => { if (dialogRef.current?.open) dialogRef.current.close(); }` as a defensive guard.
- **Risk**: Low — focus trap prevents the failure path (LogNutritionForm cannot unmount while ScanFoodSheet is modal-open). But the implementation is fragile per the blueprint's own analysis.
- **Recommendation**: Add the cleanup return. Single-line change to BottomSheet.tsx.

### FIND-002 (TRIVIAL — no action required)

**project-gotchas.md §B numbering error**

- Entries appear in order: §B.1, §B.2, §B.3, §B.4, §B.5 (operating rules), §B.6 (FoodLibrary at line 65), then §B.5 (operating rules) appears again at line 68. The FoodLibrary entry was inserted as "6" but the existing "5" was not renumbered.
- No functional impact. Can be fixed in a follow-up cleanup.

---

## Device-Test-Only Items (non-blocking for code-review approval)

These acceptance items require physical hardware and cannot be verified by static code review:

| Item | What to test |
|------|-------------|
| §8.10 — iPhone PWA zxing-wasm scan | Point camera at real barcode; verify decode + lookup + confirm + merge |
| §8.10 — iOS green camera indicator | Verify clears on Add/Esc/backdrop close (will fail BUG-001 path until fixed) |
| §11.5 — Stacked dialog (Esc) | ScanFoodSheet closes; Log sheet stays open |
| §11.5 — Stacked dialog (backdrop) | Same |
| §11.5 — iOS VoiceOver focus trap | Focus trapped to ScanFoodSheet while open; returns to Scan button on close |
| §11.5 — Form state persistence through revalidatePath | Items textarea + macros survive scan add |
| §11.5 — EAN-8 product scan | DB row has 8-digit barcode, not 13-digit |
| §11.5 — Camera fast open/close 5× | No persistent green indicator |

---

## Fix Priority List

| Priority | ID | Location | Fix |
|----------|----|----------|-----|
| **REQUIRED before ship** | BUG-001 | `ScanFoodSheet.tsx:186` | `active={open && phase === "scan"}` |
| Strongly recommended | FIND-001 | `BottomSheet.tsx:38` | Add `return () => { if (dialogRef.current?.open) dialogRef.current.close(); }` after the close branch |
| Trivial | FIND-002 | `docs/project-gotchas.md:68` | Renumber §B.5 (operating rules) to §B.7 |

---

*QA coverage: static code review + tsc + lint. No automated tests in repo. Device camera verification required post-fix per §8.10 and §11.5 smoke list.*
