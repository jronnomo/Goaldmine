# Research Output — Barcode Food Library Feature
**Agent**: Research Agent  
**Date**: 2026-06-10  
**Scope**: PRD §3.1 + requirements.md investigation before dev

---

## 1. Form & Feedback Mechanics

### useFormFeedback (src/lib/use-form-feedback.ts)

Exact API returned by `useFormFeedback()`:
```ts
{ pending: boolean; error: string | null; saved: string | null; formRef: React.RefObject<HTMLFormElement | null>; submit }
```

`submit(action, opts?)` internal sequence:
1. `setError(null)`
2. `fd = new FormData(formRef.current!)` — snapshots current form state
3. `await action(fd)`
4. **`formRef.current?.reset()`** — clears all uncontrolled inputs (line 62)
5. **`opts?.onSuccess?.()`** — called AFTER reset (line 63). This is where controlled state reset must go.
6. `setSaved(msg)` → clears after 1500 ms

**Critical for controlled-state extension**: `formRef.reset()` clears native form elements but does NOT clear React controlled state. The `onSuccess` callback is the correct hook for resetting controlled items + macro states. It fires after `reset()`, so reset → controlled-state-clear → save message is the order.

Current `LogNutritionForm` `onSuccess`: `() => setMealType(defaultMeal())`

After the refactor it becomes something like:
```ts
onSuccess: () => {
  setMealType(defaultMeal());
  setItemsText("");
  setMacros({ calories: null, proteinG: null, carbsG: null, fatG: null, fiberG: null, sodiumMg: null });
}
```

### LogNutritionForm current structure (src/components/LogNutritionForm.tsx)

- `"use client"` — already a client component
- Controlled state: only `mealType` via `useState<MealType>(defaultMeal())`
- Inputs in DOM order:
  1. `<select name="mealType" value={mealType}>` — controlled
  2. `<textarea name="items" required>` — **uncontrolled** today; must become controlled
  3. `<input type="text" name="notes">` — uncontrolled; PRD leaves this uncontrolled (reset clears it)
  4. `<MacroInputs />` — uncontrolled today; must gain opt-in controlled mode
- `logNutrition` server action called via `submit(logNutrition, { successMsg: "✓ Meal logged", onSuccess: ... })`
- No props today; will gain `quickPickFoods?: LibraryFood[]`

### LogLauncher accordion mounting (src/components/LogLauncher.tsx)

- `expanded` state starts `null`; clicking "Meal" row sets `expanded = "meal"`
- `{key === "meal" && <LogNutritionForm />}` — **mount-on-open** confirmed (line 114)
- No props are passed from LogLauncher to LogNutritionForm today
- The quick-pick lazy fetch is triggered on mount (= accordion open), which matches PRD §3.1.9

---

## 2. Items Parsing Round-Trip Analysis

### parseItemsTextarea (src/lib/workout-actions.ts, lines 167-181)

```ts
function parseItemsTextarea(raw: string): NutritionItem[] {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [namePart, qtyPart, notesPart] = trimmed.split("|").map((p) => p.trim());
    if (!namePart) continue;
    out.push({ name: namePart, ...(qtyPart ? { qty: qtyPart } : {}), ...(notesPart ? { notes: notesPart } : {}) });
  }
}
```

Split semantics: one `|` splits name from qty; two `|`s split name / qty / notes. Each segment is trimmed.

### onAdd merge — EXACT safe line format

```
Oikos Greek Yogurt (Danone) | 1.5 servings
Peanut Butter (Jif) | 200 g
```

`namePart` = everything before the first `|` (trimmed). Parentheses in the name are safe — they are NOT special characters in this parser.

The qty string (e.g. `"1 serving"`, `"1.5 servings"`, `"200 g"`) is stored verbatim; the parser does not try to parse numbers from it, so any format is safe.

**HAZARD — pipe in name/brand**: If OpenFoodFacts name or brand contains a `|` character (rare but possible), the parser will treat it as a separator and split the name mid-word. **Mitigation**: In `onAdd`, replace any `|` in name and brand with a dash (`-`) or strip it before assembling the line. This is a one-liner sanitization step the dev agent must not forget.

### Exact line to append for each basis

```ts
// serving basis:
const line = `${name.replace(/\|/g, "-")} (${brand.replace(/\|/g, "-")}) | ${servings} serving${servings === 1 ? "" : "s"}`;

// 100g basis:
const line = `${name.replace(/\|/g, "-")} (${brand.replace(/\|/g, "-")}) | ${(servings * 100).toFixed(0)} g`;
```

Append with a newline separator: `prevItems + (prevItems.trim() ? "\n" : "") + line`.

