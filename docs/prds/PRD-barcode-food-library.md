# PRD: Barcode Scan → OpenFoodFacts Macros + Personal Food Library

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-10
**Status**: Approved
**GitHub Issue**: https://github.com/jronnomo/goaldmine/issues/66
**Branch**: main
**UX-research**: invoked (background) — findings folded into §9 before development

---

## 1. Overview

### 1.1 Problem Statement

Logging a meal with macros means typing six numbers by hand. Original ask: scan a nutrition label and have macros calculated, keeping macros optional when nothing is scanned. The app makes zero LLM calls ($0 runtime), so OCR/vision is out.

### 1.2 Proposed Solution

Scan the **barcode** with the phone camera inside the meal form. A server action looks the product up in the **personal food library** first, then **OpenFoodFacts** (free API), normalizes per-serving macros (calories/protein/carbs/fat/fiber/sodium), and saves every lookup to the library. The form gains quick-pick chips of recent/frequent foods (staples = one tap, no re-scan). User sets servings (0.5 steps); macros scale and **sum into** the existing six optional macro fields. iOS standalone PWA is the primary platform — native BarcodeDetector is absent there, so a lazy-loaded **zxing-wasm** decoder is the main path, with native detection used where available. A manual barcode-digit entry strip is always present: it is the no-camera fallback, the permission-denied fallback, and the dev/test seam. Scan failure degrades to today's manual flow with zero friction.

### 1.3 Success Criteria

- Scan a real packaged food on iPhone PWA → macros auto-filled, quantity adjustable, logged meal totals correct.
- Same product next time appears in quick-pick chips without scanning; repeat barcode lookups hit the library (instant, no network).
- No-match barcode → graceful manual path. Scanner code is lazy-loaded (separate chunks; base bundle unchanged).

---

## 2. User Stories

| ID | As Gabe... | I want to... | So that... | Priority |
|----|------------|--------------|------------|----------|
| US-001 | | scan a barcode while logging a meal and get macros filled in | macro logging stops being manual data entry | Must Have |
| US-002 | | set how many servings I ate and have macros scale | the numbers reflect what I actually ate | Must Have |
| US-003 | | tap a staple food from quick-pick chips | daily repeat foods are one tap | Must Have |
| US-004 | | type the barcode digits when camera/permission fails | I'm never blocked | Must Have |
| US-005 | | keep logging meals exactly as today with no scan | macros stay optional; manual flow untouched | Must Have |
| US-006 (coach) | | see my staple foods' real per-serving macros | macro estimates for unscanned meals improve | Should Have |

---

## 3. Functional Requirements

### 3.1 Core

1. **Contract module** `src/lib/food-types.ts`: `FoodMacros` (6 keys = MACRO_KEYS), `LibraryFood {id, barcode, name, brand, servingSize, basis: "serving"|"100g", perServing}`, `BarcodeLookupResult` (found/not_found/error union), `AddFoodPayload {food, servings}`.
2. **FoodLibrary model** (§4.1) + additive migration `add_food_library`.
3. **Server actions** `src/lib/food-actions.ts` ("use server"):
   - `lookupBarcode(raw)`: validate `^\d{8,14}$`; library check across barcode forms (raw, zero-padded-13, zero-stripped — UPC-A↔EAN-13); hit → bump usageCount/lastUsedAt, return `fromLibrary: true`. Miss → fetch OFF v2 product endpoint (fields-limited; `User-Agent: Goaldmine/1.0 (github.com/jronnomo/goaldmine)`; `AbortSignal.timeout(6000)`; 12-digit miss → retry once with leading 0) → normalize → upsert → `revalidatePath("/nutrition")` → return. Network failure → `{status:"error"}`; never throws to the client.
   - `getQuickPickFoods(limit=8)`: top by usageCount desc, lastUsedAt desc.
   - `recordFoodUse(id)`: usage bump for chip-sourced adds + revalidate /nutrition.
