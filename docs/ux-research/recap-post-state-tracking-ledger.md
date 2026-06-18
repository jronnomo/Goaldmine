# Recommendation Ledger — recap-post-state-tracking (#95, Story 3.4-d)

> Stable IDs; assigned once, never renumbered. `Status` starts `proposed`.
> The implementing PR ticks each row to `shipped` / `reworked` / `dropped`
> with a SHA / `file:line` / short reason in **Evidence**.
> Every ⚠ row is a tuning/decoration item — confirm it on a real 390px screen
> in BOTH light and dark before shipping.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-95-01 | Render an inline `aria-live="polite"` status line **above** the Share button (Direction a), reusing the LogNoteForm reserved-height pattern verbatim. | layout | shipped | `RecapClient.tsx` — `<p className="text-sm min-h-[1.25rem] text-center text-[var(--success)]" aria-live="polite">` above the Share button |
| UXR-95-02 | Status copy is the literal `Posted to Instagram` (or `Posted`); the `✓` is a unicode glyph wrapped `aria-hidden`, colored `var(--success)`, like NutritionToday. No SVG, no icon lib. | copy | shipped | `RecapClient.tsx` — `<span aria-hidden="true">✓ </span>Posted to Instagram`, color `text-[var(--success)]` |
| UXR-95-03 | Live region is mounted **at render with reserved min-height** (not conditionally inserted) so the optimistic update mutates existing text and reliably announces with zero layout shift. | a11y | shipped | `RecapClient.tsx` — `<p>` always mounted, `min-h-[1.25rem]`, content `{isPosted ? … : null}` |
| UXR-95-04 | Use bare `aria-live="polite"` — do NOT also set `role="status"` on the same node (it implies polite); never call `.focus()` (no focus theft). Keep `role="alert"` for the existing error path. | a11y | shipped | `RecapClient.tsx` — `aria-live="polite"` only; error path retains `role="alert"` |
| UXR-95-05 | Once posted, **demote the Share button** from primary accent to secondary border style (`border var(--border)`, text `var(--muted)`/foreground — NOT `opacity-50`) and relabel `Share` → `Share again`. Un-posted state unchanged (accent primary). | component | shipped | `RecapClient.tsx` — `isPosted ? "border border-[var(--border)] text-[var(--muted)] hover:text-foreground" : "bg-[var(--accent)] …"`; label `isPosted ? "Share again" : "Share"`. User signed off 2026-06-17. |
| UXR-95-06 | Preserve the visible focus ring on the Share button across the accent→secondary transition; verify the demoted button does not read as disabled. | a11y | shipped | `RecapClient.tsx` — `disabled={sharing}` only (not isPosted); no `opacity-50` in posted branch |
| UXR-95-07 | Ship a **bare `Posted ✓`** (no timestamp) at launch — restraint. Relative-time ("posted Sun") is deferred. | copy | shipped | bare "✓ Posted to Instagram", no timestamp |
| UXR-95-08 ⚠ | Optional weekday tail: show a relative weekday ONLY when the post-date ≠ today (cheap — `shared_recap.date` exists). Gate behind a playtest; cutoff calendar-day vs 24h rolling is unvalidated. | tuning⚠ | dropped | deferred per restraint (B-5); not built at launch |
| UXR-95-09 ⚠ | Status-line fade-in 120–200ms ease-out, CSS transition only, honor `prefers-reduced-motion` (→ no transition). Provisional. | tuning⚠ | dropped | skipped per B-4 ("skip if it complicates markup"); bare appearance shipped |
| UXR-95-10 ⚠ | If a tinted background/border is used on any posted affordance: border `var(--success)`/0.30–0.50, fill `var(--success)`/0.08–0.14. Provisional; verify AA. | tuning⚠ | dropped | no tint shipped — bare text line only (B-5) |
| UXR-95-11 ⚠ | Reserved live-region height `min-h-[1rem]`…`[1.25rem]` (allow for an optional wrapped weekday tail). Provisional. | tuning⚠ | shipped | `min-h-[1.25rem]` chosen (upper bound; no weekday tail) |
| UXR-95-12 | Do NOT use the Bullseye glyph / target-red for "posted" — it over-celebrates routine housekeeping and dilutes the once-per-day bullseye-pop. Keep this surface calm. | decoration⚠ | shipped | confirmed OUT — only sage `--success` ✓ glyph used |
| UXR-95-13 | Do NOT overlay a corner check-badge on the card preview image (Direction d) — decoration, AA-fragile over arbitrary pixels. Dropped. | decoration⚠ | dropped | not built — confirmed out |
| UXR-95-14 | Per-week selector chip (Direction c) is a deferred OPTIONAL — add later only if multi-week "which weeks did I post" legibility is wanted; not at launch (selector row is tight at 390px; user shares the current week). | layout | dropped | deferred per B-5; not at launch |
| UXR-95-15 | Fix pre-existing token violation: Share button hardcodes `text-white` (RecapClient.tsx:269) — switch to `text-[var(--accent-fg)]` when touching it for the posted state. | a11y | shipped | `RecapClient.tsx` — primary branch now `text-[var(--accent-fg)]` |
| UXR-95-16 | Verify WCAG AA: sage `var(--success)` on `var(--card)` in BOTH light (#4E6B36 on #FFFBF0) and dark (#7FA45C on #1A130C); the cream/gold light palette is contrast-tight. | a11y | shipped | verified — light **5.84:1**, dark **6.45:1**, both > AA 4.5:1 |
