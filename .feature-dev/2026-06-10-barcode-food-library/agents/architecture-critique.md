# Architecture Critique — Barcode Food Library (issue #66)

**Agent**: Devil's Advocate Agent  
**Date**: 2026-06-10  
**Blueprint reviewed**: architecture-blueprint.md  
**Source files verified**: LogNutritionForm.tsx, use-form-feedback.ts, BottomSheet.tsx, BadgeWall.tsx, LogLauncher.tsx, BottomNav.tsx, MacroInputs.tsx, workout-actions.ts (parseItemsTextarea), schema.prisma, package.json, project-gotchas.md, quality-tools.md

---

## Verdict: NEEDS REVISION

Two High issues must be resolved before dev agents start building. Four Medium issues should be addressed before integration. All others are advisory.

---

## 1. Critical Issues

### C-1 — None

No single issue will cause data corruption or make the feature entirely non-functional. The High issues below are the stop-the-presses concerns.

---

## 2. High Issues

### H-1 — Camera track leak on close-during-startCamera (HIGH)

**What**: `stopCamera()` clears `streamRef.current = null`, but an in-flight `getUserMedia()` call started by `startCamera()` may resolve AFTER `stopCamera()` runs. When `getUserMedia` resolves, `startCamera` continues:
```typescript
streamRef.current = stream;     // orphan stream — stopCamera already ran
videoRef.current.srcObject = stream;
await videoRef.current.play();
```
The stream's tracks are now running but `streamRef.current` was set by the late-resolving call after the cleanup path already cleared it. A second `startCamera()` call (from visibilitychange restart, for example) may then set a *new* `streamRef.current`, leaving the first stream's tracks running permanently. On iOS, the green camera-in-use indicator stays on after the sheet closes.

**Why it matters**: This can happen in every close path — accordion Esc, backdrop tap, route change, visibilitychange — during the camera-initialization window (typically 200–800 ms). iOS users will see the camera indicator stuck on after scanning. Battery and privacy concern.

**How to fix**: Add a cancellation ref inside `startCamera`:
```typescript
async function startCamera() {
  const thisCall = ++startCallRef.current; // monotonically increasing id
  setScannerState("starting");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ ... });
    if (thisCall !== startCallRef.current) {
      // A newer call (or stopCamera) has taken over — discard this stream
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    streamRef.current = stream;
    // ... rest of setup
  } catch { ... }
}

function stopCamera() {
  startCallRef.current++; // invalidate any in-flight startCamera
  streamRef.current?.getTracks().forEach(t => t.stop());
  streamRef.current = null;
  // ...
}
```

Blueprint risk table (R4) acknowledges the race but proposes only that `startCamera()` "catches any error from an interrupted getUserMedia." It does NOT address the case where getUserMedia succeeds after `stopCamera` already ran. This distinction is load-bearing.

---

### H-2 — `handleAdd` has two contradictory versions; dev agents will implement the wrong one (HIGH)

**What**: Blueprint §8.2 shows `handleAdd` calling `recordFoodUse(food.id)` unconditionally (first version), then 13 lines later corrects this with a `chipSource` flag and a conditional call. The first version double-counts usage for every scan path (`lookupBarcode` already bumps `usageCount`; a second `recordFoodUse` call makes every scan inflate usage twice).

**Why it matters**: Stream C's dev agent will likely implement from the first complete code block they read. The correction is an inline editorial note that breaks the narrative flow. The final `AddFoodPayload` type with `chipSource?` is in §13 (decisions table), not adjacent to the corrected code. This is a trap.

**How to fix**: Remove the first (incorrect) version of `handleAdd` entirely. Keep only the `chipSource`-conditional form. Make `chipSource` part of `AddFoodPayload` in the §3 types spec, not as an afterthought in §8.2. Canonical single source of truth.

---

## 3. Design Concerns (Medium)

### M-1 — BadgeWall "stacked dialog" precedent is FALSE — claim is unverified in codebase (MEDIUM)

**What**: The research output §3 and blueprint §7 both state "This is identical to the BadgeWall pattern. No z-index fighting, no workarounds needed. … confirmed working in the existing codebase." This is incorrect.

**Verified from source**:
- `BadgeWall` is used at `src/app/character/page.tsx:185` — a plain page, NOT inside a BottomSheet.
- `BadgeWall` opens its OWN BottomSheet for badge details. This is a single `showModal()` call; no nesting.
- There is no instance in the codebase of a BottomSheet opened while another BottomSheet is already open via `showModal()`.

