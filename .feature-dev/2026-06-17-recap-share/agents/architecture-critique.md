# Architecture Critique — #93 Recap Share

**Role:** Devil's Advocate  
**Date:** 2026-06-17  
**Reviewed:** `architecture-blueprint.md`, `docs/prds/PRD-recap-share.md`, and all source files listed in the blueprint header.

---

## CRITICAL

### C-1 — PRD's fallback download code is broken; Developer must not copy it

**Severity:** Critical (silent Safari failure on the fallback path)

The PRD (`docs/prds/PRD-recap-share.md:47–49`) shows this fallback snippet:
```ts
const a = document.createElement("a"); a.href = url; a.download = "recap-card.png"; a.click();
URL.revokeObjectURL(url);
```
This skips `document.body.appendChild(a)` and `document.body.removeChild(a)` entirely.

The authoritative reference (`src/components/ShareWorkout.tsx:37–43`) uses the full sequence:
```ts
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
```
Safari requires the anchor to be in the DOM before `.click()` fires a `download`. Without `appendChild`, the download silently does nothing on Safari and iOS when Web Share files isn't available (i.e., the one browser family where the fallback path is most likely to run).

The blueprint handler (`architecture-blueprint.md:155–161`) correctly uses the full pattern. **The Developer must use the blueprint's handler verbatim, not the PRD snippet.** This is the single most likely copy-paste trap in the spec documents.

---

### C-2 — `sharing` and `shareError` are not reset on week navigation

**Severity:** Critical (UI lock + stale error)

`navigateToWeek()` (`src/components/RecapClient.tsx:55–62`) resets `candidates`, `highlightValue`, `customText`, and `imageLoading`. It does NOT reset `sharing` or `shareError`.