### parseMacros (lines 185-200)

Reads each of the 6 named form fields. Empty → null; non-numeric or negative → null. This means the macro fields' `name` attributes must remain identical: `"calories"`, `"proteinG"`, `"carbsG"`, `"fatG"`, `"fiberG"`, `"sodiumMg"`. No name changes allowed.

Rounding to apply before writing to controlled state (matching PRD §3.1.3 normalizer rules):
- calories, sodiumMg → `Math.round(val)` (integer)
- proteinG, carbsG, fatG, fiberG → `Math.round(val * 10) / 10` (1 decimal)
- null inputs from food: pass through as null (do not 0-fill)

`logNutrition` / `updateNutrition` signatures are unchanged — both accept `FormData` and read `parseMacros(form)`.

---

## 3. Sheet Stacking Precedent

### BottomSheet implementation (src/components/BottomSheet.tsx)

- Uses native `<dialog>` with `showModal()` — this places the dialog in the browser's **top layer**, above all normal stacking contexts including `z-40` BottomNav.
- Body overflow lock: captures `prev` before setting `overflow = "hidden"`, restores in cleanup. Two nested sheets opening/closing in sequence are safe: inner restores outer's state (both "hidden"), outer restores original.
- Esc key: `onCancel` prevents default and routes through React state.
- Backdrop click: `onClick` checks `e.target === e.currentTarget`.

### BadgeWall nested sheet pattern (src/components/game/BadgeWall.tsx)

BadgeWall renders `<BottomSheet>` inside its own component tree (lines 262-270). When BadgeWall is embedded in a page that itself opens a BottomSheet, this creates a logical "nested" sheet: two `<dialog>` elements opened with `showModal()`. The browser stacks top-layer elements in the order `showModal()` is called — the later call is visually on top. This is confirmed working in the existing codebase.

### ScanFoodSheet stacking plan

ScanFoodSheet will be rendered inside LogNutritionForm → LogLauncher accordion → BottomSheet "Log". When the user taps Scan:
1. Log sheet already has `showModal()` (is in top layer)
2. `ScanFoodSheet` calls `showModal()` → stacks above Log sheet

This is identical to the BadgeWall pattern. No z-index fighting, no workarounds needed. Both `<dialog>` elements are in the top layer; the Log sheet's backdrop does NOT block the scan sheet.

**Caveat**: the body-overflow cleanup interplay is safe because inner cleanup restores to "hidden" (what outer set), then outer cleanup restores original on close.

---

## 4. zxing-wasm Ground Truth

### Version

```
3.1.0
```

Pin this exact version in package.json:
```json
"zxing-wasm": "3.1.0"
```
(exact, no caret or tilde — PRD requirement)

### dist/reader/ contents

```
dist/reader/zxing_reader.wasm    1,089,670 bytes (~1.04 MiB)
```

Single file. No JS file in this directory — the JS is at `dist/es/reader/index.js`. The copy script targets only the `.wasm` file.

### Subpath exports map (reader)

```
"./reader" → { "import": "./dist/es/reader/index.js", "require": "./dist/cjs/reader/index.js" }
```

Dynamic import: `import("zxing-wasm/reader")` resolves to `dist/es/reader/index.js` in ESM builds (Next.js/Turbopack).

### Exported names from zxing-wasm/reader

Confirmed from `dist/es/reader/index.js` export line and `dist/es/reader/index.d.ts`:

```ts
// Primary API
export function prepareZXingModule(options?: PrepareZXingModuleOptions): void | Promise<ZXingReaderModule>;
export function readBarcodes(input: Blob | ArrayBuffer | Uint8Array | ImageData, readerOptions?: ReaderOptions): Promise<ReadResult[]>;
export function purgeZXingModule(): void;

// Deprecated but present (keep for awareness):
export function getZXingModule(overrides?: ZXingModuleOverrides): Promise<ZXingReaderModule>;    // @deprecated
export function setZXingModuleOverrides(overrides: ZXingModuleOverrides): void;                   // @deprecated
export function readBarcodesFromImageData(imageData: ImageData, readerOptions?: ReaderOptions): Promise<ReadResult[]>;  // @deprecated
export function readBarcodesFromImageFile(imageFile: Blob, readerOptions?: ReaderOptions): Promise<ReadResult[]>;       // @deprecated
```

### prepareZXingModule — exact signature