The stacked-dialog pattern (second `showModal()` while first dialog is already modal) is therefore **untested in this codebase**. The claim "confirmed working" is an error in the research output that the architect accepted without checking the source.

**Does this mean stacking won't work?** Not necessarily. The HTML spec says top-layer elements are stacked in `showModal()` call order. The second dialog appears above the first, with its own `::backdrop` covering the first dialog's content. Esc fires `cancel` on the topmost dialog only. Body overflow cleanup is safe (inner restores to "hidden", outer restores original). Theoretically sound.

**Why it still matters**: 
1. The "confirmed" language gives false assurance. Testing nested-dialog behavior on iOS Safari (especially focus return, Esc key, backdrop layers, and voiceover behavior) is a required smoke test before shipping, not a "confirmed done" item.
2. A gap: `BottomSheet`'s show/close effect has NO cleanup function returned. If `LogNutritionForm` somehow unmounts while `ScanFoodSheet`'s native `<dialog>` is open (`showModal()` was called), the native dialog stays in the DOM with no React tree owning it — orphaned. In practice this is prevented by the focus trap (ScanFoodSheet captures all input while open, so the user cannot collapse the Meal accordion that would unmount LogNutritionForm), but the BottomSheet implementation is fragile on this point. Consider adding a cleanup return to the show-effect: `return () => { if (dialog.open) dialog.close(); }`.

**Must-test checklist** (add to §10 test plan):
- [ ] Esc with ScanFoodSheet open: closes scan sheet only, Log sheet stays open
- [ ] Tap backdrop of scan sheet: closes scan sheet only
- [ ] Back button (Android) while scan sheet open: closes scan sheet only
- [ ] iOS VoiceOver: focus trapped to scan sheet correctly
- [ ] iOS: green camera indicator clears when scan sheet closes

---

### M-2 — EAN-8 zero-padding violates PRD §3.1.3 (MEDIUM)

**What**: Blueprint §5.1 sets:
```typescript
const padded13 = barcode.padStart(13, "0");
```
and uses `padded13` as the canonical upsert key for ALL barcodes including 8-digit EAN-8. Padding "12345678" → "0000012345678" does NOT produce the EAN-13 for the same product. EAN-8 and EAN-13 are distinct formats.

**PRD §3.1.3** (verbatim): "barcode normalization edge: 8-digit EAN-8 zero-padding must NOT be applied (only 12→13)."

**Impact**: Library lookups still work for EAN-8 (the multi-form OR query includes both raw and padded forms; both are queried and the padded form matches the stored key). OFF API gets the correct 8-digit code. No user-visible bug. But the canonical storage key is wrong, which will cause confusion when inspecting the DB and violates the PRD's explicit normalization rule.

**Fix**:
```typescript
// Only pad 12-digit UPC-A → EAN-13; leave 8-digit EAN-8 as-is
const padded13 = barcode.length === 12 ? "0" + barcode : barcode;
```
Adjust the multi-form OR query and the retry logic accordingly (retry only fires for `barcode.length === 12`, which is already the case ✓).

---

### M-3 — `quickPick` chips are stale after in-session scan (MEDIUM)

**What**: `LogNutritionForm` initializes chip state:
```typescript
const [quickPick, setQuickPick] = useState<LibraryFood[]>(quickPickFoods ?? []);
```
`useState` initial value runs only once (on mount). After `lookupBarcode` fires `revalidatePath("/nutrition")`, the server component re-renders and passes an updated `quickPickFoods` prop. But `quickPick` state is NOT updated — `useState` ignores subsequent prop changes. The newly scanned food does NOT appear in chips for the rest of the current form session.

**Why it matters**: If the user scans three different items in one session, only the first would be in the chips by the third add. The PR says "same product next time appears in quick-pick chips without scanning." In-session updates are excluded from that promise, but the UX friction is noticeable for multi-item scan sessions.

**Fix**: Add a sync effect (only on the `/nutrition` page path where `quickPickFoods` is a prop):
```typescript
useEffect(() => {
  if (quickPickFoods !== undefined) {
    setQuickPick(quickPickFoods);
  }
}, [quickPickFoods]);
```
The `quickPickFoods === undefined` guard prevents the lazy-fetch path from interfering.

---

### M-4 — `willReadFrequently: true` missing from canvas context (MEDIUM)

