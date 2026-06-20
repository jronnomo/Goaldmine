# Architecture Blueprint — #93 Recap Share

**Story:** One-tap Web Share button on /recap + `/recap/caption` JSON route  
**Date:** 2026-06-17  
**Author:** Architect Agent (read-only; produces spec only — no production code written)  
**Input files read:**
- `docs/prds/PRD-recap-share.md`
- `src/components/RecapClient.tsx`
- `src/app/recap/highlights/route.ts`
- `src/app/recap/card/route.tsx`
- `src/lib/recap.ts`
- `src/lib/recap-caption.ts`
- `src/components/ShareWorkout.tsx`
- `.claude/quality-tools.md`

---

## 1. New route — `src/app/recap/caption/route.ts`

### Decision: mirror `/recap/highlights/route.ts` exactly
**Alternative rejected:** A server action. Server actions add form-submission semantics; this is a pure GET with URL params mirroring the card route. The fetch-based approach in the client handler is simpler and allows `Promise.all` with the image fetch.

**Alternative rejected:** Inlining caption computation in a client-side function. `computeWeeklyRecap` uses Prisma and is server-only (it produces `Date` objects that cannot safely cross the boundary). The caption (a plain string) is the only safe thing to serialize.

### Confirmed imports
- `computeWeeklyRecap` — exported from `@/lib/recap`
- `resolveHighlight` — exported from `@/lib/recap` (signature: `resolveHighlight(recap: WeeklyRecap, param: string | null | undefined): RecapHighlight | null`)
- `composeCaption` — exported from `@/lib/recap-caption` (NOT from `@/lib/recap`; shipped in #92 as a separate module). Signature: `composeCaption(recap: WeeklyRecap, highlight: RecapHighlight | null): string`

### Confirmed zod schema
The card route (`CardParamsSchema`) uses:
- `weekOffset`: `z.coerce.number().int().min(-26).max(0).default(0)`
- `goalId`: `z.string().optional()`
- `highlight`: `z.string().optional()`

The caption route must parse `weekOffset` and `highlight` identically. `goalId` is included for forward-compatibility (matches the card route's full param surface). `template` is NOT needed — caption is text-only.

### Exact file: `src/app/recap/caption/route.ts`

```ts
// GET /recap/caption?weekOffset=&goalId=&highlight=
// Returns { caption: string } for the weekly recap share flow.
// Mirrors /recap/highlights/route.ts pattern exactly.
// composeCaption is server-only (computeWeeklyRecap uses Prisma + Date objects).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { z } from "zod";
import { computeWeeklyRecap, resolveHighlight } from "@/lib/recap";
import { composeCaption } from "@/lib/recap-caption";

const CaptionParamsSchema = z.object({
  weekOffset: z.coerce.number().int().min(-26).max(0).default(0),
  goalId: z.string().optional(),
  highlight: z.string().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = CaptionParamsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return new Response("Invalid parameters", { status: 400 });
  }
  const { weekOffset, goalId, highlight } = parsed.data;

  const recap = await computeWeeklyRecap(new Date(), { weekOffset, goalId });
  const fh = resolveHighlight(recap, highlight);
  return Response.json({ caption: composeCaption(recap, fh) });
}
```

**`runtime` / `dynamic`:** Both match the highlights route (`"nodejs"` / `"force-dynamic"`). Needed because `computeWeeklyRecap` uses Prisma (no Edge runtime) and must run fresh per-request (no ISR caching — data changes every workout).

---

## 2. The highlight param — how caption matches the previewed card

### Trace
In `RecapClient`:
```ts
const highlightParam = highlightValue
  ? `&highlight=${encodeURIComponent(highlightValue)}`
  : "";
const cardUrl = `/recap/card?weekOffset=${currentWeek.offset}&template=${template}${highlightParam}`;
```

The caption handler (inside `handleShare`) will build:
```ts
const captionUrl = `/recap/caption?weekOffset=${currentWeek.offset}${highlightParam}`;
```

`searchParams.get('highlight')` auto-decodes the percent-encoding, so the raw `highlightValue` string (e.g. `"pr:Goblet Squat"`) arrives at both the card route and the caption route identically.

Both routes call `resolveHighlight(recap, highlight)` with the same string and the same `recap` data (same `weekOffset`, same `goalId` = undefined → focus goal). The `resolveHighlight` function is deterministic for a given recap + param: same string → same `RecapHighlight | null`. The caption therefore describes exactly the highlight shown on the card.

**Special cases:**
- `highlightValue = ""` → `highlightParam = ""` → neither URL has `?highlight=` → `searchParams.get('highlight')` → `null` → `resolveHighlight(recap, null)` → `null` → no highlight in caption ✓
- `highlightValue = "custom:some text"` → encoded as `"custom%3Asome%20text"` → decoded back to `"custom:some text"` → `resolveHighlight` returns custom highlight ✓
- `highlightValue = "pr:Goblet Squat"` → encoded, decoded back → `recap.highlights.find(h => h.id === "pr:Goblet Squat")` ✓

---

## 3. `RecapClient` share handler

### New state (add after existing `useState` declarations, file:line ~28–30)
```ts
const [sharing, setSharing] = useState(false);
const [shareError, setShareError] = useState<string | null>(null);
```

### TypeScript / DOM lib notes
TypeScript 5.9.3 with `"lib": ["dom", "dom.iterable", "esnext"]` (confirmed in `tsconfig.json`) fully types:
- `navigator.canShare(data?: ShareData): boolean` — NOT optional on the `Navigator` interface type, but present as a real method. Optional chaining `navigator.canShare?.()` is valid TS even on a required member; no type assertion needed.
- `navigator.share(data?: ShareData): Promise<void>` — typed, no assertion needed.
- `new File([blob], name, {type})` — `File` constructor accepts `BlobPart[]` (a `Blob` is a `BlobPart`); no typing gotcha.
- `ShareData.files?: File[]` — typed; passing `[file]` satisfies `File[]`.

The `typeof navigator !== "undefined"` guard is needed because Next.js pre-renders client components on the server for the initial HTML skeleton. Even though `handleShare` is only called on click (never during render), TypeScript doesn't narrow globals in function bodies — `typeof` guard is both runtime-correct AND communicates intent. No `as any` or `@ts-ignore` required.

### Exact handler (add above the `return` statement, after existing handler functions)
```ts
async function handleShare() {
  setSharing(true);
  setShareError(null);
  try {
    const captionUrl = `/recap/caption?weekOffset=${currentWeek.offset}${highlightParam}`;
    const [capRes, imgRes] = await Promise.all([
      fetch(captionUrl),
      fetch(cardUrl),
    ]);

    // Caption is best-effort: if the fetch fails, share with empty caption
    const { caption } = capRes.ok ? ((await capRes.json()) as { caption: string }) : { caption: "" };

    if (!imgRes.ok) {
      setShareError("Couldn't load the recap card. Try again.");
      return;
    }
    const blob = await imgRes.blob();
    const file = new File([blob], "recap-card.png", { type: "image/png" });

    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: caption });
    } else {
      // Fallback: copy caption to clipboard + trigger PNG download
      try {
        if (typeof navigator !== "undefined") {
          await navigator.clipboard?.writeText(caption);
        }
      } catch {
        // clipboard unavailable — swallow, best-effort copy
      }
      // Use the ShareWorkout blob-download pattern (append→click→remove for Safari)
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "recap-card.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShareError("Web Share unavailable — caption copied + card downloaded.");
    }
  } catch (e) {
    // AbortError = user dismissed the OS share sheet → NOT an error
    if ((e as Error)?.name !== "AbortError") {
      setShareError("Couldn't prepare the share. Try again.");
    }
  } finally {
    setSharing(false);
  }
}
```

**Critical divergence from the PRD's proposed code:** The PRD shows `a.click()` without `document.body.appendChild(a)`. The `ShareWorkout` pattern (the authoritative reference) does `document.body.appendChild(a)` → `a.click()` → `document.body.removeChild(a)`. Safari requires the anchor to be in the DOM for `download` click to trigger. **Use the ShareWorkout pattern.** The PRD's simplified version risks silent failures on Safari/iOS when the Web Share fallback runs.

---

## 4. JSX diff — buttons block (RecapClient.tsx:202–223)

### BEFORE (lines 202–223)
```tsx
      {/* Download card (includes highlight param if set) */}
      <a
        href={cardUrl}
        download="recap-card.png"
        className="flex items-center justify-center min-h-[44px] w-full rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Download Card
      </a>

      {/* Download stories (no highlight — slides are unchanged) */}
      <div className="flex gap-2">
        {([1, 2, 3] as const).map((slide) => (
          <a
            key={slide}
            href={storyUrl(slide)}
            download={`recap-story-${slide}.png`}
            className="flex-1 flex items-center justify-center min-h-[44px] rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] hover:text-foreground transition-colors"
          >
            Story {slide}
          </a>
        ))}
      </div>
```

### AFTER
```tsx
      {/* Share — primary CTA (accent, full-width) */}
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className="flex items-center justify-center min-h-[44px] w-full rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {sharing ? "Preparing…" : "Share"}
      </button>

      {/* Share error — muted note, hidden unless set */}
      {shareError && (
        <p className="text-xs text-[var(--muted)] text-center -mt-2">{shareError}</p>
      )}

      {/* Download card — secondary action (border style) */}
      <a
        href={cardUrl}
        download="recap-card.png"
        className="flex items-center justify-center min-h-[44px] w-full rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] hover:text-foreground transition-colors"
      >
        Download Card
      </a>

      {/* Download stories (no highlight — slides are unchanged) */}
      <div className="flex gap-2">
        {([1, 2, 3] as const).map((slide) => (
          <a
            key={slide}
            href={storyUrl(slide)}
            download={`recap-story-${slide}.png`}
            className="flex-1 flex items-center justify-center min-h-[44px] rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] hover:text-foreground transition-colors"
          >
            Story {slide}
          </a>
        ))}
      </div>
```

**Changes:**
- New `<button>` replaces the `<a>` as the primary CTA. Uses `bg-[var(--accent)]` (was on Download Card). Shows `disabled={sharing}` + `disabled:opacity-50`.
- `shareError` conditional paragraph inserted immediately after the Share button (negative top margin collapses the gap).
- Download Card `<a>` demoted to border style (was accent; now matches the story links style).
- Story links: unchanged.

---

## 5. SSR / client-safety confirmation

`RecapClient.tsx` is already `"use client"` (line 1). `navigator` and `document` are touched only inside `handleShare`, which is called from a `onClick` handler — never at module scope, never in the render/return block, never in a `useEffect` without guard. SSR pre-renders the component tree but does not invoke click handlers. No SSR crash risk.

**Additional guard check:** `navigator.clipboard?.writeText(caption)` uses optional chaining — if `clipboard` is unavailable (http context, older browser), it silently no-ops. This is already in the handler.

---

## 6. Edge cases — full matrix

| Scenario | Path | Handled? |
|---|---|---|
| Web Share with files supported (iOS Safari, Android Chrome) | `canShare({files:[file]})` → `true` → `navigator.share(...)` → OS share sheet | ✓ |
| User cancels OS share sheet | `navigator.share` rejects with `AbortError` → `catch (e)` → `name === "AbortError"` → silently skipped, no error shown | ✓ |
| Web Share absent (`navigator.share` undefined) | `typeof navigator !== "undefined"` is true but `canShare?.()` is falsy (optional chain on undefined → `undefined` which is falsy) → fallback | ✓ |
| `canShare` present but files not supported (desktop Chrome) | `canShare({files:[file]})` returns `false` → fallback | ✓ |
| Caption fetch fails (5xx, network error) | `capRes.ok` false → `caption = ""` → continue with image-only share | ✓ |
| Image fetch fails | `imgRes.ok` false → `setShareError(...)` + `return` (no share attempted) | ✓ |
| `navigator.clipboard` unavailable (http, blocked by permissions) | `try/catch` around `clipboard?.writeText` → swallowed | ✓ |
| `navigator.canShare` absent (older browser, `navigator.share` also absent) | Optional chaining `canShare?.({files})` → `undefined` → falsy → fallback | ✓ |

**Does `canShare?.({files})` correctly gate ALL to the fallback?** Yes, with the `typeof navigator !== "undefined"` outer guard. The full condition is:

```ts
if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
```

This evaluates to `true` only when: (a) navigator exists AND (b) `canShare` is a function AND (c) it returns `true` for a file payload. Any other combination → fallback.

---

## 7. Testing

### Caption route — curl-testable (no Vitest needed)
With dev server running:
```sh
curl 'http://localhost:3000/recap/caption?weekOffset=0'
# → { "caption": "..." }

curl 'http://localhost:3000/recap/caption?weekOffset=-1&highlight=auto'
# → { "caption": "..." } (prior week, auto-selects top highlight)

curl 'http://localhost:3000/recap/caption?weekOffset=999'
# → 400 Invalid parameters
```

`composeCaption` itself has Vitest tests in `src/lib/recap-caption.test.ts` (shipped with #92) — no new test file needed for the route, as the route is a thin wrapper.

### Share handler — browser smoke only
`navigator.share` is not available in jsdom (Node test environment). No Vitest test is appropriate. Verify by:
1. Desktop Chrome at 390 px: click Share → fallback path fires (canShare returns false for files on desktop) → caption copied + card downloaded + muted note appears.
2. iOS Safari (or Simulator): click Share → OS share sheet appears → can send to Instagram/Messages.

---

## Do-NOT-touch list

| File | Reason |
|---|---|
| `src/lib/recap.ts` | No changes — `resolveHighlight` and `computeWeeklyRecap` are used as-is |
| `src/lib/recap-caption.ts` | No changes — `composeCaption` is used as-is |
| `src/app/recap/card/route.tsx` | No changes — card route is unchanged |
| `src/app/recap/highlights/route.ts` | No changes — mirrored, not modified |
| `src/components/ShareWorkout.tsx` | Pattern reference only — not modified |
| Story slide routes | PRD explicitly states stories are unchanged |
| Any server component in `/recap` | RecapClient is the only touch point on the page |

---

## Files to create/modify

| File | Action | Description |
|---|---|---|
| `src/app/recap/caption/route.ts` | CREATE | New GET route; caption JSON endpoint |
| `src/components/RecapClient.tsx` | MODIFY | Add `sharing`/`shareError` state, `handleShare` function, JSX button swap |

---

## QA checklist for Developer agent

1. `npx tsc --noEmit` — zero errors after changes
2. `npm run lint` — zero lint warnings (check for any unused `import type` if you add them)
3. `npm run build` — Turbopack production build passes; the new route shows in build output
4. `curl 'http://localhost:3000/recap/caption?weekOffset=0'` with dev server → `{"caption":"..."}` (non-empty)
5. `curl 'http://localhost:3000/recap/caption?weekOffset=999'` → 400
6. Browser at 390 px: Share is the full-width accent button; Download Card is the border-style secondary
7. Desktop: clicking Share triggers fallback (no Web Share files on desktop) — toast note appears, card downloads
8. `grep -nE "setHours|getDate\(\|getMonth\(" src/components/RecapClient.tsx src/app/recap/caption/route.ts` → no output (no raw date primitives added)
