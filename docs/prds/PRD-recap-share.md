# PRD — One-tap Share on /recap (#93, story 3.4-b)

**Slug:** recap-share · **Issue:** #93 (board #8, Backlog, Medium, P2) · **Date:** 2026-06-17
**Depends on:** #92 (`composeCaption`, shipped). Epic #87. Decomposition: `docs/roadmap/content-flywheel-decomposition.md`.
**UX-research:** skipped — additive Share button using the platform Web Share API + the existing download fallback; the share sheet is OS-native; no new design-system work.

## 1. Goal
Posting the weekly card to Instagram becomes one tap on mobile: a **Share** action in `RecapClient` fetches the card PNG + a caption (#92) and calls `navigator.share({ files:[png], text: caption })` → the OS share sheet (→ Instagram). Graceful fallback (copy caption + download PNG) where Web Share with files isn't supported (most desktop browsers).

## 2. Confirmed surface (research)
- `RecapClient` (`"use client"`): state `weekIdx` → `currentWeek.offset`, `template`, `highlightValue` (`""` | candidate id | `"custom:<text>"`). `cardUrl = /recap/card?weekOffset=&template=&highlight=`. Existing `<a download="recap-card.png" href={cardUrl}>`. **No `goalId`** — the card/caption use the focus goal (route default).
- `/recap/highlights/route.ts` — the JSON-route pattern to mirror (`runtime nodejs`, `force-dynamic`, zod params, `computeWeeklyRecap` → `Response.json`).
- `recap.ts`: `composeCaption(recap, highlight)` (#92), `resolveHighlight(recap, param): RecapHighlight | null` (maps the `highlight` param to a highlight). `computeWeeklyRecap` is server-only (Dates) — must stay server-side.
- `ShareWorkout.tsx` has the clipboard + blob-download patterns to reuse.

## 3. Design

### 3.1 New route `src/app/recap/caption/route.ts` (mirrors `/recap/highlights`)
`GET /recap/caption?weekOffset&goalId?&highlight?` → `{ caption: string }`.
```ts
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
// zod: weekOffset coerce int -26..0 default 0; goalId optional; highlight optional string
const recap = await computeWeeklyRecap(new Date(), { weekOffset, goalId });
const highlight = resolveHighlight(recap, params.highlight);
return Response.json({ caption: composeCaption(recap, highlight) });
```
Keeps `WeeklyRecap` (Dates) server-side; only the string crosses the boundary.

### 3.2 `RecapClient` — the Share action
Add `const [sharing, setSharing] = useState(false)` + `const [shareError, setShareError] = useState<string | null>(null)`.
```ts
async function handleShare() {
  setSharing(true); setShareError(null);
  try {
    const [capRes, imgRes] = await Promise.all([
      fetch(`/recap/caption?weekOffset=${currentWeek.offset}${highlightParam}`),
      fetch(cardUrl),
    ]);
    const { caption } = capRes.ok ? await capRes.json() : { caption: "" };
    const blob = await imgRes.blob();
    const file = new File([blob], "recap-card.png", { type: "image/png" });
    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: caption });
    } else {
      // fallback: copy caption + download the card
      try { await navigator.clipboard?.writeText(caption); } catch {}
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "recap-card.png"; a.click();
      URL.revokeObjectURL(url);
      setShareError("Web Share unavailable — caption copied + card downloaded.");
    }
  } catch (e) {
    // AbortError = user cancelled the share sheet → not an error
    if ((e as Error)?.name !== "AbortError") setShareError("Couldn't prepare the share. Try again.");
  } finally {
    setSharing(false);
  }
}
```
- **Loading state (critic F3):** the Satori render takes ~1–3s → the Share button shows a disabled "Preparing…" state while `sharing`. `shareError` renders as a small muted note below the button.
- **`navigator.canShare?.({files})`** gates the share path (Web Share with files is mobile-mostly); fallback is the existing copy+download.
- **`AbortError`** (user dismisses the OS sheet) is NOT surfaced as an error.

### 3.3 Placement (mobile-first, 390px)
"Share" becomes the **primary CTA** (accent, full-width, above "Download Card"). "Download Card" stays as a secondary action (border style). Story downloads unchanged. Button label: `sharing ? "Preparing…" : "Share"`; `disabled={sharing}`.

## 4. Edge cases
- Web Share unsupported (desktop) → fallback copy+download + the muted note. ✓
- User cancels the share sheet (`AbortError`) → silent (no error). ✓
- Caption fetch fails → caption `""` (still shares the image); image fetch fails → caught → error note.
- `clipboard` unavailable → swallow (best-effort copy). 
- SSR: `RecapClient` is `"use client"`; `navigator`/`document` only touched inside the click handler (never at render) → no SSR crash.

## 5. Acceptance criteria
1. New `src/app/recap/caption/route.ts` returns `{caption}` via `composeCaption` (server-side; mirrors `/recap/highlights`; zod-validated params incl. `highlight`).
2. `RecapClient` has a Share button: fetches card PNG → `File` + caption → `navigator.share({files:[file], text})` when `canShare({files})`, else fallback copy-caption + download-PNG.
3. Visible loading/disabled state during the fetch ("Preparing…"); `AbortError` (cancel) is silent; other failures show a muted note.
4. Share is the primary CTA at 390px; Download Card remains as secondary; stories unchanged.
5. No `Date`/`WeeklyRecap` crosses to the client (only the caption string + the PNG blob). `navigator`/`document` used only in the handler, never at render.
6. `npx tsc --noEmit`, lint, `npm run build`, `npx vitest run` pass.

## 6. Verification
tsc · eslint · build · vitest. Dev server: `curl '/recap/caption?weekOffset=0'` → `{caption: "..."}` (a real caption for the focus goal). Browser at 390px: `/recap` shows the Share button as primary; on desktop (no Web Share files) clicking it copies the caption + downloads the card + shows the note (Web Share files isn't on most desktops — the fallback path is what's testable locally). `grep -nE "setHours|getDate\(|getMonth\(" src/components/RecapClient.tsx src/app/recap/caption/route.ts` → no new raw date primitives.