**What**: The decode loop calls:
```typescript
const ctx = canvas.getContext("2d")!;
ctx.drawImage(video, ...);
const imageData = ctx.getImageData(0, 0, W, H);
```
Without `{ willReadFrequently: true }` on the first `getContext("2d")` call, the browser may GPU-accelerate the canvas. Each `getImageData` call then requires a GPU→CPU readback, which is expensive on mobile — typically 2–5 ms per frame on iPhone, adding to the 200 ms decode interval and increasing battery drain.

**Why it matters**: This is a 200 ms decode loop. On a hot GPU canvas, `getImageData` can spike the main thread. iOS is the primary platform. This is a commonly missed performance flag for `<canvas>` used for pixel reads.

**Fix**: Initialize the context once with the flag, either in a ref or by passing it on the first call:
```typescript
// In BarcodeScanner — module-level or in a ref init:
const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

// In decode loop, replace getContext per-frame with:
if (!ctxRef.current) {
  ctxRef.current = canvasRef.current!.getContext("2d", { willReadFrequently: true });
}
const ctx = ctxRef.current!;
```
`getContext` returns the same cached context object if called multiple times on the same canvas, but the flag only takes effect if set on the FIRST call.

---

### M-5 — OFF non-2xx response indiscriminately mapped to `not_found` (MEDIUM)

**What**:
```typescript
if (!res.ok) return { status: "not_found" };
```
An HTTP 429 (rate limit) or 500 (server error) returns `not_found`, causing the UI to show "Not in OpenFoodFacts — log it manually." This is incorrect: the product may exist; the request simply failed. PRD §6 says "OFF timeout/network failure → error state with retry." Non-2xx HTTP responses are failures, not absences.

**Why it matters**: On a transient OFF outage, the user is told their product is unknown and is sent to manual entry with no retry option, permanently writing no library record when the product exists. The Retry button is only shown for `{status:"error"}`.

**Fix**:
```typescript
if (!res.ok) {
  // 404 → product not in OFF; any other non-2xx → transient error
  return res.status === 404 
    ? { status: "not_found" } 
    : { status: "error", message: "OpenFoodFacts error — try again" };
}
```

---

### M-6 — `frequentFoods` query failure takes down all of `get_nutrition_history` (MEDIUM)

**What**: The blueprint wraps the `frequentFoods` query inside the existing `safe()` block of `get_nutrition_history`. If the FoodLibrary table doesn't exist yet (migration not applied) or the query fails, `safe()` catches the error and the ENTIRE tool returns an error — including `byDay` data that was fetched successfully.

**Blueprint acknowledges this**: "If the table doesn't exist yet (REQ-002 not yet applied), the build will fail — this is intentional." This is incorrect: the build won't fail (FoodLibrary is in the Prisma-generated client from the schema). It WILL fail at RUNTIME. Every `get_nutrition_history` call will fail until the migration is applied, breaking the coach's read of ALL nutrition history.

**Fix**: Wrap `frequentFoods` in an independent try/catch with graceful degradation:
```typescript
let frequentFoods: FrequentFood[] = [];
try {
  const rows = await prisma.foodLibrary.findMany({ ... take: 5, ... });
  frequentFoods = rows.map(toFrequentFood);
} catch {
  // FoodLibrary table missing or query error — degrade gracefully
}
return { since, days, mealType: mealType ?? null, entryCount: rows.length, frequentFoods, byDay };
```
This means the tool continues serving nutrition data even if the migration hasn't been applied.

---

## 4. Suggestions (Low)

### S-1 — Wasm-in-worktree DX gap: prescribe setup step for Stream B

`public/zxing/` is gitignored and not present in worktrees. Stream B's dev agent working in a worktree who runs `npm run dev:https` to test the scanner will get a 404 for `/zxing/zxing_reader.wasm`. The blueprint doesn't address this.

**Prescribe** in Stream B's work instructions: before running `dev:https` in the worktree, run:
```bash
node scripts/copy-zxing-wasm.mjs
```
This requires `node_modules/zxing-wasm` to be accessible from the worktree. If node_modules is symlinked from main checkout, `npm install zxing-wasm@3.1.0` in main (or a worktree-local install) must have already run.

---

### S-2 — No upper bound on servings stepper

The blueprint prescribes `decrement`: `max(MIN, s - STEP)` with minimum 0.5, but no maximum on `increment`. A runaway `+` button produces macro values like 150g protein for "50 servings of Greek yogurt." While not a data integrity issue, it creates obviously wrong entries.