```ts
interface PrepareZXingModuleOptions {
  overrides?: Partial<EmscriptenModule>;  // ZXingModuleOverrides — includes locateFile
  equalityFn?: (cached: ZXingModuleOverrides, overrides: ZXingModuleOverrides) => boolean;
  fireImmediately?: boolean;              // true → returns Promise<ZXingReaderModule>; false/omit → void
}

// When fireImmediately:true, returns Promise
prepareZXingModule({ overrides: { locateFile }, fireImmediately: true }): Promise<ZXingReaderModule>
// When fireImmediately:false or omitted, returns void (deferred init)
prepareZXingModule({ overrides: { locateFile } }): void
```

**locateFile override** — correct pattern for serving from public/:
```ts
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => {
      if (path.endsWith(".wasm")) return `/zxing/${path}`;   // → /zxing/zxing_reader.wasm
      return prefix + path;
    },
  },
  fireImmediately: true,  // eagerly warm the wasm; returns Promise
});
```

The `path` argument will be `"zxing_reader.wasm"` (confirmed from source: `function se() { return d("zxing_reader.wasm"); }`). So the resolved URL is `/zxing/zxing_reader.wasm`. Copy target must be `public/zxing/zxing_reader.wasm`.

### readBarcodes — exact signature

```ts
readBarcodes(
  input: Blob | ArrayBuffer | Uint8Array | ImageData,
  readerOptions?: ReaderOptions
): Promise<ReadResult[]>
```

`ReaderOptions` (relevant fields):
```ts
interface ReaderOptions {
  formats?: ReadInputBarcodeFormat[];   // see below
  tryHarder?: boolean;                  // default true
  tryRotate?: boolean;                  // default true
  tryInvert?: boolean;                  // default true
  tryDownscale?: boolean;               // default true
  maxNumberOfSymbols?: number;          // default 255; use 1 for single-barcode scan
  isPure?: boolean;                     // default false
  binarizer?: Binarizer;                // "LocalAverage" | "GlobalHistogram" | "FixedThreshold" | "BoolCast"
  // ... others
}
```

### Format strings — BOTH forms accepted

`ReadInputBarcodeFormat` accepts EITHER canonical PascalCase names OR HRI label strings (with hyphens/spaces). From README: "separators `-`, `_`, `/` and space are optional and matching is case-insensitive".

| Canonical name | HRI label (also valid as input) |
|---|---|
| `"EAN13"` | `"EAN-13"` |
| `"UPCA"` | `"UPC-A"` |
| `"UPCE"` | `"UPC-E"` |
| `"EAN8"` | `"EAN-8"` |

**PRD's `formats:["EAN-13","UPC-A","UPC-E","EAN-8"]` is VALID.** The TypeScript type accepts these HRI strings. No change needed. Canonical names (`"EAN13"`, `"UPCA"`, etc.) also work.

For BarcodeDetector native path, the format names differ — native API uses underscore format: `"ean_13"` (not `"EAN13"` or `"EAN-13"`). The PRD's `supports ean_13` check for the native path is correct browser API usage.

### ReadResult shape (relevant fields)

```ts
interface ReadResult {
  isValid: boolean;         // true when decode succeeded
  text: string;             // decoded barcode string (e.g. "3017624010701")
  format: ReadOutputBarcodeFormat;  // canonical name returned: "EAN13", "UPCA", "UPCE", "EAN8", "None"
  symbology: BarcodeSymbology;
  error: string;            // "" on success
  bytes: Uint8Array;
  // ... position, orientation, etc.
}
```

Use `result.isValid && result.text` to get the barcode digits.

### iOS/Safari notes

README has no explicit iOS/Safari section. The library is pure WebAssembly + async fetch — WebAssembly is supported in iOS Safari 16.4+. The secure context requirement is for camera access (`getUserMedia`), not wasm loading itself. Camera requires `https://` or `localhost` — see §6 dev-https below.

### copy-zxing-wasm.mjs script target

```js
// scripts/copy-zxing-wasm.mjs
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const dest = resolve(__dirname, "../public/zxing/zxing_reader.wasm");
mkdirSync(resolve(__dirname, "../public/zxing"), { recursive: true });
copyFileSync(src, dest);
console.log("zxing_reader.wasm copied to public/zxing/");
```

---

## 5. Next-Turbopack Facts

### next/dynamic ssr:false in client component

Supported. This is the canonical pattern for lazy-loading browser-only components in Next.js App Router. In a `"use client"` component, `next/dynamic` with `ssr:false` creates a separate lazy chunk and prevents server-side rendering of the component. This is confirmed working in Next.js 16.2.4.

```tsx
// In LogNutritionForm (client component)
const ScanFoodSheet = dynamic(() => import("@/components/ScanFoodSheet"), { ssr: false });
```

### public/ asset serving

