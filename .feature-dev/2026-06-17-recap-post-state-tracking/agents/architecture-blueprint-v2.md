# Architecture Blueprint v2 — Revisions (#95)

**Read `architecture-blueprint.md` first.** This file records the changes from the Devil's-Advocate critique (`architecture-critique.md`) and the UX-research findings (`docs/ux-research/recap-post-state-tracking.md`). **Where v2 conflicts with v1, v2 wins.** All other v1 sections stand.

---

## A. Required code revisions (from Devil's Advocate)

### REV-1 (CRIT-1, HIGH) — Idempotency uses a calendar-day RANGE, not exact DateTime equality
In `markRecapPosted` (§3 of v1), replace the exact-equality `findFirst`:

```ts
// ❌ v1 (exact ms equality — misses MCP notes w/ null/non-midnight targetDate)
// where: { type: "shared_recap", targetDate: monday }

// ✅ v2 — tolerate any targetDate on that calendar day in USER_TZ
const existing = await prisma.note.findFirst({
  where: {
    type: "shared_recap",
    targetDate: { gte: monday, lt: addDays(monday, 1) },
  },
  select: { id: true },
});
```
This is the linchpin: with no DB unique constraint, the app-level guard MUST be robust. The range query also matches the `dateKey`-equality join the read path uses.

### REV-2 (CRIT-2, HIGH) — `await` the action; do NOT fire-and-forget
In `RecapClient.handleShare`, the optimistic `setLocallyPosted` stays synchronous (instant ✓), but the action is **awaited** (it never throws, so awaiting inside the existing try block is safe):

```ts
// after a completed share (native success OR fallback download):
setLocallyPosted((prev) => new Set([...prev, currentWeek.offset]));   // optimistic, instant
await markRecapPosted(currentWeek.offset);                            // ← await, NOT void
```
Awaiting guarantees `revalidatePath("/coach")` runs before the user can tab away — otherwise the nudge can stay visible (the feature's core promise). Zero UX cost: the ✓ is already on screen and the share sheet already dismissed.

### REV-3 (DC-1, MEDIUM) — Move `weekRangeLabel` to `calendar-core.ts` (keep streams disjoint)
`weekRangeLabel` is a pure label fn (only needs `startOfWeekMonday`/`endOfWeekSunday`/`addDays`/`Intl` + `USER_TZ`). Importing it from `@/lib/recap` drags the whole recap engine (prisma, game engine, records, readiness) into the server-action module graph. Fix, **entirely within the Backend stream**:
1. **Move** the `weekRangeLabel` definition from `src/lib/recap.ts` (lines ~231–249) into `src/lib/calendar-core.ts` (use the exported `USER_TZ` constant instead of `process.env.USER_TZ ?? "…"`).
2. In `src/lib/recap.ts`: `import { weekRangeLabel } from "./calendar-core";` and **re-export** it (`export { weekRangeLabel }` or add to the existing re-export block) so every current `@/lib/recap` consumer keeps working unchanged.
3. In `src/lib/recap-actions.ts`: `import { weekRangeLabel } from "@/lib/calendar";` (NOT from `@/lib/recap`).
4. **Do NOT change `src/app/recap/page.tsx`'s `weekRangeLabel` import** — it keeps importing from `@/lib/recap` (the re-export covers it). This avoids a cross-worktree dependency between the two dev streams.

### REV-4 (DC-2, MEDIUM) — Re-sync `locallyPosted` when `postedWeeks` prop changes
Add to `RecapClient` so a `{posted:false}` failure's optimistic ✓ reconciles to server truth on the next render, while never un-posting:
```ts
useEffect(() => {
  setLocallyPosted((prev) => {
    const merged = new Set(postedWeeks);
    prev.forEach((o) => merged.add(o)); // keep optimistic additions
    return merged;
  });
}, [postedWeeks]);
```

### REV-5 (S-1/MR-1, LOW) — `Math.trunc` the offset before clamping
```ts
const clampedOffset = Math.max(-12, Math.min(0, Math.trunc(weekOffset)));
```

### REV-6 (DC-3, S-2, S-4 — documentation, no behavior change)
- In `recap-actions.ts`, comment that `revalidatePath` clears the **client-side router cache** (both pages are `force-dynamic`; no server full-route cache).
- Add a header comment to `recap-actions.ts`: `"use server"` — all exports MUST be async functions; no sync helpers/consts/types here.
- In `tools.ts`, add a short comment by the `shared_recap` enum value: a `log_note` with `type:"shared_recap"` SHOULD pass `targetDate` = the week's Monday (yyyy-mm-dd), or the web idempotency guard can't match it.

---

## B. UX-researched "Posted" visual (fills the v1 §5.5 TODO slot)

Source: `docs/ux-research/recap-post-state-tracking.md`. Chosen direction = inline `aria-live` status line above Share + Share button demotes to secondary "Share again". User signed off on the demote (2026-06-17).

### B-1 — Status line (reuse `LogNoteForm.tsx:83` pattern verbatim)
A **persistent, reserved-height, mounted-empty** polite live region directly **above** the Share button. Mount it empty (NOT conditionally inserted) so the optimistic text mutation reliably announces:
```tsx
{/* Posted status — persistent polite live region, reserved height, no layout shift.
    Mounted empty so the optimistic text mutation announces (LogNoteForm.tsx:83 pattern). */}
<p
  className="text-sm min-h-[1.25rem] text-center text-[var(--success)]"
  aria-live="polite"
>
  {isPosted ? (
    <>
      <span aria-hidden="true">✓ </span>Posted to Instagram
    </>
  ) : null}
</p>
```
- A11y: the `✓` is `aria-hidden`; SR users hear "Posted to Instagram", not "check mark". `aria-live="polite"` only — do NOT also add `role="status"`. Never call `.focus()`.
- Token only: `text-[var(--success)]`. No tint/border needed for the bare line (the tinted-pill variants UXR-95-10 are NOT shipped at launch).

### B-2 — Share button: demote to secondary + relabel when `isPosted`
The Share button stays tappable (re-share is idempotent); it must NOT read as disabled (no `opacity-50`, keep the focus ring):
```tsx
<button
  type="button"
  onClick={handleShare}
  disabled={sharing}   // ← still ONLY sharing; isPosted does NOT disable
  className={`flex items-center justify-center min-h-[44px] w-full rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
    isPosted
      ? "border border-[var(--border)] text-[var(--muted)] hover:text-foreground"   // secondary
      : "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"                // primary
  }`}
>
  {sharing ? "Preparing…" : isPosted ? "Share again" : "Share"}
</button>
```