If a user clicks Share, then immediately navigates to a different week while the card/caption are still fetching, two things happen:
1. The Share button remains `disabled={sharing}` (locked, no way to Share on the new week until the OLD week's fetch resolves).
2. When the OLD week's handler resolves, `setShareError(...)` or `setSharing(false)` fires against the NEW week's render — surfacing an error or file download for the wrong week.

The blueprint's JSX diff (`architecture-blueprint.md:§4`) and the list of new state (`§3`) never mention adding these resets to `navigateToWeek`. The fix is two lines in `navigateToWeek`:
```ts
setSharing(false);
setShareError(null);
```
These must be added alongside the existing resets. The in-flight fetch will still complete and call `setSharing(false)` again (harmless), but the UI will at least be unblocked.

---

## CONCERNS

### W-1 — iOS gesture-token timeout risk under cold Satori renders

**Severity:** Concern (intermittent iOS failure, hard to reproduce in dev)

iOS Safari enforces a ~5-second user-gesture token lifetime. The share handler calls `await Promise.all([fetch(captionUrl), fetch(cardUrl)])` before calling `navigator.share`. The blueprint notes the Satori render takes "1–3s" in warm conditions, but a cold Next.js serverless function startup can add several more seconds. If total latency exceeds ~5s, iOS drops the gesture token and `navigator.share` throws `NotAllowedError`. This would be caught by the outer catch, and the error message "Couldn't prepare the share. Try again." would appear — but the user has no way to understand why or know that a retry would be warm/faster.

The blueprint does not mention this risk anywhere (not in the edge-case matrix, not in QA). Mitigation options: pre-warm the card URL (the preview image fetch already does this — the `<img src={cardUrl}>` has loaded it before the user can click Share), or show a toast that the route is warming. At minimum the QA checklist should include a cold-start iOS test.

---

### W-2 — Blueprint mis-states TypeScript's `canShare` optionality

**Severity:** Concern (wrong reasoning, correct conclusion — potential confusion)

Blueprint §3 (`architecture-blueprint.md:114–116`) states:
> `navigator.canShare(data?: ShareData): boolean` — NOT optional on the Navigator interface type, but present as a real method. Optional chaining `navigator.canShare?.()` is valid TS even on a required member.

This is factually wrong about the type. In TypeScript's `lib.dom.d.ts`, `canShare` is declared as an optional method: `canShare?(data?: ShareData): boolean`. It IS typed as optional. Optional chaining is not just "valid on a required member" — it is structurally required because the type is genuinely optional.

The practical outcome (use `canShare?.()`, no assertions needed) is correct. But if the Developer reads this reasoning and decides the `?.` is just stylistic rather than necessary, they may drop it for some other target environment and introduce a runtime TypeError. The reasoning in the blueprint should say: `canShare` is optional in the TS dom lib (reflects real browser support gaps), therefore `?.` is both correct at the type level AND required for runtime safety.

---

### W-3 — Fallback shows "Web Share unavailable" note even when Web Share IS available but the user's file share failed

**Severity:** Concern (misleading error in an edge case)

The fallback path fires when `navigator.canShare?.({ files: [file] })` is falsy. This correctly covers: desktop Chrome (canShare returns `false` for files), no Web Share at all, older browsers. However, on **macOS Safari 16.4+**, `navigator.share` exists and `canShare` exists, but `canShare({ files })` returns `false` because macOS Safari does not support file sharing. The fallback correctly triggers, but the error note reads: "Web Share unavailable — caption copied + card downloaded."

To a macOS Safari user who DOES have Web Share (for text) but not for files, the message is technically inaccurate — "Web Share unavailable" is not quite right when only *file* sharing is unavailable. Low-stakes (single user), but worth a message tweak to "Sharing files unavailable — caption copied + card downloaded." or similar.

---

### W-4 — `shareError` paragraph has no `role="alert"` — screen readers won't announce it

**Severity:** Concern (a11y)

Blueprint JSX (`architecture-blueprint.md:221–223`):
```tsx
{shareError && (
  <p className="text-xs text-[var(--muted)] text-center -mt-2">{shareError}</p>
)}
```
This paragraph is conditionally rendered, but without `role="alert"` or `aria-live="polite"`, screen readers won't announce the injected error. The existing template toggle buttons and highlight picker use `aria-pressed` and `aria-label`, so this app is accessibility-aware. The paragraph should have `role="alert"` (or wrap the state in an `aria-live` region).

---

### W-5 — Double `computeWeeklyRecap` DB round-trip per Share press

**Severity:** Concern (performance — acceptable for a single-user app, worth knowing)

The Share handler fires `Promise.all([fetch(captionUrl), fetch(cardUrl)])`. Both routes call `computeWeeklyRecap(new Date(), { weekOffset, goalId })` independently, triggering two full DB aggregation queries against Neon. For a single user this is fine, and the card URL is likely already cached in the browser (the `<img>` preview already fetched it). The blueprint doesn't mention this duplication. No action needed for v1, but relevant if this ever runs on a multi-user path.

---

### W-6 — Silent empty caption on fetch failure gives no user signal

**Severity:** Low concern (UX gap)

Blueprint line 134:
```ts
const { caption } = capRes.ok ? ((await capRes.json()) as { caption: string }) : { caption: "" };
```
If the caption route returns a non-ok status (e.g., 500 due to DB error), the handler silently uses `caption: ""` and proceeds to share the image with no text. The edge-case matrix (`architecture-blueprint.md:273`) marks this ✓ as "handled". It IS handled gracefully, but the user gets no signal that the caption was dropped. A short "(no caption)" note in the `shareError` state when caption fails but image succeeds would be cleaner, but this is low-stakes for a single-user app.

---

## VERIFICATIONS (PASSED)

These are explicitly confirmed against the source code. The blueprint is correct on all of these.

### V-1 — `composeCaption` import path confirmed correct (two imports, both exist)

`src/lib/recap-caption.ts:152` exports `composeCaption(recap: WeeklyRecap, highlight: RecapHighlight | null): string`. ✓  
`src/lib/recap.ts:701` exports `resolveHighlight(recap: WeeklyRecap, param: string | null | undefined): RecapHighlight | null`. ✓  
The caption route's two-import pattern (`@/lib/recap` for `computeWeeklyRecap` + `resolveHighlight`; `@/lib/recap-caption` for `composeCaption`) is correct.

**Note:** The PRD (`PRD-recap-share.md:13`) has a misleading inline comment: `recap.ts: composeCaption(recap, highlight)` — `composeCaption` is NOT in `recap.ts`. The blueprint correctly identifies the right module. Developer should follow the blueprint's import block.

---

### V-2 — `resolveHighlight` signature matches both routes; highlight alignment is solid

Actual signature at `recap.ts:701–704`:
```ts
export function resolveHighlight(
  recap: WeeklyRecap,
  param: string | null | undefined,
): RecapHighlight | null
```
Both the card route (`card/route.tsx:28`) and the caption route (blueprint `§1:68`) call `resolveHighlight(recap, highlight)` with `highlight: string | undefined` (from `z.string().optional()`). The parameter type is compatible (zod optional → `string | undefined`, which satisfies `string | null | undefined`). Both routes call `computeWeeklyRecap(new Date(), { weekOffset, goalId })` with the same arguments. Since `resolveHighlight` is a pure, deterministic function, same inputs → same output. Caption and card highlight are guaranteed to match. ✓

---

### V-3 — Safari appendChild pattern is correct in the blueprint handler

`ShareWorkout.tsx:37–43` (authoritative reference) uses: `document.body.appendChild(a)` → `a.click()` → `document.body.removeChild(a)` → `URL.revokeObjectURL(url)`. The blueprint's `handleShare` (`architecture-blueprint.md:155–161`) matches this exactly. ✓  
The only broken code is in the PRD snippet (see C-1).

---

### V-4 — `canShare` gating is complete for all relevant browsers

The condition `typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })`:
- `navigator.share` undefined (old browsers): outer `typeof` check is true (navigator exists), inner `canShare?.` is `undefined` → falsy → fallback ✓
- `navigator.canShare` undefined (navigator.share exists but Level 2 not supported): optional chain → `undefined` → falsy → fallback ✓  
- `canShare({files})` returns `false` (desktop Chrome, macOS Safari): falsy → fallback ✓  
- All paths correctly route to fallback. No path where `navigator.share` is called but `canShare` returned `false`. ✓

---

### V-5 — AbortError handling is correct

`catch (e) { if ((e as Error)?.name !== "AbortError") setShareError(...) }` — `DOMException` (what `navigator.share` rejects with on user cancellation) has a `.name` property. `.name === "AbortError"` correctly identifies a dismissed share sheet. User cancellation is silently swallowed; all other errors show the note. ✓

---

### V-6 — SSR / render safety confirmed

`RecapClient.tsx:1`: `"use client"` ✓  
`navigator`, `document`, `URL.createObjectURL` appear only inside `handleShare()`, an async function bound to `onClick`. These are never evaluated at module scope or during the component's render pass. No SSR crash risk. ✓

---

### V-7 — TypeScript dom lib typing confirmed

`tsconfig.json:4`: `"lib": ["dom", "dom.iterable", "esnext"]` ✓  
`navigator.share`, `navigator.canShare`, `File`, `Blob`, `ShareData.files?: File[]` are all typed by the `dom` lib. `new File([blob], name, {type})` is fully typed — `Blob` satisfies `BlobPart`. No type assertions needed for the handler as written. ✓

---

### V-8 — Button tap targets and a11y preserved

Blueprint AFTER block: Share button `min-h-[44px]` ✓, Download Card `min-h-[44px]` ✓, story links `min-h-[44px]` ✓ (unchanged). Share button has `type="button"` ✓. Share button has visible text label "Share" / "Preparing…" — adequate for screen readers in absence of explicit `aria-label`. `disabled={sharing}` properly gates double-click. Story row structure is unchanged. ✓

---

### V-9 — Caption route error handling mirrors highlights route

Blueprint caption route: `if (!parsed.success) { return new Response("Invalid parameters", { status: 400 }); }` ✓  
Mirrors `highlights/route.ts:19–21` exactly. `computeWeeklyRecap` has a global try/catch that never throws (returns a safe fallback WeeklyRecap), and `composeCaption` is pure with no I/O. The route cannot throw past zod validation. ✓

---

## SUGGESTIONS

### S-1 — Pre-check `imageLoading` before enabling Share (optional UX polish)

The Share button is enabled even while the card preview `<img>` is still loading (`imageLoading === true`). Clicking Share while the image is loading triggers a second independent Satori render (the browser's `<img>` fetch and the handler's `fetch(cardUrl)` are separate requests). This is not a correctness bug, but the user might click Share and see "Preparing…" for longer than expected if the preview hasn't loaded yet. Consider `disabled={sharing || imageLoading}` with label "Loading…" / "Preparing…" / "Share" depending on state.

### S-2 — Explicitly test the cold-start path on iOS in the QA checklist

The QA checklist (`architecture-blueprint.md:§7`) lists only desktop Chrome (fallback) and "iOS Safari or Simulator". Add a cold-start step: deploy to Vercel preview, wait 10+ minutes for the function to freeze, then open /recap on iOS and press Share. This is where C-1 (wrong code), W-1 (gesture timeout), and the Satori warm-up path all converge in production.

### S-3 — Consider labeling `sharing` reset in the do-not-touch list

`navigateToWeek()` is not on the do-not-touch list since it IS being modified (implicitly — it needs the two new resets from C-2). The do-not-touch list covers the lib files correctly. No action needed beyond fixing C-2.

---

## VERDICT

**Approve with two required fixes before development begins.**

The blueprint's architecture is sound: imports are correct, the two-route structure mirrors the established pattern, the zod schema is right, and the highlight alignment argument is airtight. The blueprint improves on the PRD in the one place that matters most (the Safari download trap).

**The two fixes the Developer must make before writing a line of code:**

1. **(C-1) Do not copy the PRD's fallback snippet.** Use the blueprint's `handleShare` handler in full — specifically lines 155–161 with `document.body.appendChild(a)` and `document.body.removeChild(a)`. The PRD snippet at line 47–49 skips both calls and will silently fail on Safari.

2. **(C-2) Add `setSharing(false); setShareError(null);` to `navigateToWeek()`** in `RecapClient.tsx:55`. Without this, navigating weeks mid-share leaves the Share button permanently locked until the in-flight fetch completes, and can surface a stale error or download for the wrong week.

**The single most important thing the Developer must get right:**  
The fallback download path (`document.body.appendChild` / `removeChild` / `revokeObjectURL`) must be lifted verbatim from the blueprint handler — not from the PRD snippet. This is the highest-probability way the story ships broken: the PRD's code is wrong, the blueprint's code is right, and the two documents sit side by side in the same repo.