Files in `public/` are served at root path by Next.js dev server and on Vercel. `public/zxing/zxing_reader.wasm` → `/zxing/zxing_reader.wasm`. Turbopack does not process or bundle files in `public/` — they are served as-is. The `locateFile` returning `/zxing/zxing_reader.wasm` will fetch from this path correctly.

### dev --experimental-https

Confirmed in `node_modules/next/dist/cli/next-dev.js` line 335:
```js
if (!!options.experimentalHttps) { ... }
```

Flag: `next dev --experimental-https`. This generates a local self-signed certificate and serves over HTTPS, enabling `getUserMedia` (camera) in local development without a real cert. The flag IS available in the installed Next.js 16.2.4.

Usage:
```bash
next dev --experimental-https
# or in package.json:
"dev:https": "next dev --experimental-https"
```

Browser will show a cert warning — click through or add to trusted certs. This is the dev camera testing path the PRD references.

---

## 6. Scripts & Postinstall Current State

Current `package.json` scripts block (verbatim):
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "icons": "tsx scripts/render-icons.ts",
  "postinstall": "prisma generate"
}
```

**Current postinstall**: `prisma generate` only. No existing wasm copy step.

**New postinstall** after this feature:
```json
"postinstall": "prisma generate && node scripts/copy-zxing-wasm.mjs"
```

Order matters: `prisma generate` should stay first (Vercel runs postinstall on deploy; the client must be generated before the build). The wasm copy comes second.

**Vercel parity**: Vercel runs `npm ci` (which triggers postinstall) before `npm run build`. The `copy-zxing-wasm.mjs` script runs in postinstall, placing the wasm in `public/zxing/` before the Next.js build starts. Since `public/` files are served statically, this is correct.

---

## 7. MCP Handler Shape

### get_nutrition_history current response (tools.ts lines 1394-1472)

```json
{
  "since": "<ISO datetime>",
  "days": 14,
  "mealType": null,
  "entryCount": N,
  "byDay": [
    {
      "dateKey": "yyyy-mm-dd",
      "totals": {
        "calories": 2100,
        "proteinG": 155,
        "carbsG": 210,
        "fatG": 70,
        "fiberG": 28,
        "sodiumMg": 2400
      },
      "meals": [
        {
          "mealType": "breakfast",
          "items": [{"name": "Eggs", "qty": "4"}],
          "notes": null,
          "calories": 280,
          "proteinG": 28,
          "carbsG": 2,
          "fatG": 18,
          "fiberG": 0,
          "sodiumMg": 280
        }
      ]
    }
  ]
}
```

Keys: `since`, `days`, `mealType`, `entryCount`, `byDay`. Totals only include keys where at least one meal has a numeric value.

### frequentFoods addition (REQ-009)

Add to the returned object as a top-level key alongside `byDay`:
```json
{
  "since": "...",
  "days": 14,
  "mealType": null,
  "entryCount": N,
  "frequentFoods": [
    {
      "name": "Oikos Greek Yogurt",
      "brand": "Danone",
      "servingSize": "150 g",
      "basis": "serving",
      "perServing": { "calories": 150, "proteinG": 17, "carbsG": 11, "fatG": 3, "fiberG": 0, "sodiumMg": 65 }
    }
  ],
  "byDay": [...]
}
```

Query pattern:
```ts
const frequentFoods = await prisma.foodLibrary.findMany({
  orderBy: [{ usageCount: "desc" }, { lastUsedAt: "desc" }],
  take: 5,
  select: { name: true, brand: true, servingSize: true, basis: true,
            calories: true, proteinG: true, carbsG: true, fatG: true, fiberG: true, sodiumMg: true },
});
```

Map to `perServing` shape (nulls preserved as null). Wrap in `safe()` — already done by the outer handler.

### jsonResult pattern

```ts
function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
```

All handlers return `safe(() => ...)` which wraps in `jsonResult` on success.

---

## 8. Conventions Checklist

| Convention | Notes |
|---|---|
| Prisma client import | `import { prisma } from "@/lib/db"` in server modules. Types: `import { Prisma } from "@/generated/prisma/client"` |
| `"use server"` modules | `food-actions.ts` gets `"use server"` at top, no default export, named exports only — mirrors `workout-actions.ts` and `goal-actions.ts` |
| DB access pattern | Direct `prisma.modelName.operation()` — no abstraction layer needed for simple CRUD |
| revalidatePath | Call after every write mutation. `lookupBarcode` (on new upsert) + `recordFoodUse` → `revalidatePath("/nutrition")`. logNutrition already does this. |
| Calendar/TZ | `food-actions.ts` sets `lastUsedAt = new Date()` server-side. No calendar math needed. No `USER_TZ` concern (lastUsedAt is a timestamp, not a date-only field). |
| Error handling | Server actions: throw `new Error("message")` for validation errors (caught by `useFormFeedback`). `lookupBarcode` catches network errors and returns `{status:"error"}` (never throws to client). |
| No hex literals | No hardcoded color values in new components — use CSS vars only. |
| No raw Date in components | Any date display uses `@/lib/calendar` helpers. `lastUsedAt` in chips is not displayed as a date, so no concern there. |
| `safe()` wrapper | All MCP tool handlers use `safe(() => ...)`. Add `frequentFoods` query inside the existing `safe()` call in `get_nutrition_history`. |
| MacroInputs controlled mode | Add `values?: MacroDefaults; onChange?: (key: MacroKey, val: number | null) => void` props. When `values` is provided, render `value={values[f.name] ?? ""}` and omit `defaultValue`. When not provided, render `defaultValue={defaults?.[f.name] ?? undefined}` as before. EditNutritionForm passes only `defaults` — zero change. |
| `next/dynamic ssr:false` | Import pattern: `const ScanFoodSheet = dynamic(() => import("@/components/ScanFoodSheet"), { ssr: false })`. Place at module level in LogNutritionForm. ScanFoodSheet itself uses `import("zxing-wasm/reader")` lazily (inside BarcodeScanner component function, not at module top level). |
| Prisma FoodLibrary model | Follows PRD §4.1 exactly. `@id @default(cuid())`, `barcode String? @unique`, composite index `@@index([usageCount(sort:Desc), lastUsedAt(sort:Desc)])`. Review migration SQL before applying — shared Neon DB. |
| .gitignore | Add `public/zxing/` line to prevent committing the wasm binary. |

---

## 9. PRD Assumption Verification — What Turned Out Wrong / Surprising

| PRD assumption | Verdict | Notes |
|---|---|---|
| Format strings `"EAN-13","UPC-A","UPC-E","EAN-8"` | **CORRECT** | v3.1.0 accepts HRI labels as input — these are valid `ReadInputBarcodeFormat` values. Canonical names (`"EAN13"`, `"UPCA"`, etc.) also work. |
| `prepareZXingModule({overrides:{locateFile...}, fireImmediately:true})` | **CORRECT** | Exact match to v3 `PrepareZXingModuleOptions` shape. `locateFile` is a field of `Partial<EmscriptenModule>`. |
| `readBarcodes(imageData, {formats, tryHarder, maxNumberOfSymbols})` | **CORRECT** | All three options are in `ReaderOptions`. No API mismatch. |
| wasm filename `dist/reader/*.wasm` | **CORRECT (one file)** | Only `zxing_reader.wasm` exists in `dist/reader/`. No JS files there; the bundle JS lives in `dist/es/reader/index.js`. |
| wasm reader size ~1.04 MiB | **CONFIRMED** | 1,089,670 bytes |
| Pipe `|` in items line is safe for name with parentheses | **MOSTLY SAFE — one hazard** | Parentheses are safe. A literal `|` in the food name/brand would break parsing. Must sanitize `|` → `-` in name/brand before building the items line. |
| `onSuccess` resets controlled state | **CORRECT** | `formRef.reset()` fires first, then `onSuccess`. Controlled state reset in `onSuccess` is the right pattern. |
| `postinstall` currently runs `prisma generate` | **CONFIRMED** | Exact text: `"postinstall": "prisma generate"`. The zxing copy must be appended. |
| `next dev --experimental-https` available | **CONFIRMED** | Found at line 335 of `next-dev.js`: `if (!!options.experimentalHttps)`. |
| MacroInputs only has `defaults?` prop today | **CONFIRMED** | Uncontrolled (`defaultValue`). Two consumers: `LogNutritionForm` (no prop) and `EditNutritionForm` (passes `defaults`). Opt-in `values?/onChange?` is non-breaking for both. |
| `getZXingModule` is the init function | **WRONG (deprecated)** | `getZXingModule` exists but is marked `@deprecated` in v3.1.0. The current API is `prepareZXingModule`. PRD correctly uses `prepareZXingModule` — no action needed, but the deprecated name should not appear in new code. |
| nutrition/page.tsx passes quickPickFoods to LogNutritionForm | **NOT YET** | Currently `<LogNutritionForm />` is called with no props. The page will need to add server-side `getQuickPickFoods()` call and pass the result as a prop. |
| `revalidatePath("/nutrition")` already called in `logNutrition` | **CONFIRMED** | `workout-actions.ts` lines 219-220: `revalidatePath("/"); revalidatePath("/nutrition")`. No change needed there. |