### B-3 — Fix the pre-existing token violation (UXR-95-15)
The current Share button hardcodes `text-white` (`RecapClient.tsx:269`). Replace with `text-[var(--accent-fg)]` (folded into the className above). This is the not-posted/primary branch color.

### B-4 — Optional, low-risk (include if trivial; otherwise skip)
- **Fade-in** (UXR-95-09 ⚠): a CSS-only opacity transition on the status text (120–200ms ease-out) is acceptable IF gated by `prefers-reduced-motion: reduce → none`. Skip if it complicates the markup — the bare appearance is fine.

### B-5 — Explicitly DEFERRED / DROPPED at launch (do NOT build)
- Relative-time "posted Sun" tail (UXR-95-08) — deferred.
- Per-week chip on the selector row (UXR-95-14) — deferred.
- Corner check-badge on the card preview (UXR-95-13) — dropped.
- Tinted pill background (UXR-95-10) — not at launch; bare line only.

### B-6 — QA must verify (UXR-95-16)
AA contrast of `--success` text on `--card` in BOTH light (`#4E6B36` on `#FFFBF0`) and dark (`#7FA45C` on `#1A130C`). Flag if it fails — this is the one tuning item to confirm on a real 390px screen.

---

## C. Stream assignment (updated)

| Stream | REQs | Files | New v2 work |
|--------|------|-------|-------------|
| **Backend** | REQ-001, REQ-002 | `src/lib/recap-actions.ts` (new), `src/lib/mcp/tools.ts`, `prisma/schema.prisma`, **`src/lib/calendar-core.ts`** (move `weekRangeLabel` in), **`src/lib/recap.ts`** (re-export `weekRangeLabel`) | REV-1, REV-3, REV-5, REV-6 |
| **Frontend** | REQ-003, REQ-004 | `src/app/recap/page.tsx`, `src/components/RecapClient.tsx` | REV-2, REV-4, B-1..B-4 |

Streams remain **disjoint** (REV-3's re-export keeps `page.tsx`'s import untouched). Frontend's `import { markRecapPosted } from "@/lib/recap-actions"` only needs the file+signature to exist — pinned in v1 §3 / v2 REV-1.

## D. Ledger obligation
The implementing work must tick every `UXR-95-*` row in `docs/ux-research/recap-post-state-tracking-ledger.md` to shipped/reworked/dropped with a `file:line` or reason. The orchestrator does this in Phase 7.