4. **OFF normalizer** `src/lib/openfoodfacts.ts` (pure, no I/O): serving-basis preferred (`*_serving` keys), per-100g fallback (`basis:"100g"`, servingSize "100 g"); kcal from `energy-kcal_*` only (kJ `energy_*` ÷ 4.184 fallback; never bare `energy` as kcal); sodium: OFF grams × 1000 → mg (missing → `salt_* × 400`); grams 1 decimal, cal/sodium integer; missing/non-finite/negative → null — **never fabricate, never 0-fill, never derive calories from macros**. Name empty → barcode as name. Brand = first comma segment.
5. **BarcodeScanner** component (client): getUserMedia environment camera, `<video playsInline muted autoPlay>`; states starting/scanning/denied/no-camera/error (none block manual entry); decode every ~200ms skipping in-flight; accept after two consecutive identical reads; `navigator.vibrate?.(50)`; torch toggle when `track.getCapabilities().torch`; full cleanup on unmount/close (tracks stopped — iOS green light off); `visibilitychange` stop/restart. Decoder: native `BarcodeDetector` when present AND supports ean_13; else lazy `import("zxing-wasm/reader")`, `prepareZXingModule({overrides:{locateFile → /zxing/...}, fireImmediately:true})`, `readBarcodes(imageData, {formats:["EAN-13","UPC-A","UPC-E","EAN-8"], tryHarder:true, maxNumberOfSymbols:1})` on a ≤720px canvas frame.
6. **ScanFoodSheet** (client, nested BottomSheet; `next/dynamic ssr:false`): phases scan → lookup → confirm. Props `{open, onClose, onAdd(AddFoodPayload), initialFood?}` (initialFood = chip tap → straight to confirm). Manual digit strip always visible in scan phase (`inputMode="numeric"`). not_found: "Not in OpenFoodFacts — log it manually" + scan-again. confirm: food card (nulls render "—"), servings stepper (−/value/+, 0.5 steps, min 0.5, default 1; label "servings" vs "× 100 g" by basis), live scaled preview, "Add to meal".
7. **Form integration** (`LogNutritionForm`): quick-pick chips row (≤8, horizontal scroll, name + small brand, trailing Scan button; empty library → Scan button only) between mealType and items; items textarea + macros become controlled (input `name=`s unchanged → `logNutrition` server action untouched; `useFormFeedback` onSuccess extended to clear controlled state since formRef.reset() won't). `onAdd` merge: append `Name (Brand) | N serving(s)` (or `| ${servings*100} g` for 100g basis) line to items; for each non-null macro key add `servings × value` into the field (cal/sodium int, grams 1dp); null keys untouched. Chip adds call `recordFoodUse` fire-and-forget.
8. **MacroInputs**: opt-in controlled mode (`values?/onChange?`); uncontrolled path preserved (EditNutritionForm untouched by design — correcting ≠ composing).
9. **Quick-pick data**: /nutrition page fetches and passes `quickPickFoods` (server component); LogLauncher embed lazy-fetches via `getQuickPickFoods()` on mount (mount = accordion open; no root-layout DB threading).
10. **Wasm asset pipeline**: `zxing-wasm` pinned exact; `scripts/copy-zxing-wasm.mjs` copies `dist/reader/*.wasm` → `public/zxing/` in postinstall; `public/zxing/` gitignored. Verify dist filenames/API after install. Fallback if surprises: commit the binary.

### 3.2 Secondary

1. `get_nutrition_history` MCP response gains `frequentFoods` (top 5: name, brand, servingSize, perServing) — improves coach estimates for unscanned meals. No new tools.

### 3.3 Out of Scope

OCR/label-photo parsing; in-app LLM; barcode GENERATION; food search by name against OFF (library-only quick-pick for v1); EditNutritionForm scan integration; per-item macro storage (macros remain per-log totals); offline OFF mirror.

---

## 4. Technical Design

### 4.1 Data Model

```prisma
model FoodLibrary {
  id          String    @id @default(cuid())
  barcode     String?   @unique
  name        String
  brand       String?
  servingSize String?
  basis       String    @default("serving") // "serving" | "100g"
  calories    Float?
  proteinG    Float?
  carbsG      Float?
  fatG        Float?
  fiberG      Float?
  sodiumMg    Float?
  source      String    @default("openfoodfacts")
  usageCount  Int       @default(0)
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([usageCount(sort: Desc), lastUsedAt(sort: Desc)])
}
```
Migration `add_food_library`: one CREATE TABLE + unique + index. Additive; review SQL before apply (Neon shared with prod). No backfill.

### 4.2 MCP Tool Surface

No new tools. `get_nutrition_history` adds `frequentFoods: [{name, brand, servingSize, basis, perServing}]` (top 5). Curl: existing get_nutrition_history call → assert field present.

### 4.3 Server Actions

| Action | Input | Mutation | revalidatePath |
|--------|-------|----------|----------------|
| lookupBarcode | barcode string | FoodLibrary upsert / usage bump | /nutrition (on new upsert) |
| getQuickPickFoods | limit | none (read) | — |
| recordFoodUse | id | usage bump | /nutrition |
| logNutrition | (existing, unchanged) | NutritionLog create | /, /nutrition (existing) |

### 4.4 Pages / Components

New (all under src/components unless noted): `BarcodeScanner` (client), `ScanFoodSheet` (client, dynamic ssr:false), `src/lib/food-types.ts`, `src/lib/food-actions.ts`, `src/lib/openfoodfacts.ts`, `scripts/copy-zxing-wasm.mjs`. Modified: `LogNutritionForm` (client already), `MacroInputs`, `src/app/nutrition/page.tsx`, `src/lib/mcp/tools.ts`, `package.json`, `.gitignore`, `prisma/schema.prisma`. Unmodified by design: `EditNutritionForm`, `workout-actions.ts`, `BottomSheet`, root layout/BottomNav.

### 4.5 Date / Time Semantics

`lastUsedAt = new Date()` server-side timestamps only (no day bucketing) — no calendar math added. logNutrition date handling unchanged.

### 4.6 Override-Awareness

Orthogonal — no per-day plan reads.

### 4.7 Third-Party Dependencies

`zxing-wasm` (pinned exact version, verified at install): wasm barcode decoder, lazy-loaded, binary served from public/. Justification: iOS Safari lacks BarcodeDetector; zxing-wasm is the maintained wasm port of ZXing with a reader-only subpath. OpenFoodFacts API (no SDK — plain fetch, server-side only, UA header per their policy).

---

## 5. UI/UX Specifications

> Final visual treatment from UX research (§9). Structural spec below; 390px; tokens only; ≥44px targets.

### 5.1 Screens

**Meal form (both hosts)**: chips row `[🧀 Oikos · Danone] [🥜 PB · Jif] … [▣ Scan]` horizontal scroll; rest of form unchanged. **ScanFoodSheet**: scan phase = viewfinder (video + center guide) + manual digit strip; confirm phase = food card + stepper + scaled macro preview + Add to meal. States: starting (spinner), denied/no-camera (message + manual strip), lookup spinner, not_found/error (message + retry/scan-again).

### 5.2 Navigation

Log sheet → meal row → chips/Scan → nested sheet → add → back in form with fields filled. Same from /nutrition. No BottomNav changes.

### 5.3 Responsive / 5.4 Accessibility

Chips ≥44px tall; stepper buttons ≥44px; viewfinder labelled; states announced (`aria-live` on phase messages); manual input labelled; camera video `aria-hidden` decorative with text status alternative; reduced-motion: no new animations beyond BottomSheet's existing ones.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected |
|----------|----------|
| Camera permission denied / no camera / insecure context | denied/no-camera state; manual digit strip fully functional |
| Barcode not in OFF | not_found message; manual macro entry; nothing written |
| OFF timeout/network failure | error state with retry; form untouched |
| OFF product with kJ-only energy / sodium in g / salt only / no serving data | normalizer rules §3.1.4; per-100g basis; nulls preserved |
| 12-digit UPC-A vs 13-digit EAN | multi-form library match + zero-pad OFF retry |
| Scan while offline | lookup error state; manual flow |
| Mixed scanned + manual items | macros sum what's known; null keys untouched |
| Repeat scan same product | library hit, fromLibrary:true, no network |
| App backgrounded mid-scan (iOS) | tracks stopped; restarted on visible |
| Library empty | chips row absent; Scan button only |
| invalid manual digits | inline validation, no action call |

---

## 7. Security Considerations

OFF fetch is server-side only (UA header, timeout, no client CORS exposure); barcode regex-validated before any query; no new public routes; library rows contain no secrets; rendered names/brands are plain text (no dangerouslySetInnerHTML); wasm served same-origin from public/.

---

## 8. Acceptance Criteria

1. [ ] tsc 0 errors · 2. [ ] lint no new errors · 3. [ ] build succeeds AND scanner/zxing glue appear as separate lazy chunks (not in base bundle)
4. [ ] Migration add_food_library applied; FoodLibrary in generated client
5. [ ] `lookupBarcode("3017624010701")` → found, sane Nutella macros (kcal not kJ; sodium in mg); second call → fromLibrary:true
6. [ ] `lookupBarcode("049000028911")` resolves via zero-pad retry; garbage code → not_found
7. [ ] Meal form (Log sheet + /nutrition): chips render when library non-empty; Scan opens sheet; manual digit entry → confirm → Add fills items line + sums macros per §3.1.7 rounding
8. [ ] Plain manual meal logging + EditNutritionForm regression clean (controlled refactor didn't break reset/feedback)
9. [ ] get_nutrition_history curl includes frequentFoods
10. [ ] Desktop Chrome camera scan works (native path); iPhone PWA scan verified post-deploy by user (manual path makes this non-blocking)
11. [ ] grep changed files: no raw Date methods outside @/lib/calendar; no hex literals in new components
12. [ ] public/zxing gitignored; postinstall copies wasm; fresh `npm ci && npm run build` works (Vercel parity)

---

## 9. Open Questions — RESOLVED (UX research: docs/ux-research/barcode-food-library.md; ledger: barcode-food-library-ledger.md; pixel artifact: barcode-food-library.html)

Direction: **"Quiet capture, loud nothing."** ⚠ values = provisional, implement at start value, user verifies at 390px both themes.

1. **Chips row**: pinned LEADING Scan affordance (the only accent in the row) + quiet recent-food chips scrolling horizontally behind a right-edge token fade⚠. Chip = name + small muted brand, max-width/truncation budget⚠, NO emoji (signed off: PRD §5.1 sketch superseded — hand-rolled-SVG-only/no-cartoon profile rule; ledger row 03). Hand-rolled 20px stroke-1.5 barcode icon for Scan.
2. **Viewfinder**: framed viewfinder card (~4:3⚠, center reticle⚠) inside the nested BottomSheet, reusing the existing 240ms sheet slide — no new motion (optional laser line / dark video chrome default OFF⚠). Manual digit strip is a CO-EQUAL peer below the viewfinder, always visible. Status text in card; torch button in card corner when capable.
3. **Confirm phase**: food card + stepper (≥44px, value tint⚠) + scaled macro preview laid out MIRRORING MacroInputs' 3-column grid so the preview visibly maps to the fields it will fill; calorie emphasis weight⚠; scan→confirm transition instant vs 120ms fade⚠.
4. **Empty library**: chips row collapses to a single labelled "Scan a barcode" button (same accent treatment).
5. A11y⚠: verify gold-on-accent-soft (light theme tight), 11px muted brand text, reticle-over-video contrast. Bullseye-pop deliberately NOT used here (reserved for day-complete moments).

---

## 10. Test Plan

§8 ordering: gates → server-level lookups via manual entry seam (Nutella/Coke/garbage/repeat) → browser walkthrough at 390px both themes (chips, sheet phases, merge math, regression on manual meal + edit) → desktop Chrome camera → MCP curl → fresh-install build check. Post-deploy: user scans 2–3 real products on iPhone PWA (acceptance §8.10), backgrounds mid-scan, denies permission once, airplane-modes a lookup.

---

## 11. Appendix

Discovery: issue #66 (interview-refined 2026-06-10); plan ~/.claude/plans/sparkling-greeting-gem.md. Key reuse: parseItemsTextarea + parseMacros + logNutrition (workout-actions.ts:167/185/202, untouched), MACRO_KEYS (nutrition-plan.ts:34), BottomSheet, useFormFeedback pattern. Critical prior-art absence: first external API call, first dynamic import, first camera use, first wasm in repo.
