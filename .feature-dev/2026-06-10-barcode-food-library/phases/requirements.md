# Requirements — Barcode Food Library (issue #66)

Source of truth: docs/prds/PRD-barcode-food-library.md. Blueprint governs design conflicts.

## REQ-001 — Contract module
**Files**: src/lib/food-types.ts
FoodMacros / LibraryFood / BarcodeLookupResult / AddFoodPayload exactly per PRD §3.1.1. Plain module (no "use server"), importable client+server, no Prisma imports.
**Accept**: tsc clean; keys mirror MACRO_KEYS. **Deps**: none. **S**

## REQ-002 — FoodLibrary model + migration
**Files**: prisma/schema.prisma, prisma/migrations/*_add_food_library
Model per PRD §4.1. `npx prisma migrate dev --name add_food_library` (review SQL: additive only) + generate.
**Accept**: PRD §8.4. **Deps**: none. **S**

## REQ-003 — OFF normalizer (pure)
**Files**: src/lib/openfoodfacts.ts
normalizeOffProduct per PRD §3.1.4 (basis selection, kcal-not-kJ, sodium g→mg, salt fallback, null discipline, rounding).
**Accept**: rules verifiable against fixture objects; no I/O; tsc clean. **Deps**: REQ-001. **M**

## REQ-004 — Food server actions
**Files**: src/lib/food-actions.ts
lookupBarcode / getQuickPickFoods / recordFoodUse per PRD §3.1.3 + §4.3 (validation, multi-form library match, UA header, timeout, zero-pad retry, upsert, revalidatePath, error-shape never-throw).
**Accept**: PRD §8.5–8.6 via manual-entry seam. **Deps**: REQ-001..003. **M**

## REQ-005 — Wasm pipeline + BarcodeScanner
**Files**: package.json (zxing-wasm pinned exact, postinstall), scripts/copy-zxing-wasm.mjs, .gitignore (public/zxing/), src/components/BarcodeScanner.tsx
Per PRD §3.1.5 + §3.1.10. Verify installed dist filenames + prepareZXingModule/readBarcodes API before coding against them; document findings in output.
**Accept**: PRD §8.3 (lazy chunks), §8.12 (fresh npm ci && build); camera lifecycle states; cleanup verified (code review). **Deps**: REQ-001. **L**

## REQ-006 — ScanFoodSheet
**Files**: src/components/ScanFoodSheet.tsx
Phases scan/lookup/confirm per PRD §3.1.6 + UX research resolutions (PRD §9). Manual digit strip always present. Stub lookupBarcode until REQ-004 lands if needed.
**Accept**: states render; stepper math; a11y per §5.4. **Deps**: REQ-001, REQ-005. **M**

## REQ-007 — MacroInputs controlled mode
**Files**: src/components/MacroInputs.tsx
Opt-in values/onChange; uncontrolled path byte-compatible for EditNutritionForm.
**Accept**: EditNutritionForm renders unchanged (regression). **Deps**: REQ-001. **S**

## REQ-008 — LogNutritionForm integration
**Files**: src/components/LogNutritionForm.tsx, src/app/nutrition/page.tsx
Controlled items+macros (names unchanged), onSuccess reset extension, chips row per UX research, dynamic ScanFoodSheet mount, onAdd merge math per PRD §3.1.7, quickPickFoods prop (/nutrition) + lazy fetch (LogLauncher path), recordFoodUse on chip adds.
**Accept**: PRD §8.7–8.8. **Deps**: REQ-001, 006, 007 (sheet can be stubbed). **L**

## REQ-009 — MCP frequentFoods
**Files**: src/lib/mcp/tools.ts
get_nutrition_history response + frequentFoods top-5 per PRD §3.2.1.
**Accept**: PRD §8.9 curl. **Deps**: REQ-002. **S**