**Prescribe** a reasonable cap: `MAX_SERVINGS = 20`. Apply as `min(MAX, s + STEP)` in increment. Disable `+` button when `servings >= MAX`.

---

### S-3 — `canvasRef.current!` non-null assertion unsafe in decode loop tail

In the decode loop, after `cancelled = true` is set (component unmounts or effect re-runs), the loop executes one more iteration before the `while (!cancelled)` check fires. In that iteration:
```typescript
const canvas = canvasRef.current!;  // ← can throw after unmount
```
The exception is caught by the outer `try/catch` (`// decode errors are transient; continue loop`) and the loop exits on the next while check. Not a visible bug, but a misleading error in the catch handler.

**Fix**: Replace `!` with a null guard:
```typescript
const canvas = canvasRef.current;
if (!canvas || !decoderRef.current) continue;
```

---

### S-4 — `getQuickPickFoods()` on LogLauncher path has no loading state; UI is ambiguous

On the LogLauncher path, chips are empty (showing "Scan a barcode" button) while the lazy useEffect fetch is in-flight. A user with foods in their library sees the empty state momentarily on every accordion open. No loading indicator is prescribed.

**Options**: (a) Accept the flash as acceptable for v1 — the empty state is indistinguishable from a truly empty library, but the user sees a chip appear within ~500ms. (b) Add a `loadingChips` boolean state and show a skeleton row. Option (a) is probably fine for v1 but should be explicitly signed off rather than left as an omission.

---

### S-5 — Library staleness: no refresh mechanism is intentionally omitted — document it

`lookupBarcode` re-upserts (re-normalizes) on every new scan of a previously stored barcode (`update: { ...normalized.macros }` in the upsert). This means macros DO update on rescan, which is good. But it's only triggered by a new scan — passive use (chip taps) doesn't refresh data. If a manufacturer reformulates and the user relies on chips, the data is stale until they scan the barcode again.

This is acceptable for v1, but the behavior should be documented in comments on the upsert (already done in blueprint §5.1: "Re-normalize on re-encounter (OFF data can improve)"). No code change needed; add one line to the PRD §3.3 Out of Scope: "Library auto-refresh / staleness eviction."

---

### S-6 — `BottomSheet` fires `onClose` twice on Esc (pre-existing bug, heightened by nested sheets)

**Pre-existing**: `onCancel` calls `e.preventDefault()` (prevents native dialog close) then calls `onClose()` (first call). React re-renders, effect calls `dialog.close()`, which fires the native `close` event, which triggers React's `onClose` handler (second call). Both calls are idempotent for simple state setters like `setScanOpen(false)`. Not introduced by this feature, but worth noting when `ScanFoodSheet.onClose` has side effects (stopping camera, clearing `scanFoodInitial`): ensure all side effects are idempotent.

---

## 5. Items From Attack List — Verified OK

These were specifically targeted in the review brief and found to be correct:

| Item | Status |
|---|---|
| **Controlled-form failure path**: server action throws → useFormFeedback catch branch → `setError()` only; `formRef.reset()` and `onSuccess()` do NOT run → controlled state (`itemsText`, `macros`, `mealType`) is preserved ✓ | **OK** |
| **Controlled-form success path**: `formRef.reset()` → `onSuccess()` → `setItemsText("")`, `setMacros({...null})`, `setMealType(defaultMeal())` batched in same transition → single React re-render with clean state ✓ | **OK** |
| **Double-submit**: `pending=true` disables submit button; `startTransition` is not concurrent (inner async blocks the transition) ✓ | **OK** |
| **FormData snapshot**: controlled textarea value is synced by React to native DOM; `new FormData(formRef.current!)` captures controlled values correctly ✓ | **OK** |
| **parseItemsTextarea round-trip**: template `"Name (Brand) \| N serving(s)"` — pipe splits on first `\|` → namePart includes parens verbatim, qtyPart = "N serving(s)". Parentheses are not special. ✓ | **OK** |
| **Nested parens in qty**: `"1 serving (30 g)"` — only one `\|` in line → qtyPart stored verbatim, parser doesn't parse numbers from qty ✓ | **OK** |
| **Pipe-in-name hazard**: correctly identified in research §2; blueprint normalizes at ingest (strips `\|` in `normalizeOffProduct`) → DB-wide guarantee; `onAdd` omits sanitization correctly citing normalizer guarantee ✓ | **OK** |
| **Stacked dialog mechanics** (Esc on top only, backdrop closes top only, scroll lock safe): per native dialog spec and BottomSheet source, correct ✓ — see M-1 for caveats about unverified claim | **CAVEAT — see M-1** |
| **visibilitychange restart while sheet closed**: guard `if (!active) return;` prevents listener from being added when inactive. When sheet closes, `active=false` triggers effect cleanup → `removeEventListener`. No spurious restarts ✓ | **OK** |
| **zxing-wasm API accuracy**: `prepareZXingModule`, `readBarcodes`, HRI format strings, `locateFile` pattern all confirmed against v3.1.0 source in research §4 ✓ | **OK** |
| **Server action exposure**: barcode regex-validated (8–14 digits) before any I/O; not_found paths write nothing to DB; fixed OFF host (no SSRF); Next.js action ID provides obscurity; no secrets in library rows ✓ | **OK** |
| **Wasm chunk isolation**: `dynamic(ScanFoodSheet, {ssr:false})` in `LogNutritionForm` creates lazy chunk boundary; `BarcodeScanner` (static import of ScanFoodSheet) and `zxing-wasm` dynamic import inside `initDecoder` are both in lazy chunks; base bundle unaffected ✓ | **OK** |
| **OFF API `status` field semantics**: `status: 1` = found, `status: 0` = not found; `.product` nesting verified ✓ | **OK** |
| **revalidatePath during open form**: client component state preserved through RSC re-renders; no form clobber ✓ | **OK — see M-3 for chips caveat** |
| **Migration is additive only**: CREATE TABLE + 2 indexes, no ALTER/DROP on existing tables ✓ | **OK** |
| **connector cache**: covered by `MCP_SERVER_VERSION` bump on deploy per project-gotchas.md §C ✓ | **OK** |

---

## 6. Risk Table

| # | Risk | Severity | Status |
|---|------|----------|--------|
| R-H1 | Camera track leak on close-during-startCamera | HIGH | UNMITIGATED — add cancellation ref |
| R-H2 | handleAdd dual versions → double usage count if dev picks wrong one | HIGH | FIX BLUEPRINT |
| R-M1 | BadgeWall precedent false → untested nested dialog behavior | MEDIUM | ADD SMOKE TESTS |
| R-M2 | EAN-8 zero-padded to 13 digits (PRD violation) | MEDIUM | FIX padded13 formula |
| R-M3 | quickPick stale after in-session scan | MEDIUM | ADD sync useEffect |
| R-M4 | willReadFrequently missing → GPU readback on 200ms loop | MEDIUM | ADD to canvas init |
| R-M5 | OFF 429/5xx mapped to not_found | MEDIUM | FIX status gate |
| R-M6 | frequentFoods failure kills entire get_nutrition_history | MEDIUM | WRAP in independent try/catch |
| R-L1 | Wasm 404 in worktrees (Stream B DX) | LOW | DOCUMENT |
| R-L2 | No max on servings stepper | LOW | CAP at 20 |
| R-L3 | canvasRef! unsafe assertion at loop tail | LOW | NULL GUARD |
| R-L4 | Chips loading state omitted | LOW | ACCEPT for v1 |
| R-L5 | Library data staleness | LOW | DOCUMENT |
| R-L6 | Double onClose on Esc (pre-existing) | LOW | ENSURE idempotency |

---

## 7. Must-Fix Before Dev Starts

1. **Resolve H-1**: Add cancellation ref to `startCamera()`. `stopCamera()` increments a call counter; `startCamera` callback checks counter before adopting the stream.
2. **Resolve H-2**: Remove the first (unconditional) version of `handleAdd` from the blueprint. Keep only the `chipSource`-conditional version. Move `chipSource` into the §3 type definition.

## Should Fix Before Integration

3. **M-2**: Fix EAN-8 padding formula (`length === 12` gate).
4. **M-3**: Add `quickPickFoods` sync effect in `LogNutritionForm`.
5. **M-4**: Add `{ willReadFrequently: true }` to canvas context init (via ctx ref).
6. **M-5**: Differentiate OFF 404 vs 4xx/5xx in `fetchOff`.
7. **M-6**: Wrap `frequentFoods` query in independent try/catch → degrade to `[]`.

## Advisory (Low — fix or document as backlog)

8. S-1: Prescribe `node scripts/copy-zxing-wasm.mjs` for worktree setup.
9. S-2: Cap servings stepper at MAX_SERVINGS = 20.
10. S-3: Replace `canvasRef.current!` with null guard in decode loop.
